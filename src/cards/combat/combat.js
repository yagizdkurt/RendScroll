/* Combat (Savaş) section renderer.
   Receives a root DOM element and modifies ONLY Savaş sections in the DOM.
   It never fetches files and never touches the sidebar.

   A Savaş block is written as:

     ### Savaş: İsim
     `DM notu (read-aloud değil, kenar notu)`     (optional)
     Stat:
     - AC 16 | HP 80 | Hız 30 ft.
     - Atak: ...
     Taktik:
     - ...
     Özel Mekanik:          (any "Label:" line opens a new titled sub-section)
     - ...

   Layout produced (a single .combat-card):
     - title
     - leading "> ..." blocks   -> read-aloud DM blocks
     - inline-code lines         -> DM side notes (kept as-is)
     - each "Label:" line         -> a titled sub-section header, with the list /
                                     content that follows grouped under it

   The card renders in the left column by default; a "Side: R" line moves it to
   the right column. */

// A bare "Label:" line (letters/spaces only, ending in a colon) opens a
// sub-section. Read-aloud (">") and list ("-") lines never match.
const COMBAT_LABEL_RE = /^[\p{L} ]+:\s*$/u;

// True only for a "### Savaş:" heading (colon form).
function isCombatHead(h) {
  return /^\s*sava[şs]\s*:/.test(rsLower(h.textContent).trim());
}

/* A node ends the current section if it's a new heading/separator OR a card that
   another renderer already produced, so those don't get swallowed. */
function combatIsBoundary(n) {
  if (/^(H[1-3]|HR)$/.test(n.tagName)) return true;
  return isRenderedCard(n);
}

/* Text phase (runs before marked): inside a Savaş section, isolate each bare
   "Label:" line on its own blank-separated line. Without this a label written
   right after a list item is absorbed as lazy continuation, and a label after a
   "> ..." line is swallowed into the blockquote. */
function normalizeCombatMarkdown(text) {
  return normalizeSectionDirectives(text, {
    startsSection: (line) => /^###\s+sava[şs]\s*:/i.test(line),
    endsSection: (line) => /^#{1,3} /.test(line),
    shouldIsolate: (line) => (
      COMBAT_LABEL_RE.test(line.trim()) ||
      /^image\s*:/i.test(line.trim()) ||
      /^side\s*:/i.test(line.trim())
    ),
  });
}

// A bare "Label:" paragraph becomes a sub-section title; returns the label text
// without the trailing colon (or "" when the node is not a label).
function combatLabel(node) {
  if (node.tagName !== "P") return "";
  const t = node.textContent.trim();
  return COMBAT_LABEL_RE.test(t) ? t.replace(/\s*:\s*$/, "") : "";
}

function combatSectionTitle(text) {
  const el = document.createElement("div");
  el.className = "combat-section-title";
  el.textContent = text;
  return el;
}

// A "Checks:" / "Skill Checks:" label opens a skill-check sub-section that
// renders identically to the Skill Checks panel (and to Obje's Checks).
function combatIsChecksLabel(label) {
  return /^(skill\s+)?checks?$/.test(rsLower(label).trim());
}

// Build one Savaş card from its heading + body nodes (produced by marked from the
// card's parsed source). Returns the card element.
function buildCombatCard(head, nodes) {
    // Combat renders in the left column by default; a "Side: R" line (handled in
    // the node loop below) tags the card .card-right so layout moves it.
    const card = document.createElement("div");
    card.className = "combat-card";

    const title = document.createElement("div");
    title.className = "combat-title";
    title.textContent = head.textContent.trim().replace(/^\s*sava[şs]\s*:\s*/i, "").trim();

    // Header = title + leading content (before the first "Label:" section),
    // placed beside the portrait when an Image is given; sections flow below.
    const headEls = [title];
    let imageRaw = "";
    let headOpen = true;

    let checksBox = null;  // .skillchecks container while in a "Checks:" section
    const checkNodes = []; // collected and rendered together when the run ends

    // Render whatever Checks nodes have been collected so far, then close the run.
    function flushChecks() {
      if (checksBox) renderSkillCheckNodes(checksBox, checkNodes);
      checksBox = null;
      checkNodes.length = 0;
    }

    nodes.forEach((node) => {
      // "Image: file" becomes the top-right portrait.
      const image = node.tagName === "P" && node.textContent.trim().match(CARD_IMAGE_LINE);
      if (image) {
        if (image[1].trim()) imageRaw = image[1].trim();
        return; // the Image line is represented by the portrait frame
      }

      // "Side: R" moves the card to the right column; the line itself is dropped.
      const side = node.tagName === "P" && node.textContent.trim().match(CARD_SIDE_LINE);
      if (side) {
        if (cardSideIsRight(side[1])) card.classList.add("card-right");
        return;
      }

      const label = combatLabel(node);
      if (label) {
        // Every "Label:" opens a new sub-section, which also closes any open
        // Checks run (so e.g. an "Ekstra:" block after Checks stays separate).
        headOpen = false; // the leading header content ends at the first section
        flushChecks();
        if (combatIsChecksLabel(label)) {
          const section = document.createElement("div");
          section.className = "combat-section";
          section.appendChild(combatSectionTitle(label));
          checksBox = document.createElement("div");
          checksBox.className = "skillchecks";
          section.appendChild(checksBox);
          card.appendChild(section);
        } else {
          card.appendChild(combatSectionTitle(label));
        }
        return; // the label paragraph itself is replaced by the title
      }
      if (checksBox) {
        checkNodes.push(node); // collected; rendered together by flushChecks()
        return;
      }
      const clone = cloneAsReadAloud(node);
      if (headOpen) headEls.push(clone); // leading content stays beside portrait
      else card.appendChild(clone);
    });

    flushChecks(); // render a Checks run that reached the end of the card

    // Place the header at the top: wrapped beside the portrait when an Image was
    // given, otherwise as plain stacked elements (no empty portrait reserved).
    insertCardHeader(card, headEls, imageRaw);

    return card;
}
