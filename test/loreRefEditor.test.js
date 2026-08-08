"use strict";

/* The card editor's "Lore" field (src/lore/lore.editor.js): repeatable rows, each a
   dropdown over every lore Page / Entry in the campaign. The schema stores plain
   "Page/Entry" strings — see editorCardSchemas.test.js for the serialize half. */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..");

const PAGES = {
  "The Gate": ["# Lore: The Gate", "", "## Entry: Ancient God", "", "Body.", "",
    "## Entry: The Fall", "", "Body.", ""].join("\n"),
  Ruins: ["# Lore: Ruins", "", "## Entry: The Deep", "", "Body.", ""].join("\n"),
};

function boot() {
  const dom = new JSDOM("<!DOCTYPE html><body></body>", { runScripts: "dangerously" });
  const win = dom.window;
  win.pages = PAGES;
  win.registered = {};
  win.eval(`
    window.EditorForm = {
      registerFieldRenderer(kind, fn) { window.registered[kind] = fn; },
    };
    window.RefLibrary = {
      entries: (type) => (type === "lore"
        ? Object.keys(window.pages).map((name) => ({ name, source: window.pages[name] }))
        : []),
    };
  `);
  // loreModel.js falls back to require() for rsLower when it is not already a global.
  [
    "src/utils/text.js",
    "src/lore/loreModel.js",
    "src/lore/lore.editor.js",
  ].forEach((rel) => {
    const el = win.document.createElement("script");
    el.textContent = fs.readFileSync(path.join(ROOT, rel), "utf8");
    win.document.body.appendChild(el);
  });
  return win;
}

// Values built inside jsdom carry its Array prototype; strict deepEqual rejects
// that even when the contents match. Normalize before comparing.
const plain = (v) => Array.from(v);

// The subset of form.js's helper context a field renderer is handed.
const CONTEXT = (win) => ({
  el: (tag, cls, text) => {
    const n = win.document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  },
  button: (cls, text, title) => {
    const b = win.document.createElement("button");
    b.className = cls;
    b.textContent = text;
    b.type = "button";
    if (title) b.title = title;
    return b;
  },
});

let win;
test.before(() => { win = boot(); });

test("the field registers itself with the editor form under its schema kind", () => {
  assert.equal(typeof win.registered.loreRefs, "function");
});

test("every page is offered whole, plus one option per entry", () => {
  const options = win.LoreRefEditor.loreOptions().map((o) => o.value);
  assert.deepEqual(Array.from(options), [
    "The Gate",
    "The Gate/Ancient God",
    "The Gate/The Fall",
    "Ruins",
    "Ruins/The Deep",
  ]);
});

test("stored references become selected rows, and getValue reads them back", () => {
  const field = win.LoreRefEditor.renderLoreRefsField(
    ["The Gate/Ancient God", "Ruins"], {}, CONTEXT(win));
  const selects = [...field.wrap.querySelectorAll(".lore-ref-select")];

  assert.equal(selects.length, 2);
  assert.deepEqual(selects.map((s) => s.value), ["The Gate/Ancient God", "Ruins"]);
  assert.deepEqual(plain(field.getValue()), ["The Gate/Ancient God", "Ruins"]);
});

test("a reference whose target is gone is still offered, so editing cannot drop it", () => {
  const field = win.LoreRefEditor.renderLoreRefsField(["The Gate/Nobody"], {}, CONTEXT(win));
  const select = field.wrap.querySelector(".lore-ref-select");

  assert.equal(select.value, "The Gate/Nobody", "the stale value stays selected");
  assert.match([...select.options].find((o) => o.value === "The Gate/Nobody").textContent,
    /missing/);
  assert.deepEqual(plain(field.getValue()), ["The Gate/Nobody"]);
});

test("empty rows are dropped, so an untouched '+ add' writes nothing", () => {
  const field = win.LoreRefEditor.renderLoreRefsField([], {}, CONTEXT(win));
  assert.deepEqual(plain(field.getValue()), []);

  field.wrap.querySelector("button").dispatchEvent(new win.Event("click"));
  assert.equal(field.wrap.querySelectorAll(".lore-ref-select").length, 1, "a row was added");
  assert.deepEqual(plain(field.getValue()), [], "but an unset row is not a reference");
});

test("removing a row removes its reference", () => {
  const field = win.LoreRefEditor.renderLoreRefsField(
    ["The Gate/Ancient God", "Ruins/The Deep"], {}, CONTEXT(win));
  const remove = field.wrap.querySelectorAll(".editor-list-item .editor-mini")[0];
  remove.dispatchEvent(new win.Event("click"));

  assert.deepEqual(plain(field.getValue()), ["Ruins/The Deep"]);
});
