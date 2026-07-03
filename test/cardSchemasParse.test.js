/* Guard: editor card forms parse through explicit schema.fromBody adapters that
   consume the same AST node and shared per-type body parsers the reader uses. A
   representative values object must survive a serialize -> parse round-trip, so
   the editor (save path) and reader (render path) cannot drift through a generic
   second parser. Complements cardSchemasLabels.test.js (universal-directive label
   drift) and cardBuilders.js (render structure). See RENDERER_AST_MIGRATION.md
   for the discipline.

   It also asserts the render-side parse<Type>Body functions are exported for reuse
   by every field-bearing type (item/ability/obj/combat/npc). */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const EditorSchemas = require("../src/editor/cardSchemas.js");
const CombatEnemyModel = require("../src/cards/combat/enemyModel.js");

function roundTrip(type, values) {
  const schema = EditorSchemas.get(type);
  const md = EditorSchemas.serialize(schema, values);
  return { schema, md, back: EditorSchemas.parse(schema, md) };
}

test("item fields round-trip through the shared parseItemBody", () => {
  const values = {
    title: "Blade", sourceItem: "", type: "Weapon", damage: "1d8 slashing",
    rarity: "2", image: "blade.png", column: "right", textSize: "14",
    properties: ["Sharp", "Light"], body: "> A keen blade.", stuck: true, closed: false,
  };
  const { back } = roundTrip("item", values);
  assert.equal(back.type, "Weapon");
  assert.equal(back.damage, "1d8 slashing");
  assert.equal(back.rarity, "2");
  assert.deepEqual(back.properties, ["Sharp", "Light"]);
  assert.equal(back.image, "blade.png");
  assert.equal(back.column, "right");
  assert.equal(back.textSize, "14");
  assert.equal(back.stuck, true);
  assert.equal(back.closed, false);
  assert.match(back.body, /A keen blade\./);
});

test("item unknown meta labels survive in the Body (nothing is dropped)", () => {
  const values = {
    title: "Charm", sourceItem: "", type: "Wondrous", damage: "", rarity: "",
    image: "", column: "left", textSize: "",
    properties: [], body: "Weight: 1 lb\n> A lucky charm.", stuck: false, closed: false,
  };
  const { back } = roundTrip("item", values);
  assert.equal(back.type, "Wondrous");
  assert.match(back.body, /Weight: 1 lb/);
  assert.match(back.body, /A lucky charm\./);
});

test("ability fields round-trip through the shared parseAbilityBody", () => {
  const values = {
    keyword: "Spell", title: "Fireball", type: "Evocation", cost: "3",
    range: "30ft", cooldown: "1", rarity: "3", column: "left", textSize: "",
    properties: ["Loud"], body: "> A roaring blast.\nLore:\n> Ancient flame.",
    stuck: false, closed: true,
  };
  const { back } = roundTrip("ability", values);
  assert.equal(back.keyword, "Spell");
  assert.equal(back.type, "Evocation");
  assert.equal(back.cost, "3");
  assert.equal(back.range, "30ft");
  assert.equal(back.cooldown, "1");
  assert.equal(back.rarity, "3");
  assert.deepEqual(back.properties, ["Loud"]);
  assert.equal(back.closed, true);
  assert.match(back.body, /A roaring blast\./);
  assert.match(back.body, /Lore:/);
  assert.match(back.body, /Ancient flame\./);
});

test("manifest fields round-trip through the shared parseManifestBody", () => {
  const values = {
    duration: "20 min",
    summary: "A tense parley.",
    goals: ["Broker peace", "Learn the secret"],
    keyNpcs: ["Envoy Mara"],
    rewards: ["100 gold"],
  };
  const { back } = roundTrip("manifest", values);
  assert.equal(back.duration, "20 min");
  assert.equal(back.summary, "A tense parley.");
  assert.deepEqual(back.goals, ["Broker peace", "Learn the secret"]);
  assert.deepEqual(back.keyNpcs, ["Envoy Mara"]);
  assert.deepEqual(back.rewards, ["100 gold"]);
});

test("manifest is editable/serializable but absent from the insert menu", () => {
  assert.ok(EditorSchemas.get("manifest"), "manifest schema should be registered");
  const menu = EditorSchemas.list().map((s) => s.type);
  assert.ok(!menu.includes("manifest"), "manifest must not appear in the insert menu");
});

test("manifest exports a pure parseManifestBody for reuse", () => {
  assert.equal(typeof require("../src/cards/manifest/manifest.js").parseManifestBody, "function");
});

test("every registered schema parses through an explicit fromBody adapter", () => {
  [
    "narrative", "npc", "skillchecks", "obj", "combat", "item", "ability",
    "unexpected", "std", "picture", "audio", "transition", "manifest",
    "sourceitem", "sourceenemy",
  ].forEach((type) => {
    const schema = EditorSchemas.get(type);
    assert.ok(schema, type + " schema should exist");
    assert.equal(typeof schema.fromBody, "function", type + " must define fromBody");
  });
});

test("cardSchemas has no generic mapFieldTable parser", () => {
  const src = fs.readFileSync(path.join(__dirname, "../src/editor/cardSchemas.js"), "utf8");
  assert.doesNotMatch(src, /\bmapFieldTable\b/);
});

/* The migrated non-item types (npc/obj/combat/std) now parse through explicit
   fromBody adapters over the SAME AST node the reader renders from, so their
   editor fields must survive a serialize -> parse round-trip too. */

test("npc fields round-trip through parseNpcBody-backed fromBody", () => {
  const checks = EditorSchemas.parseChecks("- Investigation:\n> 12: A hidden ledger.");
  const values = {
    title: "Mara",
    personality: ["Guarded", "Loyal"],
    race: "Human", age: "40", occupation: "Envoy", alignment: "Neutral",
    hp: "22", ac: "13",
    image: "mara.png", bg: "hall.png",
    column: "right", textSize: "14",
    body: [
      { kind: "text", text: "> Greetings, traveler." },
      { kind: "text", text: "The Ledger:" },
      { kind: "checksBlock", label: "Checks", checks },
    ],
    closed: true,
  };
  const { back } = roundTrip("npc", values);
  assert.deepEqual(back.personality, ["Guarded", "Loyal"]);
  assert.equal(back.race, "Human");
  assert.equal(back.hp, "22");
  assert.equal(back.image, "mara.png");     // universal, from the node
  assert.equal(back.bg, "hall.png");        // universal, from the node
  assert.equal(back.column, "right");       // "Side: R" -> node.column
  assert.equal(back.textSize, "14");
  assert.equal(back.closed, true);
  // Body keeps the dialogue-topic prose and the Checks block, in source order.
  assert.equal(back.body.length, 2);
  assert.equal(back.body[0].kind, "text");
  assert.match(back.body[0].text, /Greetings/);
  assert.match(back.body[0].text, /The Ledger:/);
  assert.equal(back.body[1].kind, "checksBlock");
  assert.equal(back.body[1].checks[0].skill, "Investigation");
});

test("obj body round-trips prose + Checks + Loot through parseObjBody-backed fromBody", () => {
  const checks = EditorSchemas.parseChecks("- Perception:\n> 10: A faint draft.");
  const values = {
    title: "Altar", image: "", bg: "shrine.png", column: "left", textSize: "",
    body: [
      { kind: "text", text: "> An old stone altar." },
      { kind: "checksBlock", label: "Checks", checks },
      { kind: "text", text: "Loot:\n- 20 gold" },
    ],
    closed: false,
  };
  const { back } = roundTrip("obj", values);
  assert.equal(back.bg, "shrine.png");
  assert.equal(back.body.length, 3);
  assert.equal(back.body[0].kind, "text");
  assert.match(back.body[0].text, /old stone altar/);
  assert.equal(back.body[1].kind, "checksBlock");
  assert.equal(back.body[1].checks[0].skill, "Perception");
  assert.equal(back.body[2].kind, "text");
  assert.match(back.body[2].text, /Loot:/);
  assert.match(back.body[2].text, /20 gold/);
});

test("combat body + enemies both round-trip; Side honored", () => {
  const enemies = CombatEnemyModel.parseEnemyBlock(["- Goblin | AC 15 | HP 7 | Init +2"]);
  const values = {
    title: "Ambush", image: "", column: "right", textSize: "",
    body: [{ kind: "text", text: "> Bandits leap out!" }],
    enemies,
    closed: false,
  };
  const { back } = roundTrip("combat", values);
  assert.equal(back.column, "right");
  assert.equal(back.body.length, 1);
  assert.match(back.body[0].text, /Bandits leap out/);
  assert.equal(back.enemies.length, 1);
  assert.equal(back.enemies[0].name, "Goblin");
  assert.equal(back.enemies[0].ac, "15");
  assert.equal(back.enemies[0].hp, "7");
});

test("std title + body + universals round-trip via the AST node", () => {
  const values = {
    title: "Arrival", image: "gate.png", column: "right", textSize: "16",
    body: "> The gates open.\nDust settles on the road.", closed: true,
  };
  const { back } = roundTrip("std", values);
  assert.equal(back.title, "Arrival");
  assert.equal(back.image, "gate.png");
  assert.equal(back.column, "right");
  assert.equal(back.textSize, "16");
  assert.equal(back.closed, true);
  assert.match(back.body, /gates open/);
  assert.match(back.body, /Dust settles/);
});

test("picture directives round-trip through its explicit fromBody", () => {
  const values = {
    title: "Castle", image: "castle.png", size: "50", column: "right", closed: true,
  };
  const { back } = roundTrip("picture", values);
  assert.equal(back.title, "Castle");
  assert.equal(back.image, "castle.png");
  assert.equal(back.size, "50");
  assert.equal(back.column, "right");
  assert.equal(back.closed, true);
});

test("audio directives round-trip through its explicit fromBody", () => {
  const values = {
    title: "Tavern", file: "tavern", column: "right", closed: true,
  };
  const { back } = roundTrip("audio", values);
  assert.equal(back.title, "Tavern");
  assert.equal(back.file, "tavern");
  assert.equal(back.column, "right");
  assert.equal(back.closed, true);
});

test("transition scene and body round-trip through parseTransitionBody-backed fromBody", () => {
  const values = {
    title: "Take the Pass", scene: "3_ambush", column: "right",
    body: "> Travel at night.", closed: false,
  };
  const { back } = roundTrip("transition", values);
  assert.equal(back.title, "Take the Pass");
  assert.equal(back.scene, "3_ambush");
  assert.equal(back.column, "right");
  assert.match(back.body, /Travel at night/);
});

test("every field-bearing type exports a pure parse<Type>Body for reuse", () => {
  assert.equal(typeof require("../src/cards/item/item.js").parseItemBody, "function");
  assert.equal(typeof require("../src/cards/ability/ability.js").parseAbilityBody, "function");
  assert.equal(typeof require("../src/cards/obj/obj.js").parseObjBody, "function");
  assert.equal(typeof require("../src/cards/combat/combat.js").parseCombatBody, "function");
  assert.equal(typeof require("../src/cards/npc/npc.js").parseNpcBody, "function");
});
