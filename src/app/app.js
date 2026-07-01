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

// Card type -> builder(card, headingEl, bodyEls) -> card element (or null to leave
// the bare heading, mirroring each old enhancer's "no body -> skip" behaviour). The
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

// First card AST node in a parsed document (used to hand builders the structured
// model for a single card's source). Returns null when the source has no card.
function firstCardNode(doc) {
  for (const section of doc.sections) {
    for (const block of section.blocks) {
      if (block.kind === "card") return block;
    }
  }
  return null;
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

// Carry the per-card "Closed:" collapse directive from the AST onto the card
// element (cardCollapse.js reads dataset.ccDirective). The directive is no longer
// rendered as a body <p>, so the builder no longer drops it — we stamp it here.
function stampClosed(cardEl, card) {
  if (!cardEl || !cardEl.dataset || !card) return;
  const v = cardDirective(card, "closed");
  if (/^(t|true)$/i.test(v)) cardEl.dataset.ccDirective = "closed";
  else if (/^(f|false)$/i.test(v)) cardEl.dataset.ccDirective = "open";
}

// Card source (heading + body) -> its built card element. Shared by scene cards
// and library SourceItem views so item rendering stays on one path. The builder
// reads structured directives/checks/body from the parsed AST node, so only the
// heading goes through marked here (no more re-parsing the whole card just to feed
// the builder DOM it re-sniffed). Parsing the PREPARED source means an Item's
// resolved SourceItem merge is reflected in the node the builder sees.
function renderCardFromSource(type, src) {
  const renderSrc = prepareCardSourceForRender(type, stripCardTextSize(src));
  const builder = cardBuilder(type);
  // No builder (e.g. echo): render the whole block straight through marked.
  if (!builder) return { cardEl: null, els: markedToElements(normalizeClosedMarkdown(renderSrc)) };
  const card = firstCardNode(RendScrollParser.parseRendScroll(renderSrc));
  const head = markedToElements(renderSrc.split(/\r?\n/)[0] || "")[0] || null;
  const cardEl = builder(card, head, []);
  if (cardEl) stampClosed(cardEl, card);
  return { cardEl, els: head ? [head] : [] };
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

  if (typeof RendScrollUpdateNotice !== "undefined") {
    RendScrollUpdateNotice.init();
  }
}

init();
