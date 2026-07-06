"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");

const CampaignSearch = require("../src/app/appSearch.js");

test("campaign search matches literal text across scenes and libraries", () => {
  const sources = CampaignSearch.sceneSources([
    {
      label: "Drowned Chapel",
      path: "campaigns/Test/scenes/1.md",
      content: "# Scene\nThe Sunken Bell rings below.\n",
    },
  ]).concat(CampaignSearch.librarySources("item", [
    {
      name: "Bell Clapper",
      path: "items/Bell Clapper.md",
      source: "### SourceItem: Bell Clapper\nA sunken bell relic.\n",
    },
  ]));

  const found = CampaignSearch.searchSources(sources, "sunken bell", { limit: 30 });

  assert.equal(found.overflow, 0);
  assert.equal(found.results.length, 2);
  assert.deepEqual(found.results.map((r) => r.kind), ["scene", "item"]);
  assert.equal(found.results[0].lineNumber, 2);
  assert.equal(found.results[0].label, "Drowned Chapel");
  assert.match(found.results[0].snippet, /Sunken Bell/);
});

test("campaign search caps results and reports overflow", () => {
  const content = Array.from({ length: 35 }, (_, i) => "needle line " + i).join("\n");
  const found = CampaignSearch.searchSources([
    { kind: "scene", label: "Many", path: "campaigns/Test/scenes/1.md", content },
  ], "needle", { limit: 30 });

  assert.equal(found.results.length, 30);
  assert.equal(found.overflow, 5);
});

test("campaign search snippets stay near the match", () => {
  const line = "before ".repeat(30) + "sunken bell" + " after".repeat(30);
  const snippet = CampaignSearch.makeSnippet(line, "sunken bell", 60);

  assert.ok(snippet.length <= 66);
  assert.match(snippet, /sunken bell/);
  assert.match(snippet, /^\.\.\./);
  assert.match(snippet, /\.\.\.$/);
});

test("scene result target prefers containing card, then nearest section", () => {
  const dom = new JSDOM(
    "<!DOCTYPE html><body><article id='page'>" +
      "<h1 data-section-start='0'>Scene</h1>" +
      "<h2 data-section-start='4'>Event</h2>" +
      "<div class='std-card' data-src-start='8' data-src-end='12'></div>" +
    "</article></body>"
  );
  const page = dom.window.document.getElementById("page");
  const heading = page.querySelector("h2");
  const card = page.querySelector(".std-card");

  assert.equal(CampaignSearch.findSceneTarget(page, 9), card);
  assert.equal(CampaignSearch.findSceneTarget(page, 5), heading);
  assert.equal(CampaignSearch.findSceneTarget(page, 1), page.querySelector("h1"));
});

test("Ctrl+F focuses the mounted campaign search input", async () => {
  const dom = new JSDOM("<!DOCTYPE html><body><div id='topbar-search'></div></body>", {
    url: "http://localhost/",
  });
  global.window = dom.window;
  global.document = dom.window.document;
  global.fetch = async () => ({ ok: true, json: async () => [] });

  CampaignSearch.mount(dom.window.document.getElementById("topbar-search"));
  const event = new dom.window.KeyboardEvent("keydown", {
    key: "f",
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  dom.window.document.dispatchEvent(event);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(dom.window.document.activeElement.className, "campaign-search-input");
  assert.equal(event.defaultPrevented, true);

  delete global.fetch;
  delete global.document;
  delete global.window;
});

test("rendered match highlight wraps and clears the exact text", () => {
  const dom = new JSDOM(
    "<!DOCTYPE html><body><article id='page'>" +
      "<h2 data-section-start='4'>Event</h2>" +
      "<p>The sunken bell waits below.</p>" +
    "</article></body>"
  );
  global.document = dom.window.document;

  const page = dom.window.document.getElementById("page");
  const start = page.querySelector("h2");
  const mark = CampaignSearch.highlightRenderedMatch(page, "sunken bell", start);

  assert.ok(mark);
  assert.equal(mark.textContent, "sunken bell");
  assert.equal(page.querySelectorAll(".campaign-search-hit").length, 1);

  CampaignSearch.clearHighlights();
  assert.equal(page.querySelectorAll(".campaign-search-hit").length, 0);
  assert.match(page.textContent, /The sunken bell waits below/);

  delete global.document;
});
