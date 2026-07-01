"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const RendScrollParser = require("../src/parser/rendscrollParser.js");
const { parseRendScroll } = RendScrollParser;

const FIX_DIR = path.join(__dirname, "fixtures");
function fixture(name) {
  return fs.readFileSync(path.join(FIX_DIR, name), "utf8");
}
function parseFixture(name) {
  return parseRendScroll(fixture(name));
}

// All card blocks across every section, in source order.
function allCards(doc) {
  return doc.sections.flatMap((s) => s.blocks.filter((b) => b.kind === "card"));
}
function directiveNames(card) {
  return card.directives.map((d) => d.name);
}
function bodyText(card) {
  return card.body.map((l) => l.text).join("\n");
}
function realChecks(group) {
  return group.checks.filter((c) => c.kind === "check");
}

// --- source preservation (round-trip) ------------------------------------

test("round-trip: lines reassemble the exact source for every fixture", () => {
  for (const name of fs.readdirSync(FIX_DIR)) {
    const raw = fixture(name);
    const doc = parseRendScroll(raw);
    assert.equal(doc.lines.join(""), raw, `${name} must round-trip byte-for-byte`);
  }
});

test("card source ranges slice back to the original heading", () => {
  for (const name of fs.readdirSync(FIX_DIR)) {
    const doc = parseFixture(name);
    for (const card of allCards(doc)) {
      const slice = doc.raw.slice(card.range.startOffset, card.range.endOffset);
      assert.ok(/^#{2,3}\s/.test(slice), `${name}: card range should start at its heading`);
      assert.equal(
        doc.raw.slice(card.titleRange.startOffset, card.titleRange.endOffset),
        doc.lines[card.range.startLine],
        `${name}: titleRange should cover the heading line`
      );
    }
  }
});

// --- basic scene ----------------------------------------------------------

test("basic scene: title, header band, and event section", () => {
  const doc = parseFixture("basic-scene.md");
  assert.equal(doc.title, "The Sunken Crypt");
  assert.equal(allCards(doc).length, 0);

  const header = doc.sections.find((s) => s.kind === "header");
  assert.ok(header, "has a header section");
  assert.ok(header.blocks.some((b) => b.kind === "plain"), "intro paragraph is a plain block");

  const event = doc.sections.find((s) => s.kind === "event" && s.title === "Entrance");
  assert.ok(event, "has an Entrance event");
  assert.ok(event.blocks.some((b) => b.kind === "narrative"), "read-aloud is a narrative block");
});

// --- NPC -------------------------------------------------------------------

test("NPC: type, title, directives, column, body", () => {
  const cards = allCards(parseFixture("npc.md"));
  assert.equal(cards.length, 1);
  const npc = cards[0];
  assert.equal(npc.type, "npc");
  assert.equal(npc.title, "Gravekeeper");
  assert.deepEqual(directiveNames(npc).sort(), ["image", "side"]);
  assert.equal(npc.column, "right");
  // Stat lines and dialogue topics stay in the body (renderer interprets them).
  assert.match(bodyText(npc), /Race: Human/);
  assert.match(bodyText(npc), /İlk Diyalog:/);
});

// --- Skill Checks ----------------------------------------------------------

test("Skill Checks: whole body becomes one check group", () => {
  const cards = allCards(parseFixture("skill-checks.md"));
  assert.equal(cards.length, 1);
  const sc = cards[0];
  assert.equal(sc.type, "skillchecks");
  assert.equal(sc.title, "Skill Checks");
  assert.equal(sc.column, "right"); // Side: R
  assert.equal(sc.checkGroups.length, 1);
  assert.equal(realChecks(sc.checkGroups[0]).length, 2); // Investigation + Perception
});

test("Skill Checks accepts asterisk and dash markers as checks", () => {
  const cards = allCards(parseRendScroll([
    "### Skill Checks",
    "* Investigation:",
    "> 12: A hidden groove catches the dust.",
    "- Perception:",
    "> 10: The door hums softly.",
    "",
  ].join("\n")));

  assert.equal(cards.length, 1);
  assert.equal(cards[0].checkGroups.length, 1);
  assert.deepEqual(realChecks(cards[0].checkGroups[0]).map((c) => c.skill), ["Investigation", "Perception"]);
});

test("embedded Checks blocks accept asterisk markers", () => {
  const cards = allCards(parseRendScroll([
    "## Obje: Altar",
    "> Cold stone.",
    "Checks:",
    "* Arcana:",
    "> 13: The rune is dormant.",
    "Loot:",
    "- Chalk",
    "",
  ].join("\n")));

  assert.equal(cards.length, 1);
  assert.equal(cards[0].checkGroups.length, 1);
  assert.deepEqual(realChecks(cards[0].checkGroups[0]).map((c) => c.skill), ["Arcana"]);
  assert.match(bodyText(cards[0]), /Loot:/);
});

test("parseChecks accepts mixed unordered-list markers", () => {
  const checks = RendScrollParser.parseChecks([
    "* Investigation:",
    "> 12: A clue.",
    "- Arcana:",
    "> 15: A glyph.",
    "",
  ].join("\n"));

  assert.deepEqual(realChecks({ checks }).map((c) => c.skill), ["Investigation", "Arcana"]);
});

// --- Item ------------------------------------------------------------------

test("Item: type, title, Image directive, meta stays in body", () => {
  const cards = allCards(parseFixture("item.md"));
  assert.equal(cards.length, 1);
  const item = cards[0];
  assert.equal(item.type, "item");
  assert.equal(item.title, "Rusty Key");
  assert.ok(directiveNames(item).includes("image"));
  assert.match(bodyText(item), /Özellikler:/);
  assert.match(bodyText(item), /Tür: Key/);
});

test("SourceItem: library base item parses as sourceitem", () => {
  const cards = allCards(parseRendScroll([
    "### SourceItem: Silver Key",
    "Tür: Key",
    "",
  ].join("\n")));

  assert.equal(cards.length, 1);
  assert.equal(cards[0].type, "sourceitem");
  assert.equal(cards[0].title, "Silver Key");
});

test("standalone item refs after cards are plain card body text", () => {
  const doc = parseRendScroll([
    "# Scene",
    "",
    "## Event",
    "",
    "### STD: One",
    "> first",
    "",
    "[item=Silver Key]",
    "",
    "### STD: Two",
    "> second",
    "",
  ].join("\n"));
  const blocks = doc.sections.flatMap((s) => s.blocks);
  const refs = blocks.filter((b) => b.kind === "ref");
  const first = blocks.find((b) => b.kind === "card" && b.title === "One");

  assert.equal(refs.length, 0);
  assert.match(bodyText(first), /\[item=Silver Key\]/);
});

// --- Object (Obje at H2) ---------------------------------------------------

test("Object: H2 Obje with Checks group and Loot in body", () => {
  const cards = allCards(parseFixture("object.md"));
  assert.equal(cards.length, 1);
  const obj = cards[0];
  assert.equal(obj.type, "obj");
  assert.equal(obj.title, "Altar");
  assert.equal(obj.level, 2);
  assert.equal(obj.checkGroups.length, 1);
  assert.equal(obj.checkGroups[0].label, "Checks");
  assert.equal(realChecks(obj.checkGroups[0]).length, 1);
  assert.match(bodyText(obj), /Loot:/);
});

// --- Combat ----------------------------------------------------------------

test("Combat: Savaş heading maps to combat", () => {
  const cards = allCards(parseFixture("combat.md"));
  assert.equal(cards.length, 1);
  assert.equal(cards[0].type, "combat");
  assert.equal(cards[0].title, "Skeletons");
});

// --- Side / Image / Closed directives --------------------------------------

test("Side/Image/Closed directives are recognized on an STD card", () => {
  const cards = allCards(parseFixture("side-image-closed.md"));
  assert.equal(cards.length, 1);
  const std = cards[0];
  assert.equal(std.type, "std");
  assert.equal(std.title, "Notice");
  assert.equal(std.column, "right");
  assert.deepEqual(directiveNames(std).sort(), ["closed", "image", "side"]);
  const closed = std.directives.find((d) => d.name === "closed");
  assert.equal(closed.value, "T");
  assert.equal(std.stuck, false);
});

test("Narrative: card type, Side, Text Size, and Text body are recognized", () => {
  const doc = parseRendScroll([
    "# Scene",
    "## Event",
    "### Narrative",
    "Side: R",
    "Text Size: 16",
    "Text:",
    "> Read this aloud.",
    "",
  ].join("\n"));
  const cards = allCards(doc);
  assert.equal(cards.length, 1);
  const narrative = cards[0];
  assert.equal(narrative.type, "narrative");
  assert.equal(narrative.title, "Narrative");
  assert.equal(narrative.column, "right");
  assert.deepEqual(directiveNames(narrative).sort(), ["side", "textsize"]);
  assert.match(bodyText(narrative), /^Text:\n> Read this aloud\.$/);
});

test("Picture: card type, caption title, and Image/Size/Side directives are recognized", () => {
  const doc = parseRendScroll([
    "# Scene",
    "## Event",
    "### Picture: Castle Map",
    "Image: kale",
    "Size: 50",
    "Side: R",
    "",
  ].join("\n"));
  const cards = allCards(doc);
  assert.equal(cards.length, 1);
  const picture = cards[0];
  assert.equal(picture.type, "picture");
  assert.equal(picture.title, "Castle Map");
  assert.equal(picture.column, "right");
  assert.deepEqual(directiveNames(picture).sort(), ["image", "side", "size"]);
});

// --- Collapsable (heading-level) -------------------------------------------

test("Collapsable directive is recorded on the section, not the body", () => {
  const doc = parseFixture("collapsable.md");
  const event = doc.sections.find((s) => s.kind === "event" && s.title === "Event");
  assert.ok(event);
  assert.equal(event.collapsable, false);
  // The directive line is consumed, the intro text survives as a plain block.
  assert.ok(event.blocks.some((b) => b.kind === "plain"));
  assert.ok(!event.blocks.some((b) => b.lines && b.lines.join("\n").match(/Collapsable/i)));
});

// --- Docked / connected cards ----------------------------------------------

test("Docked: Yapışık/Combine set stuck and dock under their host", () => {
  const cards = allCards(parseFixture("docked.md"));
  assert.equal(cards.length, 3);
  const [obj, item, ability] = cards;
  assert.equal(obj.type, "obj");
  assert.equal(item.type, "item");
  assert.equal(item.stuck, true);
  assert.equal(ability.type, "ability");
  assert.equal(ability.stuck, true);
  // Docking rules (mirror of layout.js canDockUnder).
  assert.equal(RendScrollParser.canDock(item, obj), true);
  assert.equal(RendScrollParser.canDock(ability, item), true);
});

// --- Turkish card names ----------------------------------------------------

test("Turkish names: Obje / Savaş / Beklenmedik classify correctly", () => {
  const cards = allCards(parseFixture("turkish.md"));
  assert.deepEqual(cards.map((c) => c.type), ["obj", "combat", "unexpected"]);
  assert.deepEqual(cards.map((c) => c.title), ["Mezar", "İskeletler", "Çöküş"]);
});

// --- Scene manifest --------------------------------------------------------

test("bare '### Manifest' classifies as a manifest card titled 'Scene Manifest'", () => {
  const cards = allCards(parseFixture("manifest.md"));
  assert.equal(cards.length, 1);
  assert.equal(cards[0].type, "manifest");
  assert.equal(cards[0].title, "Scene Manifest");
  // The manifest's fields live verbatim in the body for the builder/schema to read.
  assert.match(bodyText(cards[0]), /Duration: 20 min/);
  assert.match(bodyText(cards[0]), /Goals:/);
});

// --- Malformed directive ---------------------------------------------------

test("Malformed directives are kept as unknown blocks, never dropped", () => {
  const cards = allCards(parseFixture("malformed.md"));
  assert.equal(cards.length, 1);
  const item = cards[0];
  assert.equal(item.type, "item");
  assert.equal(item.unknown.length, 2); // "Side" (no colon) + "Closed:" (no value)
  const reasons = item.unknown.map((u) => u.reason).join(" ");
  assert.match(reasons, /colon/);
  assert.match(reasons, /value/);
  // Real content survives.
  assert.match(bodyText(item), /Tür: Junk/);
});

// --- Unknown card type -----------------------------------------------------

test("Unknown card type renders as a plain heading section, not a card", () => {
  const doc = parseFixture("unknown-type.md");
  assert.equal(allCards(doc).length, 0);
  const section = doc.sections.find((s) => s.title === "Foo: Bar");
  assert.ok(section, "unrecognized heading becomes a (non-card) section");
  assert.equal(section.level, 3);
});

// --- debugDump -------------------------------------------------------------

test("debugDump produces readable JSON of the AST", () => {
  const doc = parseFixture("npc.md");
  const dump = RendScrollParser.debugDump(doc);
  const parsed = JSON.parse(dump);
  assert.equal(parsed.title, "Scene");
  assert.ok(Array.isArray(parsed.sections));
});
