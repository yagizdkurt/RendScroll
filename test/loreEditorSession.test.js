"use strict";

/* Lore editing runs on the SAME document session as a scene
   (src/editor/docSession.js): 50-step Ctrl+Z, one dirty flag, one Save button,
   one navigation guard. These tests drive that session through LoreEditor.

   The riskiest behaviour is rename: Save is also the rename, and a rejected
   rename (409, the target name exists) must leave the in-memory model intact so
   nothing the user typed is lost. */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..");
const LoreModel = require("../src/lore/loreModel.js");

const SCRIPTS = [
  "src/vendor/marked.min.js",
  "src/utils/text.js",
  "src/parser/rendscrollParser.js",
  "src/inlineFormatting.js",
  "src/markdown.js",
  "src/cards/shared/cardDirectives.js",
  "src/lore/loreModel.js",
  "src/lore/loreView.js",
  "src/editor/docSession.js",
  "src/lore/loreEditor.js",
];

const SOURCE = [
  "# Lore: The Gate",
  "Keywords: ancient history",
  "",
  "## Entry: Ancient God",
  "Keywords: deity",
  "",
  "First body.",
  "",
  "## Entry: The Fall",
  "",
  "Second body.",
  "",
].join("\n");

function boot() {
  const dom = new JSDOM(
    "<!DOCTYPE html><body><div id=\"topbar-primary\"></div>" +
    // The view chrome appLibrary.renderLibraryView builds around a lore page.
    "<article id=\"page\"><div class=\"library-view library-view-lore\">" +
    "<div class=\"library-view-head\">" +
    "<h1 class=\"library-view-title\">The Gate</h1></div></div></article>" +
    "<nav id=\"lore-nav\"></nav></body>",
    { runScripts: "dangerously" });
  const win = dom.window;

  win.eval("window.enhanceBaseStyling = () => {};");
  // Reader/app globals the editor reaches for, stubbed to observable objects.
  win.saved = [];
  win.saveResult = null;
  win.eval(`
    window.ReaderState = { setLibraryView(view, name) { window.__view = { view, name }; } };
    window.ReaderDom = { loreNav: () => document.getElementById("lore-nav") };
    window.refreshLibrarySidebars = () => { window.__sidebarRefreshed = true; };
    window.RefLibrary = {
      saveFile(type, name, content, renameFrom) {
        window.saved.push({ type, name, content, renameFrom });
        if (window.saveResult) return Promise.reject(new Error(window.saveResult));
        return Promise.resolve({ name, path: "campaigns/T/lore/" + name + ".md", origin: "campaign" });
      },
    };
  `);

  SCRIPTS.forEach((rel) => {
    const el = win.document.createElement("script");
    el.textContent = fs.readFileSync(path.join(ROOT, rel), "utf8");
    win.document.body.appendChild(el);
  });
  win.eval("EditorDocSession.init((on) => EditorDocSession.setEnabled(on));");
  return win;
}

// Render a lore page and hand it to LoreEditor, the way renderLoreView does.
function open(win, source, name) {
  const parsed = LoreModel.parse(source);
  const viewEl = win.document.querySelector(".library-view");
  viewEl.querySelectorAll(".lore-page").forEach((n) => n.remove());
  const root = win.LoreView.render(viewEl, parsed.page, parsed.errors);
  win.LoreEditor.attach({
    name: name || "The Gate",
    path: "campaigns/T/lore/" + (name || "The Gate") + ".md",
    page: parsed.page,
    ok: parsed.ok,
    root,
    viewEl,
  });
  return win.EditorDocSession;
}

function pressUndo(win) {
  const event = new win.KeyboardEvent("keydown",
    { key: "z", ctrlKey: true, bubbles: true, cancelable: true });
  win.document.dispatchEvent(event);
  return event;
}

const flush = () => new Promise((r) => setTimeout(r, 0));
// Values built inside jsdom carry its prototypes; assert.deepEqual (strict)
// rejects that even when they match. Normalize before comparing.
const plain = (value) => JSON.parse(JSON.stringify(value));

// --- session registration -------------------------------------------------

test("opening a lore page registers it as the session document", () => {
  const win = boot();
  const S = open(win, SOURCE);
  assert.equal(S.kind(), "lore");
  assert.equal(S.model().name, "The Gate");
  assert.equal(S.isDirty(), false);
  assert.equal(S._undoDepth(), 0);
});

test("a malformed page gets no session — it must be fixed on disk", () => {
  const win = boot();
  const S = open(win, "## Entry: Orphan\n\nBody\n");
  assert.equal(S.current(), null);
});

test("re-attaching the same page keeps the session and its undo history", () => {
  const win = boot();
  const S = open(win, SOURCE);
  S.apply(LoreModel.removeEntry(S.model(), 0));
  assert.equal(S._undoDepth(), 1);

  open(win, SOURCE); // a re-render, not a fresh open
  assert.equal(S._undoDepth(), 1, "a re-render must not reset the undo stack");
});

test("opening a different page resets the undo history", () => {
  const win = boot();
  const S = open(win, SOURCE);
  S.apply(LoreModel.removeEntry(S.model(), 0));
  assert.equal(S._undoDepth(), 1);

  open(win, "# Lore: Other\n\n## Entry: E\n\nBody\n", "Other");
  assert.equal(S._undoDepth(), 0);
  assert.equal(S.model().name, "Other");
  assert.equal(S.isDirty(), false);
});

// --- mutate / undo --------------------------------------------------------

test("a mutation marks the session dirty and re-renders the page", () => {
  const win = boot();
  const S = open(win, SOURCE);
  S.setEnabled(true);

  S.apply(LoreModel.removeEntry(S.model(), 0));
  assert.equal(S.isDirty(), true);
  assert.equal(S.model().entries.length, 1);

  const titles = [...win.document.querySelectorAll(".lore-entry-title")]
    .map((n) => n.textContent);
  assert.deepEqual(titles, ["The Fall"], "the view must follow the model");
});

test("Ctrl+Z restores the previous model and re-renders", () => {
  const win = boot();
  const S = open(win, SOURCE);
  S.setEnabled(true);
  S.apply(LoreModel.removeEntry(S.model(), 0));

  const event = pressUndo(win);
  assert.equal(event.defaultPrevented, true);
  assert.equal(S._undoDepth(), 0);
  assert.deepEqual(plain(S.model().entries.map((e) => e.name)), ["Ancient God", "The Fall"]);
  assert.deepEqual(
    [...win.document.querySelectorAll(".lore-entry-title")].map((n) => n.textContent),
    ["Ancient God", "The Fall"]);
});

test("undo walks back through several mutations", () => {
  const win = boot();
  const S = open(win, SOURCE);
  S.setEnabled(true);

  S.apply(LoreModel.addEntry(S.model(), { name: "Third", body: "x" }));
  S.apply(LoreModel.moveEntry(S.model(), 2, -1));
  assert.deepEqual(plain(S.model().entries.map((e) => e.name)), ["Ancient God", "Third", "The Fall"]);

  pressUndo(win);
  assert.deepEqual(plain(S.model().entries.map((e) => e.name)), ["Ancient God", "The Fall", "Third"]);
  pressUndo(win);
  assert.deepEqual(plain(S.model().entries.map((e) => e.name)), ["Ancient God", "The Fall"]);
});

test("the editing tools are in the DOM once a session exists", () => {
  const win = boot();
  open(win, SOURCE);
  assert.equal(win.document.querySelectorAll(".lore-entry-tools").length, 2);
  assert.ok(win.document.querySelector(".lore-page-tools"));
  assert.ok(win.document.querySelector(".lore-add-entry"));
});

test("the tool buttons are the scene's editor-tool buttons", () => {
  const win = boot();
  open(win, SOURCE);
  const tools = [...win.document.querySelectorAll(".lore-tool")];
  assert.ok(tools.length > 0);
  assert.ok(tools.every((b) => b.classList.contains("editor-tool")),
    "lore tools must reuse .editor-tool rather than a lore-only button style");
  assert.ok(win.document.querySelector(".lore-add-entry").classList.contains("editor-insert-zone"));
});

test("the page-level tool sits in the view head, and a re-render does not stack copies", () => {
  const win = boot();
  const S = open(win, SOURCE);
  const head = win.document.querySelector(".library-view-head");
  assert.equal(head.querySelectorAll(".lore-page-tools").length, 1);

  S.apply(LoreModel.setPageMeta(S.model(), { keywords: "one, two" }));
  assert.equal(win.document.querySelectorAll(".lore-page-tools").length, 1,
    "re-rendering the page body must not leave a second page tool in the head");
  assert.equal(head.querySelectorAll(".lore-page-tools").length, 1);
});

test("the move buttons are disabled at the ends of the list", () => {
  const win = boot();
  open(win, SOURCE);
  const rows = [...win.document.querySelectorAll(".lore-entry-tools")];
  const up = (row) => [...row.querySelectorAll("button")].find((b) => b.textContent === "↑");
  const down = (row) => [...row.querySelectorAll("button")].find((b) => b.textContent === "↓");

  assert.equal(up(rows[0]).disabled, true, "the first entry cannot move up");
  assert.equal(down(rows[0]).disabled, false);
  assert.equal(up(rows[1]).disabled, false);
  assert.equal(down(rows[1]).disabled, true, "the last entry cannot move down");
});

// --- save / rename --------------------------------------------------------

test("Save writes the serialized model and clears the dirty flag", async () => {
  const win = boot();
  const S = open(win, SOURCE);
  S.setEnabled(true);
  S.apply(LoreModel.removeEntry(S.model(), 1));

  await S.save({ silent: true });
  await flush();

  assert.equal(win.saved.length, 1);
  assert.equal(win.saved[0].type, "lore");
  assert.equal(win.saved[0].name, "The Gate");
  assert.equal(win.saved[0].renameFrom, "The Gate");
  assert.match(win.saved[0].content, /## Entry: Ancient God/);
  assert.doesNotMatch(win.saved[0].content, /## Entry: The Fall/);
  assert.equal(S.isDirty(), false);
});

test("renaming the page sends renameFrom and follows the file", async () => {
  const win = boot();
  const S = open(win, SOURCE);
  S.setEnabled(true);
  S.apply(LoreModel.setPageMeta(S.model(), { name: "New Name" }));

  await S.save({ silent: true });
  await flush();

  assert.equal(win.saved[0].name, "New Name");
  assert.equal(win.saved[0].renameFrom, "The Gate");
  assert.deepEqual(plain(win.__view), { view: "lore", name: "New Name" });
  assert.equal(win.__sidebarRefreshed, true);
  assert.equal(win.document.querySelector(".library-view-title").textContent, "New Name");
  assert.equal(S.isDirty(), false);
});

test("a rejected rename keeps the dirty model — nothing typed is lost", async () => {
  const win = boot();
  const S = open(win, SOURCE);
  S.setEnabled(true);
  S.apply(LoreModel.setPageMeta(S.model(), { name: "Taken" }));
  S.apply(LoreModel.addEntry(S.model(), { name: "Precious", body: "hard work" }));

  win.saveResult = "a page with that name already exists";
  const ok = await S.save({ silent: true });
  await flush();

  assert.equal(ok, false, "Save must report failure");
  assert.equal(S.isDirty(), true, "the document must stay dirty");
  assert.equal(S.model().name, "Taken");
  assert.ok(S.model().entries.some((e) => e.name === "Precious"),
    "the unsaved entry must survive the rejection");
  assert.equal(win.__view, undefined, "the reader must not follow a rename that failed");
});

test("saving without a rename still round-trips through the model", async () => {
  const win = boot();
  const S = open(win, SOURCE);
  await S.save({ silent: true });
  await flush();

  const round = LoreModel.parse(win.saved[0].content);
  assert.equal(round.ok, true);
  assert.deepEqual(plain(round.page.entries.map((e) => e.name)), ["Ancient God", "The Fall"]);
  assert.equal(round.page.entries[0].body, "First body.");
});

// --- navigation guard -----------------------------------------------------

test("the navigation guard passes when clean and blocks when dirty", async () => {
  const win = boot();
  const S = open(win, SOURCE);
  assert.equal(await S.confirmNavigation(), true, "a clean document never prompts");

  S.setEnabled(true);
  S.apply(LoreModel.removeEntry(S.model(), 0));
  // No makeModal in this window, so the guard falls back to window.confirm.
  win.confirm = () => false;
  assert.equal(await S.confirmNavigation(), false, "a dirty document must be able to block");
});
