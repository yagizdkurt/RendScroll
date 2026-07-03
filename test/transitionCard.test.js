"use strict";

/* Pure tests for the Transition card's shared parse helpers (no DOM). The
   builder itself is covered by cardBuilders.test.js in jsdom; here we drive
   parseTransitionBody / findTransitionScene / extractTransitions against real
   parser output — the same helpers the scene-graph panel's cross-scene scan
   uses. transition.js references the shared browser globals, so provide them
   the way the browser <script> order does. */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

globalThis.rsLower = require("../src/utils/text.js").rsLower;
globalThis.cardBodyLines = require("../src/cards/shared/cardDirectives.js").cardBodyLines;

const { parseRendScroll } = require("../src/parser/rendscrollParser.js");
const { parseTransitionBody, findTransitionScene, extractTransitions } =
  require("../src/cards/transition/transition.js");

const FIXTURE = fs.readFileSync(path.join(__dirname, "fixtures", "transition.md"), "utf8");

function transitionCards(doc) {
  return doc.sections.flatMap((s) => s.blocks.filter(
    (b) => b.kind === "card" && b.type === "transition"));
}

test("parser classifies ### Transition: headings as transition cards", () => {
  const cards = transitionCards(parseRendScroll(FIXTURE));
  assert.equal(cards.length, 3);
  assert.equal(cards[0].title, "Take the Mountain Pass");
  assert.equal(cards[1].column, "right"); // universal Side: R still applies
});

test("parseTransitionBody: Scene ref split from description lines", () => {
  const cards = transitionCards(parseRendScroll(FIXTURE));

  const first = parseTransitionBody(cards[0]);
  assert.equal(first.sceneRef, "3_ambush");
  // body may carry the card's trailing blank line — content is what matters
  assert.equal(first.descriptionLines.join("\n").trim(),
    "> Use when the party decides to travel at night instead of waiting for the caravan.");

  const second = parseTransitionBody(cards[1]);
  assert.equal(second.sceneRef, "4_caravan.md"); // extension kept verbatim here
  assert.match(second.descriptionLines.join("\n"), /Extra prose line/);

  const broken = parseTransitionBody(cards[2]);
  assert.equal(broken.sceneRef, "");
});

test("findTransitionScene: stem match, extension optional, case-insensitive", () => {
  const entries = [
    { file: "3_ambush.md", path: "campaigns/demo/scenes/3_ambush.md", label: "The Ambush" },
    { file: "4_caravan.md", path: "campaigns/demo/scenes/4_caravan.md", label: "The Caravan" },
  ];
  assert.equal(findTransitionScene(entries, "3_ambush").label, "The Ambush");
  assert.equal(findTransitionScene(entries, "3_AMBUSH.md").label, "The Ambush");
  assert.equal(findTransitionScene(entries, "4_caravan.md").label, "The Caravan");
  assert.equal(findTransitionScene(entries, "missing"), null);
  assert.equal(findTransitionScene(entries, ""), null);
  assert.equal(findTransitionScene([], "3_ambush"), null);
});

test("extractTransitions: lists named cards with a Scene ref, skips broken ones", () => {
  const out = extractTransitions(parseRendScroll(FIXTURE));
  assert.deepEqual(out, [
    { name: "Take the Mountain Pass", sceneRef: "3_ambush" },
    { name: "Wait for the Caravan", sceneRef: "4_caravan.md" },
  ]);
  assert.deepEqual(extractTransitions(null), []);
});
