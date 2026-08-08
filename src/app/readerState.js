/* ============================================================
   The reader's shared state and DOM handles — one owner.

   app.js used to declare these as bare top-level `let`/`const`, and its sibling
   files (appSidebar / appLibrary / appModals / refNavigation) read AND WROTE them
   directly. That only worked because every app/*.js lands in the same global
   scope, which made the five files one module wearing five filenames: none could
   be read, tested, or changed on its own.

   The right pattern was already here — outside code (sceneGraph, debugPanel, the
   transition card, appSearch) reaches this state through the read-only
   `RendScrollApp` facade in app.js. This applies it inside the folder too.

   Two globals, mirroring cards/shared/cardCollapse.js's CardCollapse +
   HeadingCollapse split:
     ReaderDom   - the shell elements every app/* file needs
     ReaderState - what the reader is currently showing
   ============================================================ */

/* Shell elements, looked up once on first use. Accessors (not eager consts) so
   this file has no load-order dependency on where its <script> tag sits. */
const ReaderDom = (() => {
  const cache = new Map();

  function el(id) {
    if (!cache.has(id)) cache.set(id, document.getElementById(id));
    return cache.get(id);
  }

  return {
    nav: () => el("nav"),
    libraryNav: () => el("library-nav"),
    enemiesNav: () => el("enemies-nav"),
    page: () => el("page"),
    sidebarToggle: () => el("sidebar-toggle"),
    newPageButton: () => el("new-page-button"),
  };
})();

/* What the reader is showing right now. The view is a small state machine —
   "scene" (a campaign scene) or one of the library views ("library" / "enemy") —
   so the transitions are two methods rather than four loose setters that callers
   have to remember to keep consistent. */
const ReaderState = (() => {
  let currentPath = null;        // active scene path, null in a library view
  let campaignEntries = [];      // the active campaign's scene list
  let currentView = "scene";     // "scene" | "library" | "enemy"
  let currentLibraryName = null; // the open library entry, null in a scene view
  let currentSource = "";        // raw markdown of the scene on screen

  return {
    currentPath: () => currentPath,
    // Only for the cases that clear/replace the path without changing the view
    // (deleting the open scene, a campaign with no scenes). Prefer setSceneView.
    setCurrentPath(path) { currentPath = path || null; },

    campaignEntries: () => campaignEntries.slice(),
    setCampaignEntries(list) { campaignEntries = Array.isArray(list) ? list.slice() : []; },

    view: () => currentView,
    libraryName: () => currentLibraryName,

    // Show a campaign scene (or, with a null path, nothing).
    setSceneView(path) {
      currentView = "scene";
      currentLibraryName = null;
      currentPath = path || null;
    },

    // Show a single library entry. `view` is the kind's view name from
    // appLibrary.js's LIBRARY_VIEWS ("library" for items, "enemy" for enemies).
    setLibraryView(view, name) {
      currentView = view;
      currentLibraryName = name || null;
      currentPath = null;
    },

    // The scene source last handed to renderPage. Kept here so re-render paths
    // read it from the owner instead of the __rsLastSource console hook.
    currentSource: () => currentSource,
    setCurrentSource(text) { currentSource = text || ""; },
  };
})();

if (typeof window !== "undefined") {
  window.ReaderDom = ReaderDom;
  window.ReaderState = ReaderState;
}
if (typeof module !== "undefined" && module.exports) module.exports = { ReaderDom, ReaderState };
