/* Enemy stat-block rendering — the DOM half of cards/combat/enemyModel.js.

   Shared by BOTH combat card builders: the "Enemies:" roster inside a Combat card
   and the standalone SourceEnemy library card render through the same
   renderCombatRoster(), so a library enemy looks identical to one inside an
   encounter. Pure presentation: it reads parsed enemy records and returns DOM.
   It knows nothing about the live runner or session state.

   Loaded before combatRunner.js and combat.js, both of which reuse the combatEl /
   combatBtn helpers below. */

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
  if (rules.length && /^tactics?\s*:?\s*$/i.test(rules[0])) rules.shift();
  if (rules.length) rules[0] = rules[0].replace(/^tactics?\s*:\s*/i, "").trim();
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
