"use strict";

/* The Lore page renderer (src/lore/loreView.js) — the reader half.

   Reader-only by contract: the editor layer is NOT loaded here, so anything
   these tests see is what a user with edit mode off gets. */

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
];

const SOURCE = [
  "# Lore: The Gate",
  "Keywords: ancient history, lost city",
  "",
  "## Entry: Ancient God",
  "Keywords: deity, Ancient God",
  "",
  "Once worshipped **beneath** the gate.",
  "",
  "> A read-aloud line.",
  "",
  "## Entry: The Fall",
  "",
  "- first",
  "- second",
  "",
].join("\n");

function boot() {
  const dom = new JSDOM("<!DOCTYPE html><body><div id=\"host\"></div></body>",
    { runScripts: "dangerously" });
  const win = dom.window;
  // enhanceBaseStyling is app.js's shared pass; the view calls it when present.
  win.eval("window.enhanceBaseStyling = (root) =>" +
    " root.querySelectorAll('blockquote').forEach((b) => b.classList.add('read-aloud'));");
  SCRIPTS.forEach((rel) => {
    const el = win.document.createElement("script");
    el.textContent = fs.readFileSync(path.join(ROOT, rel), "utf8");
    win.document.body.appendChild(el);
  });
  return win;
}

function render(win, source) {
  const parsed = LoreModel.parse(source);
  const host = win.document.getElementById("host");
  host.innerHTML = "";
  const root = win.LoreView.render(host, parsed.page, parsed.errors);
  return { host, root, parsed };
}

let win;
test.before(() => { win = boot(); });

test("the editor layer is absent — this is the reader view", () => {
  assert.equal(typeof win.LoreEditor, "undefined");
  assert.equal(typeof win.LoreView, "object");
});

test("page keywords render as chips above the entries", () => {
  const { root } = render(win, SOURCE);
  const chips = [...root.querySelectorAll(".lore-page-chips .lore-chip")]
    .map((c) => c.textContent);
  assert.deepEqual(chips, ["ancient history", "lost city"]);
});

test("each entry renders its title, chips and markdown body", () => {
  const { root } = render(win, SOURCE);
  const entries = [...root.querySelectorAll(".lore-entry")];
  assert.equal(entries.length, 2);

  const title = entries[0].querySelector(".lore-entry-title");
  assert.equal(title.textContent, "Ancient God");
  // An entry is a section of the page: an <h2> under the view's <h1>, so it picks
  // up the scene's "## Section" styling instead of restating it.
  assert.equal(title.tagName, "H2");
  assert.deepEqual(
    [...entries[0].querySelectorAll(".lore-chips .lore-chip")].map((c) => c.textContent),
    ["deity", "Ancient God"]);

  const body = entries[0].querySelector(".lore-entry-body");
  assert.ok(body.querySelector("strong"), "markdown must be rendered, not escaped");
  assert.match(body.textContent, /Once worshipped beneath the gate\./);
});

test("blockquotes in a body become read-aloud boxes, like a scene", () => {
  const { root } = render(win, SOURCE);
  assert.ok(root.querySelector("blockquote.read-aloud"));
});

test("a list in an entry body renders as a list", () => {
  const { root } = render(win, SOURCE);
  const second = root.querySelectorAll(".lore-entry")[1];
  assert.equal(second.querySelectorAll("li").length, 2);
});

test("entries carry a normalized data-lore-entry stamp for link and search targets", () => {
  const { root } = render(win, SOURCE);
  const stamps = [...root.querySelectorAll(".lore-entry")].map((e) => e.dataset.loreEntry);
  assert.deepEqual(stamps, ["ancient god", "the fall"]);
});

test("findEntry resolves an entry case-insensitively", () => {
  const { root } = render(win, SOURCE);
  const hit = win.LoreView.findEntry(root, "  ANCIENT God ");
  assert.ok(hit);
  assert.equal(hit.querySelector(".lore-entry-title").textContent, "Ancient God");
  assert.equal(win.LoreView.findEntry(root, "nope"), null);
});

test("an entry with no body shows a placeholder rather than nothing", () => {
  const { root } = render(win, "# Lore: P\n\n## Entry: Empty\n");
  assert.match(root.querySelector(".lore-entry-body").textContent, /no content yet/);
});

test("a page with no entries says so", () => {
  const { root } = render(win, "# Lore: Bare\n");
  assert.match(root.querySelector(".lore-empty").textContent, /no entries yet/);
  assert.equal(root.querySelectorAll(".lore-entry").length, 0);
});

test("a page with no keywords renders no chip row", () => {
  const { root } = render(win, "# Lore: Bare\n\n## Entry: E\n\nBody\n");
  assert.equal(root.querySelector(".lore-page-chips"), null);
});

test("a malformed file reports its parse errors and is not silently fixed", () => {
  const source = "## Entry: Orphan\n\nBody\n";
  const { root, parsed } = render(win, source);
  assert.equal(parsed.ok, false);

  const box = root.querySelector(".lore-errors");
  assert.ok(box, "expected a visible error report");
  assert.match(box.textContent, /could not be read/);
  assert.match(box.textContent, /will not rewrite it/);
  assert.ok(box.querySelectorAll(".lore-error-list li").length > 0);
});

test("the editing controls exist in the DOM but are CSS-hidden without editor mode", () => {
  // The view itself adds none; only LoreEditor does, and it is not loaded here.
  const { root } = render(win, SOURCE);
  assert.equal(root.querySelectorAll(".lore-entry-tools").length, 0);
  assert.equal(root.querySelectorAll(".lore-add-entry").length, 0);
});
