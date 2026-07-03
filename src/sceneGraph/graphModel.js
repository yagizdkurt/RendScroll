/* Scene progression graph — pure model.
   No DOM, no fetch: everything here takes plain objects and returns plain
   objects so the panel (sceneGraph.js) stays a thin view and the whole model
   is testable under node (test/sceneGraphModel.test.js).

   Persistence shape (campaigns/<Name>/graph.json, version 1):

     {
       "version": 1,
       "nodes": [ { "scene": "scenes/1_intro.md", "x": 40, "y": 40 } ],
       "edges": [ { "from": "scenes/1_intro.md", "to": "scenes/2_baron.md",
                    "label": "if they spare the baron" } ]
     }

   Scene identity ON DISK is the campaign-relative path ("scenes/…", forward
   slashes) so exported/imported/renamed campaigns keep working — the campaign
   folder name is never stored. At runtime the panel converts to/from the full
   "campaigns/<Active>/scenes/…" path used by guardedLoad / scene:loaded via
   toRelativeScene()/toFullPath(). */

const SceneGraphModel = (() => {
  const GRAPH_VERSION = 1;

  // Default-placement grid for scenes that have no saved position yet.
  const GRID_COLS = 4;
  const GRID_X0 = 40;
  const GRID_Y0 = 40;
  const GRID_DX = 200;
  const GRID_DY = 110;
  const ARRANGE_NODE_W = 160;
  const ARRANGE_NODE_H = 56;
  const ARRANGE_SPACING_MULTIPLIER = 1.5;
  const ARRANGE_GAP_X = GRID_DX * ARRANGE_SPACING_MULTIPLIER - ARRANGE_NODE_W;
  const ARRANGE_GAP_Y = GRID_DY * ARRANGE_SPACING_MULTIPLIER - ARRANGE_NODE_H;

  function emptyGraph() {
    return { version: GRAPH_VERSION, nodes: [], edges: [] };
  }

  // "campaigns\foo\scenes\1.md" -> "campaigns/foo/scenes/1.md"
  function normalizeSlashes(p) {
    return String(p).replace(/\\/g, "/");
  }

  function edgeKey(from, to) {
    return from + "|" + to;
  }

  /* Coerce loaded JSON into a valid graph, collecting human-readable warnings
     for anything dropped. Never throws on garbage — a broken graph.json must
     degrade to "some entries ignored", not a dead panel. A future version is
     the one hard stop: return readOnly so we never rewrite (and destroy) a
     newer file. */
  function normalizeGraph(raw) {
    const warnings = [];
    const graph = emptyGraph();

    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      if (raw !== undefined && raw !== null) warnings.push("graph data was not an object; starting empty");
      return { graph, warnings, readOnly: false };
    }

    if (raw.version !== undefined && raw.version !== GRAPH_VERSION) {
      warnings.push("graph.json is version " + raw.version + " (this app writes version " + GRAPH_VERSION + "); opening read-only");
      return { graph: emptyGraph(), warnings, readOnly: true };
    }

    const seenScenes = new Set();
    (Array.isArray(raw.nodes) ? raw.nodes : []).forEach((n) => {
      if (!n || typeof n !== "object" || typeof n.scene !== "string" || !n.scene.trim() ||
          typeof n.x !== "number" || typeof n.y !== "number" ||
          !isFinite(n.x) || !isFinite(n.y)) {
        warnings.push("dropped malformed node entry");
        return;
      }
      const scene = normalizeSlashes(n.scene.trim());
      if (seenScenes.has(scene)) {
        warnings.push("dropped duplicate node for " + scene);
        return;
      }
      seenScenes.add(scene);
      graph.nodes.push({ scene, x: n.x, y: n.y });
    });

    const seenEdges = new Set();
    (Array.isArray(raw.edges) ? raw.edges : []).forEach((e) => {
      if (!e || typeof e !== "object" || typeof e.from !== "string" || typeof e.to !== "string" ||
          !e.from.trim() || !e.to.trim()) {
        warnings.push("dropped malformed edge entry");
        return;
      }
      const from = normalizeSlashes(e.from.trim());
      const to = normalizeSlashes(e.to.trim());
      if (from === to) {
        warnings.push("dropped self-loop edge on " + from);
        return;
      }
      const key = edgeKey(from, to);
      if (seenEdges.has(key)) {
        warnings.push("dropped duplicate edge " + from + " -> " + to);
        return;
      }
      seenEdges.add(key);
      const edge = { from, to };
      if (typeof e.label === "string" && e.label.trim()) edge.label = e.label.trim();
      graph.edges.push(edge);
    });

    return { graph, warnings, readOnly: false };
  }

  /* Campaign prefix ("campaigns/<name>/") from the sidebar's entry list; each
     entry.path looks like "campaigns/<name>/scenes/<file>.md". Empty list -> "". */
  function campaignPrefixFromEntries(entries) {
    for (const entry of entries || []) {
      const path = normalizeSlashes(entry && entry.path || "");
      const idx = path.indexOf("/scenes/");
      if (idx > 0) return path.slice(0, idx + 1); // keep trailing "/"
    }
    return "";
  }

  // "campaigns/foo/scenes/1.md" -> "scenes/1.md" (null when outside the prefix).
  function toRelativeScene(fullPath, prefix) {
    const path = normalizeSlashes(fullPath || "");
    if (!prefix || !path.startsWith(prefix)) return null;
    return path.slice(prefix.length);
  }

  // "scenes/1.md" -> "campaigns/foo/scenes/1.md".
  function toFullPath(relScene, prefix) {
    return (prefix || "") + relScene;
  }

  // Grid slot for the i-th placed scene; nudged until it doesn't sit exactly on
  // an existing node (good enough — the user will drag it where it belongs).
  function defaultPosition(index, takenNodes) {
    let x = GRID_X0 + (index % GRID_COLS) * GRID_DX;
    let y = GRID_Y0 + Math.floor(index / GRID_COLS) * GRID_DY;
    const occupied = new Set(takenNodes.map((n) => n.x + "," + n.y));
    while (occupied.has(x + "," + y)) { x += 24; y += 24; }
    return { x, y };
  }

  /* Reconcile the graph with the actual scene list (campaign-relative paths in
     sidebar order): add nodes for new scenes, prune nodes/edges pointing at
     scenes that no longer exist. Wipe guard: an empty scene list against a
     non-empty graph means discovery failed — never treat it as "all scenes
     were deleted". Returns a NEW graph object; `changed` says whether anything
     differs (callers use it to mark the graph dirty). */
  function syncWithScenes(graph, relScenePaths) {
    const scenes = (relScenePaths || []).map(normalizeSlashes);
    if (!scenes.length && graph.nodes.length) {
      return { graph, added: 0, prunedNodes: 0, prunedEdges: 0, changed: false };
    }

    const sceneSet = new Set(scenes);
    const next = { version: GRAPH_VERSION, nodes: [], edges: [] };

    let prunedNodes = 0;
    const existing = new Map();
    graph.nodes.forEach((n) => {
      if (sceneSet.has(n.scene)) {
        existing.set(n.scene, n);
        next.nodes.push({ scene: n.scene, x: n.x, y: n.y });
      } else {
        prunedNodes++;
      }
    });

    let added = 0;
    scenes.forEach((scene, i) => {
      if (existing.has(scene)) return;
      const pos = defaultPosition(i, next.nodes);
      next.nodes.push({ scene, x: pos.x, y: pos.y });
      added++;
    });

    let prunedEdges = 0;
    graph.edges.forEach((e) => {
      if (sceneSet.has(e.from) && sceneSet.has(e.to)) {
        next.edges.push(Object.assign({}, e));
      } else {
        prunedEdges++;
      }
    });

    return {
      graph: next,
      added,
      prunedNodes,
      prunedEdges,
      changed: added > 0 || prunedNodes > 0 || prunedEdges > 0,
    };
  }

  function findEdge(graph, from, to) {
    return graph.edges.find((e) => e.from === from && e.to === to) || null;
  }

  // Add a manual edge. Rejects self-loops, duplicates, and unknown endpoints.
  function addEdge(graph, from, to) {
    if (from === to) return false;
    if (findEdge(graph, from, to)) return false;
    const known = new Set(graph.nodes.map((n) => n.scene));
    if (!known.has(from) || !known.has(to)) return false;
    graph.edges.push({ from, to });
    return true;
  }

  function removeEdge(graph, from, to) {
    const before = graph.edges.length;
    graph.edges = graph.edges.filter((e) => !(e.from === from && e.to === to));
    return graph.edges.length !== before;
  }

  function setEdgeLabel(graph, from, to, label) {
    const edge = findEdge(graph, from, to);
    if (!edge) return false;
    const trimmed = String(label || "").trim();
    if (trimmed) edge.label = trimmed;
    else delete edge.label;
    return true;
  }

  function setNodePosition(graph, scene, x, y) {
    const node = graph.nodes.find((n) => n.scene === scene);
    if (!node) return false;
    node.x = x;
    node.y = y;
    return true;
  }

  function hasPath(from, to, adjacency) {
    const stack = [from];
    const seen = new Set();
    while (stack.length) {
      const scene = stack.pop();
      if (scene === to) return true;
      if (seen.has(scene)) continue;
      seen.add(scene);
      (adjacency.get(scene) || []).forEach((next) => stack.push(next));
    }
    return false;
  }

  function arrangeSelectedNodes(graph, selectedScenes, displayEdges, options) {
    const opts = options || {};
    const nodeW = typeof opts.nodeWidth === "number" ? opts.nodeWidth : ARRANGE_NODE_W;
    const nodeH = typeof opts.nodeHeight === "number" ? opts.nodeHeight : ARRANGE_NODE_H;
    const stepX = nodeW + (typeof opts.gapX === "number" ? opts.gapX : ARRANGE_GAP_X);
    const stepY = nodeH + (typeof opts.gapY === "number" ? opts.gapY : ARRANGE_GAP_Y);

    const requested = new Set((selectedScenes || []).map(normalizeSlashes));
    const selectedNodes = graph.nodes.filter((n) => requested.has(n.scene));
    if (selectedNodes.length < 2) {
      return { changed: false, arranged: 0, ignoredCycles: 0 };
    }

    const order = new Map();
    graph.nodes.forEach((n, i) => order.set(n.scene, i));
    const selectedSet = new Set(selectedNodes.map((n) => n.scene));
    const anchorX = Math.min(...selectedNodes.map((n) => n.x));
    const anchorY = Math.min(...selectedNodes.map((n) => n.y));

    const seenEdges = new Set();
    const candidateEdges = (displayEdges || [])
      .filter((e) => e && selectedSet.has(e.from) && selectedSet.has(e.to) && e.from !== e.to)
      .sort((a, b) =>
        (order.get(a.from) - order.get(b.from)) ||
        (order.get(a.to) - order.get(b.to)) ||
        a.from.localeCompare(b.from) ||
        a.to.localeCompare(b.to))
      .filter((e) => {
        const key = edgeKey(e.from, e.to);
        if (seenEdges.has(key)) return false;
        seenEdges.add(key);
        return true;
      });

    const adjacency = new Map();
    const parents = new Map();
    let ignoredCycles = 0;
    candidateEdges.forEach((edge) => {
      if (hasPath(edge.to, edge.from, adjacency)) {
        ignoredCycles++;
        return;
      }
      if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
      adjacency.get(edge.from).push(edge.to);
      if (!parents.has(edge.to)) parents.set(edge.to, []);
      parents.get(edge.to).push(edge.from);
    });

    const connected = new Set();
    adjacency.forEach((children, parent) => {
      if (children.length) connected.add(parent);
      children.forEach((child) => connected.add(child));
    });

    const positions = new Map();
    const connectedOrder = selectedNodes
      .map((n) => n.scene)
      .filter((scene) => connected.has(scene));

    if (connectedOrder.length) {
      const indegree = new Map();
      connectedOrder.forEach((scene) => indegree.set(scene, 0));
      adjacency.forEach((children) => {
        children.forEach((child) => indegree.set(child, (indegree.get(child) || 0) + 1));
      });

      const queue = connectedOrder.filter((scene) => (indegree.get(scene) || 0) === 0);
      const depth = new Map();
      connectedOrder.forEach((scene) => depth.set(scene, 0));
      for (let i = 0; i < queue.length; i++) {
        const scene = queue[i];
        (adjacency.get(scene) || []).forEach((child) => {
          depth.set(child, Math.max(depth.get(child) || 0, (depth.get(scene) || 0) + 1));
          indegree.set(child, (indegree.get(child) || 0) - 1);
          if (indegree.get(child) === 0) queue.push(child);
        });
      }

      const rows = new Map();
      connectedOrder.forEach((scene) => {
        const d = depth.get(scene) || 0;
        if (!rows.has(d)) rows.set(d, []);
        rows.get(d).push(scene);
      });

      Array.from(rows.keys()).sort((a, b) => a - b).forEach((rowDepth) => {
        const row = rows.get(rowDepth);
        const groups = [];
        const byParentSet = new Map();
        row.forEach((scene) => {
          const ps = (parents.get(scene) || []).slice().sort((a, b) => order.get(a) - order.get(b));
          const key = ps.join("|");
          if (!byParentSet.has(key)) byParentSet.set(key, { parents: ps, scenes: [] });
          byParentSet.get(key).scenes.push(scene);
        });
        byParentSet.forEach((group) => {
          group.scenes.sort((a, b) => order.get(a) - order.get(b));
          let desiredCenter = nodeW / 2 + groups.length * stepX;
          if (group.parents.length) {
            const centers = group.parents
              .map((p) => positions.get(p))
              .filter(Boolean)
              .map((p) => p.x + nodeW / 2);
            if (centers.length) {
              desiredCenter = centers.reduce((sum, x) => sum + x, 0) / centers.length;
            }
          }
          groups.push({
            scenes: group.scenes,
            desiredFirstCenter: desiredCenter - ((group.scenes.length - 1) * stepX) / 2,
          });
        });
        groups.sort((a, b) =>
          a.desiredFirstCenter - b.desiredFirstCenter ||
          order.get(a.scenes[0]) - order.get(b.scenes[0]));

        let nextCenter = -Infinity;
        groups.forEach((group) => {
          const firstCenter = Math.max(group.desiredFirstCenter, nextCenter);
          group.scenes.forEach((scene, i) => {
            const center = firstCenter + i * stepX;
            positions.set(scene, {
              x: Math.round(center - nodeW / 2),
              y: Math.round(rowDepth * stepY),
            });
          });
          nextCenter = firstCenter + group.scenes.length * stepX;
        });
      });
    }

    const unconnected = selectedNodes
      .map((n) => n.scene)
      .filter((scene) => !connected.has(scene));
    const maxConnectedDepth = connectedOrder.length
      ? Math.max(...Array.from(positions.values()).map((p) => Math.round(p.y / stepY)))
      : -1;
    const unconnectedDepth = maxConnectedDepth + 1;
    unconnected.forEach((scene, i) => {
      positions.set(scene, {
        x: Math.round(i * stepX),
        y: Math.round(unconnectedDepth * stepY),
      });
    });

    const minLocalX = Math.min(...Array.from(positions.values()).map((p) => p.x));
    const minLocalY = Math.min(...Array.from(positions.values()).map((p) => p.y));
    let changed = false;
    selectedNodes.forEach((node) => {
      const pos = positions.get(node.scene);
      if (!pos) return;
      const nextX = Math.round(anchorX + pos.x - minLocalX);
      const nextY = Math.round(anchorY + pos.y - minLocalY);
      if (node.x !== nextX || node.y !== nextY) changed = true;
      node.x = nextX;
      node.y = nextY;
    });

    return { changed, arranged: selectedNodes.length, ignoredCycles };
  }

  /* Merge Transition-card ("derived") edges over the manual ones for display.
     Derived edges win: a manual edge with the same from|to is hidden (but left
     untouched in graph.json — the card may be deleted later and the manual
     edge resurfaces). Returned entries carry `locked: true` for derived edges
     so the view can refuse delete/relabel on them. Derived edges whose target
     scene doesn't exist are reported in `broken`, not rendered as dangling. */
  function mergeDerivedEdges(graph, derivedEdges) {
    const known = new Set(graph.nodes.map((n) => n.scene));
    const display = [];
    const broken = [];
    const derivedKeys = new Set();

    (derivedEdges || []).forEach((d) => {
      if (!known.has(d.from) || !known.has(d.to) || d.from === d.to) {
        broken.push(d);
        return;
      }
      const key = edgeKey(d.from, d.to);
      if (derivedKeys.has(key)) return; // two cards, same link: show one
      derivedKeys.add(key);
      display.push({ from: d.from, to: d.to, label: d.label, locked: true, cardName: d.cardName });
    });

    graph.edges.forEach((e) => {
      if (derivedKeys.has(edgeKey(e.from, e.to))) return; // hidden under derived
      display.push({ from: e.from, to: e.to, label: e.label, locked: false });
    });

    return { edges: display, broken };
  }

  return {
    GRAPH_VERSION,
    emptyGraph,
    normalizeGraph,
    campaignPrefixFromEntries,
    toRelativeScene,
    toFullPath,
    syncWithScenes,
    findEdge,
    addEdge,
    removeEdge,
    setEdgeLabel,
    setNodePosition,
    arrangeSelectedNodes,
    mergeDerivedEdges,
  };
})();

// Cross-script const bindings are visible in the browser, but tests reach the
// model through window; export both ways.
if (typeof window !== "undefined") window.SceneGraphModel = SceneGraphModel;
if (typeof module !== "undefined" && module.exports) {
  module.exports = SceneGraphModel;
}
