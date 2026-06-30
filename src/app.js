/* ============================================================
   Entry point: builds the sidebar, reacts to file selection,
   and orchestrates the render pipeline. Stays small on purpose.
   Feature-specific card rendering lives in cards/<type>/*.js.
   ============================================================ */

const SIDEBAR_COLLAPSED_KEY = "sidebarCollapsed";
const TOP_SCROLL_IMAGE = "src/STDImages/RendScroll1.png";

const nav = document.getElementById("nav");
const libraryNav = document.getElementById("library-nav");
const enemiesNav = document.getElementById("enemies-nav");
const page = document.getElementById("page");
const sidebarToggle = document.getElementById("sidebar-toggle");
const newPageButton = document.getElementById("new-page-button");
let currentPath = null;
let campaignEntries = [];
// The reader area shows either a campaign scene ("scene") or a single library
// item ("library"); the sidebar reflects which is active.
let currentView = "scene";
let currentLibraryName = null;

/* Known label lines from the template that should stand out. */
const FIELD_LABELS = new Set([
  "kişilik:", "ilk diyalog:", "sorarsa:", "bildikleri:", "bilmedikleri:",
  "stat:", "taktik:", "genel:", "cesetler:", "köpek:", "sandıklar:",
  "amaç:", "öz:", "kültist:", "cult hunter:",
]);

function createTopScrollImage() {
  const wrap = document.createElement("div");
  wrap.className = "top-scroll-image";

  const img = document.createElement("img");
  img.src = TOP_SCROLL_IMAGE;
  img.alt = "";
  img.decoding = "async";

  wrap.appendChild(img);
  return wrap;
}

/* Base styling shared by every scene (not tied to one feature). */
function enhanceBaseStyling(root) {
  // Read-aloud boxes.
  root.querySelectorAll("blockquote").forEach((bq) => bq.classList.add("read-aloud"));

  // Section headings get an accent based on their text.
  root.querySelectorAll("h2, h3").forEach((h) => {
    const t = rsLower(h.textContent);
    if (t.includes("skill check")) h.classList.add("skill-section");
    else if (t.includes("npc")) h.classList.add("npc-section");
    else if (t.includes("savaş") || t.includes("combat")) h.classList.add("combat-section");
    else if (t.includes("beklenmedik")) h.classList.add("contingency-section");
    else if (t.includes("yankı")) h.classList.add("echo-section");
  });

  // Short "Label:" paragraphs become emphasized field labels.
  root.querySelectorAll("p").forEach((p) => {
    const t = p.textContent.trim();
    const isKnown = FIELD_LABELS.has(rsLower(t));
    const looksLikeLabel = t.endsWith(":") && t.length <= 24 && !t.includes(" ");
    if (isKnown || looksLikeLabel) p.classList.add("field-label");
  });
}

/* Render a scene from raw markdown via the RendScroll parser model.

   Pipeline: parse -> walk the document model -> for each card, render its
   (per-card normalized) source through marked and hand the heading + body nodes
   to that card type's builder; non-card blocks render straight through marked.
   Card discovery is driven by the parser, NOT by scanning a flat HTML DOM — this
   replaced the old global normalize* + sibling-walking enhancers.

   After the flat card/heading DOM exists, the shared passes run exactly as
   before: base styling, per-card collapse, the two-column layout, and heading
   collapse. */

// Card type -> builder(headingEl, bodyEls) -> card element (or null to leave the
// bare heading, mirroring each old enhancer's "no body -> skip" behaviour). The
// builders self-register into RendScrollCards (cards/shared/cardRegistry.js); this
// looks them up by type so there is no hand-synced table to keep in step.
function cardBuilder(type) {
  return (typeof RendScrollCards !== "undefined") ? RendScrollCards.builder(type) : null;
}

const CARD_TEXT_SIZE_DEFAULT_PX = 18.24; // current .page p default: 1.14rem at 16px
const CARD_TEXT_SIZE_RE = /^\s*text\s*size\s*:\s*(\d+(?:\.\d+)?)\s*$/i;

function validCardTextSize(value) {
  const n = Number(value);
  return /^\d+(?:\.\d+)?$/.test(String(value || "")) && n >= 8 && n <= 32;
}

function cardTextSize(card) {
  const d = card.directives.find((x) => x.name === "textsize");
  return d && validCardTextSize(d.value) ? Number(d.value) : null;
}

function stripCardTextSize(src) {
  return String(src || "")
    .split(/\r?\n/)
    .filter((line) => {
      const m = line.match(CARD_TEXT_SIZE_RE);
      return !(m && validCardTextSize(m[1]));
    })
    .join("\n");
}

function applyCardTextSize(cardEl, size) {
  if (!cardEl || !cardEl.classList || size == null) return;
  cardEl.style.setProperty("--rs-card-text-scale", String(size / CARD_TEXT_SIZE_DEFAULT_PX));
}

/* Per-card source isolation, selected by the parsed card type. Each type's helper
   only isolates directive/label lines WITHIN its own card (the card source starts
   with its heading), so a card written with "Az Enter" still parses. The helper is
   registered alongside the builder (cards/shared/cardRegistry.js); a type with no
   normalizer (echo/sourceenemy/unknown) renders as a plain heading + body. */
function isolateCardSource(type, src) {
  const normalize = (typeof RendScrollCards !== "undefined") ? RendScrollCards.normalizer(type) : null;
  if (normalize) src = normalize(src);
  return normalizeClosedMarkdown(src); // "Closed:" may appear in any card
}

// Render a markdown string and return its top-level ELEMENT nodes (the old
// pipeline only ever walked element siblings, so text/whitespace nodes are
// dropped here too).
function markedToElements(md) {
  const tmp = document.createElement("div");
  tmp.innerHTML = renderMarkdown(md);
  return [...tmp.children];
}

function cardRawSource(doc, card) {
  return doc.raw.slice(card.range.startOffset, card.range.endOffset);
}

function itemSourceResolver(name) {
  if (typeof RefLibrary === "undefined") return null;
  const entry = RefLibrary.lookup("item", name);
  return entry ? entry.source : null;
}

function prepareCardSourceForRender(type, src) {
  if (typeof ItemData === "undefined") return src;
  if (type === "item") return ItemData.resolveItemSource(src, itemSourceResolver);
  if (type === "sourceitem") return ItemData.sourceItemRenderSource(src);
  return src;
}

// Heading element for a section, carrying the AST "Collapsable:" flag (which
// replaces the old markHeadingCollapsable DOM scan).
function renderSectionHeading(doc, section) {
  const els = markedToElements(RendScrollParser.lineText(doc.lines[section.headingRange.startLine]));
  const h = els[0];
  if (h && section.collapsable !== null && section.collapsable !== undefined) {
    h.dataset.collapsable = section.collapsable ? "true" : "false";
  }
  return h;
}

// Card source (heading + body) -> its built card element. Shared by scene cards
// and library SourceItem views so item rendering stays on one path.
function renderCardFromSource(type, src) {
  const renderSrc = prepareCardSourceForRender(type, stripCardTextSize(src));
  const els = markedToElements(isolateCardSource(type, renderSrc));
  const builder = cardBuilder(type);
  if (!builder) return { cardEl: null, els };
  const cardEl = builder(els[0], els.slice(1));
  return { cardEl, els };
}

// Stamp a card with a normalized reference name so inline [link=…] can find it.
function stampRefName(el, name) {
  if (el && el.dataset && name) el.dataset.refName = rsLower(String(name).trim());
}

// One card block -> the element(s) to append. A builder turns (heading, body
// nodes) into a card; a missing builder or a null result leaves the raw nodes.
function renderCardBlock(doc, card) {
  const { cardEl, els } = renderCardFromSource(card.type, cardRawSource(doc, card));
  if (!cardEl) return els;
  applyCardTextSize(cardEl, cardTextSize(card));
  stampRefName(cardEl, card.title);
  return [cardEl];
}

function refMissingCard(type, name) {
  const div = document.createElement("div");
  div.className = "ref-missing";
  div.textContent = "⚠ Not found in library: [" + type + "=" + name + "]";
  return div;
}

function renderPage(text) {
  const doc = RendScrollParser.parseRendScroll(text);
  page.innerHTML = "";
  page.appendChild(createTopScrollImage());

  doc.sections.forEach((section) => {
    if (section.headingRange) {
      const h = renderSectionHeading(doc, section);
      if (h) page.appendChild(h);
    }
    // Consecutive non-card blocks (narrative / plain / HR) are rendered together
    // from their original source slice, so marked sees them exactly as it did in
    // the old whole-document parse (e.g. a list immediately followed by a "> …"
    // blockquote stays one structure). A card boundary flushes the run.
    let buffer = [];
    const flushNonCards = () => {
      if (!buffer.length) return;
      const a = buffer[0].range.startOffset;
      const b = buffer[buffer.length - 1].range.endOffset;
      // Heading-level "Collapsable:" lines live on the section, never shown.
      const src = doc.raw.slice(a, b)
        .split(/\r?\n/)
        .filter((l) => !RendScrollParser.regexes.COLLAPSABLE_RE.test(l.trim()))
        .join(doc.eol);
      markedToElements(src).forEach((el) => page.appendChild(el));
      buffer = [];
    };
    section.blocks.forEach((block) => {
      if (block.kind === "card") {
        flushNonCards();
        renderCardBlock(doc, block).forEach((el) => page.appendChild(el));
      } else {
        buffer.push(block);
      }
    });
    flushNonCards();
  });

  enhanceBaseStyling(page);
  enhanceCardCollapse(page);
  // Re-arrange the styled nodes into the header band + two-column grid.
  layoutTwoColumns(page);
  // After the grid exists, add collapse toggles to the main event headings.
  enhanceHeadingCollapse(page);
}

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

async function load(path) {
  const text = await fetchMarkdown(path);
  currentPath = path;
  currentView = "scene";
  currentLibraryName = null;
  renderPage(text);
  page.parentElement.scrollTop = 0;
  document.querySelectorAll("#nav button").forEach((b) =>
    b.classList.toggle("active", b.dataset.path === path)
  );
  document.querySelectorAll("#library-nav button, #enemies-nav button").forEach((b) => b.classList.remove("active"));
  // Editor mode (editor/*.js) listens for this to cache the scene's raw source.
  // No-op when the editor isn't loaded.
  document.dispatchEvent(new CustomEvent("scene:loaded", { detail: { path, text } }));
}

/* ----- Reference libraries (Items, Enemies, …): sidebar list + reader view ---
   ONE parameterized implementation drives every ref kind in RefLibrary's REF_TYPES.
   Per-kind UI specifics (sidebar nav element, kicker label, the editor "+ New …"
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
function openLibrary(kind, name) {
  const cfg = libraryConfig(kind);
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
      await load(campaignEntries[0].path);
    } else {
      currentView = "scene";
      currentLibraryName = null;
      page.innerHTML = "";
    }
  } catch (err) {
    alert(err.message || ("The " + cfg.noun + " could not be deleted."));
  }
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

async function createCampaignFile(title) {
  const res = await fetch("/__create_campaign_file", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
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

function confirmDeleteCampaignEntry(entry) {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "editor-modal-backdrop nav-delete-backdrop";

    const modal = document.createElement("div");
    modal.className = "editor-modal nav-delete-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "nav-delete-title");

    const head = document.createElement("div");
    head.className = "editor-modal-head";
    head.id = "nav-delete-title";
    head.textContent = `Delete "${entry.label}"?`;

    const body = document.createElement("div");
    body.className = "editor-modal-body";
    const text = document.createElement("p");
    text.className = "nav-delete-message";
    text.textContent = "This cannot be undone.";
    body.appendChild(text);

    const foot = document.createElement("div");
    foot.className = "editor-modal-foot";

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "editor-btn";
    cancel.textContent = "Cancel";

    const del = document.createElement("button");
    del.type = "button";
    del.className = "editor-btn danger";
    del.textContent = "Delete";

    function close(result) {
      document.removeEventListener("keydown", onKeydown);
      backdrop.remove();
      resolve(result);
    }

    function onKeydown(e) {
      if (e.key === "Escape") close(false);
      if (e.key === "Enter") close(true);
    }

    cancel.addEventListener("click", () => close(false));
    del.addEventListener("click", () => close(true));
    backdrop.addEventListener("mousedown", (e) => {
      if (e.target === backdrop) close(false);
    });

    foot.appendChild(cancel);
    foot.appendChild(del);
    modal.appendChild(head);
    modal.appendChild(body);
    modal.appendChild(foot);
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    document.addEventListener("keydown", onKeydown);
    del.focus();
  });
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
        [{ label: "Delete", danger: true, onClick: () => deleteCampaignEntry(entry) }],
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

function removeNewPageDialog(backdrop) {
  document.removeEventListener("keydown", backdrop._onKeydown);
  backdrop.remove();
}

function openNewPageDialog() {
  if (document.querySelector(".new-page-backdrop")) return;

  const backdrop = document.createElement("div");
  backdrop.className = "editor-modal-backdrop new-page-backdrop";

  const modal = document.createElement("form");
  modal.className = "editor-modal new-page-modal";
  modal.noValidate = true;

  const head = document.createElement("div");
  head.className = "editor-modal-head";
  head.textContent = "New Page";

  const body = document.createElement("div");
  body.className = "editor-modal-body";

  const field = document.createElement("div");
  field.className = "editor-field";

  const label = document.createElement("label");
  label.htmlFor = "new-page-title";
  label.textContent = "Page title";

  const input = document.createElement("input");
  input.id = "new-page-title";
  input.type = "text";
  input.value = "New Page";
  input.maxLength = 120;
  input.autocomplete = "off";

  const error = document.createElement("div");
  error.className = "editor-field-error new-page-error";
  error.setAttribute("role", "alert");

  field.appendChild(label);
  field.appendChild(input);
  field.appendChild(error);
  body.appendChild(field);

  const foot = document.createElement("div");
  foot.className = "editor-modal-foot";

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "editor-btn";
  cancel.textContent = "Cancel";

  const create = document.createElement("button");
  create.type = "submit";
  create.className = "editor-btn primary";
  create.textContent = "Create";

  foot.appendChild(cancel);
  foot.appendChild(create);
  modal.appendChild(head);
  modal.appendChild(body);
  modal.appendChild(foot);
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  function setBusy(busy) {
    input.disabled = busy;
    cancel.disabled = busy;
    create.disabled = busy;
    create.textContent = busy ? "Creating..." : "Create";
    newPageButton.disabled = busy;
  }

  function close() {
    newPageButton.disabled = false;
    removeNewPageDialog(backdrop);
  }

  backdrop._onKeydown = (e) => {
    if (e.key === "Escape" && !create.disabled) close();
  };
  document.addEventListener("keydown", backdrop._onKeydown);

  cancel.addEventListener("click", close);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop && !create.disabled) close();
  });

  modal.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = input.value.trim();
    if (!title) {
      error.textContent = "Enter a page title.";
      input.focus();
      return;
    }

    error.textContent = "";
    setBusy(true);
    try {
      const entry = await createCampaignFile(title);
      const entries = await loadCampaignEntries();
      campaignEntries = entries;
      mountCampaignEntries(entries);
      await load(entry.path);
      close();
    } catch (err) {
      error.textContent = err.message || "Page creation failed.";
      setBusy(false);
      input.focus();
    }
  });

  requestAnimationFrame(() => {
    input.focus();
    input.select();
  });
}

function mountNewPageButton() {
  if (!newPageButton) return;
  newPageButton.addEventListener("click", openNewPageDialog);
}

/* Dev-only: inspect the parsed RendScroll AST for the current scene without
   touching rendering. In the console: `__rsDump()` prints readable JSON, and
   `__rsParse()` returns the live document. Caches the raw source each scene load.
   This is a passive observer of the existing pipeline (Phase 1 of the parser
   migration); it changes nothing the user sees. */
document.addEventListener("scene:loaded", (e) => {
  window.__rsLastSource = e.detail && e.detail.text ? e.detail.text : "";
});
window.__rsParse = () => RendScrollParser.parseRendScroll(window.__rsLastSource || "");
window.__rsDump = () => {
  const json = RendScrollParser.debugDump(window.__rsParse());
  console.log(json);
  return json;
};

/* Small, read-only accessor so tooling (e.g. the Debug panel, src/debug/) can
   read the same scene state the renderer/editor use, without duplicating the
   file-fetch logic. Additive — the dev hooks above are unchanged. */
window.RendScrollApp = {
  currentSource: () => window.__rsLastSource || "",
  currentPath: () => currentPath,
  campaignEntries: () => campaignEntries.slice(),
};

/* ----- inline [link=Name] navigation + preview ---------------------------- */

function findCardByRefName(name) {
  const key = rsLower(String(name).trim());
  const sel = (window.CSS && CSS.escape) ? CSS.escape(key) : key.replace(/"/g, '\\"');
  return page.querySelector('[data-ref-name="' + sel + '"]');
}

// Open every collapsed card/heading hiding `el`, so a jump never lands on
// invisible content. Reuses the existing collapse toggles (cardCollapse.js /
// HeadingCollapse) so collapse state stays consistent.
function revealElement(el) {
  let node = el;
  while (node && node !== page) {
    if (node.classList && node.classList.contains("is-collapsed")) {
      const btn = node.querySelector(":scope > .card-head > .card-toggle");
      if (btn) btn.click();
    }
    node = node.parentElement;
  }
  let guard = 0;
  while (el.offsetParent === null && guard++ < 50) {
    const collapsed = [...page.querySelectorAll(".heading-collapsed")];
    if (!collapsed.length) break;
    let toOpen = collapsed[0];
    for (const h of collapsed) {
      if (h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) toOpen = h;
    }
    const btn = toOpen.querySelector(":scope > .card-toggle");
    if (!btn) break;
    btn.click();
  }
}

function flashCard(el) {
  el.classList.add("ref-flash");
  setTimeout(() => el.classList.remove("ref-flash"), 1200);
}

function flashBrokenLink(a) {
  a.classList.add("rs-ref-link-broken");
  setTimeout(() => a.classList.remove("rs-ref-link-broken"), 1200);
}

let activePreview = null;
function closeRefPreview() {
  if (!activePreview) return;
  activePreview.remove();
  activePreview = null;
  document.removeEventListener("mousedown", onPreviewOutside, true);
  document.removeEventListener("keydown", onPreviewKey, true);
}
function onPreviewOutside(e) {
  if (activePreview && !activePreview.contains(e.target)) closeRefPreview();
}
function onPreviewKey(e) {
  if (e.key === "Escape") closeRefPreview();
}

function positionPreview(pop, anchor) {
  const r = anchor.getBoundingClientRect();
  const margin = 8;
  pop.style.position = "fixed";
  pop.style.visibility = "hidden";
  pop.style.left = "0px";
  pop.style.top = "0px";
  const pr = pop.getBoundingClientRect();
  let left = Math.min(r.left, window.innerWidth - pr.width - margin);
  let top = r.bottom + margin;
  if (top + pr.height > window.innerHeight - margin) top = r.top - pr.height - margin;
  pop.style.left = Math.max(margin, left) + "px";
  pop.style.top = Math.max(margin, top) + "px";
  pop.style.visibility = "";
}

// Render the referenced library card into a floating popover anchored to the
// link, for references whose card isn't on the current page.
function showRefPreview(anchor, type, name) {
  closeRefPreview();
  if (typeof RefLibrary === "undefined") return;
  const resolved = RefLibrary.resolve(type, name);
  if (!resolved.ok) { flashBrokenLink(anchor); return; }
  const pop = document.createElement("div");
  pop.className = "ref-preview-popover";
  const { cardEl, els } = renderCardFromSource(resolved.cardType, resolved.source);
  const content = cardEl || (els && els[0]);
  if (!content) { flashBrokenLink(anchor); return; }
  pop.appendChild(content);
  document.body.appendChild(pop);
  positionPreview(pop, anchor);
  activePreview = pop;
  setTimeout(() => {
    document.addEventListener("mousedown", onPreviewOutside, true);
    document.addEventListener("keydown", onPreviewKey, true);
  }, 0);
}

function activateRefLink(a) {
  const name = a.dataset.refName || "";
  const target = findCardByRefName(name);
  if (target) {
    revealElement(target);
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    flashCard(target);
    return;
  }
  if (typeof RefLibrary !== "undefined") {
    const found = RefLibrary.lookupAny(name);
    if (found) { showRefPreview(a, found.type, found.entry.name); return; }
  }
  // Broken: the Debug panel reports it; give a small visual nudge here.
  flashBrokenLink(a);
}

function installRefLinkHandler() {
  page.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest(".rs-ref-link");
    if (!a || !page.contains(a)) return;
    e.preventDefault();
    activateRefLink(a);
  });
  page.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const a = e.target.closest && e.target.closest(".rs-ref-link");
    if (!a) return;
    e.preventDefault();
    activateRefLink(a);
  });
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

function mountManageCampaignsButton() {
  const btn = document.getElementById("manage-campaigns-button");
  if (btn && typeof CampaignManager !== "undefined") {
    btn.addEventListener("click", () => CampaignManager.open());
  }
}

// The empty start screen shown when no campaign is active (the Manage Campaigns
// overlay is open over this). We never auto-load root files as a fake campaign.
function showStartScreen() {
  currentPath = null;
  currentView = "scene";
  campaignEntries = [];
  nav.innerHTML = "";
  page.innerHTML =
    '<div class="scene-empty-hint">No campaign selected. Use ' +
    '<strong>Manage Campaigns</strong> to create, open, or import one.</div>';
}

// Switch the reader to a campaign (or clear it for the start screen). Called by
// CampaignManager on boot and on every switch — the server already knows the
// active campaign at this point, so RefLibrary loads the campaign-scoped library.
async function activateCampaign(name) {
  if (typeof RefLibrary !== "undefined") {
    try { await RefLibrary.init(); } catch (_) { /* empty library */ }
  }
  refreshLibrarySidebars();

  const campaignNameEl = document.getElementById("nav-campaign-name");
  if (campaignNameEl) {
    const label = (typeof CampaignManager !== "undefined" && CampaignManager.activeLabel)
      ? CampaignManager.activeLabel()
      : (name || "");
    campaignNameEl.textContent = label;
  }

  if (!name) {
    showStartScreen();
    return;
  }

  let entries = [];
  try {
    entries = await loadCampaignEntries();
  } catch {
    showNavError("Campaign files could not be discovered. Start RendScroll with launcher.py.");
    return;
  }
  campaignEntries = entries;
  mountCampaignEntries(entries);

  if (entries.length) {
    load(entries[0].path);
  } else {
    currentPath = null;
    page.innerHTML =
      '<div class="scene-empty-hint">This campaign has no scenes yet. Use ' +
      '<strong>+ New Page</strong> to add one.</div>';
  }
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

async function init() {
  setSidebarCollapsed(localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true");
  sidebarToggle.addEventListener("click", () =>
    setSidebarCollapsed(!document.body.classList.contains("sidebar-collapsed"))
  );
  mountNewPageButton();
  mountManageCampaignsButton();

  // Renderer options: load persisted choices (two-file model) + apply, then
  // mount the topbar launcher that opens the Options modal.
  await RendererOptions.init();
  const optionsEl = document.getElementById("topbar-tools") || document.getElementById("options");
  if (optionsEl) RendererOptions.mount(optionsEl);

  installRefLinkHandler();
  installLibraryChangeHandler();
  setupCollapsibleSections();
  installSidebarContextMenu();

  // The campaign manager owns selection (localStorage + server) and the start
  // screen; it calls activateCampaign() to load the chosen campaign's reader.
  if (typeof CampaignManager !== "undefined") {
    CampaignManager.configure({ onSwitch: activateCampaign });
    await CampaignManager.init();
  } else {
    showStartScreen();
  }
}

init();
