/* RendScroll Debug Panel (developer tool).

   UI-only wrapper around RendScrollDiagnostics. It inspects the currently
   loaded scene immediately and can also fetch saved campaign files for
   campaign-wide parser diagnostics. */

(function () {
  "use strict";

  const TABS = [
    { id: "diagnostics", label: "Diagnostics" },
    { id: "render", label: "Render Info" },
    { id: "assets", label: "Assets" },
    { id: "ast", label: "Advanced: AST" },
  ];

  let panel = null;
  let bodyEl = null;
  let tabEls = {};
  let activeTab = "diagnostics";
  let renderToken = 0;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function diagnostics() {
    return typeof RendScrollDiagnostics !== "undefined" ? RendScrollDiagnostics : null;
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

  function campaignEntries() {
    return (window.RendScrollApp && window.RendScrollApp.campaignEntries && window.RendScrollApp.campaignEntries()) || [];
  }

  function parseDoc() {
    const d = diagnostics();
    const src = currentSource();
    if (!d || !src) return null;
    return d.parseScene(src, currentPath());
  }

  function issueSummary(issues) {
    const errors = issues.filter((i) => i.level === "error").length;
    const warns = issues.filter((i) => i.level === "warn").length;
    const summary = el("div", "rsd-summary");
    summary.appendChild(el("span", "rsd-pill rsd-pill-err", `${errors} error${errors === 1 ? "" : "s"}`));
    summary.appendChild(el("span", "rsd-pill rsd-pill-warn", `${warns} warning${warns === 1 ? "" : "s"}`));
    return summary;
  }

  function renderIssueRows(issues, emptyText) {
    const wrap = el("div", "rsd-issue-group");
    wrap.appendChild(issueSummary(issues));

    if (!issues.length) {
      wrap.appendChild(el("div", "rsd-ok", emptyText || "No diagnostics."));
      return wrap;
    }

    const list = el("div", "rsd-issues");
    issues
      .slice()
      .sort((a, b) => {
        if (a.file !== b.file) return String(a.file).localeCompare(String(b.file));
        return Number(a.line || 0) - Number(b.line || 0);
      })
      .forEach((i) => {
        const row = el("div", "rsd-issue rsd-" + i.level);
        row.appendChild(el("span", "rsd-icon", i.level === "error" ? "✖" : "⚠"));
        row.appendChild(el("span", "rsd-line", "L" + i.line));
        row.appendChild(el("span", "rsd-msg", i.message));
        list.appendChild(row);
      });
    wrap.appendChild(list);
    return wrap;
  }

  function renderIssuesByFile(issues, emptyText) {
    const wrap = el("div", "rsd-issue-group");
    wrap.appendChild(issueSummary(issues));

    if (!issues.length) {
      wrap.appendChild(el("div", "rsd-ok", emptyText || "No diagnostics."));
      return wrap;
    }

    const byFile = new Map();
    issues.forEach((i) => {
      const key = i.file || "(unknown)";
      if (!byFile.has(key)) byFile.set(key, []);
      byFile.get(key).push(i);
    });

    [...byFile.keys()].sort().forEach((file) => {
      const fileIssues = byFile.get(file).sort((a, b) => Number(a.line || 0) - Number(b.line || 0));
      wrap.appendChild(el("div", "rsd-file-head", file));
      wrap.appendChild(renderIssueRows(fileIssues, ""));
    });
    return wrap;
  }

  function renderCardMap(doc) {
    const d = diagnostics();
    const cards = d ? d.allCards(doc) : [];
    const wrap = el("div", "rsd-cardmap-wrap");
    wrap.appendChild(el("div", "rsd-subhead", `Cards (${cards.length})`));

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

  function renderDiagnostics(parsed, token) {
    const d = diagnostics();
    const wrap = el("div", "rsd-section");
    if (!d || !parsed || parsed.error) {
      wrap.appendChild(el("div", "rsd-empty rsd-error", parsed && parsed.error ? "Parse error: " + parsed.error : "Diagnostics unavailable."));
      return wrap;
    }

    wrap.appendChild(el("div", "rsd-subhead", "Current Scene"));
    const currentIssues = d.computeSceneDiagnostics(parsed.doc, { file: currentPath() });
    wrap.appendChild(renderIssueRows(currentIssues, "No diagnostics for this scene."));
    wrap.appendChild(renderCardMap(parsed.doc));

    wrap.appendChild(el("div", "rsd-subhead", "Campaign"));
    const campaignWrap = el("div", "rsd-campaign");
    campaignWrap.appendChild(el("div", "rsd-loading", "Loading saved campaign diagnostics..."));
    wrap.appendChild(campaignWrap);

    const entries = campaignEntries();
    if (!entries.length) {
      campaignWrap.innerHTML = "";
      campaignWrap.appendChild(el("div", "rsd-empty", "Campaign list unavailable."));
      return wrap;
    }

    d.computeCampaignDiagnostics(entries, typeof fetchMarkdown === "function" ? fetchMarkdown : null)
      .then((result) => {
        if (token !== renderToken) return;
        campaignWrap.innerHTML = "";
        campaignWrap.appendChild(renderIssuesByFile(result.issues, "No diagnostics for saved campaign files."));
      })
      .catch((err) => {
        if (token !== renderToken) return;
        campaignWrap.innerHTML = "";
        campaignWrap.appendChild(el("div", "rsd-empty rsd-error", "Campaign diagnostics failed: " + (err.message || err)));
      });

    return wrap;
  }

  function renderAst(parsed) {
    const p = parser();
    const pre = el("pre", "rsd-pre rsd-ast-pre");
    if (!parsed || parsed.error) {
      pre.textContent = parsed && parsed.error ? "Parse error: " + parsed.error : "(parser unavailable)";
    } else {
      pre.textContent = p ? p.debugDump(parsed.doc) : "(parser unavailable)";
    }
    return pre;
  }

  function renderInfo(parsed) {
    const d = diagnostics();
    if (!d || !parsed || parsed.error) {
      return el("div", "rsd-empty rsd-error", parsed && parsed.error ? "Parse error: " + parsed.error : "Render info unavailable.");
    }

    const rows = d.summarizeRenderInfo(parsed.doc, { file: currentPath() });
    const wrap = el("div", "rsd-section");
    const grid = el("div", "rsd-kv");
    rows.forEach(([k, v]) => {
      grid.appendChild(el("div", "rsd-k", k));
      grid.appendChild(el("div", "rsd-v", v));
    });
    wrap.appendChild(grid);
    return wrap;
  }

  function renderAssets(parsed) {
    const d = diagnostics();
    const wrap = el("div", "rsd-section");
    if (!d || !parsed || parsed.error) {
      wrap.appendChild(el("div", "rsd-empty rsd-error", parsed && parsed.error ? "Parse error: " + parsed.error : "Asset diagnostics unavailable."));
      return wrap;
    }

    const refs = d.collectAssetRefs(parsed.doc);
    wrap.appendChild(el("div", "rsd-subhead", `Image / BG references (${refs.length})`));
    wrap.appendChild(el("div", "rsd-note", "Browser probes are hints only; launch preflight performs authoritative local file checks."));

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
      row.appendChild(el("span", "rsd-line", "L" + r.line));
      row.appendChild(el("span", "rsd-asset-val", r.value));
      const url = canResolve ? cardBgUrl(r.value) : r.value;
      row.appendChild(el("span", "rsd-asset-url", "→ " + url));
      list.appendChild(row);

      const probe = new Image();
      probe.onload = () => { status.textContent = "✓"; status.className = "rsd-asset-status rsd-ok-i"; };
      probe.onerror = () => { status.textContent = "✗"; status.className = "rsd-asset-status rsd-err-i"; };
      probe.src = url;
    });
    wrap.appendChild(list);
    return wrap;
  }

  function renderActiveTab() {
    if (!bodyEl) return;
    const token = ++renderToken;
    bodyEl.innerHTML = "";
    const parsed = parseDoc();

    if (!parsed) {
      bodyEl.appendChild(el("div", "rsd-empty", "No scene loaded yet."));
      return;
    }

    let content;
    switch (activeTab) {
      case "ast": content = renderAst(parsed); break;
      case "render": content = renderInfo(parsed); break;
      case "assets": content = renderAssets(parsed); break;
      default: content = renderDiagnostics(parsed, token); break;
    }
    bodyEl.appendChild(content);
  }

  function setActiveTab(id) {
    activeTab = id;
    Object.keys(tabEls).forEach((k) => tabEls[k].classList.toggle("is-active", k === id));
    renderActiveTab();
  }

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

  document.addEventListener("scene:loaded", () => api.refresh());
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && panel && panel.classList.contains("is-open")) api.close();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountButton);
  } else {
    mountButton();
  }
})();
