"use strict";

const { test, before, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { bootReader } = require("./helpers/readerDom.js");

const SCENE = [
  "# Scene",
  "",
  "### Combat: Ambush",
  "Enemies:",
  "- Goblin | AC 15 | HP 7 | Init +2 | x2",
  "",
].join("\n");

let win;
let store;

before(async () => {
  win = await bootReader({ withApp: true });
});

beforeEach(() => {
  store = {};
  win.SessionState.getCombat = (_scenePath, cardId) => store[cardId] || null;
  win.SessionState.setCombat = (_scenePath, cardId, value) => {
    store[cardId] = JSON.parse(JSON.stringify(value));
  };
  win.SessionState.clearCombat = (_scenePath, cardId) => {
    delete store[cardId];
  };
});

function render(src = SCENE) {
  win.renderPage(src);
  return win.document.getElementById("page");
}

function inputValue(el, value) {
  el.value = value;
  el.dispatchEvent(new win.Event("input", { bubbles: true }));
}

test("renderPage stamps stable card ids with deterministic duplicate suffixes", () => {
  const page = render([
    "# Scene",
    "",
    "### Combat: Ambush",
    "Enemies:",
    "- Goblin | HP 7",
    "",
    "### Combat: Ambush",
    "Enemies:",
    "- Orc | HP 15",
    "",
  ].join("\n"));

  const ids = [...page.querySelectorAll(".combat-card")].map((el) => el.dataset.cardId);
  assert.deepEqual(ids, ["combat:ambush", "combat:ambush-2"]);
});

test("combat setup survives renderPage re-render", () => {
  let page = render();
  page.querySelector(".combat-start-btn").click();

  const firstPlayer = page.querySelector(".combat-player-row");
  inputValue(firstPlayer.querySelector(".cp-name"), "Ava");
  inputValue(firstPlayer.querySelector(".cp-init"), "17");
  inputValue(page.querySelector(".cr-roll"), "12");

  assert.equal(store["combat:ambush"].phase, "setup");
  assert.equal(store["combat:ambush"].players[0].name, "Ava");
  assert.equal(store["combat:ambush"].enemyRolls[0].roll, "12");

  page = render();
  assert.equal(page.querySelector(".cp-name").value, "Ava");
  assert.equal(page.querySelector(".cp-init").value, "17");
  assert.equal(page.querySelector(".cr-roll").value, "12");
});

test("active combat order and HP survive renderPage re-render", () => {
  let page = render();
  page.querySelector(".combat-start-btn").click();

  const firstPlayer = page.querySelector(".combat-player-row");
  inputValue(firstPlayer.querySelector(".cp-name"), "Ava");
  inputValue(firstPlayer.querySelector(".cp-init"), "17");
  inputValue(page.querySelector(".cr-roll"), "12");
  page.querySelector(".combat-start-btn").click();

  assert.equal(store["combat:ambush"].phase, "active");
  assert.deepEqual(
    store["combat:ambush"].order.map((c) => [c.kind, c.name, c.init]),
    [["player", "Ava", 17], ["enemy", "Goblin ×2", 14]]
  );

  const firstHp = page.querySelector(".combat-hp-row");
  inputValue(firstHp.querySelector(".ch-input"), "3");
  firstHp.querySelector(".combat-hit-btn").click();
  assert.equal(store["combat:ambush"].hp[0].cur, 4);

  page = render();
  assert.match(page.querySelector(".combat-order").textContent, /Ava/);
  assert.equal(page.querySelector(".combat-hp-row .ch-hp").textContent, "4/7");
});

test("End Combat clears saved combat state", () => {
  store["combat:ambush"] = {
    kind: "combat",
    phase: "active",
    players: [{ name: "Ava", init: 17 }],
    enemyRolls: [{ id: "enemy:goblin:0", roll: 12 }],
    order: [],
    hp: [{ id: "enemy:goblin:0:1", name: "Goblin 1", cur: 4, max: 7 }],
  };

  const page = render();
  page.querySelector(".combat-end-btn").click();

  assert.equal(store["combat:ambush"], undefined);
  assert.ok(page.querySelector(".combat-start-btn"));
});

test("active combat reconcile drops removed enemy instances without crashing", () => {
  store["combat:ambush"] = {
    kind: "combat",
    phase: "active",
    players: [],
    enemyRolls: [{ id: "enemy:goblin:0", roll: 10 }],
    order: [{ id: "enemy:goblin:0", kind: "enemy", name: "Goblin ×2", init: 12 }],
    hp: [
      { id: "enemy:goblin:0:1", name: "Goblin 1", cur: 4, max: 7 },
      { id: "enemy:goblin:0:2", name: "Goblin 2", cur: 2, max: 7 },
    ],
  };

  const page = render([
    "# Scene",
    "",
    "### Combat: Ambush",
    "Enemies:",
    "- Goblin | AC 15 | HP 7 | Init +2",
    "",
  ].join("\n"));

  assert.equal(page.querySelectorAll(".combat-hp-row").length, 1);
  assert.equal(page.querySelector(".combat-hp-row .ch-hp").textContent, "4/7");
});
