"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const CEM = require("../src/cards/combat/enemyModel.js");
const EditorSchemas = require("../src/editor/cardSchemas.js");

const KATE = [
  "- Kate | Village Woman • Humanoid | AC 10 | HP 15 | Init +1 | Speed 30 ft",
  "  - Attack: Rusty Knife | +4 | 1d4+2 Piercing",
  "  - Weak Save: Wisdom",
  "  - Strong Save: Dexterity",
  "  - Resist: Fire",
  "  - Immune: Poison",
  "  - Trait: Keen Senses",
  "  - Tactics: Attacks the nearest creature.",
  "  - Tactics: Below half HP she panics.",
].join("\n");

test("parseEnemyBlock reads identity, stats, attacks, saves, traits, tactics", () => {
  const [rec] = CEM.parseEnemyBlock(KATE);
  assert.equal(rec.name, "Kate");
  assert.equal(rec.subtitle, "Village Woman • Humanoid");
  assert.equal(rec.ac, "10");
  assert.equal(rec.hp, "15");
  assert.equal(rec.init, "+1");
  assert.equal(rec.speed, "30 ft");
  assert.deepEqual(rec.attacks, [{ name: "Rusty Knife", hit: "+4", damage: "1d4+2 Piercing" }]);
  assert.equal(rec.weakSave, "Wisdom");
  assert.equal(rec.strongSave, "Dexterity");
  assert.equal(rec.resist, "Fire");
  assert.equal(rec.immune, "Poison");
  assert.deepEqual(rec.traits, ["Keen Senses"]);
  assert.deepEqual(rec.tactics, ["Attacks the nearest creature.", "Below half HP she panics."]);
});

test("serializeEnemies round-trips a canonical stat block", () => {
  assert.equal(CEM.serializeEnemies(CEM.parseEnemyBlock(KATE)), KATE);
});

test("count token round-trips and omits when 1", () => {
  const recs = CEM.parseEnemyBlock("- Goblin | AC 15 | HP 7 | Init +2 | x3");
  assert.equal(recs[0].count, 3);
  assert.equal(CEM.serializeEnemies(recs), "- Goblin | AC 15 | HP 7 | Init +2 | x3");
  const one = CEM.parseEnemyBlock("- Rat | AC 10 | HP 1 | Init +0");
  assert.equal(one[0].count, 1);
  assert.equal(CEM.serializeEnemies(one), "- Rat | AC 10 | HP 1 | Init +0");
});

test("unlabelled bullets are kept as traits (back-compat with old rosters)", () => {
  const [rec] = CEM.parseEnemyBlock([
    "- Goblin | AC 15 | HP 7",
    "  - Nimble Escape: Disengage as a bonus action",
  ]);
  assert.deepEqual(rec.traits, ["Nimble Escape: Disengage as a bonus action"]);
});

test("Turkish Taktik bullets are parsed as tactics", () => {
  const [rec] = CEM.parseEnemyBlock([
    "- Goblin | AC 15 | HP 7",
    "  - Taktik: Attacks the nearest creature",
  ]);
  assert.deepEqual(rec.tactics, ["Attacks the nearest creature"]);
  assert.deepEqual(rec.traits, []);
});

test("initMod and formatInitMod treat init as a signed modifier", () => {
  assert.equal(CEM.initMod("+1"), 1);
  assert.equal(CEM.initMod("-2"), -2);
  assert.equal(CEM.initMod("3"), 3);
  assert.equal(CEM.formatInitMod("1"), "+1");
  assert.equal(CEM.formatInitMod("-2"), "-2");
  assert.equal(CEM.formatInitMod("0"), "+0");
});

test("parseDamageDice extracts dice count, die, modifier and type", () => {
  assert.deepEqual(CEM.parseDamageDice("1d4+2 Piercing"), {
    count: 1,
    sides: 4,
    extra: "+2",
    type: "Piercing",
  });
  assert.deepEqual(CEM.parseDamageDice("2d6 + 3 fire"), {
    count: 2,
    sides: 6,
    extra: "+3",
    type: "fire",
  });
  assert.deepEqual(CEM.parseDamageDice("d8"), {
    count: 1,
    sides: 8,
    extra: "",
    type: "",
  });
  assert.equal(CEM.parseDamageDice("5 poison"), null);
});

test("parseDamageTerms extracts multiple dice terms and preserves custom types", () => {
  assert.deepEqual(CEM.parseDamageTerms("1d4 necrotic + 1d4 radiant"), [
    { count: 1, sides: 4, extra: "", type: "necrotic" },
    { count: 1, sides: 4, extra: "", type: "radiant" },
  ]);
  assert.deepEqual(CEM.parseDamageTerms("1d6+2 slashing + 1d4 fire"), [
    { count: 1, sides: 6, extra: "+2", type: "slashing" },
    { count: 1, sides: 4, extra: "", type: "fire" },
  ]);
  assert.deepEqual(CEM.parseDamageTerms("d8 void"), [
    { count: 1, sides: 8, extra: "", type: "void" },
  ]);
  assert.equal(CEM.parseDamageTerms("5 poison"), null);
});

test("serializeDamageTerms writes canonical mixed damage text", () => {
  assert.equal(CEM.serializeDamageTerms([
    { count: 1, sides: 4, extra: "", type: "necrotic" },
    { count: 1, sides: 4, extra: "", type: "radiant" },
  ]), "1d4 necrotic + 1d4 radiant");
});

test("combat schema serialize/parse round-trips the Enemies block", () => {
  const schema = EditorSchemas.get("combat");
  const md = [
    "### Savaş: Ambush",
    "> The brush rustles…",
    "Enemies:",
    "- Goblin | AC 15 | HP 7 | Init +2 | x3",
    "  - Attack: Scimitar | +4 | 1d6+2 Slashing",
    "",
  ].join("\n");

  const values = EditorSchemas.parse(schema, md);
  assert.equal(values.enemies.length, 1);
  assert.equal(values.enemies[0].count, 3);
  assert.equal(values.enemies[0].attacks[0].damage, "1d6+2 Slashing");
  assert.match(JSON.stringify(values.body), /rustles/);

  const out = EditorSchemas.serialize(schema, values);
  assert.match(out, /^Enemies:$/m);
  assert.match(out, /^- Goblin \| AC 15 \| HP 7 \| Init \+2 \| x3$/m);
  assert.match(out, /^ {2}- Attack: Scimitar \| \+4 \| 1d6\+2 Slashing$/m);
});

test("combat schema serialize/parse round-trips mixed attack damage", () => {
  const schema = EditorSchemas.get("combat");
  const md = [
    "### Savaş: Mixed Damage",
    "Enemies:",
    "- Wraith | AC 13 | HP 22 | Init +3",
    "  - Attack: Touch | +5 | 1d4 necrotic + 1d4 radiant",
    "",
  ].join("\n");

  const values = EditorSchemas.parse(schema, md);
  assert.equal(values.enemies[0].attacks[0].damage, "1d4 necrotic + 1d4 radiant");

  const out = EditorSchemas.serialize(schema, values);
  assert.match(out, /^ {2}- Attack: Touch \| \+5 \| 1d4 necrotic \+ 1d4 radiant$/m);
});

test("library reference round-trips as [enemy=Name] with optional count", () => {
  const one = CEM.parseEnemyBlock("- [enemy=Goblin]");
  assert.equal(one[0].ref, "Goblin");
  assert.equal(one[0].name, "Goblin");
  assert.equal(one[0].count, 1);
  assert.equal(CEM.serializeEnemies(one), "- [enemy=Goblin]");

  const many = CEM.parseEnemyBlock("- [enemy=Hobgoblin Captain] x3");
  assert.equal(many[0].ref, "Hobgoblin Captain");
  assert.equal(many[0].count, 3);
  assert.equal(CEM.serializeEnemies(many), "- [enemy=Hobgoblin Captain] x3");
});

test("parseSourceEnemy reads the lone enemy from a library file", () => {
  const file = [
    "### SourceEnemy: Goblin",
    "- Goblin | Goblin • Humanoid | AC 15 | HP 7 | Init +2 | Speed 30 ft",
    "  - Attack: Scimitar | +4 | 1d6+2 Slashing",
    "  - Trait: Nimble Escape",
  ].join("\n");
  const rec = CEM.parseSourceEnemy(file);
  assert.equal(rec.name, "Goblin");
  assert.equal(rec.ac, "15");
  assert.equal(rec.hp, "7");
  assert.deepEqual(rec.attacks, [{ name: "Scimitar", hit: "+4", damage: "1d6+2 Slashing" }]);
  assert.deepEqual(rec.traits, ["Nimble Escape"]);
});

test("expandEnemies resolves refs, overrides count, and flags missing", () => {
  const source = { name: "Goblin", ac: "15", hp: "7", init: "+2", count: 1 };
  const resolver = (name) => (name === "Goblin" ? source : null);

  const recs = CEM.parseEnemyBlock([
    "- [enemy=Goblin] x4",
    "- [enemy=Ghost]",
    "- Kate | AC 10 | HP 15",
  ]);
  const live = CEM.expandEnemies(recs, resolver);

  assert.equal(live[0].name, "Goblin");
  assert.equal(live[0].ac, "15");
  assert.equal(live[0].count, 4); // inline count overrides the source's
  assert.equal(live[1].name, "Ghost (missing)");
  assert.equal(live[2].name, "Kate"); // inline enemy passes through untouched
  assert.equal(live[2].ref, "");
});

test("sourceenemy schema round-trips a bare single-enemy library file", () => {
  const schema = EditorSchemas.get("sourceenemy");
  const md = [
    "### SourceEnemy: Goblin",
    "- Goblin | Goblin • Humanoid | AC 15 | HP 7 | Init +2 | Speed 30 ft",
    "  - Attack: Scimitar | +4 | 1d6+2 Slashing",
    "  - Trait: Nimble Escape",
    "",
  ].join("\n");

  const values = EditorSchemas.parse(schema, md);
  assert.equal(values.title, "Goblin");
  assert.equal(values.enemy.length, 1);
  assert.equal(values.enemy[0].ac, "15");
  assert.deepEqual(values.enemy[0].attacks, [{ name: "Scimitar", hit: "+4", damage: "1d6+2 Slashing" }]);

  const out = EditorSchemas.serialize(schema, values);
  assert.match(out, /^### SourceEnemy: Goblin$/m);
  assert.match(out, /^- Goblin \| Goblin • Humanoid \| AC 15 \| HP 7 \| Init \+2 \| Speed 30 ft$/m);
  assert.doesNotMatch(out, /^Enemies:$/m); // bare block, no label
});

test("sourceenemy serialize names the lone enemy from the card title", () => {
  const schema = EditorSchemas.get("sourceenemy");
  const out = EditorSchemas.serialize(schema, {
    title: "Dire Wolf",
    enemy: [{ name: "ignored", ac: "14", hp: "37" }],
  });
  assert.match(out, /^### SourceEnemy: Dire Wolf$/m);
  assert.match(out, /^- Dire Wolf \| AC 14 \| HP 37$/m);
});

test("applyHpInput implements the damage/heal grammar", () => {
  const start = { cur: 15, max: 30 };
  assert.deepEqual(CEM.applyHpInput(start, "8"), { cur: 7, max: 30 });
  assert.deepEqual(CEM.applyHpInput(start, "-5"), { cur: 20, max: 30 });
  assert.deepEqual(CEM.applyHpInput(start, "-"), { cur: 30, max: 30 });
  assert.deepEqual(CEM.applyHpInput(start, "_10"), { cur: 25, max: 40 });
  assert.deepEqual(CEM.applyHpInput({ cur: 5, max: 30 }, "9"), { cur: 0, max: 30 });
  assert.deepEqual(CEM.applyHpInput({ cur: 28, max: 30 }, "-9"), { cur: 30, max: 30 });
  assert.deepEqual(CEM.applyHpInput(start, ""), { cur: 15, max: 30 });
});
