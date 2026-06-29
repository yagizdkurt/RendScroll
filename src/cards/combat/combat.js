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

// A bare "Label:" line (letters/spaces only, ending in a colon) opens a
// sub-section. Read-aloud (">") and list ("-") lines never match.
const COMBAT_LABEL_RE = /^[\p{L} ]+:\s*$/u;

// True only for a combat heading (colon form).
function isCombatHead(h) {
  return /^\s*(sava[şs]|combat)\s*:/.test(rsLower(h.textContent).trim());
}

/* A node ends the current section if it's a new heading/separator OR a card that
   another renderer already produced, so those don't get swallowed. */
function combatIsBoundary(n) {
  if (/^(H[1-3]|HR)$/.test(n.tagName)) return true;
  return isRenderedCard(n);
}

/* Text phase (runs before marked): inside a Savaş section, isolate each bare
   "Label:" line on its own blank-separated line. Without this a label written
   right after a list item is absorbed as lazy continuation, and a label after a
   "> ..." line is swallowed into the blockquote. */
function normalizeCombatMarkdown(text) {
  return normalizeSectionDirectives(text, {
    startsSection: (line) => /^###\s+(sava[şs]|combat)\s*:/i.test(line),
    endsSection: (line) => /^#{1,3} /.test(line),
    shouldIsolate: (line) => (
      COMBAT_LABEL_RE.test(line.trim()) ||
      /^image\s*:/i.test(line.trim()) ||
      /^side\s*:/i.test(line.trim())
    ),
  });
}

// A bare "Label:" paragraph becomes a sub-section title; returns the label text
// without the trailing colon (or "" when the node is not a label).
function combatLabel(node) {
  if (node.tagName !== "P") return "";
  const t = node.textContent.trim();
  return COMBAT_LABEL_RE.test(t) ? t.replace(/\s*:\s*$/, "") : "";
}

function combatSectionTitle(text) {
  const el = document.createElement("div");
  el.className = "combat-section-title";
  el.textContent = text;
  return el;
}

// A "Checks:" / "Skill Checks:" label opens a skill-check sub-section that
// renders identically to the Skill Checks panel (and to Obje's Checks).
function combatIsChecksLabel(label) {
  return /^(skill\s+)?checks?$/.test(rsLower(label).trim());
}

// Build one Savaş card from its heading + body nodes (produced by marked from the
// card's parsed source). Returns the card element.
function buildCombatCard(head, nodes) {
    // Combat renders in the left column by default; a "Side: R" line (handled in
    // the node loop below) tags the card .card-right so layout moves it.
    const card = document.createElement("div");
    card.className = "combat-card";

    const title = document.createElement("div");
    title.className = "combat-title";
    title.textContent = head.textContent.trim().replace(/^\s*(sava[şs]|combat)\s*:\s*/i, "").trim();

    // Header = title + leading content (before the first "Label:" section),
    // placed beside the portrait when an Image is given; sections flow below.
    const headEls = [title];
    let imageRaw = "";
    let headOpen = true;

    let checksBox = null;  // .skillchecks container while in a "Checks:" section
    const checkNodes = []; // collected and rendered together when the run ends

    let rosterBox = null;      // .combat-roster container after an "Enemies:" label
    let enemiesPending = false; // true between the "Enemies:" label and its list
    const enemyRecords = [];    // structured enemies powering roster + live runner

    // Render whatever Checks nodes have been collected so far, then close the run.
    function flushChecks() {
      if (checksBox) renderSkillCheckNodes(checksBox, checkNodes);
      checksBox = null;
      checkNodes.length = 0;
    }

    nodes.forEach((node) => {
      // The list right after an "Enemies:" label becomes the structured roster
      // (and feeds the live combat runner); it is not rendered as a plain list.
      if (enemiesPending) {
        enemiesPending = false;
        if (node.tagName === "UL" || node.tagName === "OL") {
          // Resolve any live "[enemy=Name]" library references to full stat blocks
          // before rendering, so the roster + runner share the expanded records.
          const recs = CombatEnemyModel.expandEnemies(enemyRecordsFromList(node), enemySourceResolver);
          recs.forEach((r) => enemyRecords.push(r));
          renderCombatRoster(rosterBox, recs);
          return;
        }
        // No list followed the label — fall through to normal handling.
      }

      // "Image: file" becomes the top-right portrait.
      const image = node.tagName === "P" && node.textContent.trim().match(CARD_IMAGE_LINE);
      if (image) {
        if (image[1].trim()) imageRaw = image[1].trim();
        return; // the Image line is represented by the portrait frame
      }

      // "Side: R" moves the card to the right column; the line itself is dropped.
      const side = node.tagName === "P" && node.textContent.trim().match(CARD_SIDE_LINE);
      if (side) {
        if (cardSideIsRight(side[1])) card.classList.add("card-right");
        return;
      }

      const label = combatLabel(node);
      if (label) {
        // Every "Label:" opens a new sub-section, which also closes any open
        // Checks run (so e.g. an "Ekstra:" block after Checks stays separate).
        headOpen = false; // the leading header content ends at the first section
        flushChecks();
        if (rsLower(label).trim() === "enemies") {
          // "Enemies:" opens the structured roster; the following list is parsed
          // into enemy records by the enemiesPending branch at the loop top.
          const section = document.createElement("div");
          section.className = "combat-section";
          section.appendChild(combatSectionTitle(label));
          rosterBox = document.createElement("div");
          rosterBox.className = "combat-roster";
          section.appendChild(rosterBox);
          card.appendChild(section);
          enemiesPending = true;
        } else if (combatIsChecksLabel(label)) {
          const section = document.createElement("div");
          section.className = "combat-section";
          section.appendChild(combatSectionTitle(label));
          checksBox = document.createElement("div");
          checksBox.className = "skillchecks";
          section.appendChild(checksBox);
          card.appendChild(section);
        } else {
          card.appendChild(combatSectionTitle(label));
        }
        return; // the label paragraph itself is replaced by the title
      }
      if (checksBox) {
        checkNodes.push(node); // collected; rendered together by flushChecks()
        return;
      }
      const clone = cloneAsReadAloud(node);
      if (headOpen) headEls.push(clone); // leading content stays beside portrait
      else card.appendChild(clone);
    });

    flushChecks(); // render a Checks run that reached the end of the card

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
// a reference view, identical in look to one enemy inside a combat card.
function buildSourceEnemyCard(head, nodes) {
  const card = document.createElement("div");
  card.className = "combat-card sourceenemy-card";
  const list = (nodes || []).find((n) => n.tagName === "UL" || n.tagName === "OL");
  const recs = list ? enemyRecordsFromList(list) : [];
  const box = combatEl("div", "combat-roster");
  renderCombatRoster(box, recs.length ? recs : [CombatEnemyModel.blankEnemy()]);
  card.appendChild(box);
  return card;
}

// A marked-rendered "Enemies:" list -> enemy records. Each top-level <li> is one
// enemy (its text before any nested list is the "Name | AC .. | …" header); each
// nested <li> is an ability. Reuses the shared text parser so editor and reader
// classify enemies identically.
function enemyRecordsFromList(listEl) {
  const lines = [];
  listEl.querySelectorAll(":scope > li").forEach((li) => {
    const head = li.cloneNode(true);
    head.querySelectorAll("ul, ol").forEach((n) => n.remove());
    lines.push("- " + head.textContent.trim());
    li.querySelectorAll(":scope > ul > li, :scope > ol > li").forEach((sub) => {
      lines.push("  - " + sub.textContent.trim());
    });
  });
  return CombatEnemyModel.parseEnemyBlock(lines);
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

function appendAttackDamage(parent, damage) {
  const terms = CombatEnemyModel.parseDamageTerms(damage);
  if (!terms || typeof StdIcons === "undefined") {
    parent.appendChild(combatEl("span", "attack-damage-text", formatAttackDamage(damage)));
    return;
  }

  terms.forEach((term, idx) => {
    if (idx > 0) parent.appendChild(combatEl("span", "attack-damage-plus", "+"));

    const typeKey = term.type ? StdIcons.key("damage", term.type) : null;
    const termCls = "attack-damage-term" + (typeKey ? " damage-type-" + typeKey : "");
    const wrap = combatEl("span", termCls);
    if (term.count > 1) wrap.appendChild(combatEl("span", "attack-dice-count", String(term.count)));
    const icon = StdIcons.icon("dice", term.sides, {
      className: "attack-die-icon",
      alt: "d" + term.sides,
      title: "d" + term.sides,
      size: 20,
    });
    if (icon) wrap.appendChild(icon);
    if (term.extra) wrap.appendChild(combatEl("span", "attack-damage-extra", term.extra));
    if (term.type) {
      const dmgIcon = typeKey && StdIcons.icon("damage", typeKey, {
        className: "attack-damage-icon",
        alt: term.type,
        title: term.type,
        size: 20,
      });
      if (dmgIcon) wrap.appendChild(dmgIcon);
      else wrap.appendChild(combatEl("span", "attack-damage-type", term.type));
    }
    parent.appendChild(wrap);
  });
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
   sourceenemy (library base enemy) has no per-type source isolation. */
if (typeof RendScrollCards !== "undefined") {
  RendScrollCards.register("combat", { build: buildCombatCard, normalize: normalizeCombatMarkdown });
  RendScrollCards.register("sourceenemy", { build: buildSourceEnemyCard });
}
