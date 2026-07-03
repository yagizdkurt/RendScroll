/* Scene Progression Map panel.
   A right-side dock (debugPanel.js pattern) showing the campaign's scenes as a
   draggable node graph: which scene leads to which, with optional condition
   labels on the arrows. The DM keeps it open beside the reader — double-click
   a node to jump the reader there.

   Data model lives in src/sceneGraph/graphModel.js (pure, tested); this file
   is the view/controller. Manual nodes/edges persist per campaign in
   campaigns/<Name>/graph.json via GET /__scene_graph + POST /__save_scene_graph
   (debounced autosave). Edges can also be DERIVED from Transition cards inside
   scene files (extractTransitions, src/cards/transition/transition.js): those
   render locked — the card is their source of truth, the map only displays
   them and refuses to delete or relabel them here.

   All transform math is plain tx/ty/k arithmetic (no SVG matrix APIs) so the
   render path also runs under jsdom in tests. */

const SceneGraphPanel = (() => {
  const SVG_NS = "http://www.w3.org/2000/svg";
  const NODE_W = 160;
  const NODE_H = 56;
  const CLICK_DRAG_THRESHOLD = 4; // px of pointer travel that turns a click into a drag
  const ZOOM_MIN = 0.3;
  const ZOOM_MAX = 2.5;
  const WIDTH_KEY = "rendscroll-scenegraph-width";
  const EDGE_LABEL_GLYPH_W = 12.8;
  const EDGE_LABEL_BG_H = 36;

  const M = typeof SceneGraphModel !== "undefined" ? SceneGraphModel : null;

  // --- state -----------------------------------------------------------------
  let panel = null;
  let svg = null;
  let world = null;          // <g class="rsg-world"> carrying the pan/zoom transform
  let statusEl = null;
  let detailsEl = null;
  let edgeMenu = null;

  let graph = null;          // manual graph (graph.json content), null until loaded
  let readOnly = false;      // future-version graph.json: display, never write
  let prefix = "";           // "campaigns/<name>/" for rel<->full path conversion
  let loaded = false;        // graph fetched for the current campaign
  let derivedByScene = new Map(); // rel scene -> [{from,to,label,cardName}]
  let unresolvedRefs = [];   // Transition cards whose Scene: matched no file
  let displayEdges = [];     // merged manual+derived list the SVG renders from

  let selected = null;       // {kind:"node", scene} | {kind:"edge", edge} | {kind:"nodes", scenes}
  let selectedScenes = new Set();
  let view = { tx: 20, ty: 20, k: 1 };
  let gesture = null;        // active pointer gesture (pan/node/port)
  let pendingConnect = null; // {from, band} after Add transition until target click

  let dirty = false;
  let saveTimer = null;
  let saveDelayMs = 800;     // overridable in tests via api._setSaveDelay
  let saveState = "";        // "", "saving", "saved", "failed"

  // --- small helpers -----------------------------------------------------------
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function svgEl(tag, attrs) {
    const n = document.createElementNS(SVG_NS, tag);
    for (const k in attrs || {}) n.setAttribute(k, attrs[k]);
    return n;
  }
  function warn(msg, err) {
    if (typeof RSLog !== "undefined" && RSLog.warn) RSLog.warn("scenegraph", msg, err);
  }
  function entries() {
    return (typeof RendScrollApp !== "undefined" && RendScrollApp.campaignEntries)
      ? RendScrollApp.campaignEntries() : [];
  }
  function currentRelScene() {
    const full = (typeof RendScrollApp !== "undefined" && RendScrollApp.currentPath)
      ? RendScrollApp.currentPath() : null;
    return full ? M.toRelativeScene(full, prefix) : null;
  }
  function sceneLabel(rel) {
    const full = M.toFullPath(rel, prefix);
    const entry = entries().find((e) => String(e.path).replace(/\\/g, "/") === full);
    if (!entry) return rel.replace(/^scenes\//, "").replace(/\.md$/i, "");
    return (entry.number != null ? entry.number + ". " : "") + (entry.label || entry.file);
  }
  function nodeOf(rel) {
    return graph ? graph.nodes.find((n) => n.scene === rel) || null : null;
  }
  function isOpen() {
    return !!panel && panel.classList.contains("is-open");
  }

  // Screen (client) coords -> world coords under the current pan/zoom.
  function toWorld(clientX, clientY) {
    const rect = svg.getBoundingClientRect();
    return {
      x: (clientX - rect.left - view.tx) / view.k,
      y: (clientY - rect.top - view.ty) / view.k,
    };
  }

  // --- persistence -------------------------------------------------------------
  function setSaveState(state) {
    saveState = state;
    renderStatus();
  }

  function markDirty() {
    if (readOnly) return;
    dirty = true;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveTimer = null; flushSave(); }, saveDelayMs);
  }

  function flushSave(keepalive) {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (!dirty || !graph || readOnly) return Promise.resolve();
    dirty = false;
    setSaveState("saving");
    return fetch("/__save_scene_graph", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(graph),
      keepalive: !!keepalive,
    }).then((res) => {
      if (!res.ok) throw new Error("HTTP " + res.status);
      setSaveState("saved");
    }).catch((err) => {
      dirty = true; // keep the changes queued for the next flush
      setSaveState("failed");
      warn("Saving the scene graph failed.", err);
    });
  }

  async function loadGraph() {
    prefix = M.campaignPrefixFromEntries(entries());
    let raw = null;
    let serverWarning = "";
    try {
      const res = await fetch("/__scene_graph", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "HTTP " + res.status);
      raw = data.graph;
      serverWarning = data.warning || "";
    } catch (err) {
      warn("Loading the scene graph failed.", err);
      raw = null;
    }
    const norm = M.normalizeGraph(raw);
    graph = norm.graph;
    readOnly = norm.readOnly;
    norm.warnings.concat(serverWarning ? [serverWarning] : [])
      .forEach((w) => warn(w));
    loaded = true;
    syncScenes();
  }

  // Reconcile nodes with the sidebar's scene list; report prunes in the status.
  function syncScenes() {
    if (!graph) return;
    prefix = M.campaignPrefixFromEntries(entries());
    const rel = entries()
      .map((e) => M.toRelativeScene(e.path, prefix))
      .filter(Boolean);
    const res = M.syncWithScenes(graph, rel);
    graph = res.graph;
    if (res.changed) {
      if (res.prunedNodes || res.prunedEdges) {
        setStatusNote("Removed " + (res.prunedNodes + res.prunedEdges) +
          " entr" + ((res.prunedNodes + res.prunedEdges) === 1 ? "y" : "ies") +
          " for deleted scenes.");
      }
      markDirty();
    }
  }

  // --- Transition-card scan (derived edges) --------------------------------------
  async function scanSceneTransitions(entry) {
    const rel = M.toRelativeScene(entry.path, prefix);
    if (!rel) return;
    let text = "";
    try {
      text = await fetchMarkdown(entry.path);
    } catch (err) {
      warn("Could not read " + entry.path + " for the transition scan.", err);
      return;
    }
    const doc = RendScrollParser.parseRendScroll(text);
    const found = [];
    extractTransitions(doc).forEach((t) => {
      const target = findTransitionScene(entries(), t.sceneRef);
      if (!target) {
        unresolvedRefs.push({ scene: rel, cardName: t.name, sceneRef: t.sceneRef });
        return;
      }
      const toRel = M.toRelativeScene(target.path, prefix);
      if (!toRel || toRel === rel) return;
      found.push({ from: rel, to: toRel, label: t.name, cardName: t.name });
    });
    derivedByScene.set(rel, found);
  }

  async function scanAllTransitions() {
    derivedByScene = new Map();
    unresolvedRefs = [];
    await Promise.all(entries().map(scanSceneTransitions));
  }

  async function rescanScene(fullPath) {
    const entry = entries().find((e) => String(e.path).replace(/\\/g, "/") === String(fullPath).replace(/\\/g, "/"));
    if (!entry) return;
    const rel = M.toRelativeScene(entry.path, prefix);
    unresolvedRefs = unresolvedRefs.filter((u) => u.scene !== rel);
    await scanSceneTransitions(entry);
  }

  function derivedEdges() {
    const all = [];
    derivedByScene.forEach((list) => all.push(...list));
    return all;
  }

  // --- edge geometry --------------------------------------------------------------
  // Point where the line from this node's center toward (tx,ty) exits its rect.
  function rectExitPoint(node, tx, ty) {
    const cx = node.x + NODE_W / 2;
    const cy = node.y + NODE_H / 2;
    const dx = tx - cx;
    const dy = ty - cy;
    if (!dx && !dy) return { x: cx, y: cy };
    const sx = dx !== 0 ? (NODE_W / 2) / Math.abs(dx) : Infinity;
    const sy = dy !== 0 ? (NODE_H / 2) / Math.abs(dy) : Infinity;
    const s = Math.min(sx, sy);
    return { x: cx + dx * s, y: cy + dy * s };
  }

  function edgePath(edge) {
    const a = nodeOf(edge.from);
    const b = nodeOf(edge.to);
    if (!a || !b) return null;
    const acx = a.x + NODE_W / 2, acy = a.y + NODE_H / 2;
    const bcx = b.x + NODE_W / 2, bcy = b.y + NODE_H / 2;
    const p1 = rectExitPoint(a, bcx, bcy);
    const p2 = rectExitPoint(b, acx, acy);
    // Curve sideways when the reverse edge is also displayed, so A->B and B->A
    // don't overlap into one double-headed line.
    const hasReverse = displayEdges.some((e) => e.from === edge.to && e.to === edge.from);
    let mx = (p1.x + p2.x) / 2;
    let my = (p1.y + p2.y) / 2;
    if (hasReverse) {
      const dx = p2.x - p1.x, dy = p2.y - p1.y;
      const len = Math.hypot(dx, dy) || 1;
      mx += (-dy / len) * 24;
      my += (dx / len) * 24;
    }
    return {
      d: "M " + p1.x + " " + p1.y + " Q " + mx + " " + my + " " + p2.x + " " + p2.y,
      labelX: (p1.x + 2 * mx + p2.x) / 4, // quadratic midpoint
      labelY: (p1.y + 2 * my + p2.y) / 4,
    };
  }

  // --- rendering ---------------------------------------------------------------
  function applyViewTransform() {
    if (world) world.setAttribute("transform",
      "translate(" + view.tx + " " + view.ty + ") scale(" + view.k + ")");
  }

  let statusNote = "";
  function setStatusNote(text) {
    statusNote = text || "";
    renderStatus();
  }

  function renderStatus() {
    if (!statusEl) return;
    const bits = [];
    if (readOnly) bits.push("Read-only (newer graph format)");
    if (saveState === "saving") bits.push("Saving…");
    else if (saveState === "saved") bits.push("Saved");
    else if (saveState === "failed") bits.push("Save failed");
    if (unresolvedRefs.length) {
      bits.push(unresolvedRefs.length + " transition" + (unresolvedRefs.length === 1 ? "" : "s") +
        " point at missing scenes");
    }
    if (statusNote) bits.push(statusNote);
    statusEl.textContent = bits.join(" · ");
  }

  function closeEdgeMenu() {
    if (!edgeMenu) return;
    edgeMenu.remove();
    edgeMenu = null;
  }

  function cancelPendingConnect() {
    if (!pendingConnect) return;
    if (pendingConnect.band && pendingConnect.band.parentNode) {
      pendingConnect.band.remove();
    }
    pendingConnect = null;
  }

  function nodeIntersectsBox(node, box) {
    return node.x <= box.maxX &&
      node.x + NODE_W >= box.minX &&
      node.y <= box.maxY &&
      node.y + NODE_H >= box.minY;
  }

  function truncateTitle(text, max) {
    return text.length > max ? text.slice(0, max - 1) + "…" : text;
  }

  function edgeIdentity(edge) {
    return edge.from + "|" + edge.to;
  }

  function isSelectedEdge(edge) {
    return selected && selected.kind === "edge" &&
      edgeIdentity(selected.edge) === edgeIdentity(edge) &&
      !!selected.edge.locked === !!edge.locked;
  }

  // Total re-render of the world group from the model. Graphs are tens of
  // nodes; rebuilding is simple and fast enough — no diffing.
  function render() {
    if (!world || !graph) return;
    while (world.firstChild) world.removeChild(world.firstChild);

    const merged = M.mergeDerivedEdges(graph, derivedEdges());
    displayEdges = merged.edges;

    // Edges under nodes.
    displayEdges.forEach((edge) => {
      const geo = edgePath(edge);
      if (!geo) return;
      const g = svgEl("g", { "class": "rsg-edge" + (edge.locked ? " is-locked" : "") + (isSelectedEdge(edge) ? " is-selected" : "") });
      g.setAttribute("data-edge", edgeIdentity(edge));
      if (edge.locked) g.setAttribute("data-locked", "1");
      // Wide invisible twin makes the thin line clickable.
      g.appendChild(svgEl("path", { d: geo.d, "class": "rsg-edge-hit", fill: "none" }));
      g.appendChild(svgEl("path", {
        d: geo.d, "class": "rsg-edge-line", fill: "none",
        "marker-end": "url(#rsg-arrow)",
      }));
      if (edge.label) {
        const label = truncateTitle(edge.label, 32);
        const text = svgEl("text", {
          x: geo.labelX, y: geo.labelY - 10, "class": "rsg-edge-label",
          "text-anchor": "middle",
        });
        text.textContent = (edge.locked ? "⤳ " : "") + label;
        // Legibility backing sized from an estimated glyph width (measuring
        // needs layout, which jsdom lacks and a rebuild loop doesn't want).
        const w = (label.length + (edge.locked ? 2 : 0)) * EDGE_LABEL_GLYPH_W + 18;
        g.appendChild(svgEl("rect", {
          x: geo.labelX - w / 2, y: geo.labelY - 34, width: w, height: EDGE_LABEL_BG_H,
          rx: 4, "class": "rsg-edge-label-bg",
        }));
        g.appendChild(text);
      }
      world.appendChild(g);
    });

    // Nodes.
    const current = currentRelScene();
    graph.nodes.forEach((node) => {
      const cls = ["rsg-node"];
      if ((selected && selected.kind === "node" && selected.scene === node.scene) ||
          selectedScenes.has(node.scene)) cls.push("is-selected");
      if (current && node.scene === current) cls.push("is-current");
      const g = svgEl("g", {
        "class": cls.join(" "),
        transform: "translate(" + node.x + " " + node.y + ")",
      });
      g.setAttribute("data-scene", node.scene);

      g.appendChild(svgEl("rect", {
        "class": "rsg-node-box", width: NODE_W, height: NODE_H, rx: 8,
      }));

      const title = svgEl("text", { x: 12, y: 34, "class": "rsg-node-title" });
      title.textContent = truncateTitle(sceneLabel(node.scene), 20);
      g.appendChild(title);

      // Connect port: drag from here to another node to draw an edge.
      const port = svgEl("circle", {
        "class": "rsg-port", cx: NODE_W, cy: NODE_H / 2, r: 7,
      });
      port.setAttribute("data-port", node.scene);
      g.appendChild(port);

      world.appendChild(g);
    });

    applyViewTransform();
    renderStatus();
  }

  // --- selection / details strip -------------------------------------------------
  function clearSelection() {
    selected = null;
    selectedScenes.clear();
    renderDetails();
    render();
  }

  function selectNode(scene) {
    selectedScenes.clear();
    selected = { kind: "node", scene };
    renderDetails();
    render();
  }

  function selectNodes(scenes) {
    selectedScenes = new Set(scenes);
    selected = selectedScenes.size
      ? { kind: "nodes", scenes: Array.from(selectedScenes) }
      : null;
    renderDetails();
    render();
  }

  function selectEdge(edge) {
    selectedScenes.clear();
    selected = { kind: "edge", edge };
    renderDetails();
    render();
  }

  function lockedEdgeMessage(edge) {
    return 'This link is defined by Transition card "' + (edge.cardName || edge.label || "?") +
      '" in ' + sceneLabel(edge.from) + " — edit or remove the card instead.";
  }

  function deleteSelectedEdge() {
    if (!selected || selected.kind !== "edge") return;
    const edge = selected.edge;
    if (edge.locked) {
      setDetailsError(lockedEdgeMessage(edge));
      return;
    }
    if (readOnly) return;
    if (M.removeEdge(graph, edge.from, edge.to)) {
      markDirty();
      clearSelection();
    }
  }

  function edgeFromGroup(edgeG) {
    if (!edgeG) return null;
    const key = edgeG.getAttribute("data-edge");
    const locked = edgeG.getAttribute("data-locked") === "1";
    return displayEdges.find((d) => edgeIdentity(d) === key && !!d.locked === locked)
      || displayEdges.find((d) => edgeIdentity(d) === key)
      || null;
  }

  function openEdgeMenu(edge, clientX, clientY) {
    closeEdgeMenu();
    selected = { kind: "edge", edge };
    renderDetails();
    render();

    edgeMenu = el("div", "rsg-edge-menu print-hide");
    edgeMenu.addEventListener("click", (e) => e.stopPropagation());
    const action = el("button", "rsg-edge-menu-btn",
      edge.locked ? "delete card to delete transition" : "Delete transition");
    action.type = "button";
    if (edge.locked) {
      action.disabled = true;
    } else {
      action.addEventListener("click", () => {
        closeEdgeMenu();
        deleteSelectedEdge();
      });
    }
    edgeMenu.appendChild(action);
    document.body.appendChild(edgeMenu);
    positionMenu(edgeMenu, clientX, clientY);
  }

  function positionMenu(menu, clientX, clientY) {
    const rect = menu.getBoundingClientRect();
    const x = Math.min(window.innerWidth - rect.width - 8, Math.max(8, clientX));
    const y = Math.min(window.innerHeight - rect.height - 8, Math.max(8, clientY));
    menu.style.left = x + "px";
    menu.style.top = y + "px";
  }

  function edgeExists(from, to) {
    return displayEdges.some((edge) => edge.from === from && edge.to === to);
  }

  function updatePendingConnect(clientX, clientY) {
    if (!pendingConnect) return;
    const from = nodeOf(pendingConnect.from);
    if (!from) {
      cancelPendingConnect();
      return;
    }
    const p = toWorld(clientX, clientY);
    const p1 = rectExitPoint(from, p.x, p.y);
    pendingConnect.band.setAttribute("d", "M " + p1.x + " " + p1.y + " L " + p.x + " " + p.y);
  }

  function startNodeConnection(scene, clientX, clientY) {
    if (readOnly) return;
    closeEdgeMenu();
    cancelPendingConnect();
    selectedScenes.clear();
    selected = { kind: "node", scene };
    renderDetails();
    render();

    const node = nodeOf(scene);
    if (!node) return;
    const band = svgEl("path", {
      "class": "rsg-rubberband rsg-rubberband-pending",
      fill: "none",
      "marker-end": "url(#rsg-arrow)",
    });
    world.appendChild(band);
    pendingConnect = { from: scene, band };

    if (typeof clientX === "number" && typeof clientY === "number") updatePendingConnect(clientX, clientY);
    else {
      const p = { x: node.x + NODE_W + 80, y: node.y + NODE_H / 2 };
      const p1 = rectExitPoint(node, p.x, p.y);
      band.setAttribute("d", "M " + p1.x + " " + p1.y + " L " + p.x + " " + p.y);
    }
  }

  function completePendingConnect(e) {
    if (!pendingConnect) return false;
    const targetG = nodeGroupFrom(e.target) || nodeGroupAtPoint(toWorld(e.clientX, e.clientY));
    const to = targetG && targetG.getAttribute("data-scene");
    const from = pendingConnect.from;

    if (!to || to === from) {
      setDetailsError("Click another scene to connect the transition.");
      updatePendingConnect(e.clientX, e.clientY);
      return true;
    }
    if (edgeExists(from, to)) {
      setDetailsError("That transition already exists.");
      updatePendingConnect(e.clientX, e.clientY);
      return true;
    }
    if (M.addEdge(graph, from, to)) {
      cancelPendingConnect();
      markDirty();
      render();
      const fresh = displayEdges.find((edge) => !edge.locked && edge.from === from && edge.to === to);
      if (fresh) selectEdge(fresh);
    }
    return true;
  }

  function arrangeSelectedScenes(scenes) {
    if (readOnly) return;
    const res = M.arrangeSelectedNodes(graph, scenes, displayEdges, {
      nodeWidth: NODE_W,
      nodeHeight: NODE_H,
    });
    if (!res.arranged) return;
    selectedScenes = new Set(scenes);
    selected = { kind: "nodes", scenes: Array.from(selectedScenes) };
    if (res.ignoredCycles) {
      setStatusNote("Arranged " + res.arranged + " scenes; ignored " +
        res.ignoredCycles + " cycle link" + (res.ignoredCycles === 1 ? "" : "s") + ".");
    } else {
      setStatusNote("Arranged " + res.arranged + " scenes.");
    }
    if (res.changed) markDirty();
    renderDetails();
    render();
  }

  function openNodeMenu(scene, clientX, clientY) {
    closeEdgeMenu();
    cancelPendingConnect();
    const menuScenes = selectedScenes.has(scene) && selectedScenes.size > 1
      ? Array.from(selectedScenes)
      : [scene];
    selectedScenes = menuScenes.length > 1 ? new Set(menuScenes) : new Set();
    selected = menuScenes.length > 1
      ? { kind: "nodes", scenes: menuScenes.slice() }
      : { kind: "node", scene };
    renderDetails();
    render();

    edgeMenu = el("div", "rsg-edge-menu rsg-node-menu print-hide");
    edgeMenu.addEventListener("click", (e) => e.stopPropagation());
    if (menuScenes.length > 1) {
      const arrange = el("button", "rsg-edge-menu-btn rsg-node-menu-arrange", "Arrange");
      arrange.type = "button";
      arrange.disabled = readOnly;
      arrange.addEventListener("click", () => {
        closeEdgeMenu();
        arrangeSelectedScenes(menuScenes);
      });
      edgeMenu.appendChild(arrange);
    }
    const action = el("button", "rsg-edge-menu-btn rsg-node-menu-add", "Add transition");
    action.type = "button";
    action.disabled = readOnly;
    action.addEventListener("click", (e) => startNodeConnection(scene, e.clientX, e.clientY));
    edgeMenu.appendChild(action);
    document.body.appendChild(edgeMenu);
    positionMenu(edgeMenu, clientX, clientY);
  }

  let detailsError = "";
  function setDetailsError(msg) {
    detailsError = msg || "";
    renderDetails();
  }

  function edgeRow(edge, direction) {
    const row = el("div", "rsg-detail-edge");
    const arrow = direction === "out" ? "→ " : "← ";
    const other = direction === "out" ? edge.to : edge.from;
    row.appendChild(el("span", "rsg-detail-edge-name",
      arrow + sceneLabel(other) + (edge.label ? " · " + edge.label : "")));
    if (edge.locked) {
      const lock = el("span", "rsg-detail-lock", "🔒 card");
      lock.title = lockedEdgeMessage(edge);
      row.appendChild(lock);
    } else if (!readOnly) {
      const del = el("button", "rsg-detail-delete rsg-detail-delete-icon", "✕");
      del.type = "button";
      del.title = "Delete this link";
      del.addEventListener("click", () => {
        M.removeEdge(graph, edge.from, edge.to);
        markDirty();
        renderDetails();
        render();
      });
      row.appendChild(del);
    }
    return row;
  }

  function renderDetails() {
    if (!detailsEl) return;
    detailsEl.innerHTML = "";
    if (detailsError) {
      detailsEl.appendChild(el("div", "rsg-detail-error", detailsError));
      detailsError = "";
    }
    if (!selected) {
      detailsEl.appendChild(el("div", "rsg-detail-hint",
        "Shift + Drag for multiple selection · Right click to create transition · double-click a node to open it."));
      return;
    }

    if (selected.kind === "nodes") {
      detailsEl.appendChild(el("div", "rsg-detail-title", selected.scenes.length + " scenes selected"));
      detailsEl.appendChild(el("div", "rsg-detail-hint", "Drag any selected scene to move them together."));
      return;
    }

    if (selected.kind === "node") {
      const scene = selected.scene;
      detailsEl.appendChild(el("div", "rsg-detail-title", sceneLabel(scene)));
      const outs = displayEdges.filter((e) => e.from === scene);
      const ins = displayEdges.filter((e) => e.to === scene);
      if (!outs.length && !ins.length) {
        detailsEl.appendChild(el("div", "rsg-detail-hint", "No links yet."));
      }
      outs.forEach((edge) => detailsEl.appendChild(edgeRow(edge, "out")));
      ins.forEach((edge) => detailsEl.appendChild(edgeRow(edge, "in")));
      return;
    }

    const edge = selected.edge;
    detailsEl.appendChild(el("div", "rsg-detail-title",
      sceneLabel(edge.from) + " → " + sceneLabel(edge.to)));

    if (edge.locked) {
      detailsEl.appendChild(el("div", "rsg-detail-hint", lockedEdgeMessage(edge)));
      return;
    }

    const labelWrap = el("div", "rsg-detail-labelrow");
    const input = el("input", "rsg-detail-labelinput");
    input.type = "text";
    input.placeholder = "Condition (e.g. if they spare the baron)";
    input.value = edge.label || "";
    input.disabled = readOnly;
    const applyLabel = () => {
      if (readOnly) return;
      if (M.setEdgeLabel(graph, edge.from, edge.to, input.value)) {
        edge.label = input.value.trim() || undefined;
        markDirty();
        render();
      }
    };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { applyLabel(); input.blur(); } });
    input.addEventListener("blur", applyLabel);
    labelWrap.appendChild(input);
    if (!readOnly) {
      const del = el("button", "rsg-detail-delete rsg-detail-delete-text", "Delete link");
      del.type = "button";
      del.addEventListener("click", deleteSelectedEdge);
      labelWrap.appendChild(del);
    }
    detailsEl.appendChild(labelWrap);
  }

  // --- pointer interactions --------------------------------------------------------
  function nodeGroupFrom(target) {
    let n = target;
    while (n && n !== svg) {
      if (n.getAttribute && n.getAttribute("data-scene")) return n;
      n = n.parentNode;
    }
    return null;
  }
  function edgeGroupFrom(target) {
    let n = target;
    while (n && n !== svg) {
      if (n.getAttribute && n.getAttribute("data-edge")) return n;
      n = n.parentNode;
    }
    return null;
  }

  function onPointerDown(e) {
    if (e.button !== 0) return;
    closeEdgeMenu();
    if (completePendingConnect(e)) {
      e.preventDefault();
      return;
    }
    const port = e.target.getAttribute && e.target.getAttribute("data-port");
    const nodeG = nodeGroupFrom(e.target);
    const edgeG = edgeGroupFrom(e.target);
    const start = toWorld(e.clientX, e.clientY);

    if (e.shiftKey) {
      const rect = svgEl("rect", {
        "class": "rsg-marquee",
        x: start.x, y: start.y, width: 0, height: 0,
      });
      world.appendChild(rect);
      gesture = {
        type: "marquee",
        moved: false,
        rect,
        startX: start.x,
        startY: start.y,
        startClientX: e.clientX,
        startClientY: e.clientY,
      };
    } else if (port && !readOnly) {
      const band = svgEl("path", { "class": "rsg-rubberband", fill: "none" });
      world.appendChild(band);
      gesture = { type: "port", from: port, band, x: start.x, y: start.y };
    } else if (nodeG) {
      const scene = nodeG.getAttribute("data-scene");
      const node = nodeOf(scene);
      const groupScenes = selectedScenes.has(scene) && selectedScenes.size > 1
        ? Array.from(selectedScenes)
        : [scene];
      const groupStart = groupScenes
        .map((s) => nodeOf(s))
        .filter(Boolean)
        .map((n) => ({ scene: n.scene, x: n.x, y: n.y }));
      gesture = {
        type: "node", scene, groupStart, moved: false,
        startClientX: e.clientX, startClientY: e.clientY,
        offsetX: start.x - node.x, offsetY: start.y - node.y,
      };
    } else if (edgeG) {
      const edge = edgeFromGroup(edgeG);
      if (edge) selectEdge(edge);
      gesture = null;
      return;
    } else {
      gesture = {
        type: "pan", moved: false,
        startClientX: e.clientX, startClientY: e.clientY,
        startTx: view.tx, startTy: view.ty,
      };
    }
    if (svg.setPointerCapture && e.pointerId != null) {
      try { svg.setPointerCapture(e.pointerId); } catch { /* jsdom */ }
    }
    e.preventDefault();
  }

  function onContextMenu(e) {
    const edgeG = edgeGroupFrom(e.target);
    if (edgeG) {
      const edge = edgeFromGroup(edgeG);
      if (!edge) return;
      e.preventDefault();
      openEdgeMenu(edge, e.clientX, e.clientY);
      return;
    }
    const nodeG = nodeGroupFrom(e.target);
    if (nodeG) {
      e.preventDefault();
      openNodeMenu(nodeG.getAttribute("data-scene"), e.clientX, e.clientY);
      return;
    }
    closeEdgeMenu();
  }

  function onPointerMove(e) {
    if (pendingConnect && !gesture) {
      updatePendingConnect(e.clientX, e.clientY);
      return;
    }
    if (!gesture) return;
    if (gesture.type === "pan") {
      view.tx = gesture.startTx + (e.clientX - gesture.startClientX);
      view.ty = gesture.startTy + (e.clientY - gesture.startClientY);
      gesture.moved = true;
      applyViewTransform();
      return;
    }
    if (gesture.type === "node") {
      const dx = e.clientX - gesture.startClientX;
      const dy = e.clientY - gesture.startClientY;
      if (!gesture.moved && Math.hypot(dx, dy) < CLICK_DRAG_THRESHOLD) return;
      gesture.moved = true;
      const p = toWorld(e.clientX, e.clientY);
      const node = nodeOf(gesture.scene);
      if (node) {
        const nextX = Math.round(p.x - gesture.offsetX);
        const nextY = Math.round(p.y - gesture.offsetY);
        const moveX = nextX - gesture.groupStart.find((n) => n.scene === gesture.scene).x;
        const moveY = nextY - gesture.groupStart.find((n) => n.scene === gesture.scene).y;
        gesture.groupStart.forEach((startNode) => {
          const moving = nodeOf(startNode.scene);
          if (!moving) return;
          moving.x = Math.round(startNode.x + moveX);
          moving.y = Math.round(startNode.y + moveY);
        });
        render(); // cheap at this scale; keeps edges glued to the moving node
      }
      return;
    }
    if (gesture.type === "marquee") {
      const dx = e.clientX - gesture.startClientX;
      const dy = e.clientY - gesture.startClientY;
      if (!gesture.moved && Math.hypot(dx, dy) < CLICK_DRAG_THRESHOLD) return;
      gesture.moved = true;
      const p = toWorld(e.clientX, e.clientY);
      const x = Math.min(gesture.startX, p.x);
      const y = Math.min(gesture.startY, p.y);
      gesture.rect.setAttribute("x", x);
      gesture.rect.setAttribute("y", y);
      gesture.rect.setAttribute("width", Math.abs(p.x - gesture.startX));
      gesture.rect.setAttribute("height", Math.abs(p.y - gesture.startY));
      return;
    }
    if (gesture.type === "port") {
      const p = toWorld(e.clientX, e.clientY);
      const from = nodeOf(gesture.from);
      if (from) {
        const p1 = rectExitPoint(from, p.x, p.y);
        gesture.band.setAttribute("d", "M " + p1.x + " " + p1.y + " L " + p.x + " " + p.y);
      }
    }
  }

  function onPointerUp(e) {
    if (!gesture) return;
    const g = gesture;
    gesture = null;

    if (g.type === "pan") {
      if (!g.moved) clearSelection();
      return;
    }
    if (g.type === "node") {
      if (g.moved) {
        let changed = false;
        g.groupStart.forEach((startNode) => {
          const node = nodeOf(startNode.scene);
          if (node && M.setNodePosition(graph, startNode.scene, node.x, node.y)) changed = true;
        });
        if (changed) markDirty();
      } else {
        if (selectedScenes.has(g.scene) && selectedScenes.size > 1) {
          renderDetails();
          render();
        } else {
          selectNode(g.scene);
        }
      }
      return;
    }
    if (g.type === "marquee") {
      const x = Number(g.rect.getAttribute("x")) || g.startX;
      const y = Number(g.rect.getAttribute("y")) || g.startY;
      const width = Number(g.rect.getAttribute("width")) || 0;
      const height = Number(g.rect.getAttribute("height")) || 0;
      g.rect.remove();
      if (!g.moved || width <= 0 || height <= 0) {
        clearSelection();
        return;
      }
      const box = { minX: x, minY: y, maxX: x + width, maxY: y + height };
      selectNodes(graph.nodes.filter((node) => nodeIntersectsBox(node, box)).map((node) => node.scene));
      return;
    }
    if (g.type === "port") {
      g.band.remove();
      const targetG = nodeGroupFrom(e.target) ||
        nodeGroupAtPoint(toWorld(e.clientX, e.clientY));
      const to = targetG && targetG.getAttribute("data-scene");
      if (to && to !== g.from) {
        const derived = displayEdges.some((d) => d.locked && d.from === g.from && d.to === to);
        if (derived) {
          setDetailsError("That link already exists as a Transition card.");
        } else if (M.addEdge(graph, g.from, to)) {
          markDirty();
          render(); // rebuilds displayEdges with the new edge
          const fresh = displayEdges.find((d) => !d.locked && d.from === g.from && d.to === to);
          if (fresh) selectEdge(fresh);
          return;
        }
      }
      render();
    }
  }

  // Hit-test fallback for pointerup targets that aren't the node's DOM (jsdom,
  // or when the pointer is captured): find the node whose rect contains p.
  function nodeGroupAtPoint(p) {
    const node = graph.nodes.find((n) =>
      p.x >= n.x && p.x <= n.x + NODE_W && p.y >= n.y && p.y <= n.y + NODE_H);
    if (!node) return null;
    const groups = world.querySelectorAll("[data-scene]");
    for (const g of groups) {
      if (g.getAttribute("data-scene") === node.scene) return g;
    }
    return null;
  }

  function onDblClick(e) {
    const nodeG = nodeGroupFrom(e.target);
    if (!nodeG) return;
    const full = M.toFullPath(nodeG.getAttribute("data-scene"), prefix);
    if (typeof RendScrollApp !== "undefined" && RendScrollApp.guardedLoad) {
      RendScrollApp.guardedLoad(full);
    }
  }

  function onWheel(e) {
    e.preventDefault();
    const rect = svg.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const k = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, view.k * factor));
    // Keep the point under the cursor fixed while scaling.
    view.tx = mx - ((mx - view.tx) / view.k) * k;
    view.ty = my - ((my - view.ty) / view.k) * k;
    view.k = k;
    applyViewTransform();
  }

  function fitView() {
    if (!graph || !graph.nodes.length || !svg) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    graph.nodes.forEach((n) => {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + NODE_W);
      maxY = Math.max(maxY, n.y + NODE_H);
    });
    const rect = svg.getBoundingClientRect();
    const vw = rect.width || 600, vh = rect.height || 400;
    const pad = 40;
    const k = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN,
      Math.min((vw - pad) / Math.max(1, maxX - minX), (vh - pad) / Math.max(1, maxY - minY), 1.2)));
    view.k = k;
    view.tx = (vw - (maxX - minX) * k) / 2 - minX * k;
    view.ty = (vh - (maxY - minY) * k) / 2 - minY * k;
    applyViewTransform();
  }

  // --- panel shell -------------------------------------------------------------
  function buildPanel() {
    panel = el("aside", "print-hide");
    panel.id = "rs-scenegraph-panel";
    panel.setAttribute("aria-label", "Scene progression map");

    const savedWidth = parseInt(localStorage.getItem(WIDTH_KEY) || "", 10);
    if (savedWidth) panel.style.width = savedWidth + "px";

    // Left-edge resize handle.
    const resize = el("div", "rsg-resize");
    resize.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = panel.getBoundingClientRect().width;
      const move = (ev) => {
        const w = Math.min(window.innerWidth * 0.9, Math.max(360, startW + (startX - ev.clientX)));
        panel.style.width = w + "px";
      };
      const up = () => {
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", up);
        localStorage.setItem(WIDTH_KEY, String(Math.round(panel.getBoundingClientRect().width)));
      };
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", up);
    });
    panel.appendChild(resize);

    const header = el("div", "rsg-header");
    header.appendChild(el("div", "rsg-title", "Scene Map"));
    statusEl = el("div", "rsg-status");
    header.appendChild(statusEl);
    const fit = el("button", "rsg-header-btn", "Fit");
    fit.type = "button";
    fit.title = "Frame all scenes";
    fit.addEventListener("click", fitView);
    header.appendChild(fit);
    const close = el("button", "rsg-header-btn", "✕");
    close.type = "button";
    close.setAttribute("aria-label", "Close the scene map");
    close.addEventListener("click", api.close);
    header.appendChild(close);
    panel.appendChild(header);

    const canvas = el("div", "rsg-canvas");
    svg = svgEl("svg", { "class": "rsg-svg" });
    const defs = svgEl("defs");
    const marker = svgEl("marker", {
      id: "rsg-arrow", viewBox: "0 0 10 10", refX: 9, refY: 5,
      markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse",
    });
    marker.appendChild(svgEl("path", { d: "M 0 0 L 10 5 L 0 10 z", "class": "rsg-arrowhead" }));
    defs.appendChild(marker);
    svg.appendChild(defs);
    world = svgEl("g", { "class": "rsg-world" });
    svg.appendChild(world);
    canvas.appendChild(svg);
    panel.appendChild(canvas);

    detailsEl = el("div", "rsg-details");
    panel.appendChild(detailsEl);

    svg.addEventListener("pointerdown", onPointerDown);
    svg.addEventListener("pointermove", onPointerMove);
    svg.addEventListener("pointerup", onPointerUp);
    svg.addEventListener("contextmenu", onContextMenu);
    svg.addEventListener("dblclick", onDblClick);
    svg.addEventListener("wheel", onWheel, { passive: false });

    document.body.appendChild(panel);
    renderDetails();
  }

  function mountButton() {
    const host = document.getElementById("topbar-tools") ||
      document.getElementById("options") ||
      document.getElementById("sidebar");
    if (!host || document.getElementById("rs-scenegraph-toggle")) return;

    const btn = el("button", "rsg-toggle-btn print-hide", "🗺 Map");
    btn.id = "rs-scenegraph-toggle";
    btn.type = "button";
    btn.setAttribute("aria-label", "Open the scene progression map");
    btn.title = "Scene progression map";
    btn.addEventListener("click", api.toggle);
    const exportControl = host.querySelector(".printer-export");
    if (exportControl) host.insertBefore(btn, exportControl);
    else host.appendChild(btn);
  }

  // --- lifecycle ---------------------------------------------------------------
  async function refreshAll() {
    await loadGraph();
    await scanAllTransitions();
    render();
    renderDetails();
  }

  const api = {
    async open() {
      if (!panel) buildPanel();
      panel.classList.add("is-open");
      const t = document.getElementById("rs-scenegraph-toggle");
      if (t) t.classList.add("is-active");
      if (!loaded) {
        await refreshAll();
        fitView();
      } else {
        syncScenes();
        render();
      }
    },
    close() {
      if (panel) panel.classList.remove("is-open");
      closeEdgeMenu();
      cancelPendingConnect();
      const t = document.getElementById("rs-scenegraph-toggle");
      if (t) t.classList.remove("is-active");
      flushSave();
    },
    toggle() {
      if (isOpen()) api.close();
      else api.open();
    },
    isOpen,
    // test hooks — not used by app code
    _setSaveDelay(ms) { saveDelayMs = ms; },
    _graph() { return graph; },
    _selectNodes(scenes) { selectNodes(scenes); },
  };

  document.addEventListener("scene:loaded", async (e) => {
    if (!loaded) return;
    syncScenes();
    if (e.detail && e.detail.path) await rescanScene(e.detail.path);
    if (isOpen()) render();
  });

  document.addEventListener("campaign:activated", async (e) => {
    await flushSave();
    loaded = false;
    graph = null;
    derivedByScene = new Map();
    unresolvedRefs = [];
    selected = null;
    selectedScenes.clear();
    cancelPendingConnect();
    setStatusNote("");
    const name = e.detail && e.detail.name;
    if (!name) {
      if (world) while (world.firstChild) world.removeChild(world.firstChild);
      renderDetails();
      return;
    }
    if (isOpen()) {
      await refreshAll();
      fitView();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (!isOpen()) return;
    if (e.key === "Escape") {
      if (pendingConnect) cancelPendingConnect();
      else if (edgeMenu) closeEdgeMenu();
      else if (selected) clearSelection();
      else api.close();
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && selected && selected.kind === "edge") {
      const tag = e.target && e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      deleteSelectedEdge();
    }
  });
  document.addEventListener("click", (e) => {
    if (!edgeMenu) return;
    if (e.target && edgeMenu.contains(e.target)) return;
    closeEdgeMenu();
  });

  window.addEventListener("beforeunload", () => { flushSave(true); });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountButton);
  } else {
    mountButton();
  }

  return api;
})();

if (typeof window !== "undefined") window.SceneGraphPanel = SceneGraphPanel;
if (typeof module !== "undefined" && module.exports) module.exports = SceneGraphPanel;
