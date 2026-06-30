/* Picture card renderer.
   A standalone image dropped into a scene at a chosen size. Authored as
   "### Picture: Optional Caption" with an "Image:" line and an optional
   "Size:" line (a percentage of the column width, 5–100, default 100).

   Unlike every other card — which paints images as a cover-cropped CSS
   background in the small portrait frame — this card renders a real <img>
   with object-fit: contain so the WHOLE picture is visible. It reuses
   cardBgUrl() for source resolution (so a bare name -> /images/<name>.png,
   any extension works) but does not touch the shared portrait system.

   The card renders in the left column by default; a "Side: R" line moves it
   to the right column. It never fetches files or touches the sidebar. */

// Picture width is a percentage of the column; clamp to a sane 5–100 range.
function validPictureSize(value) {
  const n = Number(value);
  return /^\d+(?:\.\d+)?$/.test(String(value || "")) && n >= 5 && n <= 100;
}

// Build one Picture card from its parsed AST node. Image/Size/Side come straight
// from the resolved directives; any remaining prose body renders through marked.
function buildPictureCard(cardNode, head, nodes) {
  const card = document.createElement("div");
  card.className = "picture-card";

  // Optional caption after the colon ("### Picture: Kale" -> "Kale").
  const caption = head.textContent.trim().replace(/^\s*picture\s*:\s*/i, "").trim();

  const imageRaw = cardDirective(cardNode, "image").trim();
  const sizeRaw = cardDirective(cardNode, "size").trim();
  const sizePct = validPictureSize(sizeRaw) ? Number(sizeRaw) : null;
  if (cardIsRight(cardNode)) card.classList.add("card-right");

  // Any non-directive body the author wrote renders as plain content.
  cardBodyElements(cardNode).forEach((n) => card.appendChild(n));

  // The image is the whole point of the card; render a real <img>, sized to a
  // percentage of the column via --pic-width (defaults to 100% in CSS).
  if (imageRaw) {
    if (sizePct != null) card.style.setProperty("--pic-width", sizePct + "%");
    const img = document.createElement("img");
    img.src = cardBgUrl(imageRaw);
    if (caption) img.alt = caption;
    card.insertBefore(img, card.firstChild);
    if (caption) {
      const cap = document.createElement("div");
      cap.className = "picture-caption";
      cap.textContent = caption;
      card.appendChild(cap);
    }
  } else if (caption) {
    // No image given: keep the caption visible as a title so the card isn't empty.
    const cap = document.createElement("div");
    cap.className = "picture-caption";
    cap.textContent = caption;
    card.insertBefore(cap, card.firstChild);
  }

  return card;
}

/* Self-register with the runtime card registry (cards/shared/cardRegistry.js).
   No normalizer: the builder reads directives/body from the parsed AST node. */
if (typeof RendScrollCards !== "undefined") {
  RendScrollCards.register("picture", { build: buildPictureCard });
}
