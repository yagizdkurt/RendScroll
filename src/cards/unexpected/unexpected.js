/* Unexpected section renderer.
   A deliberately simple titled card whose only job is to group the
   contingencies of an event. Invoked with "### Unexpected:" (the colon is
   required, so plain "### Unexpected Events" sections stay untouched and keep
   their old look).

   It only wraps the heading and the nodes that follow into one card; it does
   NOT restructure the content. It never fetches files, never touches the
   sidebar, and never calls another renderer. */

// True only for a "### Unexpected:" heading (colon form).
function isUnexpectedHead(h) {
  return /^unexpected\s*:/.test(rsLower(h.textContent).trim());
}

// Build one Unexpected card from its parsed AST node. Image/Side come
// from the resolved directives; the body renders unchanged through marked.
function buildUnexpectedCard(cardNode, head, nodes) {
    const card = document.createElement("div");
    card.className = "unexpected-card";

    const title = document.createElement("div");
    title.className = "unexpected-title";
    const name = head.textContent.trim().replace(/^\s*unexpected\s*:\s*/i, "").trim();
    title.textContent = name || "Unexpected Events";

    // An "Image:" directive becomes the top-right portrait; the rest of the body
    // is moved in unchanged — keep it simple.
    const imageRaw = cardDirective(cardNode, "image").trim();
    if (cardIsRight(cardNode)) card.classList.add("card-right");
    cardBodyElements(cardNode).forEach((n) => card.appendChild(n));

    // Header (title) sits beside the portrait when an Image was given; otherwise
    // the title is placed on top (no empty portrait reserved).
    insertCardHeader(card, title, imageRaw);

    return card;
}

/* Self-register with the runtime card registry (cards/shared/cardRegistry.js).
   No normalizer: the builder reads directives/body from the parsed AST node. */
if (typeof RendScrollCards !== "undefined") {
  RendScrollCards.register("unexpected", { build: buildUnexpectedCard, cssClass: "unexpected-card", titleClass: "unexpected-title" });
}
