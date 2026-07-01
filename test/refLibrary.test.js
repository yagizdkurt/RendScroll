"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

global.RendScrollParser = require("../src/parser/rendscrollParser.js");
const RendScrollParser = global.RendScrollParser;
const RefLibrary = require("../src/refLibrary.js");
global.RefLibrary = RefLibrary;
const RendScrollDiagnostics = require("../src/debug/diagnostics.js");

// Stub the launcher's bundle endpoint so RefLibrary.init() loads in-memory files.
// init() loads every registered ref type (item, enemy, …); the stub serves the
// given files for the "item" bundle only, so other types load empty.
function stubLibrary(files) {
  global.fetch = async (url) => {
    if (url.indexOf("/__library_bundle") === 0) {
      const served = /[?&]type=item(&|$)/.test(url) ? files : [];
      return { ok: true, json: async () => served };
    }
    return { ok: false, status: 404, json: async () => { throw new Error("no"); }, text: async () => "" };
  };
  return RefLibrary.init();
}

const ITEMS = [
  { name: "Calamity", path: "Items/Calamity.md", content: "### Item: Calamity\nTür: Kitap\n> Lanetli.\n" },
  { name: "Gümüş Anahtar", path: "Items/Gümüş Anahtar.md", content: "### Item: Gümüş Anahtar\nTür: Anahtar\n" },
];

test("parser leaves standalone [item=Name] as plain markdown", () => {
  const doc = RendScrollParser.parseRendScroll("# S\n\n## Olay\n\n[item=Gümüş Anahtar]\n");
  const refs = doc.sections.flatMap((s) => s.blocks).filter((b) => b.kind === "ref");
  const plain = doc.sections.flatMap((s) => s.blocks).filter((b) => b.kind === "plain");
  assert.equal(refs.length, 0);
  assert.match(plain.map((b) => b.lines.join("\n")).join("\n"), /\[item=Gümüş Anahtar\]/);
});

test("[item=] with an empty name is plain text", () => {
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

test("RefLibrary reports duplicate names", async () => {
  await stubLibrary([
    { name: "Dup", path: "Items/Dup.md", content: "### Item: Dup\n" },
    { name: "Dup", path: "Items/sub/Dup.md", content: "### Item: Dup\n" },
    { name: "A", path: "Items/A.md", content: "### Item: A\n[item=B]\n" },
    { name: "B", path: "Items/B.md", content: "### Item: B\n[item=A]\n" },
  ]);
  assert.equal(RefLibrary.duplicates().length, 1);
  assert.equal(RefLibrary.detectCycles().length, 0);
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

test("campaign-local entries carry origin and report overrides over global ones", async () => {
  // The server merges campaign-over-global: the winner is the campaign file and
  // the shadowed global path is recorded so the cache can flag the override.
  await stubLibrary([
    { name: "Goblin", path: "Campaigns/X/Items/Goblin.md", origin: "campaign",
      shadows: ["Items/Goblin.md"], content: "### SourceItem: Goblin (campaign)\n" },
    { name: "Sword", path: "Items/Sword.md", origin: "global", content: "### SourceItem: Sword\n" },
  ]);

  const goblin = RefLibrary.lookup("item", "Goblin");
  assert.equal(goblin.origin, "campaign");
  assert.match(RefLibrary.resolve("item", "Goblin").source, /campaign/);
  assert.equal(RefLibrary.lookup("item", "Sword").origin, "global");

  const overrides = RefLibrary.overrides();
  assert.equal(overrides.length, 1);
  assert.equal(overrides[0].name, "Goblin");
  assert.equal(overrides[0].using, "Campaigns/X/Items/Goblin.md");
  assert.deepEqual(overrides[0].hidden, ["Items/Goblin.md"]);

  // entries() exposes origin so the sidebar can group/badge campaign-local items.
  const origins = RefLibrary.entries("item").map((e) => e.origin).sort();
  assert.deepEqual(origins, ["campaign", "global"]);
});

test("createFile forwards scope and stores the returned origin", async () => {
  await stubLibrary([]);
  let sent = null;
  global.fetch = async (url, opts) => {
    if (url === "/__create_library_file") {
      sent = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ ok: true,
        entry: { name: "Camp", path: "Campaigns/X/Items/Camp.md", origin: "campaign" } }) };
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => "" };
  };
  await RefLibrary.createFile("item", "Camp", "### SourceItem: Camp\n", "campaign");
  assert.equal(sent.scope, "campaign");
  assert.equal(RefLibrary.lookup("item", "Camp").origin, "campaign");
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

test("scene diagnostics flag broken links but ignore deprecated item blocks", async () => {
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
  const parsed = RendScrollDiagnostics.parseScene(src, "Campaigns/Legacy/Scenes/1.md");
  const codes = RendScrollDiagnostics
    .computeSceneDiagnostics(parsed.doc, { file: "Campaigns/Legacy/Scenes/1.md" })
    .map((i) => i.code);
  assert.ok(!codes.includes("missing-ref"));
  assert.ok(!codes.includes("malformed-ref"));
  assert.ok(codes.includes("broken-link"));
  // A link to an on-page / library item is NOT broken.
  assert.equal(codes.filter((c) => c === "broken-link").length, 1);
});
