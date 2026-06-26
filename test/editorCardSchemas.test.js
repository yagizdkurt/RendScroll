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
