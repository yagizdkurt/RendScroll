"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const DM = require("../src/cards/shared/damageModel.js");
const CEM = require("../src/cards/combat/enemyModel.js");

test("parseDamageTerm reads count, dice, bonus, and type", () => {
  assert.deepEqual(DM.parseDamageTerm("1d4+2 Piercing"), {
    count: 1, sides: 4, extra: "+2", type: "Piercing",
  });
  assert.deepEqual(DM.parseDamageTerm("2d6 Slashing"), {
    count: 2, sides: 6, extra: "", type: "Slashing",
  });
  assert.deepEqual(DM.parseDamageTerm("d8"), { count: 1, sides: 8, extra: "", type: "" });
});

test("parseDamageTerm rejects non-polyhedral dice and junk", () => {
  assert.equal(DM.parseDamageTerm("1d7 Fire"), null);
  assert.equal(DM.parseDamageTerm("just text"), null);
});

test("parseDamageTerms splits multi-term damage but keeps flat bonuses attached", () => {
  const terms = DM.parseDamageTerms("2d6+1 Slashing + 1d4 Fire");
  assert.equal(terms.length, 2);
  assert.deepEqual(terms[0], { count: 2, sides: 6, extra: "+1", type: "Slashing" });
  assert.deepEqual(terms[1], { count: 1, sides: 4, extra: "", type: "Fire" });
});

test("parseDamageTerms is all-or-nothing (null when any term is unparseable)", () => {
  // A leading non-dice segment makes the whole expression unparseable.
  assert.equal(DM.parseDamageTerms("nonsense + 1d6 Fire"), null);
  assert.equal(DM.parseDamageTerms(""), null);
});

test("serialize is the inverse of parse (round-trip)", () => {
  const cases = ["1d8 Slashing", "2d6+1 Slashing + 1d4 Fire", "3d10-2 Necrotic"];
  cases.forEach((src) => {
    const terms = DM.parseDamageTerms(src);
    assert.equal(DM.serializeDamageTerms(terms), src);
  });
});

test("serializeDamageTerm drops invalid dice", () => {
  assert.equal(DM.serializeDamageTerm({ count: 1, sides: 7, type: "Fire" }), "");
  assert.equal(DM.serializeDamageTerm({ count: 2, sides: 6, extra: "+1", type: "Cold" }), "2d6+1 Cold");
});

test("CombatEnemyModel re-exports the shared damage functions", () => {
  assert.equal(CEM.parseDamageTerms, DM.parseDamageTerms);
  assert.equal(CEM.serializeDamageTerms, DM.serializeDamageTerms);
  assert.equal(CEM.parseDamageDice, DM.parseDamageDice);
  assert.equal(CEM.serializeDamageTerm, DM.serializeDamageTerm);
});
