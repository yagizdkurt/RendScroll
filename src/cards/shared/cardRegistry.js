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
   - titleClass -> the class the builder puts on the card's own title element,
       for the types that support per-card collapse. Its presence IS the
       "this type collapses" flag: cardCollapse.js derives BOTH of its selectors
       from it (see collapsibleSelectors), so a collapsible type is declared once
       here instead of in two hand-kept lists. Omit it for types that don't
       collapse (std / narrative / manifest / picture / audio / transition).

   The classification side (heading regex -> type, title) lives in the parser's
   CARD_TYPES manifest; this registry owns the render side. A guard test asserts the
   two agree (every classifiable type, except the builder-less "echo", registers). */
const RendScrollCards = (() => {
  const registry = {};

  function register(type, spec) {
    const s = spec || {};
    registry[type] = {
      build: s.build || null,
      cssClass: s.cssClass || type + "-card",
      titleClass: s.titleClass || null,
    };
  }

  function get(type) { return registry[type] || null; }
  function builder(type) { const e = registry[type]; return e ? e.build : null; }
  function cssClass(type) { const e = registry[type]; return e ? e.cssClass : null; }
  function titleClass(type) { const e = registry[type]; return e ? e.titleClass : null; }
  function types() { return Object.keys(registry); }

  // Unique class names across the registry, in registration order. Several types
  // can share a class (sourceitem -> item-card), so dedupe.
  function classes(pick) {
    return [...new Set(Object.values(registry).map(pick).filter(Boolean))];
  }

  // Selector matching any registered card div (e.g. ".npc-card,.item-card,…").
  function cardSelector() {
    return classes((e) => e.cssClass).map((c) => "." + c).join(",");
  }

  // The card + title selectors the per-card collapse pass needs, derived from the
  // types that declared a titleClass. `title` is scoped to direct children so a
  // nested card's title never steals the outer card's toggle.
  function collapsibleSelectors() {
    const collapsible = Object.values(registry).filter((e) => e.titleClass);
    const card = [...new Set(collapsible.map((e) => e.cssClass))].map((c) => "." + c).join(",");
    const title = [...new Set(collapsible.map((e) => e.titleClass))]
      .map((c) => ":scope > ." + c)
      .join(",");
    return { card, title };
  }

  return { register, get, builder, cssClass, titleClass, types, cardSelector, collapsibleSelectors };
})();

if (typeof window !== "undefined") window.RendScrollCards = RendScrollCards;
if (typeof module !== "undefined" && module.exports) module.exports = RendScrollCards;
