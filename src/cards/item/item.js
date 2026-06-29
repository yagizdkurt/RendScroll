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
    startsSection: (line) => /^###\s+(source\s*item|sourceitem|item)\s*:/i.test(line),
    endsSection: (line) => /^#{1,3} /.test(line),
    shouldIsolate: (line) => /^(source\s*item|sourceitem|side)\s*:/i.test(line.trim()),
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

const ITEM_NON_META_LABELS = new Set(["dm", "özellikler", "properties", "sourceitem", "source item"]);
const ITEM_RARITY_LABELS = new Set(["nadirlik", "rarity"]);
const ITEM_PROPERTIES_LABELS = new Set(["özellikler", "properties"]);

/* "Yapışık: T" / "Connect: T" flag'i: item'ı bir önceki objeye/yapışık item'a yapıştırır. */
const ITEM_STUCK_LABELS = new Set(["yapışık", "connect", "combine"]);
const ITEM_STUCK_TRUTHY = new Set(["t", "true", "yes", "1"]);

function itemTitleText(head) {
  return head.textContent.trim()
    .replace(/^\s*source\s*item\s*:\s*/i, "")
    .replace(/^\s*sourceitem\s*:\s*/i, "")
    .replace(/^\s*item\s*:\s*/i, "")
    .trim();
}

const ItemData = (() => {
  function lower(value) {
    return String(value == null ? "" : value).replace(/İ/g, "i").replace(/I/g, "ı").toLowerCase();
  }
  function normLabel(label) {
    const l = lower(label).replace(/\s+/g, " ").trim();
    if (l === "tür" || l === "type") return "type";
    if (l === "nadirlik" || l === "rarity") return "rarity";
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
// card's parsed source). A title-only Item still returns a real card so editor
// anchors can attach tools to it.
function buildItemCard(head, nodes) {
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

function buildSourceItemCard(head, nodes) {
  return buildItemCard(head, nodes);
}

if (typeof window !== "undefined") window.ItemData = ItemData;
if (typeof module !== "undefined" && module.exports) module.exports = { ItemData };

/* Self-register with the runtime card registry (cards/shared/cardRegistry.js).
   sourceitem (library base item) renders through the same builder + normalizer. */
if (typeof RendScrollCards !== "undefined") {
  RendScrollCards.register("item", { build: buildItemCard, normalize: normalizeItemMarkdown });
  RendScrollCards.register("sourceitem", { build: buildSourceItemCard, normalize: normalizeItemMarkdown });
}
