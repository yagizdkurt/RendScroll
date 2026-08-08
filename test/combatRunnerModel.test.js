"use strict";

/* The live combat runner's pure model functions (src/cards/combat/combatRunner.js).

   These build the turn order and the HP tracker from parsed enemy records plus
   whatever was restored from SessionState. They had no direct coverage while
   they sat inside the 642-line combat.js next to the card builder; splitting the
   runner out is what made them reachable on their own.

   They are top-level `function` declarations in a classic script, so jsdom does
   expose them on `window` (unlike the `const` IIFE modules, which is why
   readerDom's EXPOSE_GLOBALS exists). */

const { test, before } = require("node:test");
const assert = require("node:assert/strict");
const { bootReader } = require("./helpers/readerDom.js");

let win;

// The functions run inside jsdom, so what they return carries jsdom's prototypes,
// not Node's — assert.deepEqual (strict) rejects that even when the values match.
// Normalize to plain Node values before comparing.
const plain = (value) => JSON.parse(JSON.stringify(value));

before(async () => {
  win = await bootReader({});
});

// A parsed enemy record, as CombatEnemyModel.parseEnemyBlock would produce.
function enemy(name, extra) {
  return Object.assign({ name, ac: "", hp: "", init: "", count: 1, traits: [], attacks: [] }, extra);
}

// --- activePlayers --------------------------------------------------------

test("activePlayers drops unnamed rows and coerces initiative to a number", () => {
  const rows = [
    { name: "  Aria ", init: "18" },
    { name: "", init: "20" },        // an empty player row the DM never filled in
    { name: "Brann", init: "" },     // no roll yet
    { name: "Cyn", init: "not a number" },
  ];
  assert.deepEqual(plain(win.activePlayers(rows)), [
    { name: "Aria", init: 18 },
    { name: "Brann", init: 0 },
    { name: "Cyn", init: 0 },
  ]);
});

test("activePlayers tolerates a missing list", () => {
  assert.deepEqual(plain(win.activePlayers(null)), []);
  assert.deepEqual(plain(win.activePlayers(undefined)), []);
});

// --- buildComputedOrder ---------------------------------------------------

test("buildComputedOrder sorts players and enemies together, highest initiative first", () => {
  const records = [enemy("Goblin", { init: "+2" })];
  const [{ id }] = win.recordsWithIds(records);

  const order = win.buildComputedOrder(
    records, [{ name: "Aria", init: "20" }], [{ id, roll: "15" }]);
  assert.deepEqual(plain(order.map((c) => [c.name, c.init, c.kind])), [
    ["Aria", 20, "player"],
    ["Goblin", 17, "enemy"], // d20 15 + init mod 2
  ]);
});

test("buildComputedOrder adds the enemy's initiative modifier to its d20 roll", () => {
  const records = [enemy("Ogre", { init: "-1" })];
  const [{ id }] = win.recordsWithIds(records);
  assert.equal(win.buildComputedOrder(records, [], [{ id, roll: "10" }])[0].init, 9);
});

test("buildComputedOrder treats a missing roll as 0", () => {
  assert.equal(win.buildComputedOrder([enemy("Ogre", { init: "+3" })], [], [])[0].init, 3);
});

test("buildComputedOrder keeps input order on an initiative tie (stable sort)", () => {
  const players = [{ name: "Aria", init: "12" }, { name: "Brann", init: "12" }];
  const order = win.buildComputedOrder([], players, []);
  assert.deepEqual(plain(order.map((c) => c.name)), ["Aria", "Brann"]);
});

test("buildComputedOrder labels a grouped enemy with its count", () => {
  const order = win.buildComputedOrder([enemy("Goblin", { init: "+0", count: 3 })], [], []);
  assert.equal(order[0].name, "Goblin ×3");
});

// --- reconcileOrder -------------------------------------------------------

const ARIA = { id: "a", name: "Aria", init: 20, kind: "player" };
const BRANN = { id: "b", name: "Brann", init: 10, kind: "player" };

test("reconcileOrder keeps a saved order the DM rearranged", () => {
  const out = win.reconcileOrder([ARIA, BRANN], [{ id: "b", init: 10 }, { id: "a", init: 20 }]);
  assert.deepEqual(plain(out.map((c) => c.id)), ["b", "a"]);
});

test("reconcileOrder appends combatants the saved order never saw", () => {
  const late = { id: "new", name: "Late", init: 99, kind: "player" };
  const out = win.reconcileOrder([ARIA, late], [{ id: "a", init: 20 }]);
  assert.deepEqual(plain(out.map((c) => c.id)), ["a", "new"]);
});

test("reconcileOrder drops saved combatants that no longer exist", () => {
  const out = win.reconcileOrder([ARIA], [{ id: "gone", init: 5 }, { id: "a", init: 20 }]);
  assert.deepEqual(plain(out.map((c) => c.id)), ["a"]);
});

test("reconcileOrder falls back to the computed order when nothing was saved", () => {
  assert.deepEqual(plain(win.reconcileOrder([ARIA], null)), [ARIA]);
  assert.deepEqual(plain(win.reconcileOrder([ARIA], [])), [ARIA]);
});

test("reconcileOrder restores the saved initiative over the recomputed one", () => {
  // The DM can edit a value; a re-render must not silently undo that.
  assert.equal(win.reconcileOrder([ARIA], [{ id: "a", init: 3 }])[0].init, 3);
});

// --- buildHpState ---------------------------------------------------------

test("buildHpState makes one tracked row per instance of a grouped enemy", () => {
  const rows = win.buildHpState([enemy("Goblin", { hp: "7", count: 3 })], null);
  assert.deepEqual(plain(rows.map((r) => [r.name, r.cur, r.max])), [
    ["Goblin 1", 7, 7],
    ["Goblin 2", 7, 7],
    ["Goblin 3", 7, 7],
  ]);
});

test("buildHpState leaves a single enemy unnumbered", () => {
  const rows = win.buildHpState([enemy("Ogre", { hp: "30" })], null);
  assert.deepEqual(plain(rows.map((r) => r.name)), ["Ogre"]);
});

test("buildHpState skips enemies with no numeric HP — nothing to track", () => {
  const records = [enemy("Ghost", { hp: "" }), enemy("Ogre", { hp: "30" }), enemy("Mist", { hp: "lots" })];
  assert.deepEqual(plain(win.buildHpState(records, null).map((r) => r.name)), ["Ogre"]);
});

test("buildHpState restores saved current/max HP by instance id", () => {
  const records = [enemy("Goblin", { hp: "7", count: 2 })];
  const fresh = win.buildHpState(records, null);
  const rows = win.buildHpState(records, [{ id: fresh[1].id, cur: 2, max: 9 }]);
  assert.deepEqual(plain(rows.map((r) => [r.cur, r.max])), [[7, 7], [2, 9]]);
});

test("buildHpState keeps a restored 0 HP instead of resetting it to max", () => {
  const records = [enemy("Goblin", { hp: "7" })];
  const [row] = win.buildHpState(records, null);
  assert.equal(win.buildHpState(records, [{ id: row.id, cur: 0, max: 7 }])[0].cur, 0);
});

// --- buildActiveCombatState ----------------------------------------------

test("buildActiveCombatState assembles the persisted shape", () => {
  const records = [enemy("Goblin", { hp: "7", init: "+2" })];
  const [{ id }] = win.recordsWithIds(records);
  const state = plain(win.buildActiveCombatState(
    records, [{ name: "Aria", init: "18" }], [{ id, roll: "11" }], null));

  assert.equal(state.kind, "combat");
  assert.equal(state.phase, "active");
  assert.deepEqual(state.players, [{ name: "Aria", init: 18 }]);
  assert.deepEqual(state.enemyRolls, [{ id, roll: 11 }]);
  assert.deepEqual(state.order.map((c) => c.name), ["Aria", "Goblin"]);
  assert.deepEqual(state.hp.map((r) => r.name), ["Goblin"]);
});

// --- ids ------------------------------------------------------------------

test("recordsWithIds gives each record a slugged, index-suffixed id", () => {
  const ids = win.recordsWithIds([enemy("Dire Wolf"), enemy("Dire Wolf")]).map((r) => r.id);
  assert.deepEqual(plain(ids), ["enemy:dire-wolf:0", "enemy:dire-wolf:1"]);
  assert.equal(new Set(ids).size, 2, "same-named records must still get distinct ids");
});

// --- roster-side pure helpers --------------------------------------------

test("formatAttackHit adds a + to a bare number and strips 'to hit'", () => {
  assert.equal(win.formatAttackHit("5"), "+5");
  assert.equal(win.formatAttackHit("+5"), "+5");
  assert.equal(win.formatAttackHit("5 to hit"), "+5");
  assert.equal(win.formatAttackHit(""), "");
});

test("tacticRules flattens bullets and drops a leading 'Tactics:' label", () => {
  assert.deepEqual(
    plain(win.tacticRules(["Tactics:", "- Flank the weakest", "- Flee below 5 HP"])),
    ["Flank the weakest", "Flee below 5 HP"]);
  assert.deepEqual(
    plain(win.tacticRules(["Tactics: Flank first", "- Then flee"])),
    ["Flank first", "Then flee"]);
  assert.deepEqual(plain(win.tacticRules([])), []);
});
