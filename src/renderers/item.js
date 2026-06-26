/* Item section renderer.
   Receives a root DOM element and modifies ONLY Item sections in the DOM.
   It never fetches files, never touches the sidebar, and never calls
   another renderer. */

/* Text phase (runs before marked): inside an Item section, isolate a bare
   "Side:" line into its own paragraph so the column directive is always its own
   node, even when written with "Az Enter" right above a value-less label (e.g.
   "Özellikler:") that would otherwise swallow it out of the meta block. Mirrors
   the other card normalizers. */
function normalizeItemMarkdown(text) {
  return normalizeSectionDirectives(text, {
    startsSection: (line) => /^###\s+item\s*:/i.test(line),
    endsSection: (line) => /^#{1,3} /.test(line),
    shouldIsolate: (line) => /^side\s*:/i.test(line.trim()),
  });
}

/* A node ends the current section if it's a new heading/separator OR a card that
   another renderer already produced (e.g. an NPC card placed right before this
   Item). Without the card check the collector would swallow the next card. */
function itemIsBoundary(n) {
  if (/^(H[23]|HR)$/.test(n.tagName)) return true;
  return isRenderedCard(n);
}

const ITEM_RARITIES = {
  "1": "Common",
  "2": "Rare",
  "3": "Epic",
};

const ITEM_NON_META_LABELS = new Set(["dm", "özellikler", "properties"]);
const ITEM_RARITY_LABELS = new Set(["nadirlik", "rarity"]);
const ITEM_PROPERTIES_LABELS = new Set(["özellikler", "properties"]);

/* "Yapışık: T" / "Connect: T" flag'i: item'ı bir önceki objeye/yapışık item'a yapıştırır. */
const ITEM_STUCK_LABELS = new Set(["yapışık", "connect", "combine"]);
const ITEM_STUCK_TRUTHY = new Set(["t", "true", "yes", "1"]);

function itemTitleText(head) {
  return head.textContent.trim().replace(/^\s*item\s*:\s*/i, "").trim();
}

function itemMetaLines(node) {
  return parseMetaLines(node, ITEM_NON_META_LABELS);
}

function itemMetaBlock(rows) {
  return renderMetaGrid(rows, {
    className: "item-meta",
    labelClass: "item-meta-label",
    valueClass: "item-meta-value",
    isRarityLabel: (label) => ITEM_RARITY_LABELS.has(rsLower(label)),
    rarity: { className: "item-rarity", rarities: ITEM_RARITIES },
  });
}

function itemDescription(node) {
  const desc = document.createElement("div");
  desc.className = "item-description";
  [...node.childNodes].forEach((child) => desc.appendChild(child.cloneNode(true)));
  return desc;
}

function itemProperties(labelNode, listNode) {
  return renderProperties(labelNode, listNode, {
    sectionClass: "item-properties",
    titleClass: "item-properties-title",
  });
}

function isItemPropertiesLabel(node) {
  if (node.tagName !== "P") return false;
  return ITEM_PROPERTIES_LABELS.has(rsLower(node.textContent.trim()).replace(/:\s*$/, ""));
}

// Build one Item card from its heading + body nodes (produced by marked from the
// card's parsed source). Returns the card element, or null when there is no body.
function buildItemCard(head, nodes) {
    if (!nodes.length) return null;

    // Items render in the left column by default; a "Side: R" line (pulled out
    // of the meta block below) tags the card .card-right so layout moves it.
    const card = document.createElement("div");
    card.className = "item-card";
    let stuck = false;
    let imageRaw = ""; // "Image:" value, pulled out of the meta block when present

    const label = document.createElement("div");
    label.className = "item-label";
    label.textContent = "ITEM";

    const title = document.createElement("div");
    title.className = "item-title";
    title.textContent = itemTitleText(head);

    // Header (label + title + meta) sits beside the portrait; the rest flows
    // full-width below it.
    const headEls = [label, title];

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const meta = itemMetaLines(node);

      if (meta.length) {
        // Yapışık ve Image flag'lerini meta'dan ayıkla; geriye gerçek meta
        // kalırsa onu göster. Image, kartın sağ-üst portresine dönüşür.
        const stuckMeta = extractStuckMeta(meta, ITEM_STUCK_LABELS, ITEM_STUCK_TRUTHY);
        if (stuckMeta.stuck) stuck = true;

        const imageMeta = extractImageMeta(stuckMeta.rows);
        if (imageMeta.value) imageRaw = imageMeta.value;

        const sideMeta = extractSideMeta(imageMeta.rows);
        if (sideMeta.value && cardSideIsRight(sideMeta.value)) card.classList.add("card-right");

        if (sideMeta.rows.length) headEls.push(itemMetaBlock(sideMeta.rows));
      } else if (node.tagName === "BLOCKQUOTE") {
        card.appendChild(itemDescription(node));
      } else if (isItemPropertiesLabel(node) && nodes[i + 1] && nodes[i + 1].tagName === "UL") {
        card.appendChild(itemProperties(node, nodes[i + 1]));
        i++;
      } else {
        card.appendChild(node.cloneNode(true));
      }
    }

    // Place the header at the top: wrapped beside the portrait when an Image was
    // given, otherwise as plain stacked elements (no empty portrait reserved).
    insertCardHeader(card, headEls, imageRaw);

    if (stuck) card.classList.add("item-stuck");

    return card;
}
