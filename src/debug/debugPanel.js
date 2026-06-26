/* RendScroll Debug Panel (developer tool).

   A small, isolated, in-app panel that surfaces PARSER-BASED diagnostics for the
   currently loaded scene. It uses the existing JS parser (RendScrollParser)
   directly — no Node, no Python, no dependencies — and is strictly read-only: it
   never touches #page, the source, the editor model, saved content, or the
   rendered output. It is hidden until opened and is excluded from print/PDF
   export (.print-hide + @media print in debugPanel.css).

   Public API (also usable from the console):
     window.RendScrollDebug.open() / .close() / .toggle() / .refresh()

   Scene source comes from window.RendScrollApp (a small read-only getter in
   app.js); the AST comes from RendScrollParser.parseRendScroll(). */

(function () {
  "use strict";

  const TABS = [
    { id: "diagnostics", label: "Diagnostics" },
    { id: "ast", label: "Parser AST" },
    { id: "render", label: "Render Info" },
    { id: "assets", label: "Assets" },
  ];

  let panel = null;
  let bodyEl = null;
  let tabEls = {};
  let activeTab = "diagnostics";

  // --- tiny DOM helper ------------------------------------------------------
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function parser() {
    return typeof RendScrollParser !== "undefined" ? RendScrollParser : null;
  }
  function currentSource() {
    return (window.RendScrollApp && window.RendScrollApp.currentSource()) || "";
  }
  function currentPath() {
    return (window.RendScrollApp && window.RendScrollApp.currentPath()) || "(none)";
  }
  function parseDoc() {
    const p = parser();
    const src = currentSource();
    if (!p || !src) return null;
    try {
      return p.parseRendScroll(src);
    } catch (e) {
      return { __error: e.message };
    }
  }

  function allCards(doc) {
    return doc.sections.flatMap((s) => s.blocks.filter((b) => b.kind === "card"));
  }
  // Display lines are 1-based (matching the editor / linter).
  function dispLine(range) {
    return range ? range.startLine + 1 : "?";
  }

  // --- Diagnostics (AST-derived) -------------------------------------------
  function computeDiagnostics(doc) {
    const issues = [];
    const file = currentPath();
    const add = (level, line, message) => issues.push({ level, file, line, message });

    // Missing "# title": no page title and no level-1 heading anywhere.
    const hasH1 = !!doc.title || doc.sections.some((s) => s.level === 1);
    if (!hasH1) add("warn", 1, "no '# title'");

    doc.sections.forEach((section) => {
      let prevCard = null;
      section.blocks.forEach((block) => {
        if (block.kind !== "card") return;
        const card = block;

        // Malformed / empty directives kept by the parser.
        card.unknown.forEach((u) => {
          const raw = (u.lines && u.lines[0] ? u.lines[0] : "").trim();
          if (/^(image|bg)\s*:\s*$/i.test(raw)) {
            add("error", dispLine(u.range), "empty image path");
          } else {
            add("warn", dispLine(u.range), "malformed directive: " + raw);
          }
        });

        // Duplicate directive within one card.
        const seen = {};
        card.directives.forEach((d) => {
          seen[d.name] = (seen[d.name] || 0) + 1;
        });
        Object.keys(seen).forEach((name) => {
          if (seen[name] > 1) {
            const d = card.directives.find((x) => x.name === name);
            add("warn", dispLine(d.range), `duplicate directive: ${name} (x${seen[name]})`);
          }
        });

        // Impossible docking: a stuck card with no valid host directly above
        // (heuristic — ignores <hr> grouping, which is a dev hint only).
        if (card.stuck) {
          const p = parser();
          const ok = prevCard && p && p.canDock(card, prevCard);
          if (!ok) {
            add("warn", dispLine(card.titleRange),
              `"${card.title}" can't dock — no valid host above`);
          }
        }
        prevCard = card;
      });
    });

    return issues;
  }

  function renderDiagnostics(doc) {
    const wrap = el("div", "rsd-section");
    const issues = computeDiagnostics(doc);
    const errors = issues.filter((i) => i.level === "error").length;
    const warns = issues.filter((i) => i.level === "warn").length;

    const summary = el("div", "rsd-summary");
    summary.appendChild(el("span", "rsd-pill rsd-pill-err", `${errors} error${errors === 1 ? "" : "s"}`));
    summary.appendChild(el("span", "rsd-pill rsd-pill-warn", `${warns} warning${warns === 1 ? "" : "s"}`));
    wrap.appendChild(summary);

    if (!issues.length) {
      wrap.appendChild(el("div", "rsd-ok", "✓ No diagnostics for this scene."));
    } else {
      const list = el("div", "rsd-issues");
      issues
        .slice()
        .sort((a, b) => a.line - b.line)
        .forEach((i) => {
          const row = el("div", "rsd-issue rsd-" + i.level);
          row.appendChild(el("span", "rsd-icon", i.level === "error" ? "✖" : "⚠"));
          row.appendChild(el("span", "rsd-line", "L" + i.line));
          row.appendChild(el("span", "rsd-msg", i.message));
          list.appendChild(row);
        });
      wrap.appendChild(list);
    }

    // Per-card map (type — title), a quick structural overview.
    const cards = allCards(doc);
    const head = el("div", "rsd-subhead", `Cards (${cards.length})`);
    wrap.appendChild(head);
    const map = el("div", "rsd-cardmap");
    cards.forEach((c) => {
      const row = el("div", "rsd-cardrow");
      row.appendChild(el("span", "rsd-tag rsd-tag-" + c.type, c.type));
      row.appendChild(el("span", "rsd-cardtitle", c.title || "(untitled)"));
      const flags = [];
      if (c.column === "right") flags.push("→R");
      if (c.stuck) flags.push("docked");
      if (flags.length) row.appendChild(el("span", "rsd-flags", flags.join(" · ")));
      map.appendChild(row);
    });
    wrap.appendChild(map);
    return wrap;
  }

  // --- Parser AST -----------------------------------------------------------
  function renderAst(doc) {
    const p = parser();
    const pre = el("pre", "rsd-pre");
    pre.textContent = p ? p.debugDump(doc) : "(parser unavailable)";
    return pre;
  }

  // --- Render Info ----------------------------------------------------------
  function renderInfo(doc) {
    const cards = allCards(doc);
    const byType = {};
    cards.forEach((c) => (byType[c.type] = (byType[c.type] || 0) + 1));
    const right = cards.filter((c) => c.column === "right").length;
    const docked = cards.filter((c) => c.stuck).length;

    const blocks = doc.sections.flatMap((s) => s.blocks);
    const narrative = blocks.filter((b) => b.kind === "narrative").length;
    const plain = blocks.filter((b) => b.kind === "plain").length;

    const rows = [
      ["Path", currentPath()],
      ["Title", doc.title || "(none)"],
      ["EOL", doc.eol === "\r\n" ? "CRLF" : "LF"],
      ["Sections", String(doc.sections.length) +
        ` (header ${doc.sections.filter((s) => s.kind === "header").length}, ` +
        `event ${doc.sections.filter((s) => s.kind === "event").length})`],
      ["Cards", String(cards.length)],
      ["By type", Object.keys(byType).sort().map((t) => `${t}:${byType[t]}`).join("  ") || "—"],
      ["Columns", `left ${cards.length - right} · right ${right}`],
      ["Docked", String(docked)],
      ["Narrative blocks", String(narrative)],
      ["Plain blocks", String(plain)],
    ];

    const wrap = el("div", "rsd-section");
    const grid = el("div", "rsd-kv");
    rows.forEach(([k, v]) => {
      grid.appendChild(el("div", "rsd-k", k));
      grid.appendChild(el("div", "rsd-v", v));
    });
    wrap.appendChild(grid);
    return wrap;
  }

  // --- Assets ---------------------------------------------------------------
  function renderAssets(doc) {
    const wrap = el("div", "rsd-section");
    const refs = [];
    allCards(doc).forEach((c) => {
      c.directives.forEach((d) => {
        if (d.name === "image" || d.name === "bg") {
          refs.push({ name: d.name, value: d.value, line: dispLine(d.range) });
        }
      });
    });

    wrap.appendChild(el("div", "rsd-subhead", `Image / BG references (${refs.length})`));
    if (!refs.length) {
      wrap.appendChild(el("div", "rsd-ok", "No image references in this scene."));
      return wrap;
    }

    const canResolve = typeof cardBgUrl === "function";
    const list = el("div", "rsd-assets");
    refs.forEach((r) => {
      const row = el("div", "rsd-asset");
      const status = el("span", "rsd-asset-status", "…");
      row.appendChild(status);
      row.appendChild(el("span", "rsd-asset-kind rsd-tag-" + r.name, r.name));
      row.appendChild(el("span", "rsd-asset-val", r.value));
      const url = canResolve ? cardBgUrl(r.value) : r.value;
      row.appendChild(el("span", "rsd-asset-url", "→ " + url));
      list.appendChild(row);

      // Non-blocking existence probe (browser only — a hint, not authoritative).
      const probe = new Image();
      probe.onload = () => { status.textContent = "✓"; status.className = "rsd-asset-status rsd-ok-i"; };
      probe.onerror = () => { status.textContent = "✗"; status.className = "rsd-asset-status rsd-err-i"; };
      probe.src = url;
    });
    wrap.appendChild(list);
    return wrap;
  }

  // --- tab rendering --------------------------------------------------------
  function renderActiveTab() {
    if (!bodyEl) return;
    bodyEl.innerHTML = "";
    const doc = parseDoc();

    if (!doc) {
      bodyEl.appendChild(el("div", "rsd-empty", "No scene loaded yet."));
      return;
    }
    if (doc.__error) {
      bodyEl.appendChild(el("div", "rsd-empty rsd-error", "Parse error: " + doc.__error));
      return;
    }

    let content;
    switch (activeTab) {
      case "ast": content = renderAst(doc); break;
      case "render": content = renderInfo(doc); break;
      case "assets": content = renderAssets(doc); break;
      default: content = renderDiagnostics(doc); break;
    }
    bodyEl.appendChild(content);
  }

  function setActiveTab(id) {
    activeTab = id;
    Object.keys(tabEls).forEach((k) => tabEls[k].classList.toggle("is-active", k === id));
    renderActiveTab();
  }

  // --- panel construction ---------------------------------------------------
  function buildPanel() {
    panel = el("div", "print-hide");
    panel.id = "rs-debug-panel";

    const header = el("div", "rsd-header");
    header.appendChild(el("span", "rsd-title", "🐞 RendScroll Debug"));
    const close = el("button", "rsd-close");
    close.type = "button";
    close.textContent = "✕";
    close.setAttribute("aria-label", "Close debug panel");
    close.addEventListener("click", api.close);
    header.appendChild(close);
    panel.appendChild(header);

    const tabbar = el("div", "rsd-tabs");
    TABS.forEach((t) => {
      const b = el("button", "rsd-tab", t.label);
      b.type = "button";
      b.addEventListener("click", () => setActiveTab(t.id));
      tabEls[t.id] = b;
      tabbar.appendChild(b);
    });
    panel.appendChild(tabbar);

    bodyEl = el("div", "rsd-body");
    panel.appendChild(bodyEl);

    document.body.appendChild(panel);
    tabEls[activeTab].classList.add("is-active");
  }

  // --- toolbar button -------------------------------------------------------
  function mountButton() {
    const host =
      document.getElementById("topbar-tools") ||
      document.getElementById("options") ||
      document.getElementById("sidebar");
    if (!host || document.getElementById("rs-debug-toggle")) return;

    const btn = el("button", "rsd-toggle-btn print-hide", "🐞 Debug");
    btn.id = "rs-debug-toggle";
    btn.type = "button";
    btn.title = "Open the RendScroll parser debug panel";
    btn.addEventListener("click", api.toggle);
    host.appendChild(btn);
  }

  // --- public API -----------------------------------------------------------
  const api = {
    open() {
      if (!panel) buildPanel();
      panel.classList.add("is-open");
      const t = document.getElementById("rs-debug-toggle");
      if (t) t.classList.add("is-active");
      renderActiveTab();
    },
    close() {
      if (panel) panel.classList.remove("is-open");
      const t = document.getElementById("rs-debug-toggle");
      if (t) t.classList.remove("is-active");
    },
    toggle() {
      if (panel && panel.classList.contains("is-open")) api.close();
      else api.open();
    },
    refresh() {
      if (panel && panel.classList.contains("is-open")) renderActiveTab();
    },
  };
  window.RendScrollDebug = api;

  // Auto-refresh when the scene changes (only while the panel is open).
  document.addEventListener("scene:loaded", () => api.refresh());
  // Esc closes.
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && panel && panel.classList.contains("is-open")) api.close();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountButton);
  } else {
    mountButton();
  }
})();
