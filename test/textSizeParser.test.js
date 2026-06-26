"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const RendScrollParser = require("../src/parser/rendscrollParser.js");

function firstCard(source) {
  const doc = RendScrollParser.parseRendScroll(source);
  return doc.sections.flatMap((s) => s.blocks.filter((b) => b.kind === "card"))[0];
}

function directiveNames(card) {
  return card.directives.map((d) => d.name);
}

function bodyText(card) {
  return card.body.map((l) => l.text).join("\n");
}

test("Text Size directive is recognized only when valid", () => {
  const valid = firstCard("### STD: Notice\nText Size: 14\n> small\n");
  assert.deepEqual(directiveNames(valid), ["textsize"]);
  assert.equal(valid.directives[0].value, "14");
  assert.doesNotMatch(bodyText(valid), /Text Size/);

  const invalid = firstCard("### STD: Notice\nText Size: 99\n> visible\n");
  assert.deepEqual(directiveNames(invalid), []);
  assert.match(bodyText(invalid), /Text Size: 99/);
});
