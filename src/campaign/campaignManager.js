/* Multi-campaign manager.

   RendScroll campaigns are self-contained folders under Campaigns/ (each with a
   campaign.json manifest and a Scenes/ folder). This module owns:
     - the list of campaigns (GET /__campaigns),
     - which one is active (persisted in localStorage; mirrored to the server via
       POST /__select_campaign so scene/library discovery and campaign-first asset
       serving resolve correctly),
     - the "Manage Campaigns" overlay (also the empty start screen): create, open,
       switch, import (.zip), export, delete.

   It knows nothing about rendering: app.js passes an `onSwitch(name|null)` callback
   that reloads the reference library + scenes (or clears the reader for the start
   screen). Selection is the client's source of truth; the server is told on every
   switch and on boot. */

const CampaignManager = (() => {
  const STORAGE_KEY = "rendscroll-current-campaign";

  let campaigns = [];      // [{ name, label }]
  let activeName = null;
  let onSwitch = null;     // async (name|null) => void
  let overlay = null;
  let statusEl = null;

  function configure(opts) {
    onSwitch = (opts && opts.onSwitch) || null;
  }

  function active() {
    return activeName;
  }

  // Display label for the active campaign, read from its manifest (falls back
  // to the folder name). Used for the sidebar campaign heading.
  function activeLabel() {
    if (!activeName) return "";
    const camp = campaigns.find((c) => c.name === activeName);
    return (camp && camp.label) || activeName;
  }

  async function fetchJSON(url, opts) {
    const res = await fetch(url, Object.assign({ cache: "no-store" }, opts || {}));
    let payload = null;
    try { payload = await res.json(); } catch (_) { /* non-JSON */ }
    return { res, payload };
  }

  async function loadCampaigns() {
    try {
      const { payload } = await fetchJSON("/__campaigns");
      campaigns = Array.isArray(payload) ? payload : [];
    } catch (_) {
      campaigns = [];
    }
    return campaigns;
  }

  async function postSelect(name) {
    const { res, payload } = await fetchJSON("/__select_campaign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name || null }),
    });
    if (!res.ok || !payload || !payload.ok) {
      throw new Error((payload && payload.error) || "select failed");
    }
    return payload;
  }

  // Switch to a campaign: tell the server, persist the choice, reload the reader.
  async function select(name) {
    await postSelect(name);
    activeName = name;
    try { localStorage.setItem(STORAGE_KEY, name); } catch (_) { /* private mode */ }
    if (onSwitch) await onSwitch(name);
  }

  // Restore the last campaign on boot, or fall back to the start screen.
  async function init() {
    await loadCampaigns();
    let saved = null;
    try { saved = localStorage.getItem(STORAGE_KEY); } catch (_) { /* ignore */ }

    if (saved && campaigns.some((c) => c.name === saved)) {
      try { await select(saved); return; } catch (_) { /* stale — fall through */ }
    }

    // No valid selection: clear server state and show the start screen. Never
    // silently load root files as a fake campaign.
    activeName = null;
    try { await postSelect(null); } catch (_) { /* not launched via launcher.py */ }
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) { /* ignore */ }
    if (onSwitch) await onSwitch(null);
    open();
  }

  // ---- Actions ----------------------------------------------------------

  async function createCampaign(rawName) {
    const name = String(rawName || "").trim();
    if (!name) { setStatus("Enter a campaign name.", true); return; }
    const { res, payload } = await fetchJSON("/__create_campaign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, label: name }),
    });
    if (!res.ok || !payload || !payload.ok) {
      setStatus((payload && payload.error) || "Create failed.", true);
      return;
    }
    await loadCampaigns();
    await select(payload.campaign.name);
    hide();
  }

  async function importZip(file) {
    if (!file) return;
    setStatus("Importing " + file.name + "…");
    try {
      const buf = await file.arrayBuffer();
      const res = await fetch("/__import_campaign", {
        method: "POST",
        headers: { "Content-Type": "application/zip" },
        body: buf,
      });
      let payload = null;
      try { payload = await res.json(); } catch (_) { /* non-JSON */ }
      if (!res.ok || !payload || !payload.ok) {
        throw new Error((payload && payload.error) || "HTTP " + res.status);
      }
      await loadCampaigns();
      render();
      setStatus("Imported: " + payload.campaign.label);
    } catch (err) {
      setStatus("Import failed: " + (err.message || err), true);
    }
  }

  async function exportCampaign(name) {
    if (typeof CampaignExporter === "undefined") {
      setStatus("Exporter unavailable.", true);
      return;
    }
    setStatus("Exporting " + name + "…");
    try {
      // The exporter reads the active campaign's scenes/library, so make it active.
      if (activeName !== name) await select(name);
      const camp = campaigns.find((c) => c.name === name);
      const result = await CampaignExporter.exportPackage({ name, label: camp ? camp.label : name });
      render();
      setStatus("Exported: " + result.zip +
        (result.missing && result.missing.length ? " (" + result.missing.length + " missing refs)" : ""));
    } catch (err) {
      setStatus("Export failed: " + (err.message || err), true);
    }
  }

  async function deleteCampaign(name) {
    if (!window.confirm('Delete campaign "' + name + '"? This removes its folder and cannot be undone.')) return;
    const { res, payload } = await fetchJSON("/__delete_campaign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok || !payload || !payload.ok) {
      setStatus((payload && payload.error) || "Delete failed.", true);
      return;
    }
    if (activeName === name) {
      activeName = null;
      try { localStorage.removeItem(STORAGE_KEY); } catch (_) { /* ignore */ }
      if (onSwitch) await onSwitch(null);
    }
    await loadCampaigns();
    render();
    setStatus("Deleted: " + name);
  }

  // ---- Overlay UI -------------------------------------------------------

  function setStatus(message, isError) {
    if (!statusEl) return;
    statusEl.textContent = message || "";
    statusEl.classList.toggle("is-error", !!isError);
  }

  function ensureOverlay() {
    if (overlay) return;
    overlay = document.createElement("div");
    overlay.id = "campaign-overlay";
    overlay.className = "campaign-overlay";
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay && activeName) hide();  // backdrop closes only if a campaign is active
    });
    document.body.appendChild(overlay);
  }

  function render() {
    ensureOverlay();
    overlay.innerHTML = "";

    const panel = document.createElement("div");
    panel.className = "campaign-panel";

    const header = document.createElement("div");
    header.className = "campaign-header";
    const title = document.createElement("h2");
    title.textContent = "Campaigns";
    header.appendChild(title);
    if (activeName) {
      const close = document.createElement("button");
      close.className = "campaign-close";
      close.type = "button";
      close.textContent = "✕";
      close.title = "Close";
      close.addEventListener("click", hide);
      header.appendChild(close);
    }
    panel.appendChild(header);

    if (!campaigns.length) {
      const empty = document.createElement("p");
      empty.className = "campaign-empty";
      empty.textContent = "No campaigns yet. Create one or import a campaign package to begin.";
      panel.appendChild(empty);
    } else {
      const list = document.createElement("div");
      list.className = "campaign-list";
      campaigns.forEach((c) => list.appendChild(renderRow(c)));
      panel.appendChild(list);
    }

    panel.appendChild(renderCreateRow());
    panel.appendChild(renderImportRow());

    statusEl = document.createElement("div");
    statusEl.className = "campaign-status";
    panel.appendChild(statusEl);

    overlay.appendChild(panel);
  }

  function renderRow(c) {
    const row = document.createElement("div");
    row.className = "campaign-row";
    if (c.name === activeName) row.classList.add("is-active");

    const label = document.createElement("span");
    label.className = "campaign-row-label";
    label.textContent = c.label || c.name;
    if (c.name === activeName) {
      const tag = document.createElement("span");
      tag.className = "campaign-row-active-tag";
      tag.textContent = "active";
      label.appendChild(tag);
    }
    row.appendChild(label);

    const actions = document.createElement("div");
    actions.className = "campaign-row-actions";
    actions.appendChild(button("Open", "primary", async () => {
      try { await select(c.name); hide(); }
      catch (err) { setStatus("Open failed: " + (err.message || err), true); }
    }));
    actions.appendChild(button("Export", "", () => exportCampaign(c.name)));
    actions.appendChild(button("Delete", "danger", () => deleteCampaign(c.name)));
    row.appendChild(actions);
    return row;
  }

  function renderCreateRow() {
    const wrap = document.createElement("div");
    wrap.className = "campaign-create";
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "New campaign name";
    input.className = "campaign-create-input";
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { createCampaign(input.value); input.value = ""; }
    });
    wrap.appendChild(input);
    wrap.appendChild(button("Create Campaign", "primary", () => {
      createCampaign(input.value); input.value = "";
    }));
    return wrap;
  }

  function renderImportRow() {
    const wrap = document.createElement("div");
    wrap.className = "campaign-import";
    const file = document.createElement("input");
    file.type = "file";
    file.accept = ".zip";
    file.className = "campaign-import-input";
    file.addEventListener("change", () => {
      if (file.files && file.files[0]) { importZip(file.files[0]); file.value = ""; }
    });
    wrap.appendChild(button("Import Campaign (.zip)", "", () => file.click()));
    wrap.appendChild(file);
    return wrap;
  }

  function button(text, variant, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "campaign-btn" + (variant ? " campaign-btn-" + variant : "");
    b.textContent = text;
    b.addEventListener("click", onClick);
    return b;
  }

  function open() {
    render();
    overlay.classList.add("is-open");
  }

  function hide() {
    if (overlay) overlay.classList.remove("is-open");
  }

  return { configure, init, active, activeLabel, select, open, hide, loadCampaigns };
})();

if (typeof window !== "undefined") window.CampaignManager = CampaignManager;
if (typeof module !== "undefined" && module.exports) module.exports = CampaignManager;
