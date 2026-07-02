/* Guard: every scene-placeable card type must register BOTH a builder and its
   root CSS class in RendScrollCards. The registry is the single render-side
   source of truth — editor/anchors.js no longer keeps hand-synced ANCHORABLE /
   CARD_CLASS tables (card identity is carried by the data-src-* stamps renderPage
   writes), so a type missing here would silently lose its class-derived selectors. */

"use strict";

const { test, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const EditorSchemas = require("../src/editor/cardSchemas.js");

const ROOT = path.join(__dirname, "..");

// Reader subset of index.html's <script> order (same list as cardBuilders.test.js):
// enough for every card file to load and self-register into RendScrollCards.
const SCRIPTS = [
  "src/vendor/marked.min.js",
  "src/utils/text.js",
  "src/utils/dom.js",
  "src/utils/markdown.js",
  "src/parser/rendscrollParser.js",
  "src/cards/shared/skillCheckRules.js",
  "src/inlineFormatting.js",
  "src/markdown.js",
  "src/cards/shared/cardImage.js",
  "src/cards/shared/cardDirectives.js",
  "src/cards/shared/StdIcons.js",
  "src/cards/shared/damageModel.js",
  "src/cards/shared/damageRender.js",
  "src/cards/shared/itemTypes.js",
  "src/cards/shared/cardParts.js",
  "src/cards/shared/cardRegistry.js",
  "src/cards/skillChecks/skillChecks.js",
  "src/cards/npc/npc.js",
  "src/cards/item/item.js",
  "src/cards/ability/ability.js",
  "src/cards/obj/obj.js",
  "src/cards/combat/enemyModel.js",
  "src/cards/combat/combat.js",
  "src/cards/unexpected/unexpected.js",
  "src/cards/narrative/narrative.js",
  "src/cards/std/std.js",
  "src/cards/manifest/manifest.js",
  "src/cards/picture/picture.js",
  "src/cards/audio/audio.js",
];

let cards;

before(() => {
  const dom = new JSDOM("<!DOCTYPE html><body></body>", { runScripts: "dangerously" });
  for (const file of SCRIPTS) {
    const el = dom.window.document.createElement("script");
    el.textContent = fs.readFileSync(path.join(ROOT, file), "utf8");
    dom.window.document.body.appendChild(el);
  }
  cards = dom.window.RendScrollCards;
  assert.ok(cards, "harness failed to load (RendScrollCards missing)");
});

test("every insert-menu scene card type registers a builder and a cssClass", () => {
  EditorSchemas.list().forEach((schema) => {
    assert.equal(typeof cards.builder(schema.type), "function",
      schema.type + " must register a builder");
    const cls = cards.cssClass(schema.type);
    assert.ok(typeof cls === "string" && /-card$/.test(cls),
      schema.type + " must register a '*-card' cssClass (got " + cls + ")");
  });
});

test("Scene Manifest registers even though it is not in the insert menu", () => {
  assert.equal(typeof cards.builder("manifest"), "function");
  assert.equal(cards.cssClass("manifest"), "manifest-card");
});

test("non-derivable css classes are registered explicitly", () => {
  assert.equal(cards.cssClass("skillchecks"), "sc-card");
  assert.equal(cards.cssClass("sourceitem"), "item-card");
  assert.equal(cards.cssClass("sourceenemy"), "combat-card");
});

test("cardSelector() covers every registered class exactly once", () => {
  const selector = cards.cardSelector();
  cards.types().forEach((type) => {
    assert.ok(selector.includes("." + cards.cssClass(type)),
      "cardSelector() must include ." + cards.cssClass(type));
  });
  const parts = selector.split(",");
  assert.equal(new Set(parts).size, parts.length, "cardSelector() must not repeat classes");
});
