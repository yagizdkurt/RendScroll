"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const ItemTypes = require("../src/cards/shared/itemTypes.js");

test("find resolves canonical label + category, case-insensitively", () => {
  assert.deepEqual(ItemTypes.find("Scimitar"), { label: "Scimitar", category: "weapon" });
  assert.deepEqual(ItemTypes.find("scimitar"), { label: "Scimitar", category: "weapon" });
  assert.deepEqual(ItemTypes.find("HEAVY ARMOR"), { label: "Heavy Armor", category: "armor" });
  assert.deepEqual(ItemTypes.find("Wondrous Item"), { label: "Wondrous Item", category: "gear" });
});

test("Turkish dotted/dotless I folds when matching", () => {
  // "Sling" upper-cased to "SLING" then lowered should still match.
  assert.equal(ItemTypes.category("SLING"), "weapon");
  // İ (dotted capital) folds to i, not the dotless ı.
  assert.deepEqual(ItemTypes.find("RİNG"), { label: "Ring", category: "gear" });
});

test("category and label fall back gracefully for custom types", () => {
  assert.equal(ItemTypes.category("Plasma Rifle"), "");
  assert.equal(ItemTypes.label("Plasma Rifle"), "Plasma Rifle");
  assert.equal(ItemTypes.label("  spear  "), "Spear");
});

test("options returns grouped picker data covering every type", () => {
  const groups = ItemTypes.options();
  assert.ok(groups.length >= 6);
  const labels = groups.map((g) => g.label);
  assert.ok(labels.includes("Armor"));
  assert.ok(labels.includes("Martial Melee Weapons"));
  // The flat type list equals the union of group options.
  const fromGroups = groups.flatMap((g) => g.options).sort();
  assert.deepEqual(ItemTypes.types().slice().sort(), fromGroups);
});
