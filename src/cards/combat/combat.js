/* Combat (Savaş) section renderer.
   Receives a root DOM element and modifies ONLY Savaş sections in the DOM.
   It never fetches files and never touches the sidebar.

   A Savaş block is written as:

     ### Savaş: İsim
     `DM notu (read-aloud değil, kenar notu)`     (optional)
     Stat:
     - AC 16 | HP 80 | Hız 30 ft.
     - Atak: ...
     Taktik:
     - ...
     Özel Mekanik:          (any "Label:" line opens a new titled sub-section)
     - ...

   Layout produced (a single .combat-card):
     - title
     - leading "> ..." blocks   -> read-aloud DM blocks
     - inline-code lines         -> DM side notes (kept as-is)
     - each "Label:" line         -> a titled sub-section header, with the list /
                                     content that follows grouped under it

   The card renders in the left column by default; a "Side: R" line moves it to
   the right column. */

// True only for a combat heading (colon form).
function isCombatHead(h) {
  return /^\s*(sava[şs]|combat)\s*:/.test(rsLower(h.textContent).trim());
}

// A bare "Label:" line (letters/spaces only, ending in a colon) opens a combat
// sub-section. Canonical regex lives in the parser; reuse it so the rule is not
// restated. Read-aloud (">") and list ("-") lines never match.
function combatLabelText(line) {
  const t = String(line).trim();
  return RendScrollParser.regexes.COMBAT_LABEL_RE.test(t) ? t.replace(/\s*:\s*$/, "") : "";
}

function combatSectionTitle(text) {
  const el = document.createElement("div");
  el.className = "combat-section-title";
  el.textContent = text;
  return el;
}

// Pure per-type body parser: AST card node -> ordered combat segments. Walks the
// body in source order (cardOrderedBody), classifying each line as a "Checks:"
// group, a bare "Label:" that opens a sub-section (an "Enemies:" roster collects
// the bullet lines that follow it; any other label is a plain titled section), or a
// content run. The builder maps segments to DOM + expands/renders enemies; keeping
// the classification here as one named function mirrors the shared-parse discipline.
//   { kind: "checks",  label, checks }
//   { kind: "enemies", label, lines }   bullet lines feeding the roster
//   { kind: "section", label }          any other "Label:" sub-section
//   { kind: "lines",   lines }          a contiguous content run
function parseCombatBody(cardNode) {
  const segs = [];
  let enemyTarget = null;
  cardOrderedBody(cardNode).forEach((seg) => {
    if (seg.kind === "checks") {
      segs.push({ kind: "checks", label: seg.label || "Checks", checks: seg.checks });
      enemyTarget = null;
      return;
    }
    seg.lines.forEach((line) => {
      const label = combatLabelText(line);
      if (label) {
        if (rsLower(label).trim() === "enemies") {
          enemyTarget = { kind: "enemies", label, lines: [] };
          segs.push(enemyTarget);
        } else {
          segs.push({ kind: "section", label });
          enemyTarget = null;
        }
        return;
      }
      if (enemyTarget) { if (line.trim()) enemyTarget.lines.push(line); return; }
      const last = segs[segs.length - 1];
      if (last && last.kind === "lines") last.lines.push(line);
      else segs.push({ kind: "lines", lines: [line] });
    });
  });
  return segs;
}

// Build one Savaş card from its parsed AST node. Image/Side come from the resolved
// directives; the Checks / Enemies / sub-section / content segments come from the
// shared parseCombatBody.
function buildCombatCard(cardNode, head, nodes) {
    const card = document.createElement("div");
    card.className = "combat-card";

    const title = document.createElement("div");
    title.className = "combat-title";
    title.textContent = head.textContent.trim().replace(/^\s*(sava[şs]|combat)\s*:\s*/i, "").trim();

    // Header = title + leading content (before the first "Label:" section),
    // placed beside the portrait when an Image is given; sections flow below.
    const headEls = [title];
    const imageRaw = cardDirective(cardNode, "image").trim();
    if (cardIsRight(cardNode)) card.classList.add("card-right");

    let headOpen = true;        // leading content goes beside the portrait
    const enemyRecords = [];    // structured enemies powering roster + live runner

    parseCombatBody(cardNode).forEach((seg) => {
      if (seg.kind === "checks") {
        // "Checks:" renders identically to the Skill Checks panel (and Obje's).
        headOpen = false;
        const section = document.createElement("div");
        section.className = "combat-section";
        section.appendChild(combatSectionTitle(seg.label));
        const box = document.createElement("div");
        box.className = "skillchecks";
        renderSkillChecks(box, seg.checks);
        section.appendChild(box);
        card.appendChild(section);
        return;
      }
      if (seg.kind === "enemies") {
        headOpen = false;
        const section = document.createElement("div");
        section.className = "combat-section";
        section.appendChild(combatSectionTitle(seg.label));
        const rosterBox = document.createElement("div");
        rosterBox.className = "combat-roster";
        section.appendChild(rosterBox);
        card.appendChild(section);
        const recs = CombatEnemyModel.expandEnemies(
          CombatEnemyModel.parseEnemyBlock(seg.lines), enemySourceResolver);
        recs.forEach((r) => enemyRecords.push(r));
        renderCombatRoster(rosterBox, recs);
        return;
      }
      if (seg.kind === "section") {
        headOpen = false;
        card.appendChild(combatSectionTitle(seg.label));
        return;
      }
      const tmp = document.createElement("div");
      tmp.innerHTML = renderMarkdown(seg.lines.join("\n"));
      [...tmp.children].forEach((el) => {
        const node = cloneAsReadAloud(el);
        if (headOpen) headEls.push(node); // leading content stays beside portrait
        else card.appendChild(node);
      });
    });

    // When the card defines enemies, attach the live combat runner (Start Combat
    // -> initiative/turn order -> per-enemy HP tracking). State is ephemeral.
    if (enemyRecords.length) {
      const runner = document.createElement("div");
      runner.className = "combat-runner";
      card.appendChild(runner);
      renderCombatStart(runner, enemyRecords);
    }

    // Place the header at the top: wrapped beside the portrait when an Image was
    // given, otherwise as plain stacked elements (no empty portrait reserved).
    insertCardHeader(card, headEls, imageRaw);

    return card;
}

/* ---------- Structured enemy roster + live combat runner ---------- */

// Small DOM helpers, local to combat (mirror the editor's el()/button()).
function combatEl(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
function combatBtn(cls, text, title) {
  const b = combatEl("button", cls, text);
  b.type = "button";
  if (title) b.title = title;
  return b;
}

// Resolve a live "[enemy=Name]" combat reference to its library source record.
// Returns null (-> a "(missing)" placeholder) when the library isn't loaded or
// the file is absent. Mirrors app.js's itemSourceResolver for items.
function enemySourceResolver(name) {
  if (typeof RefLibrary === "undefined") return null;
  const entry = RefLibrary.lookup("enemy", name);
  return entry ? CombatEnemyModel.parseSourceEnemy(entry.source) : null;
}

// A standalone library enemy (Enemies/Name.md, "### SourceEnemy:"): render the
// lone enemy as a stat block, reusing the combat roster. No live runner — this is
// a reference view, identical in look to one enemy inside a combat card. The lone
// enemy block is the card body, parsed straight from source via parseEnemyBlock.
function buildSourceEnemyCard(cardNode, head, nodes) {
  const card = document.createElement("div");
  card.className = "combat-card sourceenemy-card";
  const recs = CombatEnemyModel.parseEnemyBlock(cardBodyLines(cardNode));
  const box = combatEl("div", "combat-roster");
  renderCombatRoster(box, recs.length ? recs : [CombatEnemyModel.blankEnemy()]);
  card.appendChild(box);
  return card;
}

// A small uppercase-labelled section wrapper (ATTACK / TRAITS / DEFENSES / …).
function enemySection(label) {
  const sec = combatEl("div", "enemy-section");
  sec.appendChild(combatEl("div", "enemy-section-label", label));
  return sec;
}

function enemyBadge(label, value, cls) {
  const badge = combatEl("span", "ebadge " + cls);
  badge.appendChild(combatEl("span", "ebadge-label", label));
  badge.appendChild(combatEl("span", "ebadge-value", value));
  return badge;
}

function enemyDetailCard(label) {
  const card = combatEl("div", "enemy-detail-card");
  card.appendChild(combatEl("div", "enemy-detail-label", label));
  return card;
}

function formatAttackHit(hit) {
  const t = (hit || "").trim().replace(/\s*\bto hit\b\s*$/i, "").trim();
  return /^\d+$/.test(t) ? "+" + t : t;
}

function formatAttackDamage(damage) {
  const t = (damage || "").trim();
  return t && !/\bdamage\b/i.test(t) ? t + " damage" : t;
}

// Render an attack's damage through the shared renderer. The "attack-" prefix
// reproduces the combat-specific classes (attack-damage-term, attack-die-icon,
// …) so combat.css and the output are unchanged; the fallback keeps the legacy
// "… damage" wording.
function appendAttackDamage(parent, damage) {
  renderDamage(parent, damage, { prefix: "attack-", fallback: formatAttackDamage });
}

function tacticRules(tactics) {
  const rules = [];
  (tactics || []).forEach((raw) => {
    String(raw || "").split(/\r?\n/).forEach((line) => {
      const t = line.trim().replace(/^[-*]\s+/, "").trim();
      if (t) rules.push(t);
    });
  });
  if (rules.length && /^(taktik|tactics?)\s*:?\s*$/i.test(rules[0])) rules.shift();
  if (rules.length) rules[0] = rules[0].replace(/^(taktik|tactics?)\s*:\s*/i, "").trim();
  return rules;
}

// Render each enemy as a tabletop stat card: identity first, combat badges next,
// then the traits/attack row, tactics, and compact lower-priority details.
function renderCombatRoster(box, recs) {
  box.textContent = "";
  recs.forEach((r) => {
    const block = combatEl("div", "enemy-block");

    // --- header: identity + stat badges ---
    const head = combatEl("div", "enemy-head");
    const id = combatEl("div", "enemy-id");
    id.appendChild(combatEl("div", "enemy-name", r.name || "Enemy"));
    if ((r.subtitle || "").trim()) id.appendChild(combatEl("div", "enemy-sub", r.subtitle.trim()));
    head.appendChild(id);

    const badges = combatEl("div", "enemy-badges");
    if ((r.ac || "").toString().trim()) badges.appendChild(enemyBadge("AC", r.ac, "ebadge-ac"));
    if ((r.hp || "").toString().trim()) badges.appendChild(enemyBadge("HP", r.hp, "ebadge-hp"));
    if ((r.init || "").toString().trim())
      badges.appendChild(enemyBadge("INIT", CombatEnemyModel.formatInitMod(r.init), "ebadge-init"));
    if (r.count > 1) badges.appendChild(combatEl("span", "ebadge ebadge-count", "×" + r.count));
    head.appendChild(badges);
    block.appendChild(head);

    // --- top row: traits on the left, attacks on the right ---
    const topRow = combatEl("div", "enemy-top-row");

    const traitsSec = enemySection("Traits");
    traitsSec.classList.add("enemy-traits-section");
    if ((r.traits || []).length) {
      const ul = combatEl("ul", "enemy-traits");
      r.traits.forEach((t) => ul.appendChild(combatEl("li", null, t)));
      traitsSec.appendChild(ul);
    } else {
      traitsSec.appendChild(combatEl("div", "enemy-empty-note", "No traits"));
    }
    topRow.appendChild(traitsSec);

    const attackSec = enemySection("Attacks");
    attackSec.classList.add("enemy-attack-section");
    if ((r.attacks || []).length) {
      r.attacks.forEach((a) => {
        const card = combatEl("div", "attack-card");
        const cardHead = combatEl("div", "attack-card-head");
        cardHead.appendChild(combatEl("span", "attack-name", a.name || "Attack"));
        const hit = formatAttackHit(a.hit);
        if (hit) cardHead.appendChild(combatEl("span", "attack-hit", hit));
        card.appendChild(cardHead);
        if ((a.damage || "").trim()) {
          const damageRow = combatEl("div", "attack-damage-row");
          appendAttackDamage(damageRow, a.damage);
          card.appendChild(damageRow);
        }
        attackSec.appendChild(card);
      });
    } else {
      attackSec.appendChild(combatEl("div", "enemy-empty-note", "No attack"));
    }
    topRow.appendChild(attackSec);
    block.appendChild(topRow);

    // --- tactics: DM behavior rules ---
    const rules = tacticRules(r.tactics);
    if (rules.length) {
      const sec = enemySection("Tactics");
      sec.classList.add("tactics-box");
      const list = combatEl("ul", "tactics-list");
      rules.forEach((t) => list.appendChild(combatEl("li", null, t)));
      sec.appendChild(list);
      block.appendChild(sec);
    }

    // --- bottom row: defenses, future placeholder, extras ---
    const bottomRow = combatEl("div", "enemy-bottom-row");
    const defenses = [
      ["Weak Save", r.weakSave],
      ["Strong Save", r.strongSave],
      ["Resistances", r.resist],
      ["Immunities", r.immune],
    ].filter(([, v]) => (v || "").trim());
    const defenseCard = enemyDetailCard("Defenses");
    if (defenses.length) {
      defenses.forEach(([label, val]) => {
        const cell = combatEl("div", "enemy-def");
        cell.appendChild(combatEl("span", "ed-label", label));
        cell.appendChild(combatEl("span", "ed-val", val.trim()));
        defenseCard.appendChild(cell);
      });
    } else {
      defenseCard.appendChild(combatEl("div", "enemy-empty-note", "None"));
    }
    bottomRow.appendChild(defenseCard);

    const futureCard = enemyDetailCard("");
    futureCard.classList.add("enemy-future-card");
    bottomRow.appendChild(futureCard);

    const extrasCard = enemyDetailCard("Extras");
    if ((r.speed || "").toString().trim()) {
      const cell = combatEl("div", "enemy-def");
      cell.appendChild(combatEl("span", "ed-label", "Movement"));
      cell.appendChild(combatEl("span", "ed-val", r.speed.trim()));
      extrasCard.appendChild(cell);
    } else {
      extrasCard.appendChild(combatEl("div", "enemy-empty-note", "None"));
    }
    bottomRow.appendChild(extrasCard);
    block.appendChild(bottomRow);

    box.appendChild(block);
  });
}

// Collapsed runner: just the Start Combat button.
function renderCombatStart(runner, records) {
  runner.textContent = "";
  const btn = combatBtn("combat-start-btn", "⚔ Start Combat");
  btn.addEventListener("click", () => renderCombatSetup(runner, records));
  runner.appendChild(btn);
}

// Setup view: all inputs at once (players + a roll box for dice-init enemies).
function renderCombatSetup(runner, records) {
  runner.textContent = "";
  const setup = combatEl("div", "combat-setup");

  setup.appendChild(combatEl("div", "combat-setup-title", "Players — initiative"));
  const players = combatEl("div", "combat-players");
  setup.appendChild(players);
  function addPlayer() {
    const row = combatEl("div", "combat-player-row");
    const name = combatEl("input", "cp-name");
    name.type = "text"; name.placeholder = "Player";
    const init = combatEl("input", "cp-init");
    init.type = "text"; init.inputMode = "numeric"; init.placeholder = "Init";
    const rm = combatBtn("combat-mini", "−", "Remove player");
    rm.addEventListener("click", () => row.remove());
    row.append(name, init, rm);
    players.appendChild(row);
  }
  for (let i = 0; i < 4; i++) addPlayer();
  const addP = combatBtn("combat-mini", "+ player");
  addP.addEventListener("click", addPlayer);
  setup.appendChild(addP);

  // Every enemy needs a d20 roll; the app adds the enemy's initiative modifier.
  const rollInputs = [];
  if (records.length) {
    setup.appendChild(combatEl("div", "combat-setup-title", "Enemy d20 rolls"));
    const eb = combatEl("div", "combat-enemy-rolls");
    records.forEach((r) => {
      const row = combatEl("div", "combat-roll-row");
      const mod = CombatEnemyModel.formatInitMod(r.init);
      row.appendChild(combatEl("span", "cr-name", (r.name || "Enemy") + " (" + mod + ")"));
      const inp = combatEl("input", "cr-roll");
      inp.type = "text"; inp.inputMode = "numeric"; inp.placeholder = "d20";
      row.appendChild(inp);
      eb.appendChild(row);
      rollInputs.push({ record: r, input: inp });
    });
    setup.appendChild(eb);
  }

  const begin = combatBtn("combat-start-btn", "Begin Combat");
  begin.addEventListener("click", () => {
    const playerRows = [...players.querySelectorAll(".combat-player-row")]
      .map((row) => ({
        name: row.querySelector(".cp-name").value.trim(),
        init: parseInt(row.querySelector(".cp-init").value, 10) || 0,
      }))
      .filter((p) => p.name);
    const rolls = new Map();
    rollInputs.forEach(({ record, input }) => rolls.set(record, parseInt(input.value, 10) || 0));
    renderCombatActive(runner, records, playerRows, rolls);
  });
  setup.appendChild(begin);

  runner.appendChild(setup);
}

// Active view: static turn order (players + enemies) + per-instance HP trackers.
function renderCombatActive(runner, records, players, rolls) {
  runner.textContent = "";

  const combatants = [];
  players.forEach((p) => combatants.push({ name: p.name, init: p.init, kind: "player" }));
  records.forEach((r) => {
    // Enemy turn value = the DM's d20 roll + the enemy's initiative modifier.
    const init = (rolls.get(r) || 0) + CombatEnemyModel.initMod(r.init);
    const label = r.count > 1 ? (r.name || "Enemy") + " ×" + r.count : (r.name || "Enemy");
    combatants.push({ name: label, init, kind: "enemy" });
  });
  combatants.sort((a, b) => b.init - a.init); // ties keep input order (stable sort)

  const order = combatEl("div", "combat-order");
  order.appendChild(combatEl("div", "combat-setup-title", "Turn order"));
  const orderRow = combatEl("div", "combat-order-row");
  combatants.forEach((c) => {
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
  records.forEach((r) => {
    const maxHp = parseInt(r.hp, 10);
    if (isNaN(maxHp)) return; // no HP -> nothing to track
    const count = Math.max(1, r.count || 1);
    for (let k = 1; k <= count; k++) {
      const label = count > 1 ? (r.name || "Enemy") + " " + k : (r.name || "Enemy");
      tracker.appendChild(buildHpRow(label, maxHp));
    }
  });
  runner.appendChild(tracker);

  const end = combatBtn("combat-mini combat-end-btn", "End Combat");
  end.addEventListener("click", () => renderCombatStart(runner, records));
  runner.appendChild(end);
}

// One HP tracker row. Ephemeral {cur,max}; the hit button applies the input via
// CombatEnemyModel.applyHpInput (N dmg · -N heal · - full heal · _N heal+max).
function buildHpRow(label, maxHp) {
  const state = { cur: maxHp, max: maxHp };
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
    input.focus();
  }
  hit.addEventListener("click", apply);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); apply(); } });
  paint();
  row.append(combatEl("span", "ch-name", label), hp, input, hit);
  return row;
}

/* Self-register with the runtime card registry (cards/shared/cardRegistry.js).
   No normalizer: both builders read directives/checkGroups/body from the AST node. */
if (typeof RendScrollCards !== "undefined") {
  RendScrollCards.register("combat", { build: buildCombatCard });
  RendScrollCards.register("sourceenemy", { build: buildSourceEnemyCard });
}

if (typeof window !== "undefined") window.parseCombatBody = parseCombatBody;
if (typeof module !== "undefined" && module.exports) module.exports = { parseCombatBody };
