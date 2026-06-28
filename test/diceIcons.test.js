"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const DiceIcons = require("../src/cards/shared/diceIcons.js");

test("sides() accepts number, numeric string and dNN form", () => {
  assert.equal(DiceIcons.sides(20), 20);
  assert.equal(DiceIcons.sides("20"), 20);
  assert.equal(DiceIcons.sides("d20"), 20);
  assert.equal(DiceIcons.sides("D20"), 20);
  assert.equal(DiceIcons.sides(" d6 "), 6);
});

test("sides() returns null for unsupported or garbage input", () => {
  assert.equal(DiceIcons.sides(7), null);
  assert.equal(DiceIcons.sides("d100"), null);
  assert.equal(DiceIcons.sides("twenty"), null);
  assert.equal(DiceIcons.sides(""), null);
});

test("url() resolves every supported die to its STDImages path", () => {
  assert.equal(DiceIcons.url(4), "src/STDImages/d4def.png");
  assert.equal(DiceIcons.url(6), "src/STDImages/d6def.png");
  assert.equal(DiceIcons.url(8), "src/STDImages/d8def.png");
  assert.equal(DiceIcons.url(10), "src/STDImages/d10def.png");
  assert.equal(DiceIcons.url(12), "src/STDImages/d12def.png");
  assert.equal(DiceIcons.url("d20"), "src/STDImages/d20def.png");
});

test("url() returns null for an unsupported die", () => {
  assert.equal(DiceIcons.url(100), null);
  assert.equal(DiceIcons.url("d3"), null);
});

test("TYPES lists the supported dice in ascending order", () => {
  assert.deepEqual(DiceIcons.TYPES, [4, 6, 8, 10, 12, 20]);
});
