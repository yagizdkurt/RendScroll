/* Runtime card registry — the single hook each card type self-registers into.

   Loaded before the individual cards/<type>/<type>.js builders. Each builder file
   calls RendScrollCards.register(type, { build, cssClass }) at the bottom, so app.js
   looks builders up BY TYPE instead of maintaining a hand-synced CARD_BUILDERS object.

   - build(card, headingEl, bodyEls) -> the card element (or null to leave the
       heading). `card` is the parsed RendScroll AST node for this card's source
       (directives, checkGroups, body, column, stuck) — builders read structured
       data from it instead of re-sniffing re-rendered DOM. headingEl is the
       marked-rendered heading (for the title); bodyEls is unused by current
       builders (kept for signature stability).
   - cssClass -> the identifying class the builder puts on its root <div>
       (defaults to "<type>-card"). The single source for anything that needs to
       select card divs by class — no more hand-synced class tables elsewhere.

   The classification side (heading regex -> type, title) lives in the parser's
   CARD_TYPES manifest; this registry owns the render side. A guard test asserts the
   two agree (every classifiable type, except the builder-less "echo", registers). */
const RendScrollCards = (() => {
  const registry = {};

  function register(type, spec) {
    const s = spec || {};
    registry[type] = { build: s.build || null, cssClass: s.cssClass || type + "-card" };
  }

  function get(type) { return registry[type] || null; }
  function builder(type) { const e = registry[type]; return e ? e.build : null; }
  function cssClass(type) { const e = registry[type]; return e ? e.cssClass : null; }
  function types() { return Object.keys(registry); }
  // Selector matching any registered card div (e.g. ".npc-card,.item-card,…").
  function cardSelector() {
    return [...new Set(Object.values(registry).map((e) => e.cssClass))]
      .map((c) => "." + c)
      .join(",");
  }

  return { register, get, builder, cssClass, types, cardSelector };
})();

if (typeof window !== "undefined") window.RendScrollCards = RendScrollCards;
if (typeof module !== "undefined" && module.exports) module.exports = RendScrollCards;
