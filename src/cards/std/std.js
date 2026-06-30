/* Standard ("STD") block renderer.
   A deliberately simple card that just groups the lines of a standard beat.
   Invoked with "### STD:" (the colon is required). Under it there can only be
   ">" read-aloud lines or normal paragraphs; the content is moved in unchanged.

   The card renders in the left column by default; a "Side: R" line moves it to
   the right column. It never fetches files, never touches the sidebar, and
   never calls another renderer. */

// True only for a "### STD:" heading (colon form).
function isStdHead(h) {
  return /^std\s*:/.test(rsLower(h.textContent).trim());
}

/* A node ends the current block if it's a new heading/separator OR a card that
   another renderer already produced (so they don't get swallowed in). */
function stdIsBoundary(n) {
  if (/^(H[1-3]|HR)$/.test(n.tagName)) return true;
  return isRenderedCard(n);
}

// Build one STD card from its parsed AST node. Image/Side come from the resolved
// directives; the body renders unchanged through marked.
function buildStdCard(cardNode, head, nodes) {
    const card = document.createElement("div");
    card.className = "std-card";

    // Optional label after the colon ("### STD: Varış" -> "Varış" title).
    const headEls = [];
    const name = head.textContent.trim().replace(/^\s*std\s*:\s*/i, "").trim();
    if (name) {
      const title = document.createElement("div");
      title.className = "std-title";
      title.textContent = name;
      headEls.push(title);
    }

    // An "Image:" directive becomes the top-right portrait; the rest of the body
    // is moved in unchanged — keep it simple.
    const imageRaw = cardDirective(cardNode, "image").trim();
    if (cardIsRight(cardNode)) card.classList.add("card-right");
    cardBodyElements(cardNode).forEach((n) => card.appendChild(n));

    // Header (title) sits beside the portrait when an Image was given; otherwise
    // just the title is placed on top (no empty portrait reserved).
    insertCardHeader(card, headEls, imageRaw);

    return card;
}

/* Self-register with the runtime card registry (cards/shared/cardRegistry.js).
   No normalizer: the builder reads directives/body from the parsed AST node. */
if (typeof RendScrollCards !== "undefined") {
  RendScrollCards.register("std", { build: buildStdCard });
}
