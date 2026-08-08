/* Shared jsdom boot for the reader render pipeline — the single source for the
   index.html <script> ORDER that render-pipeline tests need. Before this helper
   the ordered list was copy-pasted into cardBuilders.test.js and
   renderAnchorStamps.test.js (and had to be edited in lockstep whenever a card
   file was added). Consumers now call bootReader() and get a jsdom `window` with
   the reader globals loaded.

   Options:
     withLayout: also load cards/shared/layout.js (the two-column pass).
     withApp:    also load the REAL src/app/app.js. app.js boots itself (init()
                 at load) and expects the sidebar/campaign/options layers, so we
                 append a small APP_STUBS block that neutralizes those deps and
                 then await a macrotask so the async init() settles. This is what
                 lets a test drive the genuine renderPage()/renderCardFromSource(). */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..", "..");

// Reader subset of index.html's <script> order, up through the card layer plus the
// extracted card-source renderer (src/app/renderCard.js). Excludes layout.js and
// app.js (opt-in via bootReader options), the editor/printer/debug layers, and the
// campaign/options subsystems (stubbed by APP_STUBS when app.js is loaded).
const READER_SCRIPTS = [
  "src/vendor/marked.min.js",
  "src/utils/safeStorage.js",
  "src/utils/text.js",
  "src/utils/markdown.js",
  "src/utils/serverApi.js",
  "src/debug/rsLog.js",
  "src/session/sessionState.js",
  "src/session/draftState.js",
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
  "src/cards/transition/transition.js",
  "src/cards/shared/cardCollapse.js",
  "src/app/renderCard.js",
];

// app.js's init() calls into the sidebar/campaign/options layers and touches
// localStorage. Stub just enough that init() resolves without touching #page.
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

// Reader globals a test may want to reach from Node via `win.<name>`. Each is
// assigned only if it exists (some are absent depending on withLayout/withApp).
const EXPOSE_GLOBALS = [
  "RendScrollParser",
  "RendScrollCards",
  "renderMarkdown",
  "renderMarkdownEls",
  "renderCardFromSource",
  "renderPage",
]
  .map((n) => `if (typeof ${n} !== "undefined") window.${n} = ${n};`)
  .join("\n");

const SCAFFOLD =
  '<!DOCTYPE html><body>' +
  '<div id="nav"></div><div id="library-nav"></div><div id="enemies-nav"></div>' +
  '<button id="sidebar-toggle"></button><button id="new-page-button"></button>' +
  '<article id="page"></article>' +
  "</body>";

// Boot a jsdom reader window. Returns the window (with #page ready). Always async
// so the withApp init() settle path is uniform for callers.
async function bootReader({ withLayout = false, withApp = false } = {}) {
  // A real origin lets app.js's init() touch localStorage (about:blank cannot).
  const dom = new JSDOM(SCAFFOLD, { runScripts: "dangerously", url: "http://localhost/" });
  const win = dom.window;
  const add = (code) => {
    // textContent (not src) avoids any "</script>" inside a source breaking the parse.
    const el = win.document.createElement("script");
    el.textContent = code;
    win.document.body.appendChild(el);
  };

  const scripts = READER_SCRIPTS.slice();
  if (withLayout || withApp) scripts.push("src/cards/shared/layout.js");
  for (const file of scripts) add(fs.readFileSync(path.join(ROOT, file), "utf8"));

  // The reader files declare their globals with `const` (block-scoped), so they are
  // NOT properties of `window` and a Node-side test cannot read them off `win`.
  // Hoist the ones tests need onto `window` from INSIDE jsdom (where the const
  // bindings are lexically visible); typeof guards skip any not loaded in this mode.
  add(EXPOSE_GLOBALS);

  if (withApp) {
    add(APP_STUBS);
    // app.js reads its shared state + shell elements through these; must load first.
    add(fs.readFileSync(path.join(ROOT, "src/app/readerState.js"), "utf8"));
    add(fs.readFileSync(path.join(ROOT, "src/app/app.js"), "utf8"));
    // Let app.js's async init() settle before the caller renders.
    await new Promise((r) => setTimeout(r, 0));
  }
  return win;
}

module.exports = { READER_SCRIPTS, APP_STUBS, bootReader };
