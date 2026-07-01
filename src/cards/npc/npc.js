/* NPC section renderer.
   Receives a root DOM element and modifies ONLY NPC sections in the DOM.
   It never fetches files, never touches the sidebar, and never calls
   another renderer. */

/* BG/Image url resolution and the portrait frame are shared across all card
   builders (cards/shared/cardImage.js): cardBgUrl(), cardPortrait(). */

const NPC_FIELD_LABELS = new Set([
  "personality:",
  "kişilik:",
  "ilk diyalog:",
  "sorarsa:",
  "bildikleri:",
  "bilmedikleri:",
  "race:",
  "age:",
  "occupation:",
  "alignment:",
  "hp:",
  "ac:",
  "image:",
]);

const NPC_PERSONALITY_LABELS = new Set([
  "personality:",
  "kişilik:",
]);

const NPC_STAT_LINE = /^(race|age|occupation|alignment|hp|ac)\s*:\s*(.*)$/i;

function npcIsFieldLabel(node) {
  if (node.tagName !== "P") return false;

  const text = node.textContent.trim();
  return NPC_FIELD_LABELS.has(rsLower(text));
}

function npcFieldLabel(node) {
  const label = document.createElement("div");
  label.className = "npc-field";
  label.textContent = node.textContent.trim().replace(/:\s*$/, "");
  return label;
}

function npcTextFieldLabel(text) {
  const label = document.createElement("div");
  label.className = "npc-field";
  label.textContent = text.trim().replace(/:\s*$/, "");
  return label;
}

function npcCloneContent(node) {
  if (npcIsFieldLabel(node)) return npcFieldLabel(node);
  return cloneAsReadAloud(node);
}

function npcStatRow(label, value) {
  const row = document.createElement("div");
  row.className = "npc-stat-row";

  const key = document.createElement("div");
  key.className = "npc-stat-key";
  key.textContent = label;
  row.appendChild(key);

  const val = document.createElement("div");
  val.className = "npc-stat-value";
  val.textContent = value;
  row.appendChild(val);

  return row;
}

function npcDialogueDivider(text) {
  const divider = document.createElement("div");
  divider.className = "npc-dialogue-divider";
  divider.textContent = text;
  return divider;
}

// A body line that opens a dialogue topic subcard. "#### Başlık" shorthand or a
// bare "Başlık:" line that is NOT a known NPC field label. Returns the title text
// (or "" when the line is not a topic). Dialog answers start with ">" or "-", so
// they never match.
function npcTopicFromLine(line) {
  const text = String(line).trim();
  const hashed = text.match(/^#{4}\s*(.+)$/);
  if (hashed) return hashed[1].trim();
  if (text.endsWith(":") && text.length <= 40 && !NPC_FIELD_LABELS.has(rsLower(text))) {
    return text;
  }
  return "";
}

function npcSubheading(text) {
  const subtitle = document.createElement("div");
  subtitle.className = "npc-subtitle";
  subtitle.textContent = text;
  return subtitle;
}

// A small uppercase label above the Checks sub-section (same look as Obje).
function npcSectionTitle(text) {
  const el = document.createElement("div");
  el.className = "obj-section-title";
  el.textContent = text;
  return el;
}

// Pure per-type body parser: AST card node -> ordered NPC segments. Walks the body
// in source order (cardOrderedBody), classifying each line as an identity stat
// (Race/Age/…/HP/AC), a personality label, a dialogue topic, a "Checks:" group, or
// a content run. The builder replays the segments through its identity/dialogue DOM
// state machine; keeping the classification here as one named function mirrors the
// shared-parse discipline (RENDERER_AST_MIGRATION.md).
//   { kind: "stat", label, value }   value "" means the label heads a following run
//   { kind: "personality", label }
//   { kind: "topic", title }
//   { kind: "checks", checks }
//   { kind: "lines", lines }         a contiguous content run (blank lines kept)
function parseNpcBody(cardNode) {
  const segs = [];
  const pushLine = (line) => {
    const last = segs[segs.length - 1];
    if (last && last.kind === "lines") last.lines.push(line);
    else segs.push({ kind: "lines", lines: [line] });
  };
  cardOrderedBody(cardNode).forEach((seg) => {
    if (seg.kind === "checks") { segs.push({ kind: "checks", checks: seg.checks }); return; }
    seg.lines.forEach((line) => {
      const t = line.trim();
      if (t === "") { pushLine(line); return; }
      const stat = t.match(NPC_STAT_LINE);
      if (stat) {
        const rawLabel = stat[1].trim();
        const label = /^(hp|ac)$/i.test(rawLabel)
          ? rawLabel.toUpperCase()
          : rawLabel.replace(/^\w/, (c) => c.toUpperCase());
        segs.push({ kind: "stat", label, value: stat[2].trim() });
        return;
      }
      if (NPC_PERSONALITY_LABELS.has(rsLower(t))) { segs.push({ kind: "personality", label: t }); return; }
      const topic = npcTopicFromLine(t);
      if (topic) { segs.push({ kind: "topic", title: topic }); return; }
      pushLine(line);
    });
  });
  return segs;
}

// Build one NPC card from its parsed AST node. BG/Image/Side come from the
// resolved directives; identity (stats / personality), dialogue topics and Checks
// come from the shared parseNpcBody. A title-only NPC still returns a real card so
// editor anchors can attach tools to it.
function buildNpcCard(cardNode, head, nodes) {
    const card = document.createElement("div");
    card.className = "npc-card";

    const title = head.cloneNode(true);
    title.className = "npc-title";
    card.appendChild(title);

    const identity = document.createElement("div");
    identity.className = "npc-identity";

    const personalityCol = document.createElement("div");
    personalityCol.className = "npc-identity-col npc-identity-personality";
    identity.appendChild(personalityCol);

    const statsCol = document.createElement("div");
    statsCol.className = "npc-identity-col npc-identity-stats";
    identity.appendChild(statsCol);
    card.appendChild(identity);

    let hasIdentity = false;
    let identityTarget = null;  // identity column receiving the following content
    let dialogueDivider = null;
    let currentSubcard = null;

    // "BG: file" picks the watermark behind this card; "Image:" the portrait.
    const bg = cardDirective(cardNode, "bg").trim();
    if (bg) card.style.setProperty("--npc-bg", 'url("' + cardBgUrl(bg) + '")');
    if (cardIsRight(cardNode)) card.classList.add("card-right");
    const portrait = cardPortrait(cardDirective(cardNode, "image").trim());
    if (portrait) {
      hasIdentity = true;
      const portraitCol = document.createElement("div");
      portraitCol.className = "npc-identity-col npc-identity-portrait";
      portraitCol.appendChild(portrait);
      identity.appendChild(portraitCol);
      identity.classList.add("npc-has-portrait");
    }

    // Render a content run and route each produced node to the active target (an
    // identity column, the current dialogue subcard, or the card).
    function renderLines(lines) {
      renderMarkdownEls(lines.join("\n")).forEach((node) => {
        const target = identityTarget || currentSubcard || card;
        target.appendChild(npcCloneContent(node));
      });
    }

    parseNpcBody(cardNode).forEach((seg) => {
      if (seg.kind === "checks") {
        // "Checks:" renders as a sub-section (same look as Obje), leaving any
        // open dialog subcard / identity column.
        currentSubcard = null;
        identityTarget = null;
        const section = document.createElement("div");
        section.className = "obj-section";
        section.appendChild(npcSectionTitle("Checks"));
        const box = document.createElement("div");
        box.className = "skillchecks";
        section.appendChild(box);
        card.appendChild(section);
        renderSkillChecks(box, seg.checks);
        return;
      }
      if (seg.kind === "stat") {
        hasIdentity = true;
        currentSubcard = null;
        if (seg.value) {
          statsCol.appendChild(npcStatRow(seg.label, seg.value));
          identityTarget = null;
        } else {
          statsCol.appendChild(npcTextFieldLabel(seg.label + ":"));
          identityTarget = statsCol;
        }
        return;
      }
      if (seg.kind === "personality") {
        hasIdentity = true;
        currentSubcard = null;
        personalityCol.appendChild(npcTextFieldLabel(seg.label));
        identityTarget = personalityCol;
        return;
      }
      if (seg.kind === "topic") {
        identityTarget = null;
        if (!dialogueDivider) {
          dialogueDivider = npcDialogueDivider("Dialogues");
          card.appendChild(dialogueDivider);
        }
        currentSubcard = document.createElement("div");
        currentSubcard.className = "npc-subcard";
        currentSubcard.appendChild(npcSubheading(seg.title));
        card.appendChild(currentSubcard);
        return;
      }
      renderLines(seg.lines);
    });

    if (!hasIdentity) identity.remove();

    return card;
}

/* Self-register with the runtime card registry (cards/shared/cardRegistry.js).
   No normalizer: the builder reads directives/checkGroups/body from the AST node. */
if (typeof RendScrollCards !== "undefined") {
  RendScrollCards.register("npc", { build: buildNpcCard });
}

if (typeof window !== "undefined") window.parseNpcBody = parseNpcBody;
if (typeof module !== "undefined" && module.exports) module.exports = { parseNpcBody };
