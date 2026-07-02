"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const EditorOutline = require("../src/editor/outline.js");

function cardByTitle(model, title) {
  for (const ev of model.events) {
    const card = ev.cards.find((c) => c.title === title);
    if (card) return card;
  }
  return null;
}

test("insertAtLine can insert a card before a target card", () => {
  const model = EditorOutline.parse([
    "# Scene",
    "## Event",
    "### STD: One",
    "> first",
    "",
    "### STD: Two",
    "> second",
    "",
  ].join("\n"));
  const two = cardByTitle(model, "Two");
  const next = EditorOutline.insertAtLine(model, two.start, "### STD: Inserted\n> middle");
  const out = EditorOutline.serialize(next);

  assert.ok(out.indexOf("### STD: One") < out.indexOf("### STD: Inserted"));
  assert.ok(out.indexOf("### STD: Inserted") < out.indexOf("### STD: Two"));
});

test("insertAtLine can insert a card after a target card", () => {
  const model = EditorOutline.parse([
    "# Scene",
    "## Event",
    "### STD: One",
    "> first",
    "",
    "### STD: Two",
    "> second",
    "",
  ].join("\n"));
  const one = cardByTitle(model, "One");
  const next = EditorOutline.insertAtLine(model, one.end, "### STD: Inserted\n> middle");
  const out = EditorOutline.serialize(next);

  assert.ok(out.indexOf("### STD: One") < out.indexOf("### STD: Inserted"));
  assert.ok(out.indexOf("### STD: Inserted") < out.indexOf("### STD: Two"));
});

test("card stuck/column come from the parser directive derivation (no drift)", () => {
  // The outline model reads column/stuck straight off the canonical AST, so it
  // agrees with the renderer's TRUTHY set for every truthy spelling (e.g. "yes").
  const model = EditorOutline.parse([
    "# Scene",
    "## Event",
    "### Object: Shrine",
    "> host",
    "",
    "### Item: Holy Symbol",
    "Connect: yes",
    "Side: R",
    "> body",
    "",
  ].join("\n"));
  const item = cardByTitle(model, "Holy Symbol");

  assert.ok(item, "item card is present in the model");
  assert.equal(item.stuck, true, "Connect: yes must dock the card (matches renderer)");
  assert.equal(item.column, "right", "Side: R must place the card in the right column");
});

test("rewriteBlockColumn writes Side R for right-column card inserts", () => {
  const model = EditorOutline.parse("# Scene\n## Event\n");
  const block = EditorOutline.rewriteBlockColumn(model, "### STD: Inserted\n> body", "right");

  assert.match(block, /^### STD: Inserted\nSide: R\n> body$/);
});

test("rewriteBlockColumn removes Side for left-column card inserts", () => {
  const model = EditorOutline.parse("# Scene\n## Event\n");
  const block = EditorOutline.rewriteBlockColumn(model, "### STD: Inserted\nSide: R\n> body", "left");

  assert.equal(block, "### STD: Inserted\n> body");
});

test("rewriteBlockColumn leaves narrative inserts unchanged", () => {
  const model = EditorOutline.parse("# Scene\n## Event\n");
  const block = EditorOutline.rewriteBlockColumn(model, "> narrative", "right");

  assert.equal(block, "> narrative");
});

test("rewriteBlockColumn writes Side R for Narrative card inserts", () => {
  const model = EditorOutline.parse("# Scene\n## Event\n");
  const block = EditorOutline.rewriteBlockColumn(model, "### Narrative\nText:\n> body", "right");

  assert.match(block, /^### Narrative\nSide: R\nText:\n> body$/);
});
