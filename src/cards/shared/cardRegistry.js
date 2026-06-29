/* Runtime card registry — the single hook each card type self-registers into.

   Loaded before the individual cards/<type>/<type>.js builders. Each builder file
   calls RendScrollCards.register(type, { build, normalize }) at the bottom, so
   app.js looks builders/normalizers up BY TYPE instead of maintaining a hand-synced
   CARD_BUILDERS object and a parallel isolateCardSource switch (the two structures
   that used to silently drift apart).

   - build(headingEl, bodyEls)  -> the card element (or null to leave the heading)
   - normalize(src) [optional]  -> per-type source isolation run before marked

   The classification side (heading regex -> type, title) lives in the parser's
   CARD_TYPES manifest; this registry owns the render side. A guard test asserts the
   two agree (every classifiable type, except the builder-less "echo", registers). */
const RendScrollCards = (() => {
  const registry = {};

  function register(type, spec) {
    const s = spec || {};
    registry[type] = { build: s.build || null, normalize: s.normalize || null };
  }

  function get(type) { return registry[type] || null; }
  function builder(type) { const e = registry[type]; return e ? e.build : null; }
  function normalizer(type) { const e = registry[type]; return e ? e.normalize : null; }
  function types() { return Object.keys(registry); }

  return { register, get, builder, normalizer, types };
})();

if (typeof window !== "undefined") window.RendScrollCards = RendScrollCards;
if (typeof module !== "undefined" && module.exports) module.exports = RendScrollCards;
