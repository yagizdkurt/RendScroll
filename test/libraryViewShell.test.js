"use strict";

/* The shared library view shell (appLibrary.renderLibraryView).

   One implementation serves every RefLibrary kind, so the two per-kind hooks it
   grew for Lore — `titleTag` and the `library-view-<kind>` class — are guarded
   here together with the promise that Items/Enemies are unaffected by them. */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..");

function boot() {
  const dom = new JSDOM(
    "<!DOCTYPE html><body><article id=\"page\" class=\"page\"></article></body>",
    { runScripts: "dangerously" });
  const win = dom.window;

  // The reader/library globals renderLibraryView reaches for.
  win.eval(`
    window.ReaderDom = { page: () => document.getElementById("page") };
    window.ReaderState = { view: () => null, libraryName: () => null };
    window.RefLibrary = { resolve: () => ({ ok: false }) };
    window.refMissingCard = (kind, name) => {
      const d = document.createElement("div");
      d.className = "ref-missing";
      d.textContent = kind + ":" + name;
      return d;
    };
    // A kind with its own renderer owns everything below the toolbar.
    window.renderLoreView = (kind, name, viewEl) => {
      const d = document.createElement("div");
      d.className = "lore-page";
      viewEl.appendChild(d);
      return d;
    };
  `);

  const el = win.document.createElement("script");
  el.textContent = fs.readFileSync(path.join(ROOT, "src/app/appLibrary.js"), "utf8");
  win.document.body.appendChild(el);
  return win;
}

function render(win, kind, name) {
  win.eval(`renderLibraryView(${JSON.stringify(kind)}, ${JSON.stringify(name)});`);
  return win.document.querySelector(".library-view");
}

test("the view root carries a per-kind class", () => {
  const win = boot();
  assert.ok(render(win, "lore", "The Gate").classList.contains("library-view-lore"));
  assert.ok(render(win, "item", "Rope").classList.contains("library-view-item"));
  assert.ok(render(win, "enemy", "Goblin").classList.contains("library-view-enemy"));
});

test("a lore page's title is an <h1>, so the scene title styling applies to it", () => {
  const win = boot();
  const view = render(win, "lore", "The Gate");
  const title = view.querySelector(".library-view-title");
  assert.equal(title.tagName, "H1");
  assert.equal(title.textContent, "The Gate");
  assert.ok(view.querySelector(".lore-page"), "the kind's own renderer still runs");
});

test("kinds without a titleTag keep the plain title div", () => {
  const win = boot();
  assert.equal(render(win, "item", "Rope").querySelector(".library-view-title").tagName, "DIV");
  assert.equal(render(win, "enemy", "Goblin").querySelector(".library-view-title").tagName, "DIV");
});

test("only a kind without its own renderer gets the one-shot Edit button", () => {
  const win = boot();
  const labels = (view) => [...view.querySelectorAll(".library-view-btn")].map((b) => b.textContent);
  assert.deepEqual(labels(render(win, "lore", "The Gate")), ["⟳ Refresh", "Delete"]);
  assert.deepEqual(labels(render(win, "item", "Rope")), ["✎ Edit", "⟳ Refresh", "Delete"]);
});
