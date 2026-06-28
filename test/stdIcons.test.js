"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const StdIcons = require("../src/cards/shared/StdIcons.js");

test("key('dice') accepts number, numeric string and dNN form", () => {
  assert.equal(StdIcons.key("dice", 20), 20);
  assert.equal(StdIcons.key("dice", "20"), 20);
  assert.equal(StdIcons.key("dice", "d20"), 20);
  assert.equal(StdIcons.key("dice", "D20"), 20);
  assert.equal(StdIcons.key("dice", " d6 "), 6);
});

test("key('dice') returns null for unsupported or garbage input", () => {
  assert.equal(StdIcons.key("dice", 7), null);
  assert.equal(StdIcons.key("dice", "d100"), null);
  assert.equal(StdIcons.key("dice", "twenty"), null);
  assert.equal(StdIcons.key("dice", ""), null);
});

test("url('dice') resolves every supported die to its STDImages path", () => {
  assert.equal(StdIcons.url("dice", 4), "src/STDImages/d4def.png");
  assert.equal(StdIcons.url("dice", 6), "src/STDImages/d6def.png");
  assert.equal(StdIcons.url("dice", 8), "src/STDImages/d8def.png");
  assert.equal(StdIcons.url("dice", 10), "src/STDImages/d10def.png");
  assert.equal(StdIcons.url("dice", 12), "src/STDImages/d12def.png");
  assert.equal(StdIcons.url("dice", "d20"), "src/STDImages/d20def.png");
});

test("url('dice') returns null for an unsupported die", () => {
  assert.equal(StdIcons.url("dice", 100), null);
  assert.equal(StdIcons.url("dice", "d3"), null);
});

test("types('dice') lists the supported dice in ascending order", () => {
  assert.deepEqual(StdIcons.types("dice"), [4, 6, 8, 10, 12, 20]);
});

test("key('damage') normalizes case and whitespace to a canonical type", () => {
  assert.equal(StdIcons.key("damage", "Necrotic"), "necrotic");
  assert.equal(StdIcons.key("damage", " PIERCING "), "piercing");
  assert.equal(StdIcons.key("damage", "fire"), "fire");
});

test("key('damage') returns null for an unknown damage type", () => {
  assert.equal(StdIcons.key("damage", "sonic"), null);
  assert.equal(StdIcons.key("damage", ""), null);
  assert.equal(StdIcons.key("damage", null), null);
});

test("url('damage') resolves a known type to its STDImages path", () => {
  assert.equal(StdIcons.url("damage", "necrotic"), "src/STDImages/necroticdef.png");
  assert.equal(StdIcons.url("damage", "Radiant"), "src/STDImages/radiantdef.png");
});

test("url('damage') returns null for an unknown type", () => {
  assert.equal(StdIcons.url("damage", "sonic"), null);
});

test("types('damage') lists all 13 standard D&D damage types", () => {
  assert.equal(StdIcons.types("damage").length, 13);
});

test("an unknown kind yields null / empty results", () => {
  assert.equal(StdIcons.key("spell", "fireball"), null);
  assert.equal(StdIcons.url("spell", "fireball"), null);
  assert.deepEqual(StdIcons.types("spell"), []);
});
