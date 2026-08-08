/* "Echo" — a classification-only card type: no builder, no card element.

   "### Echo …" is a legacy heading form. The parser classifies it (CARD_TYPES in
   rendscrollParser.js) and it renders as a plain H3, styled only by a heading
   accent. Documentation/README.md steers authors to "### STD:" with an echo title
   for a real rendered card, so no builder was ever written for it.

   It still registers here, with build: null and cssClass: null, for one reason:
   the registry is the single source for per-type presentation, including the
   heading accent app.js stamps. Without this entry the echo accent would have to
   live in a second hand-kept map beside the registry — exactly the drift the
   registry exists to prevent.

   cssClass: null keeps it out of every class-derived selector (cardSelector,
   collapsibleSelectors, the print break rule): there is no .echo-card to select. */

if (typeof RendScrollCards !== "undefined") {
  RendScrollCards.register("echo", {
    build: null,
    cssClass: null,
    accentClass: "echo-section",
  });
}
