/* Item section renderer.
   Receives a root DOM element and modifies ONLY Item sections in the DOM.
   It never fetches files, never touches the sidebar, and never calls
   another renderer. */

function itemLower(s) {
  return s.replace(/İ/g, "i").replace(/I/g, "ı").toLowerCase();
}

/* A node ends the current section if it's a new heading/separator OR a card that
   another renderer already produced (e.g. an NPC card placed right before this
   Item). Without the card check the collector would swallow the next card. */
function itemIsBoundary(n) {
  if (/^(H[23]|HR)$/.test(n.tagName)) return true;
  return n.classList && (
    n.classList.contains("npc-card") ||
    n.classList.contains("item-card") ||
    n.classList.contains("ability-card") ||
    n.classList.contains("obj-card") ||
    n.classList.contains("unexpected-card")
  );
}

const ITEM_RARITIES = {
  "1": "Common",
  "2": "Rare",
  "3": "Epic",
};

const ITEM_NON_META_LABELS = new Set(["dm", "özellikler"]);

/* "Yapışık: T" / "Connect: T" flag'i: item'ı bir önceki objeye/yapışık item'a yapıştırır.
   Label kontrolü itemLower()'dan geçmiş haliyle yapılır; değer truthy ise aktif. */
const ITEM_STUCK_LABELS = new Set(["yapışık", "connect"]);
const ITEM_STUCK_TRUTHY = new Set(["t", "true"]);

function itemIsStuckValue(value) {
  return ITEM_STUCK_TRUTHY.has(itemLower(value.trim()));
}

function itemTitleText(head) {
  return head.textContent.trim().replace(/^_?\s*item\s*:\s*/i, "").trim();
}

function itemIsLeft(head) {
  return head.textContent.trim().startsWith("_");
}

function itemMetaLines(node) {
  if (node.tagName !== "P") return [];

  const lines = node.textContent.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return [];

  const meta = [];
  for (const line of lines) {
    const m = line.match(/^([^:]+):\s*(.+)$/);
    if (!m) return [];

    const label = m[1].trim();
    const value = m[2].trim();
    if (ITEM_NON_META_LABELS.has(itemLower(label))) return [];
    meta.push({ label, value });
  }

  return meta;
}

function itemRarityBadge(value) {
  const raw = value.trim();
  const label = ITEM_RARITIES[raw] || raw;
  const badge = document.createElement("span");
  badge.className = "item-rarity";
  if (ITEM_RARITIES[raw]) badge.classList.add("rarity-" + raw);
  badge.textContent = label;
  return badge;
}

function itemMetaBlock(rows) {
  const meta = document.createElement("div");
  meta.className = "item-meta";

  rows.forEach(({ label, value }) => {
    const key = document.createElement("div");
    key.className = "item-meta-label";
    key.textContent = label;
    meta.appendChild(key);

    const val = document.createElement("div");
    val.className = "item-meta-value";
    if (itemLower(label) === "nadirlik") val.appendChild(itemRarityBadge(value));
    else val.textContent = value;
    meta.appendChild(val);
  });

  return meta;
}

function itemDescription(node) {
  const desc = document.createElement("div");
  desc.className = "item-description";
  [...node.childNodes].forEach((child) => desc.appendChild(child.cloneNode(true)));
  return desc;
}

function itemProperties(labelNode, listNode) {
  const section = document.createElement("div");
  section.className = "item-properties";

  const title = document.createElement("div");
  title.className = "item-properties-title";
  title.textContent = labelNode.textContent.trim().replace(/:\s*$/, "");
  section.appendChild(title);
  section.appendChild(listNode.cloneNode(true));

  return section;
}

function isItemPropertiesLabel(node) {
  return node.tagName === "P" && itemLower(node.textContent.trim()) === "özellikler:";
}

function enhanceItemSections(root) {
  const heads = [...root.querySelectorAll("h3")].filter((h) =>
    /^_?\s*item\s*:/i.test(h.textContent.trim())
  );

  heads.forEach((head) => {
    // Stop at the next H2/H3 or an <hr> so the event separator stays standalone.
    const nodes = [];
    for (let n = head.nextElementSibling; n && !itemIsBoundary(n); n = n.nextElementSibling) {
      nodes.push(n);
    }

    if (!nodes.length) return;

    // Items default to the right column; "### _item: ..." swaps to the left.
    // The layout step keys off the .item-left marker; card rendering is shared.
    const card = document.createElement("div");
    card.className = itemIsLeft(head) ? "item-card item-left" : "item-card";
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
        const kept = [];
        for (const row of meta) {
          if (ITEM_STUCK_LABELS.has(itemLower(row.label.trim()))) {
            if (itemIsStuckValue(row.value)) stuck = true;
          } else if (/^image$/i.test(row.label.trim())) {
            if (row.value.trim()) imageRaw = row.value.trim();
          } else {
            kept.push(row);
          }
        }
        if (kept.length) headEls.push(itemMetaBlock(kept));
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
    const portrait = cardPortrait(imageRaw);
    if (portrait) {
      card.insertBefore(cardFigure(headEls, portrait), card.firstChild);
    } else {
      for (let j = headEls.length - 1; j >= 0; j--) card.insertBefore(headEls[j], card.firstChild);
    }

    if (stuck) card.classList.add("item-stuck");

    const marker = document.createComment("item-card");
    head.before(marker);
    head.remove();
    nodes.forEach((node) => node.remove());
    marker.replaceWith(card);
  });
}
