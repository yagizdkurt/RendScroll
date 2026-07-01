/* Item section renderer.
   Receives a root DOM element and modifies ONLY Item sections in the DOM.
   It never fetches files, never touches the sidebar, and never calls
   another renderer. */

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

const ITEM_RARITY_LABELS = new Set(["nadirlik", "rarity"]);
const ITEM_TYPE_LABELS = new Set(["tür", "type"]);
const ITEM_DAMAGE_LABELS = new Set(["hasar", "damage"]);

function itemTitleText(head) {
  return head.textContent.trim()
    .replace(/^\s*source\s*item\s*:\s*/i, "")
    .replace(/^\s*sourceitem\s*:\s*/i, "")
    .replace(/^\s*item\s*:\s*/i, "")
    .trim();
}

const ItemData = (() => {
  // Turkish-aware lowercaser — the one owner is utils/text.js (browser global
  // `rsLower`, loaded first; Node requires it), so the rule is not restated here.
  const lower = (typeof rsLower !== "undefined")
    ? rsLower
    : require("../../utils/text.js").rsLower;
  function normLabel(label) {
    const l = lower(label).replace(/\s+/g, " ").trim();
    if (l === "tür" || l === "type") return "type";
    if (l === "nadirlik" || l === "rarity") return "rarity";
    if (l === "hasar" || l === "damage") return "damage";
    return l;
  }
  function isClear(value) {
    return String(value || "").trim() === "-";
  }
  function splitLines(source) {
    return String(source || "").replace(/\r?\n/g, "\n").split("\n");
  }
  function parse(source) {
    const lines = splitLines(source);
    const out = {
      kind: "item",
      title: "",
      sourceItem: "",
      image: "",
      metaRows: [],
      description: [],
      properties: [],
      controls: [],
      extras: [],
      propertiesLabel: "Özellikler",
    };
    let i = 0;
    const hm = lines[0] && lines[0].match(/^\s*###\s+(source\s*item|sourceitem|item)\s*:\s*(.*)$/i);
    if (hm) {
      out.kind = /^item$/i.test(hm[1].replace(/\s+/g, "")) ? "item" : "sourceitem";
      out.title = hm[2].trim();
      i = 1;
    }
    const control = /^(side|text\s*size|yapışık|connect|combine|closed)\s*:\s*(.*)$/i;
    while (i < lines.length) {
      const line = lines[i];
      const t = line.trim();
      if (!t) { i++; continue; }
      const props = t.match(/^(özellikler|properties)\s*:\s*$/i);
      if (props) {
        out.propertiesLabel = line.trim().replace(/:\s*$/, "");
        i++;
        while (i < lines.length) {
          const bullet = lines[i].trim().match(/^[-*]\s+(.*)$/);
          if (!bullet) {
            if (lines[i].trim() === "") { i++; continue; }
            break;
          }
          out.properties.push(bullet[1].trim());
          i++;
        }
        continue;
      }
      if (/^\s*>/.test(line)) {
        out.description.push(line);
        i++;
        continue;
      }
      const sm = t.match(/^(source\s*item|sourceitem)\s*:\s*(.*)$/i);
      if (sm) { out.sourceItem = sm[2].trim(); i++; continue; }
      const cm = t.match(control);
      if (cm) { out.controls.push({ label: cm[1].trim(), value: cm[2].trim() }); i++; continue; }
      const im = t.match(/^image\s*:\s*(.*)$/i);
      if (im) { out.image = im[1].trim(); i++; continue; }
      const mm = t.match(/^([^:]+):\s*(.+)$/);
      if (mm) {
        out.metaRows.push({ label: mm[1].trim(), value: mm[2].trim() });
        i++;
        continue;
      }
      out.extras.push(line);
      i++;
    }
    return out;
  }
  function choose(instanceValue, sourceValue) {
    if (isClear(instanceValue)) return "";
    return String(instanceValue || "").trim() ? instanceValue : (sourceValue || "");
  }
  function mergeRows(sourceRows, instanceRows) {
    const result = [];
    const index = new Map();
    (sourceRows || []).forEach((row) => {
      if (isClear(row.value)) return;
      index.set(normLabel(row.label), result.length);
      result.push({ label: row.label, value: row.value });
    });
    (instanceRows || []).forEach((row) => {
      const key = normLabel(row.label);
      if (isClear(row.value)) {
        if (index.has(key)) result.splice(index.get(key), 1);
        index.clear();
        result.forEach((r, i) => index.set(normLabel(r.label), i));
        return;
      }
      if (index.has(key)) result[index.get(key)] = { label: row.label, value: row.value };
      else {
        index.set(key, result.length);
        result.push({ label: row.label, value: row.value });
      }
    });
    return result;
  }
  function chooseList(instanceList, sourceList) {
    if (instanceList && instanceList.length) {
      return instanceList.length === 1 && isClear(instanceList[0]) ? [] : instanceList;
    }
    return sourceList || [];
  }
  function chooseLines(instanceLines, sourceLines) {
    const text = (instanceLines || []).join("\n").trim();
    if (isClear(text)) return [];
    return text ? instanceLines : (sourceLines || []);
  }
  function merge(instance, source) {
    const base = source || { title: "", image: "", metaRows: [], description: [], properties: [], extras: [] };
    return {
      kind: "item",
      title: choose(instance.title, base.title),
      image: choose(instance.image, base.image),
      metaRows: mergeRows(base.metaRows, instance.metaRows),
      description: chooseLines(instance.description, base.description),
      properties: chooseList(instance.properties, base.properties),
      propertiesLabel: instance.properties.length ? instance.propertiesLabel : (base.propertiesLabel || instance.propertiesLabel || "Özellikler"),
      controls: instance.controls || [],
      extras: chooseLines(instance.extras, base.extras),
    };
  }
  function serialize(data, kind) {
    const heading = kind === "sourceitem" ? "SourceItem" : "Item";
    const lines = ["### " + heading + ": " + (data.title || "")];
    if (kind !== "sourceitem") {
      (data.controls || []).forEach((row) => {
        if (!/^text\s*size$/i.test(row.label)) lines.push(row.label + ": " + row.value);
      });
    }
    if (data.image) lines.push("Image: " + data.image);
    (data.metaRows || []).forEach((row) => lines.push(row.label + ": " + row.value));
    if (data.description && data.description.length) {
      lines.push("");
      data.description.forEach((line) => lines.push(line));
    }
    if (data.properties && data.properties.length) {
      lines.push("");
      lines.push((data.propertiesLabel || "Özellikler") + ":");
      data.properties.forEach((prop) => lines.push("- " + prop));
    }
    if (data.extras && data.extras.length) {
      lines.push("");
      data.extras.forEach((line) => lines.push(line));
    }
    return lines.join("\n") + "\n";
  }
  function resolveItemSource(source, resolver) {
    const instance = parse(source);
    const sourceText = instance.sourceItem && typeof resolver === "function" ? resolver(instance.sourceItem) : null;
    const base = sourceText ? parse(sourceText) : null;
    return serialize(base ? merge(instance, base) : instance, "item");
  }
  function sourceItemRenderSource(source) {
    return serialize(parse(source), "sourceitem");
  }
  return { parse, merge, serialize, resolveItemSource, sourceItemRenderSource };
})();

// Type -> a category-colored pill (DnD 5e taxonomy via ItemTypes); Damage ->
// dice + damage-type icons with per-type color (shared renderDamage). Both fall
// back to plain text when their helper module isn't loaded.
function itemTypePill(value) {
  if (typeof ItemTypes === "undefined") return null;
  const pill = document.createElement("span");
  pill.className = "item-type-pill";
  const category = ItemTypes.category(value);
  if (category) pill.classList.add("item-type-" + category);
  pill.textContent = ItemTypes.label(value);
  return pill;
}

function itemDamageValue(value) {
  if (typeof renderDamage === "undefined") return null;
  const box = document.createElement("span");
  box.className = "item-damage";
  renderDamage(box, value, { prefix: "item-" });
  return box;
}

function itemCustomValue(label, value) {
  const key = rsLower(label);
  if (ITEM_TYPE_LABELS.has(key)) return itemTypePill(value);
  if (ITEM_DAMAGE_LABELS.has(key)) return itemDamageValue(value);
  return null;
}

function itemMetaBlock(rows) {
  return renderMetaGrid(rows, {
    className: "item-meta",
    labelClass: "item-meta-label",
    valueClass: "item-meta-value",
    isRarityLabel: (label) => ITEM_RARITY_LABELS.has(rsLower(label)),
    rarity: { className: "item-rarity", rarities: ITEM_RARITIES },
    customValue: itemCustomValue,
  });
}

// "> ..." description source lines -> .item-description blocks (one per rendered
// blockquote), preserving inline markdown via marked.
function itemDescriptionFromModel(lines) {
  if (!lines || !lines.length) return [];
  return renderMarkdownEls(lines.join("\n")).map((node) => {
    if (node.tagName !== "BLOCKQUOTE") return node;
    const desc = document.createElement("div");
    desc.className = "item-description";
    [...node.childNodes].forEach((child) => desc.appendChild(child));
    return desc;
  });
}

// Properties list (model strings) -> the titled .item-properties sub-section,
// rendering each entry through marked so inline markdown is preserved.
function itemPropertiesFromModel(label, items) {
  if (!items || !items.length) return null;
  const tmp = document.createElement("div");
  tmp.innerHTML = renderMarkdown(items.map((p) => "- " + p).join("\n"));
  const list = tmp.querySelector("ul, ol");
  if (!list) return null;
  return renderProperties({ textContent: (label || "Özellikler") + ":" }, list, {
    sectionClass: "item-properties",
    titleClass: "item-properties-title",
  });
}

// Pure per-type body parser: AST card node -> item model. Reconstructs the item
// source from the node (heading derived from the node's type + title, body from
// cardBodySource) and runs the canonical ItemData.parse, so the render builder
// below AND editor/cardSchemas.js model an Item's fields through the exact same
// code. Universal directives (Image/Side/…) also surface here (ItemData folds them
// into image/controls) and are otherwise read off the node by each consumer.
function parseItemBody(cardNode) {
  const heading = cardNode && cardNode.type === "sourceitem" ? "SourceItem" : "Item";
  const title = (cardNode && cardNode.title) || "";
  return ItemData.parse("### " + heading + ": " + title + "\n" + cardBodySource(cardNode));
}

// Build one Item card from its parsed AST node. The item model comes from the
// shared parseItemBody (canonical ItemData.parse); Image/Side/stuck come from the
// resolved directives. A title-only Item still returns a real card so editor
// anchors can attach tools to it.
function buildItemCard(cardNode, head, nodes) {
    const card = document.createElement("div");
    card.className = "item-card";

    const data = parseItemBody(cardNode);

    const label = document.createElement("div");
    label.className = "item-label";
    label.textContent = "ITEM";

    const title = document.createElement("div");
    title.className = "item-title";
    title.textContent = data.title || itemTitleText(head);

    // Header (label + title + meta) sits beside the portrait; the rest flows
    // full-width below it.
    const headEls = [label, title];
    const imageRaw = (cardDirective(cardNode, "image") || data.image || "").trim();
    if (cardIsRight(cardNode)) card.classList.add("card-right");
    if (data.metaRows.length) headEls.push(itemMetaBlock(data.metaRows));

    itemDescriptionFromModel(data.description).forEach((el) => card.appendChild(el));
    const props = itemPropertiesFromModel(data.propertiesLabel, data.properties);
    if (props) card.appendChild(props);
    if (data.extras && data.extras.length) {
      renderMarkdownEls(data.extras.join("\n")).forEach((el) => card.appendChild(el));
    }

    // Place the header at the top: wrapped beside the portrait when an Image was
    // given, otherwise as plain stacked elements (no empty portrait reserved).
    insertCardHeader(card, headEls, imageRaw);

    if (cardNode.stuck) card.classList.add("item-stuck");

    return card;
}

function buildSourceItemCard(cardNode, head, nodes) {
  return buildItemCard(cardNode, head, nodes);
}

if (typeof window !== "undefined") { window.ItemData = ItemData; window.parseItemBody = parseItemBody; }
if (typeof module !== "undefined" && module.exports) module.exports = { ItemData, parseItemBody };

/* Self-register with the runtime card registry (cards/shared/cardRegistry.js).
   sourceitem (library base item) renders through the same builder. No normalizer:
   the builder reads directives/body from the parsed AST node (via ItemData.parse). */
if (typeof RendScrollCards !== "undefined") {
  RendScrollCards.register("item", { build: buildItemCard });
  RendScrollCards.register("sourceitem", { build: buildSourceItemCard });
}
