/* End-to-end guard for the render-time anchor stamps: renderPage() must stamp
   every card <div> with data-src-start/data-src-end, the two-column layout must
   only MOVE those nodes (stamps survive into the final grid), and every stamp
   must join back to exactly one EditorOutline card by its heading line. This is
   the drift guard that replaced editor/anchors.js's layout re-simulation — if a
   layout or builder change ever breaks card↔source identity, it fails here
   instead of silently making cards un-editable. */

"use strict";

const { test, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const EditorOutline = require("../src/editor/outline.js");

const ROOT = path.join(__dirname, "..");

// Reader scripts in index.html order (the cardBuilders.test.js list) PLUS the
// layout pass and app.js itself, so the real renderPage() runs end-to-end.
const SCRIPTS = [
  "src/vendor/marked.min.js",
  "src/utils/safeStorage.js",
  "src/utils/text.js",
  "src/utils/dom.js",
  "src/utils/markdown.js",
  "src/parser/rendscrollParser.js",
  "src/cards/shared/skillCheckRules.js",
  "src/inlineFormatting.js",
  "src/markdown.js",
  "src/cards/shared/cardImage.js",
  "src/cards/shared/cardDirectives.js",
  "src/cards/shared/StdIcons.js",
  "src/cards/shared/damageModel.js",
  "src/cards/shared/damageRender.js",
  "src/cards/shared/itemTypes.js",
  "src/cards/shared/cardParts.js",
  "src/cards/shared/cardRegistry.js",
  "src/cards/skillChecks/skillChecks.js",
  "src/cards/npc/npc.js",
  "src/cards/item/item.js",
  "src/cards/ability/ability.js",
  "src/cards/obj/obj.js",
  "src/cards/combat/enemyModel.js",
  "src/cards/combat/combat.js",
  "src/cards/unexpected/unexpected.js",
  "src/cards/narrative/narrative.js",
  "src/cards/std/std.js",
  "src/cards/manifest/manifest.js",
  "src/cards/picture/picture.js",
  "src/cards/audio/audio.js",
  "src/cards/shared/cardCollapse.js",
  "src/cards/shared/layout.js",
];

// app.js boots itself (init()) and expects the sidebar/campaign/options layers;
// stub just enough of them that init() resolves without touching #page.
const APP_STUBS = `
  var SIDEBAR_COLLAPSED_KEY = "test-sidebar-collapsed";
  function setSidebarCollapsed() {}
  function mountNewPageButton() {}
  function mountManageCampaignsButton() {}
  function installRefLinkHandler() {}
  function installLibraryChangeHandler() {}
  function setupCollapsibleSections() {}
  function installSidebarContextMenu() {}
  function refreshLibrarySidebars() {}
  function mountCampaignEntries() {}
  function showNavError() {}
  async function loadCampaignEntries() { return []; }
  var RendererOptions = {
    init: async function () {},
    mount: function () {},
    get: function () { return undefined; },
  };
  var CampaignManager = { configure: function () {}, init: async function () {} };
`;

// Exercises every layout path: header band, two-column row with a Side: R card,
// an <hr> row split, sticky docking, and an H1 full-width section.
const SCENE = [
  "# Scene Title",
  "",
  "### STD: Header Note",
  "> In the header band.",
  "",
  "## First Event",
  "",
  "### Narrative",
  "Text:",
  "> Read aloud.",
  "",
  "### Skill Checks",
  "Side: R",
  "Combat:",
  "- Athletics:",
  "> 10: climb",
  "",
  "---",
  "",
  "### Object: Shrine",
  "> A small shrine.",
  "",
  "### Item: Holy Symbol",
  "Connect: T",
  "Type: Wondrous",
  "",
  "# Interlude",
  "",
  "### STD: Full Width",
  "> Inside the H1 section.",
  "",
  "## Second Event",
  "",
].join("\n");

let win;

before(async () => {
  const dom = new JSDOM(
    '<!DOCTYPE html><body>' +
      '<div id="nav"></div><div id="library-nav"></div><div id="enemies-nav"></div>' +
      '<button id="sidebar-toggle"></button><button id="new-page-button"></button>' +
      '<article id="page"></article>' +
      "</body>",
    // A real origin so app.js's init() can touch localStorage (about:blank cannot).
    { runScripts: "dangerously", url: "http://localhost/" }
  );
  win = dom.window;
  const add = (code) => {
    const el = win.document.createElement("script");
    el.textContent = code;
    win.document.body.appendChild(el);
  };
  for (const file of SCRIPTS) add(fs.readFileSync(path.join(ROOT, file), "utf8"));
  add(APP_STUBS);
  add(fs.readFileSync(path.join(ROOT, "src/app/app.js"), "utf8"));
  // Let app.js's async init() settle before rendering.
  await new Promise((r) => setTimeout(r, 0));
});

function render(src) {
  win.renderPage(src);
  return win.document.getElementById("page");
}

test("every card div is stamped and every stamp joins to exactly one outline card", () => {
  const page = render(SCENE);
  const model = EditorOutline.parse(SCENE);
  const modelCards = model.events.flatMap((ev) => ev.cards);
  const stamped = [...page.querySelectorAll("[data-src-start]")];

  assert.equal(stamped.length, modelCards.length,
    "one stamped div per outline card (dom=" + stamped.length + " model=" + modelCards.length + ")");

  const seen = new Set();
  for (const el of stamped) {
    const start = Number(el.dataset.srcStart);
    const hit = EditorOutline.findCardByStart(model, start);
    assert.ok(hit, "stamp data-src-start=" + start + " must resolve to an outline card");
    assert.equal(Number(el.dataset.srcEnd), hit.card.end,
      "data-src-end must match the outline card's end for " + hit.card.type);
    assert.ok(!seen.has(hit.card.id), "outline card matched twice: " + hit.card.id);
    seen.add(hit.card.id);
  }
});

test("stamps survive the two-column layout into every placement context", () => {
  const page = render(SCENE);

  // Header band: the STD card before the first H2.
  const headerCard = page.querySelector(".page-header .std-card");
  assert.ok(headerCard && headerCard.dataset.srcStart, "header-band card keeps its stamp");

  // Side: R routes to the aside column; the stamp must ride along.
  const asideCard = page.querySelector(".col-aside .sc-card");
  assert.ok(asideCard && asideCard.dataset.srcStart, "right-column card keeps its stamp");

  // A docked (Connect: T) item lands in its host's column, still stamped.
  const docked = page.querySelector(".page-grid .item-card");
  assert.ok(docked && docked.dataset.srcStart, "docked card keeps its stamp");

  // H1 full-width section body.
  const fullCard = page.querySelector(".grid-full .std-card");
  assert.ok(fullCard && fullCard.dataset.srcStart, "full-width section card keeps its stamp");
});

test("non-card content is never stamped", () => {
  const page = render(SCENE);
  for (const el of page.querySelectorAll("[data-src-start]")) {
    assert.match(el.className, /-card\b/, "only card divs may carry data-src-start");
  }
});
