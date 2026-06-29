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

function abilityMetaLines(node) {
  return parseMetaLines(node, ABILITY_NON_META_LABELS);
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

function abilityDescription(node) {
  const desc = document.createElement("div");
  desc.className = "ability-description";
  [...node.childNodes].forEach((child) => desc.appendChild(child.cloneNode(true)));
  return desc;
}

function abilityProperties(labelNode, listNode) {
  return renderProperties(labelNode, listNode, {
    sectionClass: "ability-properties",
    titleClass: "ability-properties-title",
  });
}

function isAbilityPropertiesLabel(node) {
  if (node.tagName !== "P") return false;
  return ABILITY_PROPERTIES_LABELS.has(rsLower(node.textContent.trim()).replace(/:\s*$/, ""));
}

// A bare "Lore:" line switches following nodes into the lore panel.
function isAbilityLoreLabel(node) {
  if (node.tagName !== "P") return false;
  return ABILITY_LORE_LABELS.has(rsLower(node.textContent.trim()).replace(/:\s*$/, ""));
}

/* Text phase (runs before marked): inside an ability section, isolate a bare
   "Lore:" label on its own blank-separated line. Without this a label written
   right after a "> ..." line would be swallowed into the blockquote (lazy
   continuation). Mirrors normalizeObjMarkdown. */
function normalizeAbilityMarkdown(text) {
  return normalizeSectionDirectives(text, {
    startsSection: (line) =>
      /^#{2,3}\s+/.test(line) && ABILITY_HEAD.test(line.replace(/^#{2,3}\s+/, "")),
    endsSection: (line) => /^#{1,3} /.test(line),
    shouldIsolate: (line) => /^lore\s*:\s*$/i.test(line.trim()) || /^side\s*:/i.test(line.trim()),
  });
}

// Build one Ability card from its heading + body nodes (produced by marked from
// the card's parsed source). A title-only Ability still returns a real card so
// editor anchors can attach tools to it.
function buildAbilityCard(head, nodes) {
    const card = document.createElement("div");
    card.className = "ability-card";
    let stuck = false;
    let imageRaw = ""; // "Image:" value, pulled out of the meta block when present
    let mode = "desc"; // flips to "lore" after a bare "Lore:" label
    let lorePanel = null;

    const label = document.createElement("div");
    label.className = "ability-label";
    label.textContent = abilityLabelText(head);

    const title = document.createElement("div");
    title.className = "ability-title";
    title.textContent = abilityTitleText(head);

    // Header (label + title + meta) sits beside the portrait; the rest flows
    // full-width below it.
    const headEls = [label, title];

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];

      if (isAbilityLoreLabel(node)) {
        mode = "lore";
        if (!lorePanel) {
          lorePanel = document.createElement("div");
          lorePanel.className = "ability-lore";
          card.appendChild(lorePanel);
        }
        continue; // the label paragraph itself is dropped
      }

      if (mode === "lore") {
        lorePanel.appendChild(cloneAsReadAloud(node));
        continue;
      }

      const meta = abilityMetaLines(node);

      if (meta.length) {
        // Yapışık ve Image flag'lerini meta'dan ayıkla; geriye gerçek meta
        // kalırsa göster. Image, kartın sağ-üst portresine dönüşür.
        const stuckMeta = extractStuckMeta(meta, ABILITY_STUCK_LABELS, ABILITY_STUCK_TRUTHY);
        if (stuckMeta.stuck) stuck = true;

        const imageMeta = extractImageMeta(stuckMeta.rows);
        if (imageMeta.value) imageRaw = imageMeta.value;

        const sideMeta = extractSideMeta(imageMeta.rows);
        if (sideMeta.value && cardSideIsRight(sideMeta.value)) card.classList.add("card-right");

        if (sideMeta.rows.length) headEls.push(abilityMetaBlock(sideMeta.rows));
      } else if (node.tagName === "BLOCKQUOTE") {
        card.appendChild(abilityDescription(node));
      } else if (isAbilityPropertiesLabel(node) && nodes[i + 1] && nodes[i + 1].tagName === "UL") {
        card.appendChild(abilityProperties(node, nodes[i + 1]));
        i++;
      } else {
        card.appendChild(node.cloneNode(true));
      }
    }

    // Place the header at the top: wrapped beside the portrait when an Image was
    // given, otherwise as plain stacked elements (no empty portrait reserved).
    insertCardHeader(card, headEls, imageRaw);

    if (stuck) card.classList.add("ability-stuck");

    return card;
}

/* Self-register with the runtime card registry (cards/shared/cardRegistry.js). */
if (typeof RendScrollCards !== "undefined") {
  RendScrollCards.register("ability", { build: buildAbilityCard, normalize: normalizeAbilityMarkdown });
}
