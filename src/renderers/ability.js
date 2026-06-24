/* Ability section renderer (Skill / Spell / Passive / Effect).
   Receives a root DOM element and modifies ONLY Ability sections in the DOM.
   It never fetches files, never touches the sidebar, and never calls another
   renderer. Modeled on the Item renderer (renderers/item.js).

   An ability is written as one of:

     ### Skill: İsim        ### Spell: İsim
     ### Passive: İsim      ### Effect: İsim

   The keyword used becomes the card's label (SKILL / SPELL / PASSIVE / EFFECT).
   A leading "_" ("### _Spell:") forces the right column (it is the default
   anyway, mirroring item cards). Fields:

     Tür: ...                 -> meta row
     Maliyet / Menzil / Bekleme: ...   -> meta rows
     Nadirlik: 1|2|3          -> rarity badge (Common/Rare/Epic)
     > serbest açıklama       -> description (read-aloud-ish)
     Özellikler:              -> titled bullet sub-section
     - ...
     Lore:                    -> read-aloud styled lore panel
     > ...
     Yapışık: T  (Connect: T) -> snaps onto the preceding item/obje/ability */

function abilityLower(s) {
  return s.replace(/İ/g, "i").replace(/I/g, "ı").toLowerCase();
}

const ABILITY_HEAD = /^_?\s*(skill|spell|passive|effect)\s*:/i;

/* A node ends the current section if it's a new heading/separator OR a card that
   another renderer already produced (e.g. an item card placed right before this
   ability). Without the card check the collector would swallow the next card. */
function abilityIsBoundary(n) {
  if (/^(H[23]|HR)$/.test(n.tagName)) return true;
  return n.classList && (
    n.classList.contains("npc-card") ||
    n.classList.contains("item-card") ||
    n.classList.contains("obj-card") ||
    n.classList.contains("ability-card") ||
    n.classList.contains("unexpected-card")
  );
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
const ABILITY_STUCK_LABELS = new Set(["yapışık", "connect"]);
const ABILITY_STUCK_TRUTHY = new Set(["t", "true"]);

function abilityIsStuckValue(value) {
  return ABILITY_STUCK_TRUTHY.has(abilityLower(value.trim()));
}

/* Keyword captured from the heading -> uppercase label ("Spell" -> "SPELL"). */
function abilityLabelText(head) {
  const m = head.textContent.trim().match(ABILITY_HEAD);
  return (m ? m[1] : "ability").toUpperCase();
}

function abilityTitleText(head) {
  return head.textContent.trim().replace(ABILITY_HEAD, "").replace(/^\s*/, "").trim();
}

function abilityMetaLines(node) {
  if (node.tagName !== "P") return [];

  const lines = node.textContent.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return [];

  const meta = [];
  for (const line of lines) {
    const m = line.match(/^([^:]+):\s*(.+)$/);
    if (!m) return [];

    const label = m[1].trim();
    const value = m[2].trim();
    if (ABILITY_NON_META_LABELS.has(abilityLower(label))) return [];
    meta.push({ label, value });
  }

  return meta;
}

function abilityRarityBadge(value) {
  const raw = value.trim();
  const label = ABILITY_RARITIES[raw] || raw;
  const badge = document.createElement("span");
  badge.className = "ability-rarity";
  if (ABILITY_RARITIES[raw]) badge.classList.add("rarity-" + raw);
  badge.textContent = label;
  return badge;
}

function abilityMetaBlock(rows) {
  const meta = document.createElement("div");
  meta.className = "ability-meta";

  rows.forEach(({ label, value }) => {
    const key = document.createElement("div");
    key.className = "ability-meta-label";
    key.textContent = label;
    meta.appendChild(key);

    const val = document.createElement("div");
    val.className = "ability-meta-value";
    if (ABILITY_RARITY_LABELS.has(abilityLower(label))) val.appendChild(abilityRarityBadge(value));
    else val.textContent = value;
    meta.appendChild(val);
  });

  return meta;
}

function abilityDescription(node) {
  const desc = document.createElement("div");
  desc.className = "ability-description";
  [...node.childNodes].forEach((child) => desc.appendChild(child.cloneNode(true)));
  return desc;
}

function abilityProperties(labelNode, listNode) {
  const section = document.createElement("div");
  section.className = "ability-properties";

  const title = document.createElement("div");
  title.className = "ability-properties-title";
  title.textContent = labelNode.textContent.trim().replace(/:\s*$/, "");
  section.appendChild(title);
  section.appendChild(listNode.cloneNode(true));

  return section;
}

function isAbilityPropertiesLabel(node) {
  if (node.tagName !== "P") return false;
  return ABILITY_PROPERTIES_LABELS.has(abilityLower(node.textContent.trim()).replace(/:\s*$/, ""));
}

// A bare "Lore:" line switches following nodes into the lore panel.
function isAbilityLoreLabel(node) {
  if (node.tagName !== "P") return false;
  return ABILITY_LORE_LABELS.has(abilityLower(node.textContent.trim()).replace(/:\s*$/, ""));
}

/* Text phase (runs before marked): inside an ability section, isolate a bare
   "Lore:" label on its own blank-separated line. Without this a label written
   right after a "> ..." line would be swallowed into the blockquote (lazy
   continuation). Mirrors normalizeObjMarkdown. */
function normalizeAbilityMarkdown(text) {
  const out = [];
  let inAbility = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^#{2,3}\s+/.test(line) && ABILITY_HEAD.test(line.replace(/^#{2,3}\s+/, ""))) {
      inAbility = true;
      out.push(line);
      continue;
    }
    if (/^#{1,3} /.test(line)) { inAbility = false; out.push(line); continue; }
    if (inAbility && /^lore\s*:\s*$/i.test(line.trim())) {
      if (out.length && out[out.length - 1].trim() !== "") out.push("");
      out.push(line);
      out.push("");
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

function enhanceAbilitySections(root) {
  const heads = [...root.querySelectorAll("h3")].filter((h) =>
    ABILITY_HEAD.test(h.textContent.trim())
  );

  heads.forEach((head) => {
    // Stop at the next H2/H3 or an <hr> so the event separator stays standalone.
    const nodes = [];
    for (let n = head.nextElementSibling; n && !abilityIsBoundary(n); n = n.nextElementSibling) {
      nodes.push(n);
    }

    if (!nodes.length) return;

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
        const clone = node.cloneNode(true);
        if (clone.tagName === "BLOCKQUOTE") clone.classList.add("read-aloud");
        lorePanel.appendChild(clone);
        continue;
      }

      const meta = abilityMetaLines(node);

      if (meta.length) {
        // Yapışık ve Image flag'lerini meta'dan ayıkla; geriye gerçek meta
        // kalırsa göster. Image, kartın sağ-üst portresine dönüşür.
        const kept = [];
        for (const row of meta) {
          if (ABILITY_STUCK_LABELS.has(abilityLower(row.label.trim()))) {
            if (abilityIsStuckValue(row.value)) stuck = true;
          } else if (/^image$/i.test(row.label.trim())) {
            if (row.value.trim()) imageRaw = row.value.trim();
          } else {
            kept.push(row);
          }
        }
        if (kept.length) headEls.push(abilityMetaBlock(kept));
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
    const portrait = cardPortrait(imageRaw);
    if (portrait) {
      card.insertBefore(cardFigure(headEls, portrait), card.firstChild);
    } else {
      for (let j = headEls.length - 1; j >= 0; j--) card.insertBefore(headEls[j], card.firstChild);
    }

    if (stuck) card.classList.add("ability-stuck");

    const marker = document.createComment("ability-card");
    head.before(marker);
    head.remove();
    nodes.forEach((node) => node.remove());
    marker.replaceWith(card);
  });
}
