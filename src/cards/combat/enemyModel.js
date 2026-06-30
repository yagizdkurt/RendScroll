/* Combat enemy model — the ONE place that parses/serializes a combat card's
   structured enemy stat blocks and owns the live HP-tracker grammar.

   Shared by both render paths so they can never drift:
     - the editor (src/editor/cardSchemas.js) serializes/parses the "Enemies:"
       markdown block when saving/opening a combat card, and
     - the reader (src/cards/combat/combat.js) renders the stat blocks + the live
       combat runner.

   Markdown shape — one enemy per top-level bullet (a "header" line of pipe-
   separated identity + stats), with labelled indented bullets for the rich
   sections:

     Enemies:
     - Kate | Village Woman • Humanoid | AC 10 | HP 15 | Init +1 | Speed 30 ft
       - Attack: Rusty Knife | +4 | 1d4+2 Piercing
       - Weak Save: Wisdom
       - Strong Save: Dexterity
       - Resist: Fire
       - Immune: Poison
       - Trait: Keen Senses
       - Tactics: Attacks the nearest creature.
       - Tactics: Below half HP she panics.

   Initiative is stored and shown as a MODIFIER ("+1"), never the d20 formula.

   One enemy record:
     { name, subtitle, ac, hp, init, speed, count,
       attacks: [{ name, hit, damage }],
       weakSave, strongSave, resist, immune,
       traits: string[], tactics: string[] }

   Loaded as a browser global (`CombatEnemyModel`) like the rest of the app, and
   `module.exports` for Node tests. */

const CombatEnemyModel = (() => {
  // Dice + damage-type parsing/serializing lives in one shared module so the
  // combat reader, item cards, and the editor never drift. Browser: global
  // `DamageModel`. Node: require it.
  const DM = (typeof DamageModel !== "undefined")
    ? DamageModel
    : require("../shared/damageModel.js");

  // Pipe-separated header stat tokens. Order here is also the canonical serialize
  // order. Init is handled specially (formatted as a signed modifier).
  const STAT_TOKENS = [
    { key: "ac", label: "AC", re: /^ac\s+(.+)$/i },
    { key: "hp", label: "HP", re: /^hp\s+(.+)$/i },
    { key: "init", label: "Init", re: /^init\s+(.+)$/i },
    { key: "speed", label: "Speed", re: /^speed\s+(.+)$/i },
  ];

  function blankEnemy() {
    return {
      name: "", subtitle: "", ac: "", hp: "", init: "", speed: "", count: 1,
      attacks: [], weakSave: "", strongSave: "", resist: "", immune: "",
      traits: [], tactics: [],
      // A non-empty `ref` marks a live link to a library enemy (Enemies/Name.md);
      // the full stats are resolved + expanded at render time (see expandEnemies).
      ref: "",
    };
  }

  // Initiative is a modifier. initMod("+1")/"-2"/"1" -> integer; formatInitMod
  // always renders a signed string ("+1", "-2", "+0").
  function initMod(init) {
    const m = String(init == null ? "" : init).match(/[+-]?\d+/);
    return m ? parseInt(m[0], 10) || 0 : 0;
  }
  function formatInitMod(init) {
    const n = initMod(init);
    return (n >= 0 ? "+" : "") + n;
  }

  // "Rusty Knife | +4 | 1d4+2 Piercing" -> { name, hit, damage } (positional).
  function parseAttack(val) {
    const p = String(val).split("|").map((s) => s.trim());
    return { name: p[0] || "", hit: p[1] || "", damage: p[2] || "" };
  }
  function serializeAttack(a) {
    const segs = [(a.name || "").trim(), (a.hit || "").trim(), (a.damage || "").trim()];
    while (segs.length > 1 && segs[segs.length - 1] === "") segs.pop();
    return segs.join(" | ");
  }

  // Dice/damage parsing + serializing now live in DamageModel (shared). Keep the
  // historical CombatEnemyModel.* names by re-exporting the shared functions.
  const parseDamageDice = DM.parseDamageDice;
  const parseDamageTerms = DM.parseDamageTerms;
  const serializeDamageTerm = DM.serializeDamageTerm;
  const serializeDamageTerms = DM.serializeDamageTerms;

  // "Kate | Village Woman • Humanoid | AC 10 | … | x3" -> enemy record (without
  // the indented sub-section bullets). A segment that isn't a known stat or the
  // "xN" count is taken as the subtitle (creature type / flavour).
  function parseEnemyHeader(text) {
    const rec = blankEnemy();
    // Live library reference: "[enemy=Name] x3" — the stats come from the library
    // file at render time; only the name + optional count live in the combat card.
    const refM = String(text).match(/^\s*\[\s*enemy\s*=\s*([^\]]+?)\s*\]\s*(.*)$/i);
    if (refM) {
      rec.ref = refM[1].trim();
      rec.name = rec.ref;
      const xm = (refM[2] || "").match(/x\s*(\d+)/i);
      if (xm) rec.count = Math.max(1, parseInt(xm[1], 10) || 1);
      return rec;
    }
    const parts = String(text).split("|").map((s) => s.trim());
    rec.name = (parts.shift() || "").trim();
    for (const part of parts) {
      if (!part) continue;
      let matched = false;
      for (const tok of STAT_TOKENS) {
        const m = part.match(tok.re);
        if (m) { rec[tok.key] = m[1].trim(); matched = true; break; }
      }
      if (matched) continue;
      const xm = part.match(/^x\s*(\d+)$/i);
      if (xm) { rec.count = Math.max(1, parseInt(xm[1], 10) || 1); continue; }
      rec.subtitle = rec.subtitle ? rec.subtitle + " " + part : part;
    }
    return rec;
  }

  // Apply one labelled indented bullet ("Attack: …", "Weak Save: …", …) to the
  // current enemy. An unlabelled bullet (or unknown label) becomes a trait, which
  // keeps older free-text "- ability" rosters working.
  function applySubBullet(rec, text) {
    const t = String(text).trim();
    const lm = t.match(/^([A-Za-z][A-Za-z ]*?):\s*(.*)$/);
    const label = lm ? lm[1].trim().toLowerCase() : "";
    const val = lm ? lm[2].trim() : t;
    switch (label) {
      case "attack": rec.attacks.push(parseAttack(val)); break;
      case "weak save": rec.weakSave = val; break;
      case "strong save": rec.strongSave = val; break;
      case "resist": case "resistance": case "resistances": rec.resist = val; break;
      case "immune": case "immunity": case "immunities": rec.immune = val; break;
      case "trait": case "traits": rec.traits.push(val); break;
      case "tactics": case "tactic": case "taktik": rec.tactics.push(val); break;
      default: rec.traits.push(t); break;
    }
  }

  // Parse the lines under an "Enemies:" label into enemy records. A top-level
  // bullet ("- …", no leading space) starts an enemy; an indented bullet feeds a
  // section of the current enemy. Blank lines are tolerated.
  function parseEnemyBlock(lines) {
    const arr = Array.isArray(lines) ? lines : String(lines).split(/\r?\n/);
    const enemies = [];
    let cur = null;
    for (const raw of arr) {
      if (raw == null || raw.trim() === "") continue;
      if (/^[-*]\s+/.test(raw)) {
        cur = parseEnemyHeader(raw.replace(/^[-*]\s+/, ""));
        enemies.push(cur);
      } else {
        const am = raw.match(/^\s+[-*]\s+(.*)$/);
        if (am && cur) applySubBullet(cur, am[1]);
      }
    }
    return enemies;
  }

  // Build the canonical "- Name | … | AC .. | …" header line. Empty fields are
  // omitted; "xN" only when count > 1; Init is rendered as a signed modifier.
  function serializeEnemyHeader(rec) {
    // A live library reference round-trips as "- [enemy=Name] xN" (no inline stats).
    if (rec && (rec.ref || "").toString().trim()) {
      const count = Math.max(1, parseInt(rec.count, 10) || 1);
      return "- [enemy=" + rec.ref.toString().trim() + "]" + (count > 1 ? " x" + count : "");
    }
    const segs = [(rec.name || "").trim()];
    if ((rec.subtitle || "").trim()) segs.push(rec.subtitle.trim());
    if ((rec.ac || "").toString().trim()) segs.push("AC " + rec.ac.toString().trim());
    if ((rec.hp || "").toString().trim()) segs.push("HP " + rec.hp.toString().trim());
    if ((rec.init || "").toString().trim()) segs.push("Init " + formatInitMod(rec.init));
    if ((rec.speed || "").toString().trim()) segs.push("Speed " + rec.speed.toString().trim());
    const count = Math.max(1, parseInt(rec.count, 10) || 1);
    if (count > 1) segs.push("x" + count);
    return "- " + segs.join(" | ");
  }

  function enemyHasContent(rec) {
    if (!rec) return false;
    if ((rec.ref || "").toString().trim()) return true;
    return ["name", "subtitle", "ac", "hp", "init", "speed", "weakSave",
            "strongSave", "resist", "immune"].some((k) => (rec[k] || "").toString().trim()) ||
      (rec.attacks || []).length || (rec.traits || []).length || (rec.tactics || []).length;
  }

  // Enemy records -> the full markdown block (header lines + labelled sub-bullets).
  // Empty enemies are dropped. Returns "" for an empty list.
  function serializeEnemies(list) {
    const out = [];
    (list || []).forEach((rec) => {
      if (!enemyHasContent(rec)) return;
      out.push(serializeEnemyHeader(rec));
      (rec.attacks || []).forEach((a) => {
        const s = serializeAttack(a);
        if (s) out.push("  - Attack: " + s);
      });
      if ((rec.weakSave || "").trim()) out.push("  - Weak Save: " + rec.weakSave.trim());
      if ((rec.strongSave || "").trim()) out.push("  - Strong Save: " + rec.strongSave.trim());
      if ((rec.resist || "").trim()) out.push("  - Resist: " + rec.resist.trim());
      if ((rec.immune || "").trim()) out.push("  - Immune: " + rec.immune.trim());
      (rec.traits || []).forEach((t) => { if ((t || "").trim()) out.push("  - Trait: " + t.trim()); });
      (rec.tactics || []).forEach((t) => { if ((t || "").trim()) out.push("  - Tactics: " + t.trim()); });
    });
    return out.join("\n");
  }

  // A library enemy file (Enemies/Name.md) holds ONE enemy as a "### SourceEnemy:"
  // heading + a single-enemy block. Strip the heading and parse the lone record.
  function parseSourceEnemy(source) {
    const lines = String(source == null ? "" : source).split(/\r?\n/)
      .filter((l) => !/^\s*###\s+/.test(l));
    const recs = parseEnemyBlock(lines);
    return recs[0] || blankEnemy();
  }

  // Resolve live library references in a record list. Each record with a `ref`
  // is replaced by the resolver's source record (or a "(missing)" placeholder),
  // with the combat card's inline count overriding the source's. Inline records
  // pass through untouched. `resolver(name)` -> source enemy record | null.
  function expandEnemies(records, resolver) {
    return (records || []).map((rec) => {
      if (!rec || !(rec.ref || "").toString().trim()) return rec;
      const count = Math.max(1, parseInt(rec.count, 10) || 1);
      const base = (typeof resolver === "function") ? resolver(rec.ref) : null;
      if (!base) {
        const miss = blankEnemy();
        miss.name = rec.ref + " (missing)";
        miss.count = count;
        return miss;
      }
      const out = Object.assign(blankEnemy(), base);
      out.ref = rec.ref;
      out.count = count;
      return out;
    });
  }

  // The live HP-tracker grammar. Given the current {cur, max} and a raw input
  // string, return the next {cur, max}:
  //   "N"   -> deal N damage          (cur = max(0, cur - N))
  //   "-N"  -> heal N, capped at max  (cur = min(max, cur + N))
  //   "-"   -> full heal to max       (cur = max)
  //   "_N"  -> heal N AND raise max   (cur += N, max += N)
  // Empty/unrecognised input is a no-op.
  function applyHpInput(state, raw) {
    let cur = Number(state.cur) || 0;
    let max = Number(state.max) || 0;
    const s = String(raw == null ? "" : raw).trim();
    if (s === "") return { cur, max };
    if (s === "-") return { cur: max, max };
    let m;
    if ((m = s.match(/^_\s*(\d+)$/))) {
      const n = parseInt(m[1], 10);
      return { cur: cur + n, max: max + n };
    }
    if ((m = s.match(/^-\s*(\d+)$/))) {
      const n = parseInt(m[1], 10);
      return { cur: Math.min(max, cur + n), max };
    }
    if ((m = s.match(/^\+?\s*(\d+)$/))) {
      const n = parseInt(m[1], 10);
      return { cur: Math.max(0, cur - n), max };
    }
    return { cur, max };
  }

  return {
    blankEnemy,
    initMod,
    formatInitMod,
    parseAttack,
    serializeAttack,
    parseDamageDice,
    parseDamageTerms,
    serializeDamageTerm,
    serializeDamageTerms,
    parseEnemyHeader,
    parseEnemyBlock,
    serializeEnemyHeader,
    serializeEnemies,
    parseSourceEnemy,
    expandEnemies,
    applyHpInput,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = CombatEnemyModel;
