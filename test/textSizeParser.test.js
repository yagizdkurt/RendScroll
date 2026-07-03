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

test("validTextSize is the exported canonical 8-32 check", () => {
  assert.equal(typeof RendScrollParser.validTextSize, "function");
  assert.equal(RendScrollParser.validTextSize("8"), true);
  assert.equal(RendScrollParser.validTextSize("32"), true);
  assert.equal(RendScrollParser.validTextSize("16.5"), true);
  assert.equal(RendScrollParser.validTextSize("7"), false);
  assert.equal(RendScrollParser.validTextSize("33"), false);
  assert.equal(RendScrollParser.validTextSize("large"), false);
  assert.equal(RendScrollParser.validTextSize(""), false);
});

test("matchDirective is exported and carries name on malformed results", () => {
  assert.equal(typeof RendScrollParser.matchDirective, "function");

  const ok = RendScrollParser.matchDirective("Side: R");
  assert.equal(ok.kind, "directive");
  assert.equal(ok.name, "side");
  assert.equal(ok.value, "R");

  const missingValue = RendScrollParser.matchDirective("Image:");
  assert.equal(missingValue.kind, "malformed");
  assert.equal(missingValue.name, "image");
  assert.match(missingValue.reason, /value/);

  const missingColon = RendScrollParser.matchDirective("Side R");
  assert.equal(missingColon.kind, "malformed");
  assert.equal(missingColon.name, "side");
  assert.match(missingColon.reason, /colon/);

  assert.equal(RendScrollParser.matchDirective("Type: Junk"), null);
});

test("empty Text Size:/Size: is malformed (kept as unknown, not body)", () => {
  const card = firstCard("### STD: Notice\nText Size:\nSize:\n> visible\n");
  assert.deepEqual(directiveNames(card), []);
  assert.equal(card.unknown.length, 2);
  const reasons = card.unknown.map((u) => u.reason).join(" ");
  assert.match(reasons, /value/);
  // The empty directive lines are not echoed into rendered body prose.
  assert.doesNotMatch(bodyText(card), /Text Size:/);
  assert.doesNotMatch(bodyText(card), /^Size:/m);
});
