"use strict";

/* ReaderState is the one owner of the reader's shared state. Before it, app.js
   declared these as bare top-level `let`s and appSidebar/appLibrary/appModals
   assigned to them directly — so the invariants below were spread across four
   files and enforced by nobody. They are asserted here instead. */

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const fs = require("node:fs");

const SRC = fs.readFileSync(
  path.join(__dirname, "..", "src", "app", "readerState.js"), "utf8");

// Fresh module per test: the state is a singleton, so tests must not share one.
function load() {
  const dom = new JSDOM(
    '<!DOCTYPE html><body><div id="nav"></div><div id="library-nav"></div>' +
    '<div id="enemies-nav"></div><article id="page"></article>' +
    '<button id="sidebar-toggle"></button><button id="new-page-button"></button></body>',
    { runScripts: "dangerously" });
  const el = dom.window.document.createElement("script");
  el.textContent = SRC;
  dom.window.document.body.appendChild(el);
  return dom.window;
}

test("a fresh reader starts on an empty scene view", () => {
  const { ReaderState } = load();
  assert.equal(ReaderState.view(), "scene");
  assert.equal(ReaderState.currentPath(), null);
  assert.equal(ReaderState.libraryName(), null);
  assert.equal(ReaderState.currentSource(), "");
  assert.equal(ReaderState.campaignEntries().length, 0);
});

test("setSceneView sets the path and clears any open library entry", () => {
  const { ReaderState } = load();
  ReaderState.setLibraryView("library", "Rope");
  ReaderState.setSceneView("campaigns/A/scenes/1.md");

  assert.equal(ReaderState.view(), "scene");
  assert.equal(ReaderState.currentPath(), "campaigns/A/scenes/1.md");
  assert.equal(ReaderState.libraryName(), null);
});

test("setLibraryView opens an entry and clears the scene path", () => {
  const { ReaderState } = load();
  ReaderState.setSceneView("campaigns/A/scenes/1.md");
  ReaderState.setLibraryView("enemy", "Goblin");

  assert.equal(ReaderState.view(), "enemy");
  assert.equal(ReaderState.libraryName(), "Goblin");
  assert.equal(ReaderState.currentPath(), null);
});

test("setSceneView(null) clears the reader without leaving a library view", () => {
  const { ReaderState } = load();
  ReaderState.setLibraryView("library", "Rope");
  ReaderState.setSceneView(null);

  assert.equal(ReaderState.view(), "scene");
  assert.equal(ReaderState.currentPath(), null);
  assert.equal(ReaderState.libraryName(), null);
});

test("campaignEntries hands out a copy, so callers cannot mutate the state", () => {
  const { ReaderState } = load();
  const source = [{ path: "a.md" }, { path: "b.md" }];
  ReaderState.setCampaignEntries(source);

  ReaderState.campaignEntries().push({ path: "c.md" });
  assert.equal(ReaderState.campaignEntries().length, 2);

  // The list it was given is copied too: mutating it later must not leak in.
  source.push({ path: "c.md" });
  assert.equal(ReaderState.campaignEntries().length, 2);
});

test("setCampaignEntries tolerates a non-array (a failed discovery)", () => {
  const { ReaderState } = load();
  ReaderState.setCampaignEntries([{ path: "a.md" }]);
  ReaderState.setCampaignEntries(null);
  assert.equal(ReaderState.campaignEntries().length, 0);
});

test("currentSource holds the scene markdown on screen", () => {
  const { ReaderState } = load();
  ReaderState.setCurrentSource("# Scene\n");
  assert.equal(ReaderState.currentSource(), "# Scene\n");
  ReaderState.setCurrentSource(null);
  assert.equal(ReaderState.currentSource(), "");
});

test("ReaderDom resolves each shell element once and caches it", () => {
  const win = load();
  const { ReaderDom } = win;
  assert.equal(ReaderDom.nav(), win.document.getElementById("nav"));
  assert.equal(ReaderDom.libraryNav(), win.document.getElementById("library-nav"));
  assert.equal(ReaderDom.enemiesNav(), win.document.getElementById("enemies-nav"));
  assert.equal(ReaderDom.page(), win.document.getElementById("page"));
  assert.equal(ReaderDom.sidebarToggle(), win.document.getElementById("sidebar-toggle"));
  assert.equal(ReaderDom.newPageButton(), win.document.getElementById("new-page-button"));
  assert.equal(ReaderDom.page(), ReaderDom.page());
});
