/* DOM-render tests for the card builders — the product's core output path, which
   had zero automated coverage. A jsdom window loads the reader scripts in the same
   order index.html does (minus app/editor/layout), so the builders self-register
   into RendScrollCards exactly as in the browser. We then drive a few representative
   build<Type>Card functions end-to-end (source -> isolate -> marked -> card DOM) and
   assert the produced element.

   This also hosts the manifest<->registry guard: every classifiable card type in the
   parser's CARD_TYPES (except the builder-less "echo") must have a registered builder,
   so a forgotten registration fails loudly here instead of silently at render time. */

const { test, before } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..");

// Reader subset of index.html's <script> order. Excludes app.js (calls init() +
// fetch at load), the editor/layout/printer/debug layers, refLibrary, and options —
// none are needed to build a single card from source.
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
  "src/cards/shared/StdIcons.js",
  "src/cards/shared/cardMeta.js",
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
  "src/cards/picture/picture.js",
  "src/cards/shared/cardCollapse.js",
];

let win;

before(() => {
  const dom = new JSDOM("<!DOCTYPE html><body><article id=\"page\"></article></body>", {
    runScripts: "dangerously",
  });
  win = dom.window;
  // Append each script as a real <script> element (textContent avoids any "</script>"
  // inside a source breaking the parse). jsdom runs them in one shared global, so the
  // top-level RendScrollParser / build*Card / renderMarkdown bindings leak across files
  // just like classic <script> tags in the browser.
  for (const file of SCRIPTS) {
    const el = win.document.createElement("script");
    el.textContent = fs.readFileSync(path.join(ROOT, file), "utf8");
    win.document.body.appendChild(el);
  }
  // Final script (shared scope) exposes the symbols + a minimal render helper that
  // mirrors app.js's renderCardFromSource: isolate -> marked -> build.
  const expose = win.document.createElement("script");
  expose.textContent = `
    window.__T = {
      parser: RendScrollParser,
      cards: RendScrollCards,
      renderCard: function (type, src) {
        var norm = RendScrollCards.normalizer(type);
        var s = normalizeClosedMarkdown(norm ? norm(src) : src);
        var tmp = document.createElement("div");
        tmp.innerHTML = renderMarkdown(s);
        var els = Array.prototype.slice.call(tmp.children);
        var build = RendScrollCards.builder(type);
        return build ? build(els[0], els.slice(1)) : null;
      },
    };
  `;
  win.document.body.appendChild(expose);
});

test("every classifiable card type (except echo) registers a builder", () => {
  const T = win.__T;
  assert.ok(T && T.cards, "harness failed to load (RendScrollCards missing)");
  // Build a plain Node array (cardTypeList runs in jsdom's realm; copying avoids a
  // cross-realm prototype mismatch in the assertion).
  const missing = Array.from(T.parser.cardTypeList())
    .filter((type) => type !== "echo")
    .filter((type) => typeof T.cards.builder(type) !== "function");
  assert.strictEqual(missing.length, 0, "card types with no registered builder: " + missing.join(", "));
  // sourceitem/sourceenemy are library variants not in cardTypeList but must build too.
  assert.strictEqual(typeof T.cards.builder("sourceitem"), "function");
  assert.strictEqual(typeof T.cards.builder("sourceenemy"), "function");
});

test("narrative: builds a narrative-card and routes Side: R to the right column", () => {
  const card = win.__T.renderCard("narrative", "### Narrative\nSide: R\nText:\n> Read aloud line.\n");
  assert.ok(card, "no card produced");
  assert.ok(card.classList.contains("narrative-card"), "expected .narrative-card");
  assert.ok(card.classList.contains("card-right"), "Side: R should add .card-right");
  assert.match(card.textContent, /Read aloud line\./);
});

test("std: builds an std-card carrying the heading title", () => {
  const card = win.__T.renderCard("std", "### STD: Field Note\nA short standard note.\n");
  assert.ok(card, "no card produced");
  assert.ok(card.classList.contains("std-card"), "expected .std-card");
  assert.match(card.textContent, /Field Note/);
});

test("item: builds an item-card with the item name and meta", () => {
  const card = win.__T.renderCard("item", "### Item: Iron Sword\nTür: Weapon\nNadirlik: 2\n");
  assert.ok(card, "no card produced");
  assert.ok(card.classList.contains("item-card"), "expected .item-card");
  assert.match(card.textContent, /Iron Sword/);
});
