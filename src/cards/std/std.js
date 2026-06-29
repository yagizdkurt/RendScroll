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

/* Text phase (runs before marked): inside a STD section, isolate a bare
   "Image:" line into its own paragraph so it is not glued into a neighbouring
   list/blockquote and can be lifted out as the card portrait. */
function normalizeStdMarkdown(text) {
  return normalizeSectionDirectives(text, {
    startsSection: (line) => /^###\s+std\s*:/i.test(line),
    endsSection: (line) => /^#{1,3} /.test(line),
    shouldIsolate: (line) => /^image\s*:/i.test(line.trim()) || /^side\s*:/i.test(line.trim()),
  });
}

/* A node ends the current block if it's a new heading/separator OR a card that
   another renderer already produced (so they don't get swallowed in). */
function stdIsBoundary(n) {
  if (/^(H[1-3]|HR)$/.test(n.tagName)) return true;
  return isRenderedCard(n);
}

// Build one STD card from its heading + body nodes (produced by marked from the
// card's parsed source). Returns the card element.
function buildStdCard(head, nodes) {
    // STD renders in the left column by default; a "Side: R" line (handled in
    // the node loop below) tags the card .card-right so layout moves it.
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

    // Move the content in unchanged — keep it simple. An "Image:" line is lifted
    // out to become the top-right portrait instead of plain text.
    let imageRaw = "";
    nodes.forEach((n) => {
      const image = n.tagName === "P" && n.textContent.trim().match(CARD_IMAGE_LINE);
      if (image) {
        if (image[1].trim()) imageRaw = image[1].trim();
        return;
      }
      // "Side: R" moves the card to the right column; the line itself is dropped.
      const side = n.tagName === "P" && n.textContent.trim().match(CARD_SIDE_LINE);
      if (side) {
        if (cardSideIsRight(side[1])) card.classList.add("card-right");
        return;
      }
      card.appendChild(n.cloneNode(true));
    });

    // Header (title) sits beside the portrait when an Image was given; otherwise
    // just the title is placed on top (no empty portrait reserved).
    insertCardHeader(card, headEls, imageRaw);

    return card;
}

/* Self-register with the runtime card registry (cards/shared/cardRegistry.js). */
if (typeof RendScrollCards !== "undefined") {
  RendScrollCards.register("std", { build: buildStdCard, normalize: normalizeStdMarkdown });
}
