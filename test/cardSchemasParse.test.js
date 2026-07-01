/* Guard: for the card types whose editor form parses through the SHARED per-type
   render parser (parse<Type>Body via schema.fromBody — item and ability), a
   representative values object must survive a serialize -> parse round-trip. This
   proves the editor (save path) and the reader (render path) model those types'
   fields through the exact same code, so the two can never drift. Complements
   cardSchemasLabels.test.js (universal-directive label drift) and cardBuilders.js
   (render structure). See RENDERER_AST_MIGRATION.md for the discipline.

   It also asserts the render-side parse<Type>Body functions are exported for reuse
   by every field-bearing type (item/ability/obj/combat/npc). */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const EditorSchemas = require("../src/editor/cardSchemas.js");

function roundTrip(type, values) {
  const schema = EditorSchemas.get(type);
  const md = EditorSchemas.serialize(schema, values);
  return { schema, md, back: EditorSchemas.parse(schema, md) };
}

test("item fields round-trip through the shared parseItemBody", () => {
  const values = {
    title: "Blade", sourceItem: "", tur: "Weapon", damage: "1d8 kesme",
    rarity: "2", image: "blade.png", column: "right", textSize: "14",
    properties: ["Sharp", "Light"], body: "> A keen blade.", stuck: true, closed: false,
  };
  const { back } = roundTrip("item", values);
  assert.equal(back.tur, "Weapon");
  assert.equal(back.damage, "1d8 kesme");
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
    title: "Charm", sourceItem: "", tur: "Wondrous", damage: "", rarity: "",
    image: "", column: "left", textSize: "",
    properties: [], body: "Weight: 1 lb\n> A lucky charm.", stuck: false, closed: false,
  };
  const { back } = roundTrip("item", values);
  assert.equal(back.tur, "Wondrous");
  assert.match(back.body, /Weight: 1 lb/);
  assert.match(back.body, /A lucky charm\./);
});

test("ability fields round-trip through the shared parseAbilityBody", () => {
  const values = {
    keyword: "Spell", title: "Fireball", tur: "Evocation", cost: "3",
    range: "30ft", cooldown: "1", rarity: "3", column: "left", textSize: "",
    properties: ["Loud"], body: "> A roaring blast.\nLore:\n> Ancient flame.",
    stuck: false, closed: true,
  };
  const { back } = roundTrip("ability", values);
  assert.equal(back.keyword, "Spell");
  assert.equal(back.tur, "Evocation");
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

test("every field-bearing type exports a pure parse<Type>Body for reuse", () => {
  assert.equal(typeof require("../src/cards/item/item.js").parseItemBody, "function");
  assert.equal(typeof require("../src/cards/ability/ability.js").parseAbilityBody, "function");
  assert.equal(typeof require("../src/cards/obj/obj.js").parseObjBody, "function");
  assert.equal(typeof require("../src/cards/combat/combat.js").parseCombatBody, "function");
  assert.equal(typeof require("../src/cards/npc/npc.js").parseNpcBody, "function");
});
