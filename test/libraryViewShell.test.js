"use strict";

/* The shared library shell (appLibrary): the sidebar lists and the reader view
   that one implementation builds for every RefLibrary kind.

   The per-kind differences Lore needs — `titleTag`, `toolbar`, the
   `library-view-<kind>` class, and dropping the campaign badge for a kind that has
   no global root — are guarded here, together with the promise that Items and
   Enemies are unaffected by them. */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..");

// The real scopes, so the badge rule is tested against the actual registry.
const REF_TYPES = require("../src/refLibrary.js").REF_TYPES;

function boot() {
  const dom = new JSDOM(
    "<!DOCTYPE html><body><article id=\"page\" class=\"page\"></article>" +
    "<nav id=\"lore-nav\"></nav><nav id=\"library-nav\"></nav><nav id=\"enemies-nav\"></nav>" +
    "</body>",
    { runScripts: "dangerously" });
  const win = dom.window;

  // The reader/library globals appLibrary reaches for.
  win.scopes = REF_TYPES;
  win.menu = null;
  win.eval(`
    const byId = (id) => document.getElementById(id);
    window.ReaderDom = {
      page: () => byId("page"),
      loreNav: () => byId("lore-nav"),
      libraryNav: () => byId("library-nav"),
      enemiesNav: () => byId("enemies-nav"),
    };
    window.ReaderState = { view: () => null, libraryName: () => null };
    window.CampaignManager = { active: () => "Legacy" };
    window.openNavMenu = (items) => { window.menu = items.map((i) => i.label); };
    window.RefLibrary = {
      resolve: () => ({ ok: false }),
      def: (kind) => window.scopes[kind] || null,
      entries: () => [
        { name: "Local", path: "campaigns/T/x/Local.md", origin: "campaign" },
        { name: "Shared", path: "x/Shared.md", origin: "global" },
      ],
    };
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

test("a lore page has no management toolbar; other kinds keep theirs", () => {
  const win = boot();
  const labels = (view) => [...view.querySelectorAll(".library-view-btn")].map((b) => b.textContent);

  const lore = render(win, "lore", "The Gate");
  assert.equal(lore.querySelector(".library-view-toolbar"), null,
    "a lore page reads as a page of the book, not a managed library entry");
  assert.deepEqual(labels(lore), []);

  // Items/Enemies are unaffected — and only a kind without its own renderer
  // gets the one-shot Edit button.
  assert.deepEqual(labels(render(win, "item", "Rope")), ["✎ Edit", "⟳ Refresh", "Delete"]);
});

// --- sidebar lists --------------------------------------------------------

function mount(win, kind, navId) {
  win.eval(`mountLibraryNav(${JSON.stringify(kind)});`);
  return [...win.document.getElementById(navId).querySelectorAll("button")];
}

test("a campaign-only kind's entries carry no origin badge", () => {
  // Every lore page is campaign-local, so a "C" badge would mark all of them and
  // distinguish nothing.
  const win = boot();
  const buttons = mount(win, "lore", "lore-nav");
  assert.equal(buttons.length, 2);
  assert.equal(win.document.querySelectorAll("#lore-nav .nav-origin-badge").length, 0);
  assert.deepEqual(buttons.map((b) => b.textContent), ["Local", "Shared"]);
  assert.deepEqual(buttons.map((b) => b.title), ["Local", "Shared"]);
});

test("a kind with both roots still badges its campaign-local entries", () => {
  const win = boot();
  const buttons = mount(win, "item", "library-nav");
  assert.equal(buttons[0].querySelector(".nav-origin-badge").textContent, "C");
  assert.equal(buttons[0].title, "Local (campaign)");
  assert.equal(buttons[1].querySelector(".nav-origin-badge"), null);
});

test("the entry menu offers a Move only for a kind that has somewhere to move to", () => {
  const win = boot();
  // win.menu is built inside jsdom, so it carries jsdom's Array prototype; strict
  // deepEqual rejects that even when the contents match. Normalize first.
  const open = (kind, origin) => {
    win.eval(`openLibraryEntryMenu(${JSON.stringify(kind)},` +
      ` { name: "X", origin: ${JSON.stringify(origin)} }, 0, 0);`);
    return Array.from(win.menu);
  };
  assert.deepEqual(open("lore", "campaign"), ["Delete"]);
  assert.deepEqual(open("item", "campaign"), ["Delete", "Move to global library"]);
  assert.deepEqual(open("item", "global"), ["Delete", "Move to campaign"]);
});
