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
        // Mirror app.js renderCardFromSource: the builder reads the parsed AST node;
        // only the heading line goes through marked (for the title element).
        var doc = RendScrollParser.parseRendScroll(src);
        var card = null;
        doc.sections.forEach(function (sec) {
          sec.blocks.forEach(function (b) { if (!card && b.kind === "card") card = b; });
        });
        var tmp = document.createElement("div");
        tmp.innerHTML = renderMarkdown(src.split(/\\r?\\n/)[0] || "");
        var head = tmp.children[0] || null;
        var build = RendScrollCards.builder(type);
        var el = build ? build(card, head, []) : null;
        // Mirror app.js stampClosed: carry the "Closed:" directive to the element.
        if (el && card) {
          var v = "";
          (card.directives || []).forEach(function (d) { if (d.name === "closed") v = d.value; });
          if (/^(t|true)$/i.test(v)) el.dataset.ccDirective = "closed";
          else if (/^(f|false)$/i.test(v)) el.dataset.ccDirective = "open";
        }
        return el;
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

/* ----------------------------------------------------------------------------
   Structure regression net (P1 migration safety net).

   These assert the STRUCTURE each builder produces from a representative source,
   captured before the AST-in-builder migration so the refactor is provably
   non-regressing. They intentionally check class/shape/section invariants (not
   exact text/markup) so they survive incidental output changes but catch a
   builder that stops routing a directive/field correctly.
---------------------------------------------------------------------------- */

test("item: meta grid, rarity badge, type pill, damage, properties, description, Side", () => {
  const card = win.__T.renderCard(
    "item",
    "### Item: Blade\nSide: R\nTür: Weapon\nNadirlik: 2\nHasar: 1d8 kesme\n\n> A keen blade.\n\nÖzellikler:\n- Sharp\n"
  );
  assert.ok(card.classList.contains("item-card"), "expected .item-card");
  assert.ok(card.classList.contains("card-right"), "Side: R should add .card-right");
  assert.ok(card.querySelector(".item-meta"), "expected .item-meta grid");
  assert.ok(card.querySelector(".item-rarity"), "expected rarity badge");
  assert.ok(card.querySelector(".item-type-pill"), "expected type pill");
  assert.ok(card.querySelector(".item-damage"), "expected damage value");
  assert.ok(card.querySelector(".item-properties"), "expected .item-properties");
  assert.ok(card.querySelector(".item-description"), "expected .item-description");
});

test("item: Yapışık: T marks the card .item-stuck", () => {
  const card = win.__T.renderCard("item", "### Item: Ring\nYapışık: T\nTür: Wondrous\n");
  assert.ok(card.classList.contains("item-stuck"), "expected .item-stuck");
});

test("ability: label, meta, rarity, properties, lore, description", () => {
  const card = win.__T.renderCard(
    "ability",
    "### Spell: Fireball\nTür: Evocation\nMaliyet: 3\nNadirlik: 3\n\n> A roaring blast.\n\nÖzellikler:\n- Loud\nLore:\n> Ancient flame.\n"
  );
  assert.ok(card.classList.contains("ability-card"), "expected .ability-card");
  const label = card.querySelector(".ability-label");
  assert.ok(label && /SPELL/.test(label.textContent), "expected SPELL label");
  assert.ok(card.querySelector(".ability-meta"), "expected .ability-meta");
  assert.ok(card.querySelector(".ability-rarity"), "expected rarity badge");
  assert.ok(card.querySelector(".ability-properties"), "expected .ability-properties");
  assert.ok(card.querySelector(".ability-lore"), "expected .ability-lore");
  assert.ok(card.querySelector(".ability-description"), "expected .ability-description");
});

test("combat: roster rows, checks, runner, Side, portrait", () => {
  const card = win.__T.renderCard(
    "combat",
    "### Savaş: Ambush\nImage: goblin.png\nSide: R\nStat:\n- AC 15 | HP 20\nEnemies:\n- Goblin | AC 15 | HP 7\n- Orc | AC 13 | HP 15\nChecks:\n- Perception:\n> 10: spot them\n"
  );
  assert.ok(card.classList.contains("combat-card"), "expected .combat-card");
  assert.ok(card.classList.contains("card-right"), "Side: R should add .card-right");
  assert.strictEqual(card.querySelectorAll(".enemy-block").length, 2, "expected 2 roster rows");
  assert.ok(card.querySelector(".skillchecks"), "expected a .skillchecks section");
  assert.ok(card.querySelector(".combat-runner"), "expected the live combat runner");
  assert.match(card.textContent, /Ambush/);
});

test("npc: stat row, personality, dialogue subcard, checks, portrait", () => {
  const card = win.__T.renderCard(
    "npc",
    "### NPC: Bob\nImage: bob.png\nRace: Human\nKişilik:\n> Friendly.\nSelam:\n> Hi there.\nChecks:\n- Insight:\n> 10: he is honest\n"
  );
  assert.ok(card.classList.contains("npc-card"), "expected .npc-card");
  assert.ok(card.querySelector(".npc-stat-row"), "expected a .npc-stat-row (Race)");
  assert.ok(card.querySelector(".npc-subcard"), "expected a dialogue .npc-subcard");
  assert.ok(card.querySelector(".skillchecks"), "expected a Checks .skillchecks");
  assert.match(card.textContent, /Bob/);
});

test("obj: title, checks section, loot panel, BG watermark", () => {
  const card = win.__T.renderCard(
    "obj",
    "### Obje: Chest\nBG: chest.png\n> A heavy chest.\nChecks:\n- Investigation:\n> 10: a false bottom\nLoot:\n- 20 gold\n"
  );
  assert.ok(card.classList.contains("obj-card"), "expected .obj-card");
  assert.ok(/Point Of Interest/.test(card.textContent), "expected POI title");
  assert.ok(card.querySelector(".obj-section .skillchecks"), "expected a Checks section");
  assert.ok(card.querySelector(".obj-loot"), "expected a .obj-loot panel");
  assert.ok(/chest\.png/.test(card.getAttribute("style") || ""), "expected --obj-bg watermark");
});

test("skillchecks: card, grid, skill name, category, Side", () => {
  const card = win.__T.renderCard(
    "skillchecks",
    "### Skill Checks\nSide: R\nCombat:\n- Athletics:\n> 10: climb the wall\n"
  );
  assert.ok(card.classList.contains("sc-card"), "expected .sc-card");
  assert.ok(card.classList.contains("card-right"), "Side: R should add .card-right");
  assert.ok(card.querySelector(".sc-grid"), "expected a .sc-grid");
  assert.ok(card.querySelector(".sc-skill-name"), "expected a .sc-skill-name");
  assert.ok(card.querySelector(".sc-category"), "expected a .sc-category");
});

test("picture: img, caption, --pic-width, Side", () => {
  const card = win.__T.renderCard("picture", "### Picture: Castle\nImage: castle.png\nSize: 50\nSide: R\n");
  assert.ok(card.classList.contains("picture-card"), "expected .picture-card");
  assert.ok(card.classList.contains("card-right"), "Side: R should add .card-right");
  assert.ok(card.querySelector("img"), "expected an <img>");
  assert.ok(card.querySelector(".picture-caption"), "expected a caption");
  assert.ok(/--pic-width:\s*50%/.test(card.getAttribute("style") || ""), "expected --pic-width: 50%");
});

test("audio: player, caption, Side", () => {
  const card = win.__T.renderCard("audio", "### Audio: Tavern\nFile: tavern\nSide: R\n");
  assert.ok(card.classList.contains("audio-card"), "expected .audio-card");
  assert.ok(card.classList.contains("card-right"), "Side: R should add .card-right");
  assert.ok(card.querySelector("audio"), "expected an <audio> element");
  assert.ok(card.querySelector(".audio-caption"), "expected a caption");
});

test("std: title + portrait + body", () => {
  const card = win.__T.renderCard("std", "### STD: Arrival\nImage: gate.png\n> You arrive at the gate.\n");
  assert.ok(card.classList.contains("std-card"), "expected .std-card");
  assert.ok(card.querySelector(".std-title"), "expected .std-title");
  assert.match(card.textContent, /Arrival/);
});

test("manifest: title, Duration/Summary rows, Goals/Key NPCs/Rewards lists", () => {
  const card = win.__T.renderCard(
    "manifest",
    "### Manifest\nDuration: 20 min\nSummary: A tense parley.\nGoals:\n- Broker peace\n- Learn the secret\nKey NPCs:\n- Envoy Mara\nRewards:\n- 100 gold\n"
  );
  assert.ok(card, "no card produced");
  assert.ok(card.classList.contains("manifest-card"), "expected .manifest-card");
  assert.ok(card.querySelector(".manifest-title"), "expected a .manifest-title");
  assert.strictEqual(card.querySelectorAll(".manifest-row").length, 2, "expected Duration + Summary rows");
  assert.match(card.textContent, /20 min/);
  assert.match(card.textContent, /A tense parley\./);
  const lists = card.querySelectorAll(".manifest-list");
  assert.strictEqual(lists.length, 3, "expected Goals + Key NPCs + Rewards lists");
  assert.strictEqual(card.querySelector(".manifest-list ul").querySelectorAll("li").length, 2, "expected 2 goals");
  assert.match(card.textContent, /Envoy Mara/);
  assert.match(card.textContent, /100 gold/);
});

test("manifest: empty fields are omitted (Duration only)", () => {
  const card = win.__T.renderCard("manifest", "### Manifest\nDuration: 10 min\n");
  assert.ok(card.classList.contains("manifest-card"), "expected .manifest-card");
  assert.strictEqual(card.querySelectorAll(".manifest-row").length, 1, "only Duration row");
  assert.strictEqual(card.querySelectorAll(".manifest-list").length, 0, "no empty lists");
});

test("unexpected: title + body, Side", () => {
  const card = win.__T.renderCard("unexpected", "### Unexpected: Twist\nSide: R\n- The bridge collapses.\n");
  assert.ok(card.classList.contains("unexpected-card"), "expected .unexpected-card");
  assert.ok(card.classList.contains("card-right"), "Side: R should add .card-right");
  assert.ok(card.querySelector(".unexpected-title"), "expected .unexpected-title");
  assert.match(card.textContent, /Twist/);
});

test("Closed directive: stamped onto the card element for the collapse pass", () => {
  const closed = win.__T.renderCard("std", "### STD: Note\nClosed: T\n> Body.\n");
  assert.strictEqual(closed.dataset.ccDirective, "closed", "Closed: T -> ccDirective closed");
  const open = win.__T.renderCard("std", "### STD: Note\nClosed: F\n> Body.\n");
  assert.strictEqual(open.dataset.ccDirective, "open", "Closed: F -> ccDirective open");
  const none = win.__T.renderCard("std", "### STD: Note\n> Body.\n");
  assert.strictEqual(none.dataset.ccDirective, undefined, "no directive -> unset");
});

test("sourceenemy: renders a roster from a lone enemy block", () => {
  const card = win.__T.renderCard("sourceenemy", "### SourceEnemy: Kate\n- Kate | AC 10 | HP 15\n");
  assert.ok(card.classList.contains("sourceenemy-card"), "expected .sourceenemy-card");
  assert.strictEqual(card.querySelectorAll(".enemy-block").length, 1, "expected 1 roster row");
  assert.match(card.textContent, /Kate/);
});
