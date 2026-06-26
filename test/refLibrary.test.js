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
  assert.match(r.source, /Lanetli/);
  assert.equal(RefLibrary.has("item", "GÜMÜŞ ANAHTAR".replace(/I/g, "İ")), true);
  assert.equal(RefLibrary.resolve("item", "Nope").ok, false);
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
