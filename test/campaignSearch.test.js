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

/* --- "key:" lore keyword mode ---------------------------------------------
   A "key:" query is an EXACT keyword lookup, not a text search: both sides go
   through LoreModel.keywordKey (lowercase, all whitespace removed) and must be
   equal. Page keywords and entry keywords are separate hits. */

const RefLibrary = require("../src/refLibrary.js");
const LoreModel = require("../src/lore/loreModel.js");

const LORE_SOURCE = [
  "# Lore: The Gate",
  "Keywords: ancient history, lost city",
  "",
  "## Entry: Ancient God",
  "Keywords: deity, Ancient God",
  "",
  "Worshipped beneath the gate.",
  "",
  "## Entry: The Fall",
  "Keywords: collapse",
  "",
  "It came down in a night.",
  "",
].join("\n");

// appSearch reaches for these as globals; give it the real modules.
function withLore(fn) {
  const priorLib = global.RefLibrary;
  const priorModel = global.LoreModel;
  global.LoreModel = LoreModel;
  global.RefLibrary = {
    REF_TYPES: RefLibrary.REF_TYPES,
    entries: (type) => (type === "lore"
      ? [{ name: "The Gate", path: "campaigns/T/lore/The Gate.md", source: LORE_SOURCE }]
      : []),
  };
  try { return fn(); } finally {
    global.RefLibrary = priorLib;
    global.LoreModel = priorModel;
  }
}

test("keywordQuery separates a key: lookup from a literal search", () => {
  assert.equal(CampaignSearch.keywordQuery("sunken bell"), null);
  assert.equal(CampaignSearch.keywordQuery("key:deity"), "deity");
  assert.equal(CampaignSearch.keywordQuery("KEY: Ancient God "), "Ancient God");
  assert.equal(CampaignSearch.keywordQuery("key:"), "", "an empty keyword is not a literal search");
});

test("key: matches a page keyword and reports the page, not its entries", () => {
  withLore(() => {
    const found = CampaignSearch.searchKeywords("lost city", { limit: 30 });
    assert.equal(found.results.length, 1);
    assert.equal(found.results[0].kind, "lore");
    assert.equal(found.results[0].name, "The Gate");
    assert.equal(found.results[0].loreEntry, "");
  });
});

test("key: matches an entry keyword and names the entry", () => {
  withLore(() => {
    const found = CampaignSearch.searchKeywords("ancient god", { limit: 30 });
    assert.equal(found.results.length, 1);
    assert.equal(found.results[0].loreEntry, "Ancient God");
    assert.match(found.results[0].snippet, /Ancient God/);
  });
});

test("key: ignores case and every whitespace difference", () => {
  withLore(() => {
    ["Ancient God", "ancient  god", "ANCIENTGOD", " ancientGod "].forEach((q) => {
      assert.equal(CampaignSearch.searchKeywords(q, { limit: 30 }).results.length, 1, q);
    });
  });
});

test("key: is exact — no prefix, substring or plural matches", () => {
  withLore(() => {
    ["ancient", "god", "deit", "deities", "lost"].forEach((q) => {
      assert.equal(CampaignSearch.searchKeywords(q, { limit: 30 }).results.length, 0, q);
    });
  });
});

test("key: finds nothing when no lore carries the keyword", () => {
  withLore(() => {
    assert.equal(CampaignSearch.searchKeywords("nonexistent", { limit: 30 }).results.length, 0);
  });
});

test("normal search still scans lore names, keyword lines and bodies", () => {
  withLore(() => {
    const sources = CampaignSearch.librarySearchSources();
    const lore = sources.filter((s) => s.kind === "lore");
    assert.equal(lore.length, 1);

    // A word only in a body.
    const body = CampaignSearch.searchSources(sources, "Worshipped", { limit: 30 });
    assert.equal(body.results.length, 1);
    assert.equal(body.results[0].kind, "lore");
    // A word only on a Keywords: line.
    assert.equal(CampaignSearch.searchSources(sources, "collapse", { limit: 30 }).results.length, 1);
    // A substring of a keyword — literal search DOES match this; "key:" does not.
    assert.ok(CampaignSearch.searchSources(sources, "ancient", { limit: 30 }).results.length > 0);
  });
});

test("the result badge label comes from the ref registry", () => {
  withLore(() => {
    assert.equal(CampaignSearch.resultTypeLabel("scene"), "Scene");
    assert.equal(CampaignSearch.resultTypeLabel("lore"), "Lore");
    assert.equal(CampaignSearch.resultTypeLabel("item"), "Item");
    assert.equal(CampaignSearch.resultTypeLabel("enemy"), "Enemy");
  });
});
