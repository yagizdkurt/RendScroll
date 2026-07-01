/* ============================================================
   Sidebar: whole-sidebar + per-section collapse, the campaign
   scene list, the campaign CRUD fetch wrappers those buttons
   call, and the generic floating nav context menu.
   ============================================================ */

const SIDEBAR_COLLAPSED_KEY = "sidebarCollapsed";

function setSidebarCollapsed(collapsed) {
  document.body.classList.toggle("sidebar-collapsed", collapsed);
  sidebarToggle.setAttribute("aria-expanded", String(!collapsed));
  sidebarToggle.setAttribute("aria-label", collapsed ? "Expand sidebar" : "Collapse sidebar");
  localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
}

// Make each sidebar section (Campaign / Items / Enemies) collapse its list when
// its title is clicked, persisting per-section state. Independent of the whole-
// sidebar collapse (which hides titles entirely); section-collapse only hides a
// list while the sidebar is expanded (see base.css).
const SECTION_COLLAPSE_KEY = "navSectionCollapsed";
function setupCollapsibleSections() {
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem(SECTION_COLLAPSE_KEY) || "{}") || {}; } catch (_) { stored = {}; }

  document.querySelectorAll(".nav-section-title").forEach((title) => {
    const targetNav = title.nextElementSibling;
    if (!targetNav || targetNav.tagName !== "NAV") return;
    const key = title.id || title.textContent.trim();

    function apply(collapsed) {
      title.classList.toggle("is-collapsed", collapsed);
      targetNav.classList.toggle("is-collapsed", collapsed);
      title.setAttribute("aria-expanded", String(!collapsed));
    }
    function toggle() {
      const collapsed = !title.classList.contains("is-collapsed");
      apply(collapsed);
      stored[key] = collapsed;
      try { localStorage.setItem(SECTION_COLLAPSE_KEY, JSON.stringify(stored)); } catch (_) { /* ignore */ }
    }

    title.setAttribute("role", "button");
    title.setAttribute("tabindex", "0");
    apply(!!stored[key]);
    title.addEventListener("click", toggle);
    title.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
    });
  });
}

function showNavError(message) {
  nav.innerHTML = "";
  const error = document.createElement("div");
  error.className = "nav-error";
  error.textContent = message;
  nav.appendChild(error);
}

async function loadCampaignEntries() {
  const res = await fetch("/__campaign_files", { cache: "no-store" });
  if (!res.ok) throw new Error("campaign discovery failed");
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error("bad discovery response");
  return data;
}

async function createCampaignFile(title, manifest) {
  const body = { title };
  // Optional Scene Manifest markdown block, written under the "# Title" header.
  if (manifest && manifest.trim()) body.manifest = manifest;
  const res = await fetch("/__create_campaign_file", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  let payload = null;
  try {
    payload = await res.json();
  } catch {
    /* non-JSON body */
  }

  if (!res.ok || !payload || !payload.ok || !payload.entry) {
    const detail = payload && payload.error ? payload.error : `HTTP ${res.status}`;
    throw new Error("Page creation failed: " + detail);
  }
  return payload.entry;
}

async function deleteCampaignFile(path) {
  const res = await fetch("/__delete_campaign_file", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });

  let payload = null;
  try {
    payload = await res.json();
  } catch {
    /* non-JSON body */
  }

  if (!res.ok || !payload || !payload.ok) {
    const detail = payload && payload.error ? payload.error : `HTTP ${res.status}`;
    throw new Error("Page deletion failed: " + detail);
  }
}

function removeNavContextMenu() {
  const menu = document.querySelector(".nav-context-menu");
  if (menu) menu.remove();
  document.removeEventListener("mousedown", onNavContextMouseDown, true);
  document.removeEventListener("keydown", onNavContextKey, true);
  window.removeEventListener("scroll", removeNavContextMenu, true);
}

function onNavContextMouseDown(e) {
  const menu = document.querySelector(".nav-context-menu");
  if (menu && menu.contains(e.target)) return;
  removeNavContextMenu();
}

function onNavContextKey(e) {
  if (e.key === "Escape") removeNavContextMenu();
}

async function deleteCampaignEntry(entry) {
  const index = campaignEntries.findIndex((item) => item.path === entry.path);
  if (!(await confirmDeleteCampaignEntry(entry))) return;

  try {
    await deleteCampaignFile(entry.path);
    const entries = await loadCampaignEntries();
    campaignEntries = entries;

    if (currentPath === entry.path) {
      currentPath = null;
      mountCampaignEntries(entries);
      if (entries.length) {
        const next = entries[Math.min(Math.max(index, 0), entries.length - 1)];
        await load(next.path);
      } else {
        page.innerHTML = "";
        document.dispatchEvent(new CustomEvent("scene:loaded", { detail: { path: null, text: "" } }));
      }
    } else {
      mountCampaignEntries(entries);
    }
  } catch (err) {
    alert(err.message || "Page deletion failed.");
  }
}

// Generic sidebar context menu. `items` is a list of
// { label, danger?, disabled?, onClick } and/or { separator:true }. Reuses the
// single floating .nav-context-menu element + its outside-click/Escape/scroll
// teardown.
function openNavMenu(items, x, y) {
  removeNavContextMenu();

  const menu = document.createElement("div");
  menu.className = "nav-context-menu";
  menu.setAttribute("role", "menu");

  items.forEach((spec) => {
    if (!spec) return;
    if (spec.separator) {
      const sep = document.createElement("div");
      sep.className = "nav-context-menu-sep";
      menu.appendChild(sep);
      return;
    }
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "nav-context-menu-item" +
      (spec.danger ? " danger" : "") + (spec.disabled ? " is-disabled" : "");
    btn.setAttribute("role", "menuitem");
    btn.textContent = spec.label;
    if (spec.disabled) {
      btn.disabled = true;
    } else {
      btn.addEventListener("click", () => {
        removeNavContextMenu();
        spec.onClick();
      });
    }
    menu.appendChild(btn);
  });

  document.body.appendChild(menu);

  const rect = menu.getBoundingClientRect();
  const left = Math.min(x, window.innerWidth - rect.width - 8);
  const top = Math.min(y, window.innerHeight - rect.height - 8);
  menu.style.left = Math.max(8, left) + "px";
  menu.style.top = Math.max(8, top) + "px";

  document.addEventListener("mousedown", onNavContextMouseDown, true);
  document.addEventListener("keydown", onNavContextKey, true);
  window.addEventListener("scroll", removeNavContextMenu, true);
}

function mountCampaignEntries(entries) {
  nav.innerHTML = "";
  entries.forEach((entry, index) => {
    const { path, number, label } = entry;
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.dataset.path = path;
    btn.dataset.navIndex = String(index + 1);
    if (number !== null && number !== undefined) {
      btn.dataset.navIndex = String(number);
    }
    btn.classList.toggle("active", path === currentPath);
    btn.addEventListener("click", () => load(path));
    btn.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openNavMenu(
        [
          { label: "Edit manifest", onClick: () => openEditManifestDialog(entry) },
          { separator: true },
          { label: "Delete", danger: true, onClick: () => deleteCampaignEntry(entry) },
        ],
        e.clientX, e.clientY
      );
    });
    nav.appendChild(btn);
  });
  // A standalone "+ New page" affordance, mirroring the Item / Enemy libraries
  // (the topbar button does the same thing).
  const create = document.createElement("button");
  create.className = "nav-create";
  create.textContent = "+ New page";
  create.dataset.navIndex = "+";
  create.addEventListener("click", openNewPageDialog);
  nav.appendChild(create);
}

// Right-clicking empty sidebar space opens a create menu. Button/input targets
// are skipped so the per-entry menus (scenes, library items) keep their own
// handlers. Scene + campaign-bound options need an active campaign.
function installSidebarContextMenu() {
  const sidebar = document.getElementById("sidebar");
  if (!sidebar) return;
  sidebar.addEventListener("contextmenu", (e) => {
    if (e.target.closest("button, input, select, textarea, .options")) return;
    e.preventDefault();
    const hasCampaign = typeof CampaignManager !== "undefined" && CampaignManager.active();
    const newLib = (kind, scope) => () => {
      const cfg = libraryConfig(kind);
      if (typeof Editor !== "undefined") cfg.create((name) => openLibrary(kind, name), scope);
    };
    openNavMenu([
      { label: "New scene", disabled: !hasCampaign, onClick: openNewPageDialog },
      { separator: true },
      { label: "New item", onClick: newLib("item", "global") },
      { label: "New campaign-bound item", disabled: !hasCampaign, onClick: newLib("item", "campaign") },
      { label: "New enemy", onClick: newLib("enemy", "global") },
      { label: "New campaign-bound enemy", disabled: !hasCampaign, onClick: newLib("enemy", "campaign") },
    ], e.clientX, e.clientY);
  });
}

function mountManageCampaignsButton() {
  const btn = document.getElementById("manage-campaigns-button");
  if (btn && typeof CampaignManager !== "undefined") {
    btn.addEventListener("click", () => CampaignManager.open());
  }
}
