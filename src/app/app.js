/* ============================================================
   Entry point: owns the render pipeline and orchestration
   (init / campaign activation / scene load), plus the shared
   reader state every sibling module reads. Feature subsystems
   that used to live here now sit beside it as plain globals:
     - app/appModals.js    New Page + delete-confirm dialogs
     - app/appSidebar.js   sidebar, campaign CRUD, nav context menu
     - app/appLibrary.js   reference-library reader view
     - app/refNavigation.js inline [link=] jump + preview
   Card rendering lives in cards/<type>/*.js.
   ============================================================ */

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

/* Card type -> heading accent class. The parser owns classification (card.type);
   this map is the renderer's presentation choice for each type. Only level-3 card
   types are listed, matching the `h3.*-section` rules in base.css. */
const ACCENT_BY_TYPE = {
  skillchecks: "skill-section",
  npc: "npc-section",
  combat: "combat-section",
  unexpected: "contingency-section",
  echo: "echo-section",
};

/* Base styling shared by every scene (not tied to one feature). Heading accents
   are stamped per-card from the parsed card.type (see stampAccentClass), not
   re-sniffed from DOM text here. */
function enhanceBaseStyling(root) {
  // Read-aloud boxes.
  root.querySelectorAll("blockquote").forEach((bq) => bq.classList.add("read-aloud"));
}

// Stamp a card's heading accent from its parser type. Finds the first heading in
// the produced nodes (the builder's card subtree, or the raw block elements for a
// builderless type like echo) and adds ACCENT_BY_TYPE[type].
function stampAccentClass(nodes, type) {
  const cls = ACCENT_BY_TYPE[type];
  if (!cls) return;
  for (const n of nodes) {
    if (!n) continue;
    const h = (n.tagName && /^H[1-6]$/.test(n.tagName))
      ? n
      : (n.querySelector ? n.querySelector("h1, h2, h3, h4, h5, h6") : null);
    if (h) { h.classList.add(cls); return; }
  }
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

// Card-source -> card-element rendering (cardBuilder, cardTextSize,
// stripCardTextSize, applyCardTextSize, prepareCardSourceForRender,
// itemSourceResolver, stampClosed, renderCardFromSource) now lives in
// src/app/renderCard.js, loaded as a global before app.js. app.js keeps the
// orchestration below.

// Render a markdown string and return its top-level ELEMENT nodes (the old
// pipeline only ever walked element siblings, so text/whitespace nodes are
// dropped here too). Delegates to the shared card-layer helper
// (cards/shared/cardDirectives.js), which is loaded before app.js.
function markedToElements(md) {
  return renderMarkdownEls(md);
}

function cardRawSource(doc, card) {
  return doc.raw.slice(card.range.startOffset, card.range.endOffset);
}

// First card AST node in a parsed document is provided by the parser
// (RendScrollParser.firstCardNode) — the single owner of that walk.

// Heading element for a section, carrying the AST "Collapsable:" flag (which
// replaces the old markHeadingCollapsable DOM scan).
function renderSectionHeading(doc, section) {
  const els = markedToElements(RendScrollParser.lineText(doc.lines[section.headingRange.startLine]));
  const h = els[0];
  if (h && section.collapsable !== null && section.collapsable !== undefined) {
    h.dataset.collapsable = section.collapsable ? "true" : "false";
  }
  if (h && section.headingRange) {
    h.dataset.sectionStart = String(section.headingRange.startLine);
  }
  return h;
}

// Stamp a card with a normalized reference name so inline [link=…] can find it.
function stampRefName(el, name) {
  if (el && el.dataset && name) el.dataset.refName = rsLower(String(name).trim());
}

function cardIdSlug(value) {
  const slug = rsLower(String(value || ""))
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "untitled";
}

function nextCardId(renderContext, card) {
  const base = card.type + ":" + cardIdSlug(card.title);
  const count = (renderContext.cardIdCounts.get(base) || 0) + 1;
  renderContext.cardIdCounts.set(base, count);
  return count === 1 ? base : base + "-" + count;
}

// One card block -> the element(s) to append. A builder turns (heading, body
// nodes) into a card; a missing builder or a null result leaves the raw nodes.
function renderCardBlock(doc, card, renderContext) {
  const cardId = nextCardId(renderContext, card);
  const { cardEl, els } = renderCardFromSource(card.type, cardRawSource(doc, card), {
    cardId,
    scenePath: renderContext.scenePath,
  });
  if (!cardEl) { stampAccentClass(els, card.type); return els; }
  stampAccentClass([cardEl], card.type);
  applyCardTextSize(cardEl, cardTextSize(card));
  stampRefName(cardEl, card.title);
  cardEl.dataset.cardId = cardId;
  // Source line range of this card in the scene. layout only MOVES nodes, so the
  // stamp survives into the final grid; editor/anchors.js joins it back to the
  // outline card by line instead of re-simulating the layout routing.
  cardEl.dataset.srcStart = String(card.range.startLine);
  cardEl.dataset.srcEnd = String(card.range.endLine);
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
  const renderContext = { cardIdCounts: new Map(), scenePath: currentPath };
  page.innerHTML = "";

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
        renderCardBlock(doc, block, renderContext).forEach((el) => page.appendChild(el));
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

async function confirmReaderNavigation() {
  if (typeof Editor !== "undefined" && Editor.confirmNavigation) {
    return Editor.confirmNavigation();
  }
  return true;
}

async function guardedLoad(path) {
  if (currentView === "scene" && currentPath === path) return true;
  if (!(await confirmReaderNavigation())) return false;
  await load(path);
  return true;
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
  confirmNavigation: confirmReaderNavigation,
  guardedLoad,
};

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
  if (typeof SessionState !== "undefined") {
    await SessionState.loadForCampaign(name);
  }
  if (typeof RefLibrary !== "undefined") {
    try { await RefLibrary.init(); } catch (err) {
      if (typeof RSLog !== "undefined" && RSLog.warn) RSLog.warn("library", "Reference library init failed; continuing with an empty library.", err);
    }
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
    document.dispatchEvent(new CustomEvent("campaign:activated", { detail: { name: null } }));
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
  // The scene-graph panel (and any future subsystem) refreshes per-campaign
  // state on this; fired after entries exist so listeners see the new list.
  document.dispatchEvent(new CustomEvent("campaign:activated", { detail: { name } }));

  if (entries.length) {
    load(entries[0].path);
  } else {
    currentPath = null;
    page.innerHTML =
      '<div class="scene-empty-hint">This campaign has no scenes yet. Use ' +
      '<strong>+ New Page</strong> to add one.</div>';
  }
}

async function init() {
  setSidebarCollapsed(SafeStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true");
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
  const searchEl = document.getElementById("topbar-search");
  if (searchEl && typeof CampaignSearch !== "undefined" && CampaignSearch.mount) {
    CampaignSearch.mount(searchEl);
  }

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

  if (typeof RendScrollUpdateNotice !== "undefined") {
    RendScrollUpdateNotice.init();
  }
}

init();
