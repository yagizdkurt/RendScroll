/* Live combat runner — the DM's at-the-table session for one Combat card.

   Start Combat -> setup (player names + initiative, a d20 box per enemy) ->
   active (turn order + per-instance HP tracking) -> End Combat.

   This is the ONLY file in src/cards/ that touches SessionState: the runner's
   state is per-scene, per-card table state persisted outside the scene markdown
   (campaigns/<Name>/.sys/session.json), not card content. Keeping it here means
   a change to the session schema cannot reach a card builder.

   The order/HP builders below (activePlayers, buildComputedOrder, reconcileOrder,
   buildHpState, buildActiveCombatState) are pure functions over records + saved
   state — see test/combatRunnerModel.test.js.

   Uses combatEl/combatBtn from enemyRoster.js and CombatEnemyModel from
   enemyModel.js; both load before this file. */

function combatSlug(value) {
  return rsLower(String(value || "enemy"))
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "enemy";
}

function recordsWithIds(records) {
  return (records || []).map((record, index) => ({
    id: "enemy:" + combatSlug(record.name || record.ref || "enemy") + ":" + index,
    record,
  }));
}

function playerId(player, index) {
  return "player:" + combatSlug(player.name || "player") + ":" + index;
}

function rollValue(rolls, id) {
  const hit = (rolls || []).find((r) => r && r.id === id);
  return hit ? hit.roll : "";
}

function persistCombat(context, model) {
  if (typeof SessionState === "undefined" || !context || !context.cardId) return;
  SessionState.setCombat(context.scenePath, context.cardId, model);
}

function savedCombat(context) {
  if (typeof SessionState === "undefined" || !context || !context.cardId) return null;
  return SessionState.getCombat(context.scenePath, context.cardId);
}

function renderCombatRunner(runner, records, context) {
  const saved = savedCombat(context);
  if (saved && saved.phase === "active") {
    renderCombatActive(runner, records, context, saved);
  } else if (saved && saved.phase === "setup") {
    renderCombatSetup(runner, records, context, saved);
  } else {
    renderCombatStart(runner, records, context);
  }
}

// Collapsed runner: just the Start Combat button.
function renderCombatStart(runner, records, context) {
  runner.textContent = "";
  const btn = combatBtn("combat-start-btn", "⚔ Start Combat");
  btn.addEventListener("click", () => renderCombatSetup(runner, records, context, null));
  runner.appendChild(btn);
}

function collectSetupModel(players, rollInputs) {
  const playerRows = [...players.querySelectorAll(".combat-player-row")]
    .map((row) => ({
      name: row.querySelector(".cp-name").value.trim(),
      init: row.querySelector(".cp-init").value.trim(),
    }));
  return {
    kind: "combat",
    phase: "setup",
    players: playerRows,
    enemyRolls: rollInputs.map(({ id, input }) => ({ id, roll: input.value.trim() })),
  };
}

function defaultSetupPlayers(saved) {
  const rows = saved && Array.isArray(saved.players) ? saved.players : [];
  return rows.length ? rows : [{}, {}, {}, {}];
}

// Setup view: all inputs at once (players + a roll box for dice-init enemies).
function renderCombatSetup(runner, records, context, saved) {
  runner.textContent = "";
  const setup = combatEl("div", "combat-setup");

  setup.appendChild(combatEl("div", "combat-setup-title", "Players — initiative"));
  const players = combatEl("div", "combat-players");
  setup.appendChild(players);
  const rollInputs = [];

  function saveSetup() {
    persistCombat(context, collectSetupModel(players, rollInputs));
  }

  function addPlayer(values) {
    const row = combatEl("div", "combat-player-row");
    const name = combatEl("input", "cp-name");
    name.type = "text"; name.placeholder = "Player"; name.value = (values && values.name) || "";
    const init = combatEl("input", "cp-init");
    init.type = "text"; init.inputMode = "numeric"; init.placeholder = "Init";
    init.value = values && values.init != null ? String(values.init) : "";
    const rm = combatBtn("combat-mini", "−", "Remove player");
    rm.addEventListener("click", () => { row.remove(); saveSetup(); });
    name.addEventListener("input", saveSetup);
    init.addEventListener("input", saveSetup);
    row.append(name, init, rm);
    players.appendChild(row);
  }
  defaultSetupPlayers(saved).forEach(addPlayer);
  const addP = combatBtn("combat-mini", "+ player");
  addP.addEventListener("click", () => { addPlayer({}); saveSetup(); });
  setup.appendChild(addP);

  // Every enemy needs a d20 roll; the app adds the enemy's initiative modifier.
  const recs = recordsWithIds(records);
  if (recs.length) {
    setup.appendChild(combatEl("div", "combat-setup-title", "Enemy d20 rolls"));
    const eb = combatEl("div", "combat-enemy-rolls");
    recs.forEach(({ id, record }) => {
      const row = combatEl("div", "combat-roll-row");
      const mod = CombatEnemyModel.formatInitMod(record.init);
      row.appendChild(combatEl("span", "cr-name", (record.name || "Enemy") + " (" + mod + ")"));
      const inp = combatEl("input", "cr-roll");
      inp.type = "text"; inp.inputMode = "numeric"; inp.placeholder = "d20";
      const savedRoll = rollValue(saved && saved.enemyRolls, id);
      inp.value = savedRoll != null && savedRoll !== "" ? String(savedRoll) : "";
      inp.addEventListener("input", saveSetup);
      row.appendChild(inp);
      eb.appendChild(row);
      rollInputs.push({ id, input: inp });
    });
    setup.appendChild(eb);
  }

  const begin = combatBtn("combat-start-btn", "Begin Combat");
  begin.addEventListener("click", () => {
    const setupModel = collectSetupModel(players, rollInputs);
    const active = buildActiveCombatState(records, setupModel.players, setupModel.enemyRolls, null);
    persistCombat(context, active);
    renderCombatActive(runner, records, context, active);
  });
  setup.appendChild(begin);

  runner.appendChild(setup);
  saveSetup();
}

function activePlayers(players) {
  return (players || [])
    .map((p) => ({ name: String(p.name || "").trim(), init: parseInt(p.init, 10) || 0 }))
    .filter((p) => p.name);
}

function buildComputedOrder(records, players, rolls) {
  const combatants = [];
  activePlayers(players).forEach((p, index) => {
    combatants.push({ id: playerId(p, index), name: p.name, init: p.init, kind: "player" });
  });
  recordsWithIds(records).forEach(({ id, record }) => {
    const init = (parseInt(rollValue(rolls, id), 10) || 0) + CombatEnemyModel.initMod(record.init);
    const label = record.count > 1 ? (record.name || "Enemy") + " ×" + record.count : (record.name || "Enemy");
    combatants.push({ id, name: label, init, kind: "enemy" });
  });
  combatants.sort((a, b) => b.init - a.init); // ties keep input order (stable sort)
  return combatants;
}

function reconcileOrder(computed, savedOrder) {
  if (!Array.isArray(savedOrder) || !savedOrder.length) return computed;
  const byId = new Map(computed.map((c) => [c.id, c]));
  const out = [];
  savedOrder.forEach((saved) => {
    if (saved && byId.has(saved.id)) {
      out.push(Object.assign({}, byId.get(saved.id), { init: Number(saved.init) || byId.get(saved.id).init }));
      byId.delete(saved.id);
    }
  });
  computed.forEach((c) => { if (byId.has(c.id)) out.push(c); });
  return out;
}

function buildHpState(records, savedHp) {
  const byId = new Map((savedHp || []).map((h) => [h && h.id, h]));
  const rows = [];
  recordsWithIds(records).forEach(({ id, record }) => {
    const maxHp = parseInt(record.hp, 10);
    if (isNaN(maxHp)) return; // no HP -> nothing to track
    const count = Math.max(1, record.count || 1);
    for (let k = 1; k <= count; k++) {
      const instanceId = id + ":" + k;
      const label = count > 1 ? (record.name || "Enemy") + " " + k : (record.name || "Enemy");
      const saved = byId.get(instanceId);
      rows.push({
        id: instanceId,
        name: label,
        cur: saved && Number.isFinite(Number(saved.cur)) ? Number(saved.cur) : maxHp,
        max: saved && Number.isFinite(Number(saved.max)) ? Number(saved.max) : maxHp,
      });
    }
  });
  return rows;
}

function buildActiveCombatState(records, players, rolls, saved) {
  const computed = buildComputedOrder(records, players, rolls);
  return {
    kind: "combat",
    phase: "active",
    players: activePlayers(players),
    enemyRolls: (rolls || []).map((r) => ({ id: r.id, roll: parseInt(r.roll, 10) || 0 })),
    order: reconcileOrder(computed, saved && saved.order),
    hp: buildHpState(records, saved && saved.hp),
  };
}

// Active view: static turn order (players + enemies) + per-instance HP trackers.
function renderCombatActive(runner, records, context, saved) {
  runner.textContent = "";
  const state = buildActiveCombatState(records, saved && saved.players, saved && saved.enemyRolls, saved);

  const order = combatEl("div", "combat-order");
  order.appendChild(combatEl("div", "combat-setup-title", "Turn order"));
  const orderRow = combatEl("div", "combat-order-row");
  state.order.forEach((c) => {
    const boxCls = "combat-order-box " + (c.kind === "player" ? "is-player" : "is-enemy");
    const boxEl = combatEl("div", boxCls);
    boxEl.appendChild(combatEl("span", "co-name", c.name));
    boxEl.appendChild(combatEl("span", "co-init", String(c.init)));
    orderRow.appendChild(boxEl);
  });
  order.appendChild(orderRow);
  runner.appendChild(order);

  const tracker = combatEl("div", "combat-hptracker");
  tracker.appendChild(combatEl("div", "combat-setup-title", "Enemy HP"));
  state.hp.forEach((row) => tracker.appendChild(buildHpRow(row, () => persistCombat(context, state))));
  runner.appendChild(tracker);

  const end = combatBtn("combat-mini combat-end-btn", "End Combat");
  end.addEventListener("click", () => {
    if (typeof SessionState !== "undefined" && context && context.cardId) {
      SessionState.clearCombat(context.scenePath, context.cardId);
    }
    renderCombatStart(runner, records, context);
  });
  runner.appendChild(end);
}

// One HP tracker row. State is {id,name,cur,max}; the hit button applies the
// input via CombatEnemyModel.applyHpInput (N dmg · -N heal · - full heal · _N
// heal+max) and persists the active combat model.
function buildHpRow(state, onChange) {
  const row = combatEl("div", "combat-hp-row");
  const hp = combatEl("span", "ch-hp");
  function paint() {
    hp.textContent = state.cur + "/" + state.max;
    row.classList.toggle("dead", state.cur <= 0);
  }
  const input = combatEl("input", "ch-input");
  input.type = "text"; input.inputMode = "numeric"; input.placeholder = "dmg";
  const hit = combatBtn("combat-hit-btn", "⚔", "N dmg · -N heal · - full heal · _N heal & raise max");
  function apply() {
    const next = CombatEnemyModel.applyHpInput(state, input.value);
    state.cur = next.cur; state.max = next.max;
    input.value = "";
    paint();
    if (typeof onChange === "function") onChange();
    input.focus();
  }
  hit.addEventListener("click", apply);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); apply(); } });
  paint();
  row.append(combatEl("span", "ch-name", state.name), hp, input, hit);
  return row;
}
