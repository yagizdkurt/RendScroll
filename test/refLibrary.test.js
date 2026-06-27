"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

global.RendScrollParser = require("../src/parser/rendscrollParser.js");
const RendScrollParser = global.RendScrollParser;
const RefLibrary = require("../src/refLibrary.js");
global.RefLibrary = RefLibrary;
const RendScrollDiagnostics = require("../src/debug/diagnostics.js");

// Stub the launcher's bundle endpoint so RefLibrary.init() loads in-memory files.
function stubLibrary(files) {
  global.fetch = async (url) => {
    if (url.indexOf("/__library_bundle") === 0) return { ok: true, json: async () => files };
    return { ok: false, status: 404, json: async () => { throw new Error("no"); }, text: async () => "" };
  };
  return RefLibrary.init();
}

const ITEMS = [
  { name: "Calamity", path: "Items/Calamity.md", content: "### Item: Calamity\nTür: Kitap\n> Lanetli.\n" },
  { name: "Gümüş Anahtar", path: "Items/Gümüş Anahtar.md", content: "### Item: Gümüş Anahtar\nTür: Anahtar\n" },
];

test("parser turns a standalone [item=Name] line into a ref block", () => {
  const doc = RendScrollParser.parseRendScroll("# S\n\n## Olay\n\n[item=Gümüş Anahtar]\n");
  const refs = doc.sections.flatMap((s) => s.blocks).filter((b) => b.kind === "ref");
  assert.equal(refs.length, 1);
  assert.equal(refs[0].refType, "item");
  assert.equal(refs[0].refName, "Gümüş Anahtar");
});

test("[item=] with an empty name is NOT a ref block (left as plain text)", () => {
  const doc = RendScrollParser.parseRendScroll("# S\n\n[item=]\n");
  const refs = doc.sections.flatMap((s) => s.blocks).filter((b) => b.kind === "ref");
  assert.equal(refs.length, 0);
});

test("RefLibrary resolves a reference to its file source (case/Turkish-insensitive)", async () => {
  await stubLibrary(ITEMS);
  const r = RefLibrary.resolve("item", "calamity");
  assert.equal(r.ok, true);
  assert.equal(r.cardType, "sourceitem");
  assert.match(r.source, /Lanetli/);
  assert.equal(RefLibrary.has("item", "GÜMÜŞ ANAHTAR".replace(/I/g, "İ")), true);
  assert.equal(RefLibrary.resolve("item", "Nope").ok, false);
});

test("RefLibrary resolves SourceItem files and keeps legacy Item files readable", async () => {
  await stubLibrary([
    { name: "New", path: "Items/New.md", content: "### SourceItem: New\nTür: Relic\n" },
    { name: "Legacy", path: "Items/Legacy.md", content: "### Item: Legacy\nTür: Tool\n" },
  ]);

  assert.equal(RefLibrary.resolve("item", "New").cardType, "sourceitem");
  assert.match(RefLibrary.resolve("item", "New").source, /^### SourceItem: New/m);
  assert.match(RefLibrary.resolve("item", "Legacy").source, /^### Item: Legacy/m);
});

test("RefLibrary reports duplicate names and circular references", async () => {
  await stubLibrary([
    { name: "Dup", path: "Items/Dup.md", content: "### Item: Dup\n" },
    { name: "Dup", path: "Items/sub/Dup.md", content: "### Item: Dup\n" },
    { name: "A", path: "Items/A.md", content: "### Item: A\n[item=B]\n" },
    { name: "B", path: "Items/B.md", content: "### Item: B\n[item=A]\n" },
  ]);
  assert.equal(RefLibrary.duplicates().length, 1);
  assert.equal(RefLibrary.detectCycles().length >= 1, true);
  // Nested resolution must not hang on a cycle.
  assert.equal(RefLibrary.resolve("item", "A").ok, true);
});

test("createFile then deleteFile add and remove a cache entry", async () => {
  await stubLibrary(ITEMS.slice());
  const posted = [];
  global.fetch = async (url, opts) => {
    posted.push({ url, body: opts && opts.body ? JSON.parse(opts.body) : null });
    if (url === "/__create_library_file") {
      return { ok: true, json: async () => ({ ok: true, entry: { name: "Yeni", path: "Items/Yeni.md" } }) };
    }
    if (url === "/__delete_campaign_file") {
      return { ok: true, json: async () => ({ ok: true }) };
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => "" };
  };

  await RefLibrary.createFile("item", "Yeni", "### Item: Yeni\n");
  assert.equal(RefLibrary.has("item", "Yeni"), true);

  await RefLibrary.deleteFile("item", "Yeni");
  assert.equal(RefLibrary.has("item", "Yeni"), false);
  // Delete targets the library file path under Items/.
  assert.equal(posted.some((p) => p.url === "/__delete_campaign_file" && p.body.path === "Items/Yeni.md"), true);
});

test("library item migration helper writes SourceItem and strips instance-only fields", () => {
  const out = RefLibrary.sourceItemContent("Lantern", [
    "### Item: Lantern",
    "SourceItem: Old",
    "Side: R",
    "Text Size: 14",
    "Yapışık: T",
    "Closed: T",
    "Tür: Tool",
    "",
  ].join("\n"));

  assert.match(out, /^### SourceItem: Lantern$/m);
  assert.match(out, /^Tür: Tool$/m);
  assert.doesNotMatch(out, /^### Item:/m);
  assert.doesNotMatch(out, /^SourceItem:/m);
  assert.doesNotMatch(out, /^Side:/m);
  assert.doesNotMatch(out, /^Text Size:/m);
  assert.doesNotMatch(out, /^Yapışık:/m);
  assert.doesNotMatch(out, /^Closed:/m);
  assert.equal(RefLibrary.itemInstanceContent("Lantern"), "### Item: Lantern\nSourceItem: Lantern\n");
});

test("scene diagnostics flag missing refs, malformed refs, and broken links", async () => {
  await stubLibrary(ITEMS);
  const src = [
    "# Scene",
    "",
    "## Olay",
    "",
    "[item=Calamity]",
    "[item=Missing]",
    "",
    "Masada [link=Calamity]kitap[/link] ve [link=Nope]yok[/link].",
    "",
    "[item=]",
  ].join("\n");
  const parsed = RendScrollDiagnostics.parseScene(src, "Campaign/1.md");
  const codes = RendScrollDiagnostics
    .computeSceneDiagnostics(parsed.doc, { file: "Campaign/1.md" })
    .map((i) => i.code);
  assert.ok(codes.includes("missing-ref"));
  assert.ok(codes.includes("malformed-ref"));
  assert.ok(codes.includes("broken-link"));
  // A link to an on-page / library item is NOT broken.
  assert.equal(codes.filter((c) => c === "broken-link").length, 1);
});
