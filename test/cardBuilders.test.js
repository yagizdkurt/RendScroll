/* DOM-render tests for the card builders — the product's core output path. A jsdom
   window loads the reader scripts in index.html order (via the shared readerDom
   helper), so the builders self-register into RendScrollCards exactly as in the
   browser. We then drive the REAL src/app/renderCard.js renderCardFromSource
   end-to-end (source -> prepare -> parse -> marked heading -> build -> stampClosed)
   and assert the produced element — no re-implementation to drift from app.js.

   This also hosts the manifest<->registry guard: every classifiable card type in the
   parser's CARD_TYPES must be registered, so a forgotten registration fails loudly
   here instead of silently at render time — plus the accentClass guards, which are
   the only thing keeping the JS accent declarations and the base.css rules in step. */

const { test, before } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { bootReader } = require("./helpers/readerDom.js");

const ROOT = path.join(__dirname, "..");

let win;
let T;

before(async () => {
  // No layout/app needed to build a single card, but renderCard.js is loaded by the
  // helper, so we call the genuine renderCardFromSource (not a mirror of it).
  win = await bootReader({});
  T = {
    parser: win.RendScrollParser,
    cards: win.RendScrollCards,
    // Real path: renderCardFromSource returns { cardEl, els }; the builder tests want
    // the built card element (stampClosed already applied inside).
    renderCard: (type, src) => win.renderCardFromSource(type, src).cardEl,
  };
});

test("every classifiable card type is registered", () => {
  assert.ok(T && T.cards, "harness failed to load (RendScrollCards missing)");
  // Build a plain Node array (cardTypeList runs in jsdom's realm; copying avoids a
  // cross-realm prototype mismatch in the assertion).
  const unregistered = Array.from(T.parser.cardTypeList())
    .filter((type) => !T.cards.get(type));
  assert.strictEqual(unregistered.length, 0,
    "card types missing from the registry: " + unregistered.join(", "));

  // Every registered type either builds a card, or declares itself builder-less
  // on purpose (build: null + cssClass: null) — no silent third state.
  Array.from(T.parser.cardTypeList()).forEach((type) => {
    const entry = T.cards.get(type);
    if (typeof entry.build === "function") {
      assert.ok(entry.cssClass, type + " builds a card, so it needs a cssClass");
    } else {
      assert.strictEqual(entry.build, null, type + " must declare build: null explicitly");
      assert.strictEqual(entry.cssClass, null,
        type + " has no builder, so it must declare cssClass: null (no card element)");
    }
  });

  // sourceitem/sourceenemy are library variants not in cardTypeList but must build too.
  assert.strictEqual(typeof T.cards.builder("sourceitem"), "function");
  assert.strictEqual(typeof T.cards.builder("sourceenemy"), "function");
});

test("every declared accentClass belongs to a real parser card type", () => {
  // Heading accents are stamped from card.type (app.js stampAccentClass) and the
  // class now comes from the registry, so a renamed/typo'd type fails loudly here.
  const accented = T.cards.types().filter((type) => T.cards.accentClass(type));
  assert.ok(accented.length > 0, "no type declares an accentClass");
  const types = new Set(Array.from(T.parser.cardTypeList()));
  const unknown = accented.filter((type) => !types.has(type));
  assert.strictEqual(unknown.length, 0,
    "accentClass declared for types the parser does not classify: " + unknown.join(", "));
});

test("every declared accentClass has a matching h3 rule in base.css", () => {
  // The JS half and the CSS half of an accent are separate files by necessity;
  // this is what keeps them from drifting (declare a class, forget the rule, and
  // the heading silently renders unstyled).
  const css = fs.readFileSync(path.join(ROOT, "src/styles/base.css"), "utf8");
  const missing = T.cards.types()
    .map((type) => T.cards.accentClass(type))
    .filter(Boolean)
    .filter((cls) => !new RegExp("h3\\." + cls + "\\b").test(css));
  assert.strictEqual(missing.length, 0,
    "accent classes with no h3 rule in base.css: " + missing.join(", "));
});

test("narrative: builds a narrative-card and routes Side: R to the right column", () => {
  const card = T.renderCard("narrative", "### Narrative\nSide: R\nText:\n> Read aloud line.\n");
  assert.ok(card, "no card produced");
  assert.ok(card.classList.contains("narrative-card"), "expected .narrative-card");
  assert.ok(card.classList.contains("card-right"), "Side: R should add .card-right");
  assert.match(card.textContent, /Read aloud line\./);
});

test("std: builds an std-card carrying the heading title", () => {
  const card = T.renderCard("std", "### STD: Field Note\nA short standard note.\n");
  assert.ok(card, "no card produced");
  assert.ok(card.classList.contains("std-card"), "expected .std-card");
  assert.match(card.textContent, /Field Note/);
});

test("item: builds an item-card with the item name and meta", () => {
  const card = T.renderCard("item", "### Item: Iron Sword\nType: Weapon\nRarity: 2\n");
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
  const card = T.renderCard(
    "item",
    "### Item: Blade\nSide: R\nType: Weapon\nRarity: 2\nDamage: 1d8 slashing\n\n> A keen blade.\n\nProperties:\n- Sharp\n"
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

test("item: Connect: T marks the card .item-stuck", () => {
  const card = T.renderCard("item", "### Item: Ring\nConnect: T\nType: Wondrous\n");
  assert.ok(card.classList.contains("item-stuck"), "expected .item-stuck");
});

test("ability: label, meta, rarity, properties, lore, description", () => {
  const card = T.renderCard(
    "ability",
    "### Spell: Fireball\nType: Evocation\nCost: 3\nRarity: 3\n\n> A roaring blast.\n\nProperties:\n- Loud\nLore:\n> Ancient flame.\n"
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
  const card = T.renderCard(
    "combat",
    "### Combat: Ambush\nImage: goblin.png\nSide: R\nStat:\n- AC 15 | HP 20\nEnemies:\n- Goblin | AC 15 | HP 7\n- Orc | AC 13 | HP 15\nChecks:\n- Perception:\n> 10: spot them\n"
  );
  assert.ok(card.classList.contains("combat-card"), "expected .combat-card");
  assert.ok(card.classList.contains("card-right"), "Side: R should add .card-right");
  assert.strictEqual(card.querySelectorAll(".enemy-block").length, 2, "expected 2 roster rows");
  assert.ok(card.querySelector(".skillchecks"), "expected a .skillchecks section");
  assert.ok(card.querySelector(".combat-runner"), "expected the live combat runner");
  assert.match(card.textContent, /Ambush/);
});

test("npc: stat row, personality, dialogue subcard, checks, portrait", () => {
  const card = T.renderCard(
    "npc",
    "### NPC: Bob\nImage: bob.png\nRace: Human\nPersonality:\n> Friendly.\nGreeting:\n> Hi there.\nChecks:\n- Insight:\n> 10: he is honest\n"
  );
  assert.ok(card.classList.contains("npc-card"), "expected .npc-card");
  assert.ok(card.querySelector(".npc-stat-row"), "expected a .npc-stat-row (Race)");
  assert.ok(card.querySelector(".npc-subcard"), "expected a dialogue .npc-subcard");
  assert.ok(card.querySelector(".skillchecks"), "expected a Checks .skillchecks");
  assert.match(card.textContent, /Bob/);
});

test("obj: title, checks section, loot panel, BG watermark", () => {
  const card = T.renderCard(
    "obj",
    "### Object: Chest\nBG: chest.png\n> A heavy chest.\nChecks:\n- Investigation:\n> 10: a false bottom\nLoot:\n- 20 gold\n"
  );
  assert.ok(card.classList.contains("obj-card"), "expected .obj-card");
  assert.ok(/Point Of Interest/.test(card.textContent), "expected POI title");
  assert.ok(card.querySelector(".obj-section .skillchecks"), "expected a Checks section");
  assert.ok(card.querySelector(".obj-loot"), "expected a .obj-loot panel");
  assert.ok(/chest\.png/.test(card.getAttribute("style") || ""), "expected --obj-bg watermark");
});

test("skillchecks: card, grid, skill name, category, Side", () => {
  const card = T.renderCard(
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
  const card = T.renderCard("picture", "### Picture: Castle\nImage: castle.png\nSize: 50\nSide: R\n");
  assert.ok(card.classList.contains("picture-card"), "expected .picture-card");
  assert.ok(card.classList.contains("card-right"), "Side: R should add .card-right");
  assert.ok(card.querySelector("img"), "expected an <img>");
  assert.ok(card.querySelector(".picture-caption"), "expected a caption");
  assert.ok(/--pic-width:\s*50%/.test(card.getAttribute("style") || ""), "expected --pic-width: 50%");
});

test("picture: out-of-range Size is ignored (validSize clamp)", () => {
  // 200 is outside the shared 5–100 range, so no --pic-width is set.
  const card = T.renderCard("picture", "### Picture: Castle\nImage: castle.png\nSize: 200\n");
  assert.ok(!/--pic-width/.test(card.getAttribute("style") || ""), "out-of-range Size should not set --pic-width");
});

test("audio: player, caption, Side", () => {
  const card = T.renderCard("audio", "### Audio: Tavern\nFile: tavern\nSide: R\n");
  assert.ok(card.classList.contains("audio-card"), "expected .audio-card");
  assert.ok(card.classList.contains("card-right"), "Side: R should add .card-right");
  assert.ok(card.querySelector("audio"), "expected an <audio> element");
  assert.ok(card.querySelector(".audio-caption"), "expected a caption");
});

test("transition: title, description, enabled Continue button resolving the scene", () => {
  // The builder resolves Scene: against RendScrollApp.campaignEntries at render
  // time; stub the accessor the way app.js exposes it.
  win.RendScrollApp = {
    campaignEntries: () => [
      { file: "3_ambush.md", path: "campaigns/demo/scenes/3_ambush.md", number: 3, label: "The Ambush" },
    ],
    guardedLoad: () => true,
  };
  const card = T.renderCard(
    "transition",
    "### Transition: Take the Pass\nScene: 3_ambush\n> Use when they travel at night.\n"
  );
  delete win.RendScrollApp;
  assert.ok(card.classList.contains("transition-card"), "expected .transition-card");
  assert.match(card.querySelector(".transition-title").textContent, /Take the Pass/);
  assert.match(card.querySelector(".transition-desc").textContent, /travel at night/);
  const btn = card.querySelector(".transition-go");
  assert.ok(btn, "expected the Continue button");
  assert.strictEqual(btn.disabled, false, "button enabled when the scene resolves");
  assert.match(btn.textContent, /The Ambush/);
  assert.ok(!card.querySelector(".transition-warning"), "no warning when resolved");
});

test("transition: unknown scene disables the button and shows a warning", () => {
  const card = T.renderCard(
    "transition",
    "### Transition: Dead End\nScene: 99_missing\n"
  );
  const btn = card.querySelector(".transition-go");
  assert.strictEqual(btn.disabled, true, "button disabled on a broken ref");
  assert.match(card.querySelector(".transition-warning").textContent, /99_missing/);
});

test("std: title + portrait + body", () => {
  const card = T.renderCard("std", "### STD: Arrival\nImage: gate.png\n> You arrive at the gate.\n");
  assert.ok(card.classList.contains("std-card"), "expected .std-card");
  assert.ok(card.querySelector(".std-title"), "expected .std-title");
  assert.match(card.textContent, /Arrival/);
});

test("manifest: no visible title, Duration/Summary rows, Goals/Key NPCs/Rewards lists", () => {
  const card = T.renderCard(
    "manifest",
    "### Manifest\nDuration: 20 min\nSummary: A tense parley.\nGoals:\n- Broker peace\n- Learn the secret\nKey NPCs:\n- Envoy Mara\nRewards:\n- 100 gold\n"
  );
  assert.ok(card, "no card produced");
  assert.ok(card.classList.contains("manifest-card"), "expected .manifest-card");
  assert.equal(card.querySelector(".manifest-title"), null, "manifest title should not render visibly");
  assert.strictEqual(card.querySelectorAll(".manifest-row").length, 2, "expected Duration + Summary rows");
  assert.match(card.textContent, /20 min/);
  assert.match(card.textContent, /A tense parley\./);
  const panels = card.querySelector(".scene-meta-panels");
  assert.ok(panels, "expected a scene meta panel row");
  assert.strictEqual(panels.querySelectorAll(".scene-meta-panel").length, 3, "expected 3 scene meta panels");
  const lists = card.querySelectorAll(".manifest-list");
  assert.strictEqual(lists.length, 3, "expected Goals + Key NPCs + Rewards lists");
  assert.strictEqual(card.querySelector(".manifest-list ul").querySelectorAll("li").length, 2, "expected 2 goals");
  assert.match(card.textContent, /Envoy Mara/);
  assert.match(card.textContent, /100 gold/);
});

test("manifest: empty fields are omitted (Duration only)", () => {
  const card = T.renderCard("manifest", "### Manifest\nDuration: 10 min\n");
  assert.ok(card.classList.contains("manifest-card"), "expected .manifest-card");
  assert.strictEqual(card.querySelectorAll(".manifest-row").length, 1, "only Duration row");
  assert.strictEqual(card.querySelectorAll(".manifest-list").length, 0, "no empty lists");
  assert.strictEqual(card.querySelector(".scene-meta-panels"), null, "no empty panel row");
});

test("unexpected: title + body, Side", () => {
  const card = T.renderCard("unexpected", "### Unexpected: Twist\nSide: R\n- The bridge collapses.\n");
  assert.ok(card.classList.contains("unexpected-card"), "expected .unexpected-card");
  assert.ok(card.classList.contains("card-right"), "Side: R should add .card-right");
  assert.ok(card.querySelector(".unexpected-title"), "expected .unexpected-title");
  assert.match(card.textContent, /Twist/);
});

test("Closed directive: stamped onto the card element for the collapse pass", () => {
  const closed = T.renderCard("std", "### STD: Note\nClosed: T\n> Body.\n");
  assert.strictEqual(closed.dataset.ccDirective, "closed", "Closed: T -> ccDirective closed");
  const open = T.renderCard("std", "### STD: Note\nClosed: F\n> Body.\n");
  assert.strictEqual(open.dataset.ccDirective, "open", "Closed: F -> ccDirective open");
  const none = T.renderCard("std", "### STD: Note\n> Body.\n");
  assert.strictEqual(none.dataset.ccDirective, undefined, "no directive -> unset");
});

test("sourceenemy: renders a roster from a lone enemy block", () => {
  const card = T.renderCard("sourceenemy", "### SourceEnemy: Kate\n- Kate | AC 10 | HP 15\n");
  assert.ok(card.classList.contains("sourceenemy-card"), "expected .sourceenemy-card");
  assert.strictEqual(card.querySelectorAll(".enemy-block").length, 1, "expected 1 roster row");
  assert.match(card.textContent, /Kate/);
});
