"use strict";

/* LoreModel: the pure lore-page model (src/lore/loreModel.js).

   Two properties matter most here and are asserted repeatedly:
     - an entry's BODY is verbatim — arbitrary markdown must survive a
       parse/serialize round trip byte for byte;
     - the STRUCTURE is canonical — headings, "Keywords:" lines and blank-line
       spacing are rewritten deterministically, which is what lets the editor
       serialize a mutated model without a line-splice engine. */

const test = require("node:test");
const assert = require("node:assert/strict");

const LoreModel = require("../src/lore/loreModel.js");

const CANONICAL = [
  "# Lore: The Gate",
  "Keywords: ancient history, lost city",
  "",
  "## Entry: Ancient God",
  "Keywords: deity, Ancient God",
  "",
  "Once worshipped beneath the gate.",
  "",
  "## Entry: The Fall",
  "",
  "No keywords on this one.",
  "",
].join("\n");

// --- parse ----------------------------------------------------------------

test("parse reads the page name, keywords and entries in source order", () => {
  const { ok, page, errors } = LoreModel.parse(CANONICAL);
  assert.equal(ok, true, "unexpected errors: " + JSON.stringify(errors));
  assert.equal(page.name, "The Gate");
  assert.deepEqual(page.keywords, ["ancient history", "lost city"]);
  assert.deepEqual(page.entries.map((e) => e.name), ["Ancient God", "The Fall"]);
  assert.deepEqual(page.entries[0].keywords, ["deity", "Ancient God"]);
  assert.deepEqual(page.entries[1].keywords, []);
  assert.equal(page.entries[0].body, "Once worshipped beneath the gate.");
});

test("parse accepts a page with no keywords and no entries", () => {
  const { ok, page } = LoreModel.parse("# Lore: Bare\n");
  assert.equal(ok, true);
  assert.equal(page.name, "Bare");
  assert.deepEqual(page.keywords, []);
  assert.deepEqual(page.entries, []);
});

test("parse normalizes CRLF input", () => {
  const { ok, page } = LoreModel.parse(CANONICAL.replace(/\n/g, "\r\n"));
  assert.equal(ok, true);
  assert.equal(page.entries[0].body, "Once worshipped beneath the gate.");
});

test("parse only treats Keywords: directly under a heading as metadata", () => {
  const src = [
    "# Lore: P", "", "## Entry: E", "",
    "Body line.", "Keywords: not metadata, just prose", "",
  ].join("\n");
  const { ok, page } = LoreModel.parse(src);
  assert.equal(ok, true);
  assert.deepEqual(page.entries[0].keywords, []);
  assert.match(page.entries[0].body, /Keywords: not metadata/);
});

// --- body fidelity --------------------------------------------------------

test("an entry body survives parse -> serialize byte for byte", () => {
  const body = [
    "Intro paragraph.",
    "",
    "```js",
    "  const indented = 1;   // trailing spaces and a blank line follow",
    "",
    "```",
    "",
    "- list item",
    "  - nested, 2-space indent",
    "",
    "> read-aloud",
  ].join("\n");
  const src = "# Lore: P\n\n## Entry: E\n\n" + body + "\n";

  const first = LoreModel.parse(src);
  assert.equal(first.ok, true);
  assert.equal(first.page.entries[0].body, body, "body must be kept verbatim");

  const round = LoreModel.parse(LoreModel.serialize(first.page));
  assert.equal(round.page.entries[0].body, body, "body must survive a round trip");
});

test("serialize of a parsed canonical file is an identity", () => {
  const { page } = LoreModel.parse(CANONICAL);
  assert.equal(LoreModel.serialize(page), CANONICAL);
});

test("a hand-written file normalizes its structure but not its bodies", () => {
  const messy = [
    "# Lore: The Gate",
    "Keywords:   ancient history ,, lost city  ",
    "",
    "",
    "",
    "## Entry: Ancient God",
    "Keywords: deity, Ancient God",
    "",
    "",
    "Once worshipped beneath the gate.",
    "",
    "",
  ].join("\n");
  const { ok, page } = LoreModel.parse(messy);
  assert.equal(ok, true);
  assert.equal(page.entries[0].body, "Once worshipped beneath the gate.");
  assert.equal(LoreModel.serialize(page), [
    "# Lore: The Gate",
    "Keywords: ancient history, lost city",
    "",
    "## Entry: Ancient God",
    "Keywords: deity, Ancient God",
    "",
    "Once worshipped beneath the gate.",
    "",
  ].join("\n"));
});

// --- keywords -------------------------------------------------------------

test("normalizeKeywords splits on commas, trims and drops blanks", () => {
  assert.deepEqual(LoreModel.normalizeKeywords("  a , b ,,  c  "), ["a", "b", "c"]);
  assert.deepEqual(LoreModel.normalizeKeywords(""), []);
  assert.deepEqual(LoreModel.normalizeKeywords("   ,  , "), []);
  assert.deepEqual(LoreModel.normalizeKeywords(null), []);
});

test("normalizeKeywords dedupes ignoring case and all whitespace, keeping the first spelling", () => {
  assert.deepEqual(
    LoreModel.normalizeKeywords("Ancient God, ancient  god, ANCIENTGOD, lost city"),
    ["Ancient God", "lost city"]);
});

test("normalizeKeywords accepts an array as well as a comma string", () => {
  assert.deepEqual(LoreModel.normalizeKeywords([" a ", "", "A"]), ["a"]);
});

test("keywordKey lowercases and removes every whitespace character", () => {
  assert.equal(LoreModel.keywordKey("Ancient God"), "ancientgod");
  assert.equal(LoreModel.keywordKey("  ancient\tgod\n"), "ancientgod");
  assert.equal(LoreModel.keywordKey("AncientGod"), "ancientgod");
  assert.notEqual(LoreModel.keywordKey("ancient"), LoreModel.keywordKey("ancientgod"));
});

// --- validation -----------------------------------------------------------

test("a file with no \"# Lore:\" heading is a parse error", () => {
  const { ok, errors } = LoreModel.parse("## Entry: Orphan\n\nBody\n");
  assert.equal(ok, false);
  assert.ok(errors.some((e) => /missing "# Lore: Name" heading/.test(e.message)));
});

test("an unnamed page or entry is a parse error", () => {
  assert.equal(LoreModel.parse("# Lore:\n").ok, false);
  const { ok, errors } = LoreModel.parse("# Lore: P\n\n## Entry:\n\nBody\n");
  assert.equal(ok, false);
  assert.ok(errors.some((e) => /entry has no name/.test(e.message)));
});

test("duplicate entry names are a parse error, ignoring case and edge spaces", () => {
  const src = "# Lore: P\n\n## Entry: Ancient God\n\nA\n\n## Entry:   ancient god  \n\nB\n";
  const { ok, errors } = LoreModel.parse(src);
  assert.equal(ok, false);
  assert.ok(errors.some((e) => /duplicate entry name/.test(e.message)));
});

test("a name containing / or \\ is a parse error (they are the address separator)", () => {
  assert.equal(LoreModel.parse("# Lore: A/B\n").ok, false);
  assert.equal(LoreModel.parse("# Lore: P\n\n## Entry: A\\B\n").ok, false);
});

test("an unexpected heading level is a parse error", () => {
  assert.equal(LoreModel.parse("# Lore: P\n\n## Notes\n\nBody\n").ok, false);
  assert.equal(LoreModel.parse("# Lore: P\n\n# Another\n").ok, false);
});

test("page-level prose outside an entry is a parse error", () => {
  const { ok, errors } = LoreModel.parse("# Lore: P\n\nLoose text.\n");
  assert.equal(ok, false);
  assert.ok(errors.some((e) => /must live inside an "## Entry:"/.test(e.message)));
});

test("a failing parse still returns a page so the view can render something", () => {
  const { ok, page } = LoreModel.parse("Loose text with no heading.\n");
  assert.equal(ok, false);
  assert.equal(page.name, "");
  assert.deepEqual(page.entries, []);
});

// --- mutations ------------------------------------------------------------

function base() {
  return LoreModel.parse(CANONICAL).page;
}

test("mutations return a new page and never touch the original", () => {
  const page = base();
  const next = LoreModel.addEntry(page, { name: "Third", body: "x" });
  assert.equal(page.entries.length, 2, "the input page must be untouched");
  assert.equal(next.entries.length, 3);
  assert.notEqual(next, page);
  assert.notEqual(next.entries[0], page.entries[0], "entries must be cloned too");
});

test("addEntry appends to the end", () => {
  const next = LoreModel.addEntry(base(), { name: "Third", keywords: "c", body: "x" });
  assert.equal(next.entries[2].name, "Third");
  assert.deepEqual(next.entries[2].keywords, ["c"]);
});

test("updateEntry changes only the fields it is given", () => {
  const next = LoreModel.updateEntry(base(), 0, { name: "Renamed" });
  assert.equal(next.entries[0].name, "Renamed");
  assert.deepEqual(next.entries[0].keywords, ["deity", "Ancient God"]);
  assert.equal(next.entries[0].body, "Once worshipped beneath the gate.");
});

test("removeEntry drops the addressed entry; an out-of-range index is a no-op", () => {
  assert.deepEqual(
    LoreModel.removeEntry(base(), 0).entries.map((e) => e.name), ["The Fall"]);
  assert.equal(LoreModel.removeEntry(base(), 9).entries.length, 2);
  assert.equal(LoreModel.removeEntry(base(), -1).entries.length, 2);
});

test("moveEntry reorders, and a move off either end is a no-op", () => {
  const page = base();
  assert.deepEqual(LoreModel.moveEntry(page, 1, -1).entries.map((e) => e.name),
    ["The Fall", "Ancient God"]);
  assert.deepEqual(LoreModel.moveEntry(page, 0, 1).entries.map((e) => e.name),
    ["The Fall", "Ancient God"]);
  assert.deepEqual(LoreModel.moveEntry(page, 0, -1).entries.map((e) => e.name),
    ["Ancient God", "The Fall"]);
  assert.deepEqual(LoreModel.moveEntry(page, 1, 1).entries.map((e) => e.name),
    ["Ancient God", "The Fall"]);
});

test("setPageMeta renames and re-normalizes keywords", () => {
  const next = LoreModel.setPageMeta(base(), { name: "  Renamed  ", keywords: "x, X, y" });
  assert.equal(next.name, "Renamed");
  assert.deepEqual(next.keywords, ["x", "y"]);
});

test("entryNameTaken spots a collision but exempts the entry being renamed", () => {
  const page = base();
  assert.equal(LoreModel.entryNameTaken(page, "the fall"), true);
  assert.equal(LoreModel.entryNameTaken(page, "The Fall", 1), false, "self must be exempt");
  assert.equal(LoreModel.entryNameTaken(page, "Brand New"), false);
});

test("a mutated page serializes to valid, re-parseable markdown", () => {
  let page = base();
  page = LoreModel.addEntry(page, { name: "Third", keywords: "c", body: "> quoted" });
  page = LoreModel.moveEntry(page, 2, -1);
  page = LoreModel.setPageMeta(page, { name: "Renamed" });

  const round = LoreModel.parse(LoreModel.serialize(page));
  assert.equal(round.ok, true, JSON.stringify(round.errors));
  assert.equal(round.page.name, "Renamed");
  assert.deepEqual(round.page.entries.map((e) => e.name),
    ["Ancient God", "Third", "The Fall"]);
  assert.equal(round.page.entries[1].body, "> quoted");
});

// --- addresses and keyword matching ---------------------------------------

test("parseAddress reads a page and an optional entry", () => {
  assert.deepEqual(LoreModel.parseAddress("lore:The Gate"), { page: "The Gate", entry: "" });
  assert.deepEqual(LoreModel.parseAddress("lore:The Gate/Ancient God"),
    { page: "The Gate", entry: "Ancient God" });
  assert.deepEqual(LoreModel.parseAddress("LORE: The Gate / Ancient God "),
    { page: "The Gate", entry: "Ancient God" });
});

test("parseAddress accepts a backslash separator and rejects non-lore values", () => {
  assert.deepEqual(LoreModel.parseAddress("lore:P\\E"), { page: "P", entry: "E" });
  assert.equal(LoreModel.parseAddress("Rope"), null);
  assert.equal(LoreModel.parseAddress("item:Rope"), null);
  assert.equal(LoreModel.parseAddress("lore:"), null);
});

test("findEntryIndex resolves an entry name case-insensitively", () => {
  const page = base();
  assert.equal(LoreModel.findEntryIndex(page, "  ANCIENT god "), 0);
  assert.equal(LoreModel.findEntryIndex(page, "nope"), -1);
});

test("matchKeyword reports page and entry hits separately", () => {
  const page = base();
  assert.deepEqual(LoreModel.matchKeyword(page, "lost city"),
    [{ kind: "page", entryIndex: -1, entryName: "" }]);
  assert.deepEqual(LoreModel.matchKeyword(page, "ancientgod"),
    [{ kind: "entry", entryIndex: 0, entryName: "Ancient God" }]);
  assert.deepEqual(LoreModel.matchKeyword(page, "nothing"), []);
});

test("a page keyword does NOT propagate to its entries", () => {
  const hits = LoreModel.matchKeyword(base(), "ancient history");
  assert.deepEqual(hits.map((h) => h.kind), ["page"]);
});

test("matchKeyword is exact on the normalized key — no prefix or substring hits", () => {
  const page = base();
  assert.deepEqual(LoreModel.matchKeyword(page, "ancient"), []);
  assert.deepEqual(LoreModel.matchKeyword(page, "deities"), []);
  assert.equal(LoreModel.matchKeyword(page, "  DEITY ").length, 1);
});

test("newPageContent produces a parseable starter file", () => {
  const content = LoreModel.newPageContent("Fresh Page", "a, b");
  assert.equal(content, "# Lore: Fresh Page\nKeywords: a, b\n");
  assert.equal(LoreModel.parse(content).ok, true);
  assert.equal(LoreModel.newPageContent("Fresh Page", ""), "# Lore: Fresh Page\n");
});
