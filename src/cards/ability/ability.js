/* Ability section renderer (Skill / Spell / Passive / Effect).
   Receives a root DOM element and modifies ONLY Ability sections in the DOM.
   It never fetches files, never touches the sidebar, and never calls another
   builder. Modeled on the Item card (cards/item/item.js).

   An ability is written as one of:

     ### Skill: İsim        ### Spell: İsim
     ### Passive: İsim      ### Effect: İsim

   The keyword used becomes the card's label (SKILL / SPELL / PASSIVE / EFFECT).
   The card renders in the left column by default; a "Side: R" line moves it to
   the right column. Fields:

     Tür: ...                 -> meta row
     Maliyet / Menzil / Bekleme: ...   -> meta rows
     Nadirlik: 1|2|3          -> rarity badge (Common/Rare/Epic)
     > serbest açıklama       -> description (read-aloud-ish)
     Özellikler:              -> titled bullet sub-section
     - ...
     Lore:                    -> read-aloud styled lore panel
     > ...
     Yapışık: T  (Connect: T) -> snaps onto the preceding item/obje/ability */

const ABILITY_HEAD = /^\s*(skill|spell|passive|effect)\s*:/i;

/* A node ends the current section if it's a new heading/separator OR a card that
   another renderer already produced (e.g. an item card placed right before this
   ability). Without the card check the collector would swallow the next card. */
function abilityIsBoundary(n) {
  if (/^(H[23]|HR)$/.test(n.tagName)) return true;
  return isRenderedCard(n);
}

const ABILITY_RARITIES = {
  "1": "Common",
  "2": "Rare",
  "3": "Epic",
};

const ABILITY_NON_META_LABELS = new Set(["dm", "özellikler", "properties", "lore"]);

// Özel işlenen alanlar TR/EN: "Nadirlik"/"Rarity" rozet olur, "Özellikler"/
// "Properties" liste alt-bölümü olur, "Lore" read-aloud panel olur.
const ABILITY_RARITY_LABELS = new Set(["nadirlik", "rarity"]);
const ABILITY_PROPERTIES_LABELS = new Set(["özellikler", "properties"]);
const ABILITY_LORE_LABELS = new Set(["lore"]);

/* "Yapışık: T" / "Connect: T" flag'i: ability'yi bir önceki obje/item/yapışık
   ability'ye yapıştırır. (Item renderer ile aynı sözcükler.) */
const ABILITY_STUCK_LABELS = new Set(["yapışık", "connect", "combine"]);
const ABILITY_STUCK_TRUTHY = new Set(["t", "true", "yes", "1"]);

/* Keyword captured from the heading -> uppercase label ("Spell" -> "SPELL"). */
function abilityLabelText(head) {
  const m = head.textContent.trim().match(ABILITY_HEAD);
  return (m ? m[1] : "ability").toUpperCase();
}

function abilityTitleText(head) {
  return head.textContent.trim().replace(ABILITY_HEAD, "").replace(/^\s*/, "").trim();
}

function abilityMetaBlock(rows) {
  return renderMetaGrid(rows, {
    className: "ability-meta",
    labelClass: "ability-meta-label",
    valueClass: "ability-meta-value",
    isRarityLabel: (label) => ABILITY_RARITY_LABELS.has(rsLower(label)),
    rarity: { className: "ability-rarity", rarities: ABILITY_RARITIES },
  });
}

// "> ..." description source lines -> .ability-description blocks (one per
// rendered blockquote), preserving inline markdown via marked.
function abilityDescriptionFromModel(lines) {
  if (!lines || !lines.length) return [];
  const tmp = document.createElement("div");
  tmp.innerHTML = renderMarkdown(lines.join("\n"));
  return [...tmp.children].map((node) => {
    if (node.tagName !== "BLOCKQUOTE") return node;
    const desc = document.createElement("div");
    desc.className = "ability-description";
    [...node.childNodes].forEach((child) => desc.appendChild(child));
    return desc;
  });
}

// Properties list (model strings) -> the titled .ability-properties sub-section.
function abilityPropertiesFromModel(label, items) {
  if (!items || !items.length) return null;
  const tmp = document.createElement("div");
  tmp.innerHTML = renderMarkdown(items.map((p) => "- " + p).join("\n"));
  const list = tmp.querySelector("ul, ol");
  if (!list) return null;
  return renderProperties({ textContent: (label || "Özellikler") + ":" }, list, {
    sectionClass: "ability-properties",
    titleClass: "ability-properties-title",
  });
}

// Parse the ability body lines into a model: meta rows (Tür/Maliyet/…), the
// properties list (Özellikler:), the lore panel (Lore:), and the description
// (> …). Image/Side/stuck are universal directives read from the AST node, so
// they never appear here. Mirrors the old node loop, on text not DOM.
function parseAbilityBody(cardNode) {
  const lines = cardBodyLines(cardNode);
  const model = { metaRows: [], properties: [], propertiesLabel: "Özellikler", description: [], lore: [], extras: [] };
  let i = 0;
  let mode = "body"; // flips to "lore" after a bare "Lore:" label
  while (i < lines.length) {
    const raw = lines[i];
    const t = raw.trim();
    if (!t) { i++; continue; }

    if (ABILITY_LORE_LABELS.has(rsLower(t).replace(/:\s*$/, "")) && /:\s*$/.test(t)) {
      mode = "lore";
      i++;
      continue;
    }
    if (mode === "lore") { model.lore.push(raw); i++; continue; }

    if (ABILITY_PROPERTIES_LABELS.has(rsLower(t).replace(/:\s*$/, "")) && /:\s*$/.test(t)) {
      model.propertiesLabel = t.replace(/:\s*$/, "");
      i++;
      while (i < lines.length) {
        const b = lines[i].trim().match(/^[-*]\s+(.*)$/);
        if (!b) { if (lines[i].trim() === "") { i++; continue; } break; }
        model.properties.push(b[1].trim());
        i++;
      }
      continue;
    }

    if (/^\s*>/.test(raw)) { model.description.push(raw); i++; continue; }

    const mm = t.match(/^([^:]+):\s*(.+)$/);
    if (mm && !ABILITY_NON_META_LABELS.has(rsLower(mm[1].trim()))) {
      model.metaRows.push({ label: mm[1].trim(), value: mm[2].trim() });
      i++;
      continue;
    }

    model.extras.push(raw);
    i++;
  }
  return model;
}

// Build one Ability card from its parsed AST node. Meta/properties/lore/desc come
// from parseAbilityBody; the keyword label + title from the heading; Image/Side/
// stuck from the resolved directives. A title-only Ability still returns a real
// card so editor anchors can attach tools to it.
function buildAbilityCard(cardNode, head, nodes) {
    const card = document.createElement("div");
    card.className = "ability-card";

    const data = parseAbilityBody(cardNode);

    const label = document.createElement("div");
    label.className = "ability-label";
    label.textContent = abilityLabelText(head);

    const title = document.createElement("div");
    title.className = "ability-title";
    title.textContent = abilityTitleText(head);

    // Header (label + title + meta) sits beside the portrait; the rest flows
    // full-width below it.
    const headEls = [label, title];
    const imageRaw = cardDirective(cardNode, "image").trim();
    if (cardIsRight(cardNode)) card.classList.add("card-right");
    if (data.metaRows.length) headEls.push(abilityMetaBlock(data.metaRows));

    abilityDescriptionFromModel(data.description).forEach((el) => card.appendChild(el));
    const props = abilityPropertiesFromModel(data.propertiesLabel, data.properties);
    if (props) card.appendChild(props);
    if (data.extras.length) {
      const tmp = document.createElement("div");
      tmp.innerHTML = renderMarkdown(data.extras.join("\n"));
      [...tmp.children].forEach((el) => card.appendChild(el));
    }

    if (data.lore.length) {
      const lorePanel = document.createElement("div");
      lorePanel.className = "ability-lore";
      const tmp = document.createElement("div");
      tmp.innerHTML = renderMarkdown(data.lore.join("\n"));
      [...tmp.children].forEach((el) => lorePanel.appendChild(cloneAsReadAloud(el)));
      card.appendChild(lorePanel);
    }

    // Place the header at the top: wrapped beside the portrait when an Image was
    // given, otherwise as plain stacked elements (no empty portrait reserved).
    insertCardHeader(card, headEls, imageRaw);

    if (cardNode.stuck) card.classList.add("ability-stuck");

    return card;
}

/* Self-register with the runtime card registry (cards/shared/cardRegistry.js).
   No normalizer: the builder reads directives/body from the parsed AST node. */
if (typeof RendScrollCards !== "undefined") {
  RendScrollCards.register("ability", { build: buildAbilityCard });
}
