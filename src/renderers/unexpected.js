/* Unexpected ("Beklenmedik") section renderer.
   A deliberately simple titled card whose only job is to group the
   contingencies of an event. Invoked with "### Beklenmedik:" or
   "### Unexpected:" (the colon is required, so the plain
   "### Beklenmedik Durumlar" sections stay untouched and keep their old look).

   It only wraps the heading and the nodes that follow into one card; it does
   NOT restructure the content. It never fetches files, never touches the
   sidebar, and never calls another renderer. */

// True only for a "### Beklenmedik:" / "### Unexpected:" heading (colon form).
function isUnexpectedHead(h) {
  return /^(beklenmedik|unexpected)\s*:/.test(rsLower(h.textContent).trim());
}

/* Text phase (runs before marked): inside an Unexpected section, isolate a bare
   "Image:" line into its own paragraph so it is not glued into a neighbouring
   list/blockquote and can be lifted out as the card portrait. */
function normalizeUnexpectedMarkdown(text) {
  return normalizeSectionDirectives(text, {
    startsSection: (line) => /^###\s+(beklenmedik|unexpected)\s*:/i.test(line),
    endsSection: (line) => /^#{1,3} /.test(line),
    shouldIsolate: (line) => /^image\s*:/i.test(line.trim()) || /^side\s*:/i.test(line.trim()),
  });
}

/* A node ends the current section if it's a new heading/separator OR a card that
   another renderer already produced (NPC/Obje cards are emitted before this
   one runs, so without this they'd be swallowed into the unexpected card). */
function unexpectedIsBoundary(n) {
  if (/^(H[1-3]|HR)$/.test(n.tagName)) return true;
  return isRenderedCard(n);
}

function enhanceUnexpectedSections(root) {
  const heads = [...root.querySelectorAll("h3")].filter(isUnexpectedHead);

  heads.forEach((head) => {
    // Stop at the next H2/H3 or an <hr> so the event separator stays standalone.
    const nodes = [];
    for (let n = head.nextElementSibling; n && !unexpectedIsBoundary(n); n = n.nextElementSibling) {
      nodes.push(n);
    }

    // Unexpected renders in the left column by default; a "Side: R" line (handled
    // in the node loop below) tags the card .card-right so layout moves it.
    const card = document.createElement("div");
    card.className = "unexpected-card";

    const title = document.createElement("div");
    title.className = "unexpected-title";
    const name = head.textContent.trim().replace(/^\s*(beklenmedik|unexpected)\s*:\s*/i, "").trim();
    title.textContent = name || "Beklenmedik Durumlar";

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
    // the title is placed on top (no empty portrait reserved).
    insertCardHeader(card, title, imageRaw);

    const marker = document.createComment("unexpected-card");
    head.before(marker);
    head.remove();
    nodes.forEach((n) => n.remove());
    marker.replaceWith(card);
  });
}
