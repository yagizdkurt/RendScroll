/* Standard ("STD") block renderer.
   A deliberately simple card that just groups the lines of a standard beat.
   Invoked with "### STD:" (the colon is required). Under it there can only be
   ">" read-aloud lines or normal paragraphs; the content is moved in unchanged.

   The card renders in the left column by default; a "Side: R" line moves it to
   the right column. It never fetches files, never touches the sidebar, and
   never calls another renderer. */

function stdLower(s) {
  return s.replace(/İ/g, "i").replace(/I/g, "ı").toLowerCase();
}

// True only for a "### STD:" heading (colon form).
function isStdHead(h) {
  return /^std\s*:/.test(stdLower(h.textContent).trim());
}

/* Text phase (runs before marked): inside a STD section, isolate a bare
   "Image:" line into its own paragraph so it is not glued into a neighbouring
   list/blockquote and can be lifted out as the card portrait. */
function normalizeStdMarkdown(text) {
  const out = [];
  let inStd = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^###\s+std\s*:/i.test(line)) { inStd = true; out.push(line); continue; }
    if (/^#{1,3} /.test(line)) { inStd = false; out.push(line); continue; }
    if (inStd && (/^image\s*:/i.test(line.trim()) || /^side\s*:/i.test(line.trim()))) {
      if (out.length && out[out.length - 1].trim() !== "") out.push("");
      out.push(line);
      out.push("");
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

/* A node ends the current block if it's a new heading/separator OR a card that
   another renderer already produced (so they don't get swallowed in). */
function stdIsBoundary(n) {
  if (/^(H[1-3]|HR)$/.test(n.tagName)) return true;
  return n.classList && (
    n.classList.contains("npc-card") ||
    n.classList.contains("item-card") ||
    n.classList.contains("ability-card") ||
    n.classList.contains("obj-card") ||
    n.classList.contains("combat-card") ||
    n.classList.contains("unexpected-card") ||
    n.classList.contains("std-card")
  );
}

function enhanceStdSections(root) {
  const heads = [...root.querySelectorAll("h3")].filter(isStdHead);

  heads.forEach((head) => {
    // Collect everything until the next heading/separator/card.
    const nodes = [];
    for (let n = head.nextElementSibling; n && !stdIsBoundary(n); n = n.nextElementSibling) {
      nodes.push(n);
    }

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
    const portrait = cardPortrait(imageRaw);
    if (portrait) {
      card.insertBefore(cardFigure(headEls, portrait), card.firstChild);
    } else {
      for (let j = headEls.length - 1; j >= 0; j--) card.insertBefore(headEls[j], card.firstChild);
    }

    const marker = document.createComment("std-card");
    head.before(marker);
    head.remove();
    nodes.forEach((n) => n.remove());
    marker.replaceWith(card);
  });
}
