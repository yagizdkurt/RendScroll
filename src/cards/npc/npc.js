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

// Build one NPC card from its parsed AST node. BG/Image/Side come from the
// resolved directives; "Checks:" blocks from cardNode.checkGroups; identity
// (stats / personality) and dialogue topics are parsed from cardNode.body text,
// in source order. A title-only NPC still returns a real card so editor anchors
// can attach tools to it.
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
    let buf = [];               // plain content lines awaiting a marked render

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

    // Render the buffered content run and route each produced node to the active
    // target (an identity column, the current dialogue subcard, or the card).
    function flushBuf() {
      if (!buf.length) return;
      const tmp = document.createElement("div");
      tmp.innerHTML = renderMarkdown(buf.join("\n"));
      [...tmp.children].forEach((node) => {
        const target = identityTarget || currentSubcard || card;
        target.appendChild(npcCloneContent(node));
      });
      buf = [];
    }

    cardOrderedBody(cardNode).forEach((seg) => {
      if (seg.kind === "checks") {
        // "Checks:" renders as a sub-section (same look as Obje), leaving any
        // open dialog subcard / identity column.
        flushBuf();
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
      seg.lines.forEach((line) => {
        const t = line.trim();
        if (t === "") { buf.push(line); return; }

        const stat = t.match(NPC_STAT_LINE);
        if (stat) {
          flushBuf();
          hasIdentity = true;
          currentSubcard = null;
          const rawLabel = stat[1].trim();
          const label = /^(hp|ac)$/i.test(rawLabel)
            ? rawLabel.toUpperCase()
            : rawLabel.replace(/^\w/, (c) => c.toUpperCase());
          if (stat[2].trim()) {
            statsCol.appendChild(npcStatRow(label, stat[2].trim()));
            identityTarget = null;
          } else {
            statsCol.appendChild(npcTextFieldLabel(label + ":"));
            identityTarget = statsCol;
          }
          return;
        }

        if (NPC_PERSONALITY_LABELS.has(rsLower(t))) {
          flushBuf();
          hasIdentity = true;
          currentSubcard = null;
          personalityCol.appendChild(npcTextFieldLabel(t));
          identityTarget = personalityCol;
          return;
        }

        const topic = npcTopicFromLine(t);
        if (topic) {
          flushBuf();
          identityTarget = null;
          if (!dialogueDivider) {
            dialogueDivider = npcDialogueDivider("Dialogues");
            card.appendChild(dialogueDivider);
          }
          currentSubcard = document.createElement("div");
          currentSubcard.className = "npc-subcard";
          currentSubcard.appendChild(npcSubheading(topic));
          card.appendChild(currentSubcard);
          return;
        }

        buf.push(line);
      });
    });
    flushBuf();

    if (!hasIdentity) identity.remove();

    return card;
}

/* Self-register with the runtime card registry (cards/shared/cardRegistry.js).
   No normalizer: the builder reads directives/checkGroups/body from the AST node. */
if (typeof RendScrollCards !== "undefined") {
  RendScrollCards.register("npc", { build: buildNpcCard });
}
