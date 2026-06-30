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

// A whole line that is just "Size: 50" (percentage). Value capture is the number.
const CARD_SIZE_LINE = /^size\s*:\s*(\d+(?:\.\d+)?)\s*$/i;

// Picture width is a percentage of the column; clamp to a sane 5–100 range.
function validPictureSize(value) {
  const n = Number(value);
  return /^\d+(?:\.\d+)?$/.test(String(value || "")) && n >= 5 && n <= 100;
}

/* Text phase (runs before marked): inside a Picture section, isolate the
   directive lines into their own paragraphs so they are not glued into a
   neighbouring list/blockquote and can be lifted out by the builder. */
function normalizePictureMarkdown(text) {
  return normalizeSectionDirectives(text, {
    startsSection: (line) => /^###\s+picture\s*:/i.test(line),
    endsSection: (line) => /^#{1,3} /.test(line),
    shouldIsolate: (line) => (
      /^image\s*:/i.test(line.trim()) ||
      /^size\s*:/i.test(line.trim()) ||
      /^side\s*:/i.test(line.trim())
    ),
  });
}

// Build one Picture card from its heading + body nodes. Returns the card element.
function buildPictureCard(head, nodes) {
  const card = document.createElement("div");
  card.className = "picture-card";

  // Optional caption after the colon ("### Picture: Kale" -> "Kale").
  const caption = head.textContent.trim().replace(/^\s*picture\s*:\s*/i, "").trim();

  let imageRaw = "";
  let sizePct = null;
  nodes.forEach((n) => {
    const image = n.tagName === "P" && n.textContent.trim().match(CARD_IMAGE_LINE);
    if (image) {
      if (image[1].trim()) imageRaw = image[1].trim();
      return;
    }
    const size = n.tagName === "P" && n.textContent.trim().match(CARD_SIZE_LINE);
    if (size) {
      if (validPictureSize(size[1])) sizePct = Number(size[1]);
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

/* Self-register with the runtime card registry (cards/shared/cardRegistry.js). */
if (typeof RendScrollCards !== "undefined") {
  RendScrollCards.register("picture", { build: buildPictureCard, normalize: normalizePictureMarkdown });
}
