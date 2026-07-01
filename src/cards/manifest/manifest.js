/* Scene Manifest renderer.
   A compact "at a glance" card that heads a scene: approximate Duration, a one-line
   Summary, and short bullet lists of Goals / Key NPCs / Rewards. Authored as a bare
   "### Manifest" heading (no colon, no title — the display title is fixed). It is
   written at the TOP of a scene file, so the flat-DOM/layout pass naturally places it
   in the full-width .page-header band at the very top (see cards/shared/layout.js).

   It never fetches files, never touches the sidebar, and never calls another
   renderer. */

// The scalar (single "Label: value") and list ("Label:" + "- " bullets) fields, in
// display/serialize order. English labels — the schema mirrors these mdLabels.
const MANIFEST_SCALARS = [
  { key: "duration", label: "Duration" },
  { key: "summary", label: "Summary" },
];
const MANIFEST_LISTS = [
  { key: "goals", label: "Goals" },
  { key: "keyNpcs", label: "Key NPCs" },
  { key: "rewards", label: "Rewards" },
];

// Pure per-type body parser: AST card node -> manifest model
// { duration, summary, goals[], keyNpcs[], rewards[] }. Reads the card's non-heading
// source lines (cardBodySource) and pulls scalars ("Duration: …") and labelled bullet
// lists ("Goals:" then "- …"). Shared by the render builder below AND
// editor/cardSchemas.js (via fromBody), so the fields never parse two ways.
function parseManifestBody(cardNode) {
  const out = { duration: "", summary: "", goals: [], keyNpcs: [], rewards: [] };
  const source = (typeof cardBodySource !== "undefined") ? cardBodySource(cardNode) : "";
  const lines = String(source || "").replace(/\r?\n/g, "\n").split("\n");

  const scalarBy = {};
  MANIFEST_SCALARS.forEach((f) => { scalarBy[f.label.toLowerCase()] = f.key; });
  const listBy = {};
  MANIFEST_LISTS.forEach((f) => { listBy[f.label.toLowerCase()] = f.key; });

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) continue;
    const m = t.match(/^([^:]+):\s*(.*)$/);
    if (!m) continue;
    const label = m[1].trim().toLowerCase();
    const rest = m[2].trim();

    if (scalarBy[label]) { out[scalarBy[label]] = rest; continue; }

    if (listBy[label] && !rest) {
      // Consume the following "- " bullets (tolerating blank lines between).
      const items = [];
      let j = i + 1;
      while (j < lines.length) {
        const bt = lines[j].trim();
        if (bt === "") { j++; continue; }
        const bm = bt.match(/^[-*]\s+(.*)$/);
        if (!bm) break;
        items.push(bm[1].trim());
        j++;
      }
      out[listBy[label]] = items;
      i = j - 1;
    }
  }
  return out;
}

// One compact "Label: value" row.
function manifestRow(label, value) {
  const row = document.createElement("div");
  row.className = "manifest-row";
  const lab = document.createElement("span");
  lab.className = "manifest-label";
  lab.textContent = label;
  const val = document.createElement("span");
  val.className = "manifest-value";
  val.textContent = value;
  row.appendChild(lab);
  row.appendChild(val);
  return row;
}

// One labelled bullet list ("Goals" + <ul>), or null when empty.
function manifestList(label, items) {
  if (!items || !items.length) return null;
  const block = document.createElement("div");
  block.className = "manifest-list";
  const lab = document.createElement("div");
  lab.className = "manifest-label";
  lab.textContent = label;
  const ul = document.createElement("ul");
  items.forEach((it) => {
    const li = document.createElement("li");
    li.textContent = it;
    ul.appendChild(li);
  });
  block.appendChild(lab);
  block.appendChild(ul);
  return block;
}

// Build one Scene Manifest card from its parsed AST node. Empty fields are omitted,
// so a manifest with only a Duration renders just that row. Always returns a real
// card so editor anchors can attach tools to it.
function buildManifestCard(cardNode, head, nodes) {
  const card = document.createElement("div");
  card.className = "manifest-card";
  if (cardIsRight(cardNode)) card.classList.add("card-right");

  const title = document.createElement("div");
  title.className = "manifest-title";
  title.textContent = "Scene Manifest";
  card.appendChild(title);

  const data = parseManifestBody(cardNode);

  const rows = MANIFEST_SCALARS
    .filter((f) => String(data[f.key] || "").trim())
    .map((f) => manifestRow(f.label, data[f.key]));
  if (rows.length) {
    const wrap = document.createElement("div");
    wrap.className = "manifest-rows";
    rows.forEach((r) => wrap.appendChild(r));
    card.appendChild(wrap);
  }

  MANIFEST_LISTS.forEach((f) => {
    const block = manifestList(f.label, data[f.key]);
    if (block) card.appendChild(block);
  });

  return card;
}

if (typeof window !== "undefined") window.parseManifestBody = parseManifestBody;
if (typeof module !== "undefined" && module.exports) module.exports = { parseManifestBody };

/* Self-register with the runtime card registry (cards/shared/cardRegistry.js).
   No normalizer: the builder reads directives/body from the parsed AST node. */
if (typeof RendScrollCards !== "undefined") {
  RendScrollCards.register("manifest", { build: buildManifestCard });
}
