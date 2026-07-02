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
    "Type: Tool",
    "Rarity: 2",
    "Image: lamp",
    "> Pale light.",
    "",
    "Properties:",
    "- Glows",
    "",
  ].join("\n"));

  assert.match(out, /^### Item: Lantern$/m);
  assert.match(out, /^Side: R$/m);
  assert.doesNotMatch(out, /^Text Size:/m);
  assert.match(out, /^Image: lamp$/m);
  assert.match(out, /^Type: Tool$/m);
  assert.match(out, /^Rarity: 2$/m);
  assert.match(out, /^> Pale light\.$/m);
  assert.match(out, /^- Glows$/m);
});

test("ItemData item fields override SourceItem fields", () => {
  const out = ItemData.resolveItemSource([
    "### Item: Lantern",
    "SourceItem: Lantern",
    "Type: Weapon",
    "Rarity: 3",
    "Image: sword",
    "> Sharp.",
    "",
    "Properties:",
    "- Cuts",
    "",
  ].join("\n"), () => [
    "### SourceItem: Lantern",
    "Type: Tool",
    "Rarity: 2",
    "Image: lamp",
    "> Pale light.",
    "",
    "Properties:",
    "- Glows",
    "",
  ].join("\n"));

  assert.match(out, /^Type: Weapon$/m);
  assert.match(out, /^Rarity: 3$/m);
  assert.match(out, /^Image: sword$/m);
  assert.match(out, /^> Sharp\.$/m);
  assert.match(out, /^- Cuts$/m);
  assert.doesNotMatch(out, /^Type: Tool$/m);
  assert.doesNotMatch(out, /^- Glows$/m);
});

test("ItemData dash clears inherited fields", () => {
  const out = ItemData.resolveItemSource([
    "### Item: Lantern",
    "SourceItem: Lantern",
    "Type: -",
    "Image: -",
    "> -",
    "",
    "Properties:",
    "- -",
    "",
  ].join("\n"), () => [
    "### SourceItem: Lantern",
    "Type: Tool",
    "Image: lamp",
    "> Pale light.",
    "",
    "Properties:",
    "- Glows",
    "",
  ].join("\n"));

  assert.doesNotMatch(out, /^Type:/m);
  assert.doesNotMatch(out, /^Image:/m);
  assert.doesNotMatch(out, /^> Pale light\.$/m);
  assert.doesNotMatch(out, /^Properties:$/m);
});

test("ItemData SourceItem render output drops instance-only controls", () => {
  const out = ItemData.sourceItemRenderSource([
    "### SourceItem: Lantern",
    "Side: R",
    "Text Size: 14",
    "Connect: T",
    "Closed: T",
    "Type: Tool",
    "",
  ].join("\n"));

  assert.match(out, /^### SourceItem: Lantern$/m);
  assert.match(out, /^Type: Tool$/m);
  assert.doesNotMatch(out, /^Side:/m);
  assert.doesNotMatch(out, /^Text Size:/m);
  assert.doesNotMatch(out, /^Connect:/m);
  assert.doesNotMatch(out, /^Closed:/m);
});
