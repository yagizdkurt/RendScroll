/* Shared dice + damage-type model — the ONE place that parses/serializes a
   "count·dice + bonus + type" damage expression (e.g. "2d6+1 Slashing + 1d4 Fire").

   Owned here (not by any single card) so every consumer stays in lock-step:
     - combat attacks (src/cards/combat/enemyModel.js / combat.js),
     - item damage (src/cards/item/*),
     - the editor's damage-part editor (src/editor/damageEditor.js).

   Allowed dice are the polyhedral set [4,6,8,10,12,20] (matches StdIcons "dice").
   parse* return null on anything they can't fully understand, so callers fall
   back to verbatim text rather than dropping content.

   Loaded as a browser global (`DamageModel`) like the rest of the app, and
   `module.exports` for Node tests. */

const DamageModel = (() => {
  const DICE = [4, 6, 8, 10, 12, 20];

  // "1d4+2 Piercing" -> { count, sides, extra, type } (one term), or null.
  function parseDamageTerm(term) {
    const m = String(term || "").trim().match(/^(\d*)d(4|6|8|10|12|20)\s*([+-]\s*\d+)?\s*(.*)$/i);
    if (!m) return null;
    const count = parseInt(m[1] || "1", 10) || 1;
    const sides = parseInt(m[2], 10);
    const extra = (m[3] || "").replace(/\s+/g, "");
    const type = (m[4] || "").trim();
    return { count, sides, extra, type };
  }

  // Multiple terms joined by " + ", e.g. "2d6 Slashing + 1d4 Fire". Splits only
  // where a " + " precedes another dice term (so a flat "+2" bonus stays attached).
  // All-or-nothing: returns null if any term fails so callers keep the raw text.
  function parseDamageTerms(damage) {
    const raw = String(damage || "").trim();
    if (!raw) return null;
    const parts = raw.split(/\s+\+\s+(?=\d*d(?:4|6|8|10|12|20)\b)/i);
    if (!parts.length) return null;
    const terms = parts.map(parseDamageTerm);
    return terms.every(Boolean) ? terms : null;
  }

  // Single-term convenience: the lone parsed term, or null.
  function parseDamageDice(damage) {
    const terms = parseDamageTerms(damage);
    return terms && terms.length === 1 ? terms[0] : null;
  }

  function serializeDamageTerm(term) {
    const count = Math.max(1, parseInt(term && term.count, 10) || 1);
    const sides = parseInt(term && term.sides, 10);
    if (!DICE.includes(sides)) return "";
    const extra = String((term && term.extra) || "").replace(/\s+/g, "");
    const type = String((term && term.type) || "").trim();
    return count + "d" + sides + extra + (type ? " " + type : "");
  }

  function serializeDamageTerms(terms) {
    return (terms || []).map(serializeDamageTerm).filter(Boolean).join(" + ");
  }

  return {
    DICE,
    parseDamageTerm,
    parseDamageTerms,
    parseDamageDice,
    serializeDamageTerm,
    serializeDamageTerms,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = DamageModel;
