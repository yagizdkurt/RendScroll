/* ============================================================
   Reference-library reader: sidebar lists + the single-entry
   reader view/toolbar for every ref kind in RefLibrary's
   REF_TYPES. ONE parameterized implementation (LIBRARY_VIEWS)
   drives Items and Enemies; adding a kind is a config entry.
   ============================================================ */

/* Per-kind UI specifics (sidebar nav element, kicker label, the editor "+ New …"
   callback) live in LIBRARY_VIEWS; the view/mount/refresh/open/delete logic is
   shared. Adding a ref kind is a LIBRARY_VIEWS entry + a sidebar <nav> in
   index.html, not a second ~100-line copy of this block.

   Library enemies differ from items only in this config: they are concrete stat
   blocks referenced from combat cards (not inserted as standalone scene cards), and
   their view state uses currentView === "enemy" instead of "library". */
const LIBRARY_VIEWS = {
  item: {
    view: "library", kicker: "Items", noun: "item", nameAttr: "itemName",
    nav: () => libraryNav,
    create: (cb, scope) => Editor.createLibraryItem && Editor.createLibraryItem(cb, scope),
  },
  enemy: {
    view: "enemy", kicker: "Enemies", noun: "enemy", nameAttr: "enemyName",
    nav: () => enemiesNav,
    create: (cb, scope) => Editor.createEnemyToLibrary && Editor.createEnemyToLibrary(cb, scope),
  },
};

function libraryConfig(kind) { return LIBRARY_VIEWS[kind]; }

// The kind's files (via RefLibrary, loaded at boot), as [{ name, path, origin }].
function libraryEntries(kind) {
  if (typeof RefLibrary === "undefined") return [];
  return RefLibrary.entries(kind).map((e) => ({ name: e.name, path: e.path, origin: e.origin || "global" }));
}

// One library entry button (with a campaign badge when it is campaign-local).
function libraryEntryButton(kind, cfg, entry) {
  const btn = document.createElement("button");
  btn.textContent = entry.name;
  if (entry.origin === "campaign") {
    const badge = document.createElement("span");
    badge.className = "nav-origin-badge";
    badge.textContent = "C";
    badge.title = "Campaign-local";
    btn.appendChild(badge);
  }
  btn.dataset[cfg.nameAttr] = entry.name;
  btn.dataset.navIndex = entry.name.charAt(0).toUpperCase(); // collapsed-mode glyph
  btn.title = entry.name + (entry.origin === "campaign" ? " (campaign)" : "");
  btn.classList.toggle("active", currentView === cfg.view && entry.name === currentLibraryName);
  btn.addEventListener("click", () => openLibrary(kind, entry.name));
  btn.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openLibraryEntryMenu(kind, entry, e.clientX, e.clientY);
  });
  return btn;
}

// Right-click menu for an Items/Enemies entry: Delete (confirmed, reuses
// deleteLibrary) plus a Move action whose direction follows the entry's origin.
// "Move to campaign" is disabled when no campaign is active.
function openLibraryEntryMenu(kind, entry, x, y) {
  const hasCampaign = typeof CampaignManager !== "undefined" && CampaignManager.active();
  const items = [
    { label: "Delete", danger: true, onClick: () => deleteLibrary(kind, entry.name) },
  ];
  if (entry.origin === "campaign") {
    items.push({ label: "Move to global library", onClick: () => moveLibrary(kind, entry.name, "global") });
  } else {
    items.push({
      label: "Move to campaign",
      disabled: !hasCampaign,
      onClick: () => moveLibrary(kind, entry.name, "campaign"),
    });
  }
  openNavMenu(items, x, y);
}

// Move a library entry between the campaign-local and global folders, then
// refresh the sidebars (and the reader view if this entry is on screen).
async function moveLibrary(kind, name, toScope) {
  const cfg = libraryConfig(kind);
  if (typeof RefLibrary === "undefined") return;
  try {
    await RefLibrary.moveFile(kind, name, toScope);
    refreshLibrarySidebars();
    if (currentView === cfg.view && currentLibraryName === name) openLibrary(kind, name);
    document.dispatchEvent(new CustomEvent("library:changed", { detail: { type: kind, name, moved: toScope } }));
  } catch (err) {
    alert(err.message || ("The " + cfg.noun + " could not be moved."));
  }
}

// Group library entries by origin (campaign-local vs global). Each group gets a
// subheader and its own "+ New …" that creates into that origin's folder.
function mountLibraryNav(kind) {
  const cfg = libraryConfig(kind);
  const navEl = cfg.nav();
  if (!navEl) return;
  navEl.innerHTML = "";

  const entries = libraryEntries(kind);
  const campaign = entries.filter((e) => e.origin === "campaign");
  const global = entries.filter((e) => e.origin !== "campaign");
  const hasCampaign = typeof CampaignManager !== "undefined" && CampaignManager.active();

  const group = (label, list, scope) => {
    // Show the Campaign group only when a campaign is active; always show Global.
    if (scope === "campaign" && !hasCampaign) return;
    const header = document.createElement("div");
    header.className = "nav-group-label";
    header.textContent = label;
    navEl.appendChild(header);
    list.forEach((entry) => navEl.appendChild(libraryEntryButton(kind, cfg, entry)));
    const create = document.createElement("button");
    create.className = "nav-create";
    create.textContent = "+ New " + cfg.noun;
    create.dataset.navIndex = "+";
    create.addEventListener("click", () => {
      if (typeof Editor !== "undefined") cfg.create((name) => openLibrary(kind, name), scope);
    });
    navEl.appendChild(create);
  };

  group("Campaign " + cfg.kicker, campaign, "campaign");
  group("Global " + cfg.kicker, global, "global");
}

// Re-read every library list into the sidebar (after create/edit/delete).
function refreshLibrarySidebars() {
  Object.keys(LIBRARY_VIEWS).forEach(mountLibraryNav);
}

// Switch the reader area to a single library entry's card + management toolbar.
async function openLibrary(kind, name) {
  const cfg = libraryConfig(kind);
  const isCurrent = currentView === cfg.view && currentLibraryName === name;
  if (!isCurrent && typeof confirmReaderNavigation === "function" && !(await confirmReaderNavigation())) return false;
  currentView = cfg.view;
  currentLibraryName = name;
  currentPath = null;
  document.querySelectorAll("#nav button, #library-nav button, #enemies-nav button")
    .forEach((b) => b.classList.remove("active"));
  cfg.nav().querySelectorAll("button").forEach((b) =>
    b.classList.toggle("active", b.dataset[cfg.nameAttr] === name)
  );
  renderLibraryView(kind, name);
  page.parentElement.scrollTop = 0;
  document.dispatchEvent(new CustomEvent("scene:loaded", { detail: { path: null, text: "" } }));
  return true;
}

function libraryToolbarButton(label, title, onClick, extraClass) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "library-view-btn" + (extraClass ? " " + extraClass : "");
  b.textContent = label;
  if (title) b.title = title;
  b.addEventListener("click", onClick);
  return b;
}

function renderLibraryView(kind, name) {
  const cfg = libraryConfig(kind);
  page.innerHTML = "";
  const view = document.createElement("div");
  view.className = "library-view";

  const head = document.createElement("div");
  head.className = "library-view-head";
  const kicker = document.createElement("div");
  kicker.className = "library-view-kicker";
  kicker.textContent = cfg.kicker;
  const titleEl = document.createElement("div");
  titleEl.className = "library-view-title";
  titleEl.textContent = name;
  head.appendChild(kicker);
  head.appendChild(titleEl);

  const toolbar = document.createElement("div");
  toolbar.className = "library-view-toolbar";
  toolbar.appendChild(libraryToolbarButton("✎ Edit", "Edit this " + cfg.noun, () => {
    if (typeof Editor !== "undefined" && Editor.editLibraryItem) {
      Editor.editLibraryItem(kind, name);
    }
  }));
  toolbar.appendChild(libraryToolbarButton("⟳ Refresh", "Reload from disk", async () => {
    if (typeof RefLibrary !== "undefined") await RefLibrary.refresh(kind, name);
    renderLibraryView(kind, name);
  }));
  toolbar.appendChild(libraryToolbarButton("Delete", "Delete this " + cfg.noun, () => deleteLibrary(kind, name), "danger"));

  view.appendChild(head);
  view.appendChild(toolbar);

  const resolved = (typeof RefLibrary !== "undefined") ? RefLibrary.resolve(kind, name) : { ok: false };
  if (resolved.ok) {
    const { cardEl } = renderCardFromSource(resolved.cardType, resolved.source);
    view.appendChild(cardEl || refMissingCard(kind, name));
    enhanceBaseStyling(view);
    enhanceCardCollapse(view);
  } else {
    view.appendChild(refMissingCard(kind, name));
  }

  page.appendChild(view);
}

async function deleteLibrary(kind, name) {
  const cfg = libraryConfig(kind);
  if (typeof RefLibrary === "undefined") return;
  const entry = RefLibrary.lookup(kind, name);
  if (!entry) return;
  if (!(await confirmDeleteCampaignEntry({ label: name, path: entry.path }))) return;
  try {
    await RefLibrary.deleteFile(kind, name);
    document.dispatchEvent(new CustomEvent("library:changed", { detail: { type: kind, name, removed: true } }));
    // Leave the library view: go back to the first campaign scene (or empty).
    if (campaignEntries.length) {
      await guardedLoad(campaignEntries[0].path);
    } else {
      currentView = "scene";
      currentLibraryName = null;
      page.innerHTML = "";
    }
  } catch (err) {
    alert(err.message || ("The " + cfg.noun + " could not be deleted."));
  }
}

// The editor (and the library view) dispatch "library:changed" after any
// create / move / edit / delete of a library file. Keep the sidebar in sync and
// re-render whatever the reader is showing so new/edited references resolve.
function installLibraryChangeHandler() {
  document.addEventListener("library:changed", () => {
    refreshLibrarySidebars();
    if (currentView === "library" && currentLibraryName) {
      // The edited/deleted item may be the one on screen.
      if (typeof RefLibrary !== "undefined" && RefLibrary.lookup("item", currentLibraryName)) {
        renderLibraryView("item", currentLibraryName);
      }
      return;
    }
    if (currentView === "enemy" && currentLibraryName) {
      if (typeof RefLibrary !== "undefined" && RefLibrary.lookup("enemy", currentLibraryName)) {
        renderLibraryView("enemy", currentLibraryName);
      }
      return;
    }
    if (currentView === "scene") {
      // Re-render the scene so edited/added references resolve. When the editor
      // is on, route through it so the editing decorations are re-applied.
      const ed = (typeof Editor !== "undefined" && Editor.getState) ? Editor.getState() : null;
      if (ed && ed.enabled && Editor.rerender) {
        Editor.rerender();
      } else {
        const src = (typeof window !== "undefined" && window.__rsLastSource) || "";
        if (src) renderPage(src);
      }
    }
  });
}
