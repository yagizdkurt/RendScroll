/* Shared DOM pieces used by card builders.
   Options keep renderer-specific class names explicit. */

function createRarityBadge(value, options) {
  const raw = value.trim();
  const label = options.rarities[raw] || raw;
  const badge = document.createElement("span");
  badge.className = options.className;
  if (options.rarities[raw]) badge.classList.add("rarity-" + raw);
  badge.textContent = label;
  return badge;
}

function renderMetaGrid(rows, options) {
  const meta = document.createElement("div");
  meta.className = options.className;

  rows.forEach(({ label, value }) => {
    const key = document.createElement("div");
    key.className = options.labelClass;
    key.textContent = label;
    meta.appendChild(key);

    const val = document.createElement("div");
    val.className = options.valueClass;
    if (options.isRarityLabel && options.isRarityLabel(label)) {
      val.appendChild(createRarityBadge(value, options.rarity));
    } else {
      val.textContent = value;
    }
    meta.appendChild(val);
  });

  return meta;
}

function renderProperties(labelNode, listNode, options) {
  const section = document.createElement("div");
  section.className = options.sectionClass;

  const title = document.createElement("div");
  title.className = options.titleClass;
  title.textContent = labelNode.textContent.trim().replace(/:\s*$/, "");
  section.appendChild(title);
  section.appendChild(listNode.cloneNode(true));

  return section;
}

function cloneAsReadAloud(node) {
  const clone = node.cloneNode(true);
  if (clone.tagName === "BLOCKQUOTE") clone.classList.add("read-aloud");
  return clone;
}

function insertCardHeader(card, mainEls, imageRaw) {
  const portrait = cardPortrait(imageRaw);
  const els = Array.isArray(mainEls) ? mainEls : [mainEls];
  if (portrait) {
    card.insertBefore(cardFigure(els, portrait), card.firstChild);
    return;
  }
  for (let j = els.length - 1; j >= 0; j--) {
    if (els[j]) card.insertBefore(els[j], card.firstChild);
  }
}
