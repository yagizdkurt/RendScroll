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

// A whole line that is just "Başlık:" (letters/spaces + colon). Dialog answers
// start with ">" or "-", so they never match — the distinction stays safe.
const NPC_TITLE_LINE = /^[ \t]*[\wÇĞİÖŞÜçğıöşü][\wÇĞİÖŞÜçğıöşü ]*:[ \t]*$/;

/* Text phase (runs before marked): inside an NPC section, make sure each bare
   "Başlık:" line is its own paragraph by inserting a blank line before it.
   This lets topics be written with "Az Enter" (no blank lines) and still render
   as subcards instead of being glued into the previous list/blockquote. */
function normalizeNpcMarkdown(text) {
  const out = [];
  let inNpc = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^### .*NPC/i.test(line)) { inNpc = true; out.push(line); continue; }
    if (/^#{1,3} /.test(line)) { inNpc = false; out.push(line); continue; }
    // Isolate directive/stat lines as their own paragraphs (blank line on both
    // sides) so they don't get glued into neighbouring blockquotes/lists.
    if (inNpc && (/^bg\s*:/i.test(line.trim()) || /^image\s*:/i.test(line.trim()) || /^side\s*:/i.test(line.trim()) || NPC_STAT_LINE.test(line.trim()) || /^checks\s*:\s*$/i.test(line.trim()))) {
      if (out.length && out[out.length - 1].trim() !== "") out.push("");
      out.push(line);
      out.push("");
      continue;
    }
    if (inNpc && NPC_TITLE_LINE.test(line)) {
      const prev = out.length ? out[out.length - 1] : "";
      if (prev.trim() !== "") out.push("");
    }
    out.push(line);
  }
  return out.join("\n");
}

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

function npcSubheadingText(node) {
  if (node.tagName === "H4") return node.textContent.trim();
  if (node.tagName !== "P") return "";

  const text = node.textContent.trim();

  // Legacy "#### Başlık" shorthand (marked needs a space after the hashes).
  const hashed = text.match(/^#{4}\s*(.+)$/);
  if (hashed) return hashed[1].trim();

  // Plain "Başlık:" line that is NOT a known NPC field label -> a dialog topic.
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

// A bare "Checks:" line switches the NPC card into skill-check mode.
function npcIsChecksLabel(node) {
  return node.tagName === "P" && /^checks\s*:\s*$/i.test(rsLower(node.textContent.trim()));
}

// A small uppercase label above the Checks sub-section (same look as Obje).
function npcSectionTitle(text) {
  const el = document.createElement("div");
  el.className = "obj-section-title";
  el.textContent = text;
  return el;
}

// Build one NPC card from its heading + body nodes (produced by marked from the
// card's parsed source). A title-only NPC still returns a real card so editor
// anchors can attach tools to it.
function buildNpcCard(head, nodes) {
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

    // The portrait column is created lazily, only when an Image is present, so a
    // card with no image reserves no empty third column.
    let portraitCol = null;

    card.appendChild(identity);

    let hasIdentity = false;
    let identityTarget = null;
    let dialogueDivider = null;
    let currentSubcard = null;
    let inChecks = false;     // collecting nodes for the Checks sub-section
    let checksBox = null;     // .skillchecks container, created on first Checks
    const checkNodes = [];    // collected and rendered together after the loop

    nodes.forEach((node) => {
      // "BG: file" picks the watermark behind this card. The CSS ::before
      // falls back to the standard npc image when --npc-bg is left unset.
      const bg = node.tagName === "P" && node.textContent.trim().match(/^bg\s*:\s*(.+)$/i);
      if (bg) {
        card.style.setProperty("--npc-bg", 'url("' + cardBgUrl(bg[1]) + '")');
        return; // the BG line itself is dropped
      }

      // "Side: R" moves the card to the right column; the line itself is dropped.
      const side = node.tagName === "P" && node.textContent.trim().match(CARD_SIDE_LINE);
      if (side) {
        if (cardSideIsRight(side[1])) card.classList.add("card-right");
        return;
      }

      const text = node.tagName === "P" ? node.textContent.trim() : "";
      const lowerText = rsLower(text);
      const image = text.match(CARD_IMAGE_LINE);
      if (image) {
        identityTarget = null;
        const portrait = cardPortrait(image[1]);
        if (portrait) {
          hasIdentity = true;
          if (!portraitCol) {
            portraitCol = document.createElement("div");
            portraitCol.className = "npc-identity-col npc-identity-portrait";
            identity.appendChild(portraitCol);
            identity.classList.add("npc-has-portrait");
          }
          portraitCol.innerHTML = "";
          portraitCol.appendChild(portrait);
        }
        return; // the Image line is represented by the portrait frame
      }

      const stat = text.match(NPC_STAT_LINE);
      if (stat) {
        hasIdentity = true;
        inChecks = false;
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

      if (NPC_PERSONALITY_LABELS.has(lowerText)) {
        hasIdentity = true;
        inChecks = false;
        currentSubcard = null;
        personalityCol.appendChild(npcTextFieldLabel(text));
        identityTarget = personalityCol;
        return;
      }

      // "Checks:" opens a skill-check sub-section (same look as Obje). It is
      // appended to the card itself, so it leaves any open dialog subcard.
      if (npcIsChecksLabel(node)) {
        inChecks = true;
        currentSubcard = null;
        identityTarget = null;
        if (!checksBox) {
          const section = document.createElement("div");
          section.className = "obj-section";
          section.appendChild(npcSectionTitle("Checks"));
          checksBox = document.createElement("div");
          checksBox.className = "skillchecks";
          section.appendChild(checksBox);
          card.appendChild(section);
        }
        return; // the label paragraph itself is dropped
      }

      const subheading = npcSubheadingText(node);
      if (subheading) {
        inChecks = false; // a dialog topic ends the Checks collection
        identityTarget = null;
        if (!dialogueDivider) {
          dialogueDivider = npcDialogueDivider("Dialogues");
          card.appendChild(dialogueDivider);
        }
        currentSubcard = document.createElement("div");
        currentSubcard.className = "npc-subcard";
        currentSubcard.appendChild(npcSubheading(subheading));
        card.appendChild(currentSubcard);
        return;
      }

      if (inChecks) {
        checkNodes.push(node);
        return;
      }

      if (identityTarget) {
        identityTarget.appendChild(npcCloneContent(node));
        return;
      }

      if (npcIsFieldLabel(node)) identityTarget = null;

      const target = currentSubcard || card;
      target.appendChild(npcCloneContent(node));
    });

    // Render collected Checks together so skill names share one grid column.
    if (checksBox) renderSkillCheckNodes(checksBox, checkNodes);
    if (!hasIdentity) identity.remove();

    return card;
}

/* Self-register with the runtime card registry (cards/shared/cardRegistry.js). */
if (typeof RendScrollCards !== "undefined") {
  RendScrollCards.register("npc", { build: buildNpcCard, normalize: normalizeNpcMarkdown });
}
