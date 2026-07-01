/* Guard: the editor's anchoring layer (EditorAnchors) must know about every card
   type that renders as a single card <div> in a scene — otherwise that card gets no
   Edit/move/delete handle and its edit form never opens (the bug the Scene Manifest
   card first hit). ANCHORABLE and CARD_CLASS must stay in sync with each other and
   cover every scene-placeable schema type. */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const EditorAnchors = require("../src/editor/anchors.js");
const EditorSchemas = require("../src/editor/cardSchemas.js");

const { ANCHORABLE, CARD_CLASS } = EditorAnchors._internals;

test("ANCHORABLE and CARD_CLASS cover the same set of types", () => {
  const anchorable = [...ANCHORABLE].sort();
  const classed = Object.keys(CARD_CLASS).sort();
  assert.deepEqual(anchorable, classed, "ANCHORABLE and CARD_CLASS must list the same types");
});

test("every insert-menu scene card type is anchorable", () => {
  EditorSchemas.list().forEach((schema) => {
    assert.ok(ANCHORABLE.has(schema.type), schema.type + " must be anchorable in the editor");
    assert.ok(CARD_CLASS[schema.type], schema.type + " must have a CARD_CLASS entry");
  });
});

test("Scene Manifest is anchorable even though it is not in the insert menu", () => {
  assert.ok(ANCHORABLE.has("manifest"), "manifest must be anchorable so its Edit form opens");
  assert.equal(CARD_CLASS.manifest, "manifest-card");
});
