"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const EditorSchemas = require("../src/editor/cardSchemas.js");

test("card Text Size parses and serializes through schema metadata", () => {
  const schema = EditorSchemas.get("std");
  const values = EditorSchemas.parse(schema, "### STD: Notice\nText Size: 14\n> small note\n");

  assert.equal(values.textSize, "14");
  assert.match(EditorSchemas.serialize(schema, values), /^Text Size: 14$/m);
});

test("cards without Text Size do not gain one when serialized", () => {
  const schema = EditorSchemas.get("std");
  const values = EditorSchemas.parse(schema, "### STD: Notice\n> unchanged\n");
  const out = EditorSchemas.serialize(schema, values);

  assert.equal(values.textSize, "");
  assert.doesNotMatch(out, /^Text Size:/m);
});

test("Skill Checks parse asterisk markers and serialize canonical dash markers", () => {
  const schema = EditorSchemas.get("skillchecks");
  const values = EditorSchemas.parse(schema, [
    "### Skill Checks",
    "* Investigation:",
    "> 12: A hidden crack in the stone.",
    "- Perception:",
    "> 10: A faint draft.",
    "",
  ].join("\n"));

  assert.deepEqual(values.checks.map((entry) => entry.skill), ["Investigation", "Perception"]);

  const out = EditorSchemas.serialize(schema, values);
  assert.match(out, /^- Investigation:$/m);
  assert.match(out, /^- Perception:$/m);
  assert.doesNotMatch(out, /^\* Investigation:$/m);
});

test("schema lists parse asterisk markers and serialize canonical dash markers", () => {
  const schema = EditorSchemas.get("item");
  const values = EditorSchemas.parse(schema, [
    "### Item: Rope",
    "Özellikler:",
    "* Climbing",
    "* Quiet",
    "",
  ].join("\n"));

  assert.deepEqual(values.properties, ["Climbing", "Quiet"]);

  const out = EditorSchemas.serialize(schema, values);
  assert.match(out, /^- Climbing$/m);
  assert.match(out, /^- Quiet$/m);
  assert.doesNotMatch(out, /^\* Climbing$/m);
});

test("Item schema parses and serializes SourceItem slot", () => {
  const schema = EditorSchemas.get("item");
  const values = EditorSchemas.parse(schema, [
    "### Item: Lantern",
    "SourceItem: Lantern Base",
    "Tür: -",
    "",
  ].join("\n"));

  assert.equal(values.sourceItem, "Lantern Base");
  assert.equal(values.tur, "-");
  const out = EditorSchemas.serialize(schema, values);
  assert.match(out, /^SourceItem: Lantern Base$/m);
  assert.match(out, /^Tür: -$/m);
});

test("SourceItem schema has no instance-only slots", () => {
  const schema = EditorSchemas.get("sourceitem");
  const keys = schema.fields.map((f) => f.key);

  assert.deepEqual(keys, ["title", "tur", "rarity", "image", "properties", "body"]);
  assert.match(EditorSchemas.serialize(schema, {
    title: "Lantern",
    tur: "Tool",
    rarity: "2",
    image: "",
    properties: ["Glows"],
    body: "> Pale light.",
  }), /^### SourceItem: Lantern$/m);
});

test("Narrative schema serializes Text as quoted read-aloud lines", () => {
  const schema = EditorSchemas.get("narrative");
  const out = EditorSchemas.serialize(schema, {
    column: "right",
    textSize: "16",
    text: "First line\n\nSecond line",
  });

  assert.match(out, /^### Narrative$/m);
  assert.match(out, /^Side: R$/m);
  assert.match(out, /^Text Size: 16$/m);
  assert.match(out, /^Text:$/m);
  assert.match(out, /^> First line$/m);
  assert.match(out, /^>$/m);
  assert.match(out, /^> Second line$/m);
});

test("Narrative schema parses Text label and unquotes content", () => {
  const schema = EditorSchemas.get("narrative");
  const values = EditorSchemas.parse(schema, [
    "### Narrative",
    "Side: R",
    "Text Size: 15",
    "Text:",
    "> First line",
    ">",
    "> Second line",
    "",
  ].join("\n"));

  assert.equal(values.column, "right");
  assert.equal(values.textSize, "15");
  assert.equal(values.text, "First line\n\nSecond line");
});
