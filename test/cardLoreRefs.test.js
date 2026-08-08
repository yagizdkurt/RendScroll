/* Lore chips on cards — the "LoreRef:" directive, end to end through the REAL
   render path: renderCardFromSource stamps the card, enhanceCardCollapse builds the
   head, cardLoreRefs.js puts the chips in it.

   The click behaviour itself is NOT re-tested here: a chip is an .rs-ref-link with a
   "lore:Page/Entry" data-ref-name, which is exactly what src/app/refNavigation.js
   already handles for inline [link=lore:…]. These tests pin that contract instead. */

const { test, before } = require("node:test");
const assert = require("node:assert");
const { bootReader } = require("./helpers/readerDom.js");

const LORE_SOURCE = [
  "# Lore: The Gate",
  "",
  "## Entry: Ancient God",
  "",
  "Once worshipped beneath the gate.",
  "",
  "## Entry: The Fall",
  "",
  "It ended in ash.",
  "",
].join("\n");

let win;

// Stand in for the loaded library: one lore page with two entries.
function installRefLibrary(w) {
  w.eval(`
    window.RefLibrary = {
      lookup(type, name) {
        if (type !== "lore") return null;
        const key = String(name || "").trim().toLowerCase();
        return key === "the gate"
          ? { name: "The Gate", path: "campaigns/T/lore/The Gate.md", source: ${JSON.stringify(LORE_SOURCE)} }
          : null;
      },
    };
  `);
}

// Render one card and run the same two passes renderPage runs, in the same order.
function renderCard(type, src) {
  const { cardEl } = win.renderCardFromSource(type, src);
  const host = win.document.getElementById("page");
  host.innerHTML = "";
  if (cardEl) host.appendChild(cardEl);
  win.eval("enhanceCardCollapse(document.getElementById('page'));");
  win.enhanceLoreRefs(host);
  return cardEl;
}

const chipsOf = (cardEl) => [...cardEl.querySelectorAll(".lore-ref-chip")];

before(async () => {
  win = await bootReader({});
  installRefLibrary(win);
});

test("each LoreRef: line becomes one chip, labelled with the entry name", () => {
  const card = renderCard("obj",
    "### POI: The Sunken Door\nLoreRef: The Gate/Ancient God\nLoreRef: The Gate/The Fall\n> A door.\n");
  const chips = chipsOf(card);
  assert.deepStrictEqual(chips.map((c) => c.textContent), ["Ancient God", "The Fall"]);
  assert.strictEqual(chips[0].title, "Lore: The Gate / Ancient God");
});

test("a chip is an rs-ref-link carrying the lore address the reader already resolves", () => {
  const card = renderCard("npc", "### NPC: Warden\nLoreRef: The Gate/Ancient God\n");
  const chip = chipsOf(card)[0];
  assert.ok(chip.classList.contains("rs-ref-link"),
    "the chip must reuse the inline-link click/keyboard path");
  // Lowercased like inlineFormatting.js writes it; lore resolves case-insensitively.
  assert.strictEqual(chip.dataset.refName, "lore:the gate/ancient god");
  assert.strictEqual(chip.getAttribute("role"), "link");
  assert.strictEqual(chip.tabIndex, 0);
});

test("a page-level reference (no entry) is allowed and labelled with the page", () => {
  const card = renderCard("combat", "### Combat: Ambush\nLoreRef: The Gate\n");
  const chip = chipsOf(card)[0];
  assert.strictEqual(chip.textContent, "The Gate");
  assert.strictEqual(chip.dataset.refName, "lore:the gate");
  assert.ok(!chip.classList.contains("is-broken"));
});

test("a reference to a missing page or entry is marked broken, never dropped", () => {
  const card = renderCard("obj",
    "### POI: Door\nLoreRef: The Gate/Nobody\nLoreRef: No Such Page/Entry\nLoreRef: The Gate/The Fall\n");
  const chips = chipsOf(card);
  assert.strictEqual(chips.length, 3, "a broken reference is still shown");
  assert.ok(chips[0].classList.contains("is-broken"));
  assert.match(chips[0].title, /no longer exists/);
  assert.ok(chips[1].classList.contains("is-broken"));
  assert.ok(!chips[2].classList.contains("is-broken"));
});

test("the chips live inside the card head, so a collapsed card still shows them", () => {
  const card = renderCard("obj", "### POI: Door\nLoreRef: The Gate/Ancient God\nClosed: T\n");
  const row = card.querySelector(".card-lore-refs");
  assert.ok(row, "expected a chip row");
  assert.ok(row.parentElement.classList.contains("card-head"),
    "chips outside .card-head are hidden by the collapse rule");
  assert.ok(card.classList.contains("is-collapsed"), "sanity: the card starts collapsed");
});

test("with a portrait the chips go beside the title, not after the image", () => {
  // An Image: makes the head the .card-figure row (title column + portrait).
  const card = renderCard("obj", "### POI: Door\nImage: door.png\nLoreRef: The Gate/Ancient God\n");
  const head = card.querySelector(":scope > .card-head");
  assert.ok(head.classList.contains("card-figure"), "sanity: the figure is the head");
  const row = card.querySelector(".card-lore-refs");
  assert.ok(row.parentElement.classList.contains("card-figure-main"),
    "expected the chips in the figure's text column");
});

test("the pass is idempotent — running it twice adds no second row", () => {
  const card = renderCard("obj", "### POI: Door\nLoreRef: The Gate/Ancient God\n");
  win.enhanceLoreRefs(win.document.getElementById("page"));
  assert.strictEqual(card.querySelectorAll(".card-lore-refs").length, 1);
  assert.strictEqual(chipsOf(card).length, 1);
});

test("a type that did not opt in renders no chips", () => {
  // unexpected has a title bar but is deliberately excluded (registry loreRefs flag).
  const card = renderCard("unexpected", "### Unexpected: Cave-in\nLoreRef: The Gate/Ancient God\n");
  assert.strictEqual(card.dataset.loreRefs, undefined, "the card must not be stamped");
  assert.strictEqual(chipsOf(card).length, 0);
});

test("LoreRef: never leaks into the rendered card body", () => {
  const obj = renderCard("obj", "### POI: Door\nLoreRef: The Gate/Ancient God\n> A door.\n");
  assert.doesNotMatch(obj.textContent, /LoreRef/);

  // Item rebuilds its body from cardBodySource, which re-injects directive lines —
  // its control-line filter has to know the directive too.
  const item = renderCard("item", "### Item: Rope\nType: Gear\nLoreRef: The Gate/Ancient God\n");
  assert.doesNotMatch(item.textContent, /LoreRef/);
  assert.strictEqual(chipsOf(item).length, 1);

  // Ability keeps its own bare "Lore:" read-aloud panel — the whole reason the
  // directive is a separate word.
  const ability = renderCard("ability",
    "### Spell: Fireball\nLoreRef: The Gate/Ancient God\nLore:\n> Found in the ash.\n");
  assert.doesNotMatch(ability.textContent, /LoreRef/);
  assert.strictEqual(chipsOf(ability).length, 1);
  assert.ok(ability.querySelector(".ability-lore"), "the Lore: panel must survive");
  assert.match(ability.textContent, /Found in the ash\./);
});
