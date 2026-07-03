/* RendScroll Debug Panel (developer tool).

   UI-only wrapper around RendScrollDiagnostics. It inspects the currently
   loaded scene immediately and can also fetch saved campaign files for
   campaign-wide parser diagnostics. */

(function () {
  "use strict";

  const TABS = [
    { id: "diagnostics", label: "Diagnostics" },
    { id: "runtime", label: "Runtime" },
    { id: "render", label: "Render Info" },
    { id: "assets", label: "Assets" },
    { id: "ast", label: "Advanced: AST" },
  ];

  let panel = null;
  let bodyEl = null;
  let tabEls = {};
  let activeTab = "diagnostics";
  let renderToken = 0;
  let exitDialog = null;

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

  function assetInventory() {
    return typeof RendScrollAssetInventory !== "undefined" ? RendScrollAssetInventory : null;
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

  async function fetchJSON(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }

  function parseDoc() {
    const d = diagnostics();
    const src = currentSource();
    if (!d || !src) return null;
    return d.parseScene(src, currentPath());
  }

  function runtimeWarnings() {
    return (typeof RSLog !== "undefined" && RSLog.entries) ? RSLog.entries() : [];
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

    wrap.appendChild(renderRuntimeLog());

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

  function renderRuntimeLog() {
    const entries = runtimeWarnings().filter((entry) => entry.level === "warn");
    const wrap = el("div", "rsd-section");
    wrap.appendChild(el("div", "rsd-subhead", `Runtime Warnings (${entries.length})`));

    if (!entries.length) {
      wrap.appendChild(el("div", "rsd-ok", "No runtime warnings."));
      return wrap;
    }

    const list = el("div", "rsd-log-list");
    entries.slice().reverse().forEach((entry) => {
      const row = el("div", "rsd-log-row rsd-warn");
      row.appendChild(el("span", "rsd-icon", "!"));
      row.appendChild(el("span", "rsd-log-area", entry.area || "app"));
      const msg = el("span", "rsd-log-msg");
      const time = entry.time ? String(entry.time).slice(11, 19) + " " : "";
      msg.textContent = time + entry.message + (entry.detail ? " - " + entry.detail : "");
      row.appendChild(msg);
      list.appendChild(row);
    });
    wrap.appendChild(list);
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

  function renderAssetRows(refs, emptyText) {
    const list = el("div", "rsd-assets");
    if (!refs.length) {
      list.appendChild(el("div", "rsd-ok", emptyText));
      return list;
    }
    refs.forEach((r) => {
      const row = el("div", "rsd-asset" + (r.missing ? " rsd-asset-missing" : ""));
      row.appendChild(el("span", "rsd-asset-status " + (r.missing ? "rsd-err-i" : "rsd-ok-i"), r.missing ? "x" : "ok"));
      row.appendChild(el("span", "rsd-asset-kind rsd-tag-" + r.type, r.directive));
      row.appendChild(el("span", "rsd-line", (r.source || "(source)") + ":L" + r.line));
      row.appendChild(el("span", "rsd-asset-val", r.raw));
      row.appendChild(el("span", "rsd-asset-url", "-> " + r.path));
      list.appendChild(row);
    });
    return list;
  }

  function renderUnusedAssets(unused) {
    const list = el("div", "rsd-assets");
    if (!unused.length) {
      list.appendChild(el("div", "rsd-ok", "No unused listed assets."));
      return list;
    }
    unused.forEach((asset) => {
      const row = el("div", "rsd-asset");
      row.appendChild(el("span", "rsd-asset-status", "-"));
      row.appendChild(el("span", "rsd-asset-kind", asset.origin || "asset"));
      row.appendChild(el("span", "rsd-asset-val", asset.name || asset.path));
      row.appendChild(el("span", "rsd-asset-url", asset.path));
      list.appendChild(row);
    });
    return list;
  }

  async function computeAssetReport() {
    const inv = assetInventory();
    if (!inv) throw new Error("RendScrollAssetInventory unavailable");
    const entries = campaignEntries();
    const scenes = [];
    for (const entry of entries) {
      const path = entry.path || entry.file || String(entry);
      let text = "";
      if (path === currentPath()) {
        text = currentSource();
      } else if (typeof fetchMarkdown === "function") {
        text = await fetchMarkdown(path);
      }
      scenes.push({ path, text });
    }

    if (typeof RefLibrary !== "undefined" && RefLibrary.init && RefLibrary.isReady && !RefLibrary.isReady()) {
      try { await RefLibrary.init(); } catch (_) { /* report what can be resolved */ }
    }

    const [images, audio] = await Promise.all([
      fetchJSON("/__assets?type=images"),
      fetchJSON("/__assets?type=audio"),
    ]);
    return inv.analyzeAssets(scenes, typeof RefLibrary !== "undefined" ? RefLibrary : null, { images, audio });
  }

  function renderAssets(parsed, token) {
    const inv = assetInventory();
    const wrap = el("div", "rsd-section");
    if (!inv) {
      wrap.appendChild(el("div", "rsd-empty rsd-error", "Asset diagnostics unavailable."));
      return wrap;
    }

    const entries = campaignEntries();
    if (!entries.length) {
      wrap.appendChild(el("div", "rsd-empty", "Campaign list unavailable."));
      return wrap;
    }

    const loading = el("div", "rsd-loading", "Loading campaign asset inventory...");
    wrap.appendChild(loading);
    computeAssetReport()
      .then((report) => {
        if (token !== renderToken) return;
        wrap.innerHTML = "";
        wrap.appendChild(el("div", "rsd-subhead", `Referenced assets (${report.refs.length})`));
        wrap.appendChild(renderAssetRows(report.refs, "No image/audio references in this campaign."));
        wrap.appendChild(el("div", "rsd-subhead", `Missing assets (${report.missingAssets.length})`));
        wrap.appendChild(renderAssetRows(report.missingAssets, "No missing assets."));
        wrap.appendChild(el("div", "rsd-subhead", `Unused listed assets (${report.unused.length})`));
        wrap.appendChild(renderUnusedAssets(report.unused));
      })
      .catch((err) => {
        if (token !== renderToken) return;
        wrap.innerHTML = "";
        wrap.appendChild(el("div", "rsd-empty rsd-error", "Asset inventory failed: " + (err.message || err)));
      });
    return wrap;
  }

  function renderActiveTab() {
    if (!bodyEl) return;
    const token = ++renderToken;
    bodyEl.innerHTML = "";
    const parsed = parseDoc();

    if (!parsed) {
      if (activeTab === "runtime") {
        bodyEl.appendChild(renderRuntimeLog());
        return;
      }
      if (activeTab === "assets") {
        bodyEl.appendChild(renderAssets(null, token));
        return;
      }
      if (activeTab === "diagnostics") bodyEl.appendChild(renderRuntimeLog());
      bodyEl.appendChild(el("div", "rsd-empty", "No scene loaded yet."));
      return;
    }

    let content;
    switch (activeTab) {
      case "ast": content = renderAst(parsed); break;
      case "render": content = renderInfo(parsed); break;
      case "assets": content = renderAssets(parsed, token); break;
      case "runtime": content = renderRuntimeLog(); break;
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

    const btn = el("button", "rsd-toggle-btn print-hide", "🐞");
    btn.id = "rs-debug-toggle";
    btn.type = "button";
    btn.setAttribute("aria-label", "Open debug panel");
    btn.title = "Open the RendScroll parser debug panel";
    btn.addEventListener("click", api.toggle);
    host.appendChild(btn);

    if (!document.getElementById("rs-exit-app")) {
      const exit = el("button", "rsd-toggle-btn rsd-exit-btn print-hide", "⏻");
      exit.id = "rs-exit-app";
      exit.type = "button";
      exit.setAttribute("aria-label", "Exit RendScroll");
      exit.title = "Close the RendScroll Chrome app";
      exit.addEventListener("click", openExitDialog);
      host.appendChild(exit);
    }
  }

  function closeExitDialog() {
    if (!exitDialog) return;
    exitDialog.remove();
    exitDialog = null;
    const exit = document.getElementById("rs-exit-app");
    if (exit) exit.focus();
  }

  async function requestAppExit() {
    if (typeof Editor !== "undefined" && Editor.confirmNavigation) {
      closeExitDialog();
      const canExit = await Editor.confirmNavigation({
        messageText: "You have unsaved edits on this page. Save them before exiting RendScroll?",
      });
      if (!canExit) return;
    }

    const confirm = exitDialog && exitDialog.querySelector(".rsd-exit-confirm");
    if (confirm) {
      confirm.disabled = true;
      confirm.textContent = "Closing...";
    }

    try {
      fetch("/__rendscroll_exit", { method: "POST", keepalive: true })
        .catch(() => {})
        .finally(() => window.close());
    } catch (err) {
      window.close();
    }
  }

  function openExitDialog() {
    if (exitDialog) {
      const confirm = exitDialog.querySelector(".rsd-exit-confirm");
      if (confirm) confirm.focus();
      return;
    }

    const backdrop = el("div", "rsd-exit-backdrop print-hide");
    backdrop.setAttribute("role", "presentation");

    const dialog = el("div", "rsd-exit-dialog");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "rsd-exit-title");
    dialog.setAttribute("aria-describedby", "rsd-exit-message");

    const title = el("div", "rsd-exit-title", "Close RendScroll?");
    title.id = "rsd-exit-title";
    const message = el("div", "rsd-exit-message", "Gonna have a long rest yourself?");
    message.id = "rsd-exit-message";

    const actions = el("div", "rsd-exit-actions");
    const cancel = el("button", "rsd-exit-cancel", "Cancel");
    cancel.type = "button";
    cancel.addEventListener("click", closeExitDialog);

    const confirm = el("button", "rsd-exit-confirm", "Exit");
    confirm.type = "button";
    confirm.addEventListener("click", requestAppExit);

    actions.append(cancel, confirm);
    dialog.append(title, message, actions);
    backdrop.appendChild(dialog);
    backdrop.addEventListener("mousedown", (e) => {
      if (e.target === backdrop) closeExitDialog();
    });

    exitDialog = backdrop;
    document.body.appendChild(backdrop);
    confirm.focus();
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
  document.addEventListener("rslog:entry", () => api.refresh());
  document.addEventListener("rslog:clear", () => api.refresh());
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && exitDialog) {
      closeExitDialog();
      return;
    }
    if (e.key === "Escape" && panel && panel.classList.contains("is-open")) api.close();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountButton);
  } else {
    mountButton();
  }
})();
