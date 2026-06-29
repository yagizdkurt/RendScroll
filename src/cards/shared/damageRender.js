/* Shared damage renderer: turns a damage string ("1d8+1 Slashing + 1d4 Fire")
   into styled DOM — dice + damage-type icons (via StdIcons) with per-type color
   (the .damage-type-<key> class, colored once in cards/shared/shared.css).

   One renderer for every card so combat attacks and item damage never drift.
   Class names are prefixed per caller (combat uses "attack-", items "item-") so
   each card keeps its own spacing while sharing the color classes. Falls back to
   plain text when the string can't be parsed or StdIcons isn't loaded.

   Browser-only (builds DOM). Loaded as a global (`renderDamage`). */

function renderDamage(parent, damage, opts) {
  const o = opts || {};
  const prefix = o.prefix || "";
  const size = o.iconSize != null ? o.iconSize : 20;
  const DM = (typeof DamageModel !== "undefined")
    ? DamageModel
    : (typeof require !== "undefined" ? require("./damageModel.js") : null);

  function span(cls, text) {
    const s = document.createElement("span");
    if (cls) s.className = cls;
    if (text != null) s.textContent = text;
    return s;
  }

  const terms = DM ? DM.parseDamageTerms(damage) : null;
  if (!terms || typeof StdIcons === "undefined") {
    const text = typeof o.fallback === "function" ? o.fallback(damage) : String(damage || "").trim();
    parent.appendChild(span(prefix + "damage-text", text));
    return parent;
  }

  terms.forEach((term, idx) => {
    if (idx > 0) parent.appendChild(span(prefix + "damage-plus", "+"));

    const typeKey = term.type ? StdIcons.key("damage", term.type) : null;
    const wrap = span(prefix + "damage-term" + (typeKey ? " damage-type-" + typeKey : ""));
    if (term.count > 1) wrap.appendChild(span(prefix + "dice-count", String(term.count)));
    const dieIcon = StdIcons.icon("dice", term.sides, {
      className: prefix + "die-icon", alt: "d" + term.sides, title: "d" + term.sides, size,
    });
    if (dieIcon) wrap.appendChild(dieIcon);
    if (term.extra) wrap.appendChild(span(prefix + "damage-extra", term.extra));
    if (term.type) {
      const dmgIcon = typeKey && StdIcons.icon("damage", typeKey, {
        className: prefix + "damage-icon", alt: term.type, title: term.type, size,
      });
      if (dmgIcon) wrap.appendChild(dmgIcon);
      else wrap.appendChild(span(prefix + "damage-type", term.type));
    }
    parent.appendChild(wrap);
  });
  return parent;
}

if (typeof window !== "undefined") window.renderDamage = renderDamage;
if (typeof module !== "undefined" && module.exports) module.exports = renderDamage;
