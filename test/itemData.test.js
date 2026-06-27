"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { ItemData } = require("../src/cards/item/item.js");

test("ItemData inherits empty item fields from SourceItem", () => {
  const out = ItemData.resolveItemSource([
    "### Item: Lantern",
    "SourceItem: Lantern",
    "Side: R",
    "Text Size: 14",
    "",
  ].join("\n"), () => [
    "### SourceItem: Lantern",
    "Tür: Tool",
    "Nadirlik: 2",
    "Image: lamp",
    "> Pale light.",
    "",
    "Özellikler:",
    "- Glows",
    "",
  ].join("\n"));

  assert.match(out, /^### Item: Lantern$/m);
  assert.match(out, /^Side: R$/m);
  assert.doesNotMatch(out, /^Text Size:/m);
  assert.match(out, /^Image: lamp$/m);
  assert.match(out, /^Tür: Tool$/m);
  assert.match(out, /^Nadirlik: 2$/m);
  assert.match(out, /^> Pale light\.$/m);
  assert.match(out, /^- Glows$/m);
});

test("ItemData item fields override SourceItem fields", () => {
  const out = ItemData.resolveItemSource([
    "### Item: Lantern",
    "SourceItem: Lantern",
    "Tür: Weapon",
    "Nadirlik: 3",
    "Image: sword",
    "> Sharp.",
    "",
    "Özellikler:",
    "- Cuts",
    "",
  ].join("\n"), () => [
    "### SourceItem: Lantern",
    "Tür: Tool",
    "Nadirlik: 2",
    "Image: lamp",
    "> Pale light.",
    "",
    "Özellikler:",
    "- Glows",
    "",
  ].join("\n"));

  assert.match(out, /^Tür: Weapon$/m);
  assert.match(out, /^Nadirlik: 3$/m);
  assert.match(out, /^Image: sword$/m);
  assert.match(out, /^> Sharp\.$/m);
  assert.match(out, /^- Cuts$/m);
  assert.doesNotMatch(out, /^Tür: Tool$/m);
  assert.doesNotMatch(out, /^- Glows$/m);
});

test("ItemData dash clears inherited fields", () => {
  const out = ItemData.resolveItemSource([
    "### Item: Lantern",
    "SourceItem: Lantern",
    "Tür: -",
    "Image: -",
    "> -",
    "",
    "Özellikler:",
    "- -",
    "",
  ].join("\n"), () => [
    "### SourceItem: Lantern",
    "Tür: Tool",
    "Image: lamp",
    "> Pale light.",
    "",
    "Özellikler:",
    "- Glows",
    "",
  ].join("\n"));

  assert.doesNotMatch(out, /^Tür:/m);
  assert.doesNotMatch(out, /^Image:/m);
  assert.doesNotMatch(out, /^> Pale light\.$/m);
  assert.doesNotMatch(out, /^Özellikler:$/m);
});

test("ItemData SourceItem render output drops instance-only controls", () => {
  const out = ItemData.sourceItemRenderSource([
    "### SourceItem: Lantern",
    "Side: R",
    "Text Size: 14",
    "Yapışık: T",
    "Closed: T",
    "Tür: Tool",
    "",
  ].join("\n"));

  assert.match(out, /^### SourceItem: Lantern$/m);
  assert.match(out, /^Tür: Tool$/m);
  assert.doesNotMatch(out, /^Side:/m);
  assert.doesNotMatch(out, /^Text Size:/m);
  assert.doesNotMatch(out, /^Yapışık:/m);
  assert.doesNotMatch(out, /^Closed:/m);
});
