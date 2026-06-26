/* Object (Obje) section renderer.
   Receives a root DOM element and modifies ONLY Obje sections in the DOM.
   It never fetches files and never touches the sidebar.

   An Obje is written as:

     ### Obje: İsim
     > Serbest açıklama / DM anlatımı (read-aloud)
     BG: kapi.png            (optional; default watermark = chest.png)
     Checks:
     - Investigation:
     > 10: ...
     > 15: ...
     Loot:
     - 20 altın
     - Kutsal sembol

   Layout produced (a single .obj-card):
     - title
     - any leading "> ..." blocks   -> read-aloud DM blocks (description)
     - "Checks:"  -> titled sub-section of skill cards (same look as Skill Checks)
     - "Loot:"    -> titled loot sub-panel (a list)

   The skill-check renderer (renderSkillCheckNodes) is reused from
   skillChecks.js so Checks render identically to a Skill Checks section. */

/* A node ends the current section if it's a new heading/separator OR a card that
   another renderer already produced (e.g. an NPC card placed right after this
   Obje). Without the card check the collector would swallow the next card. */
function objIsBoundary(n) {
  if (/^(H[1-3]|HR)$/.test(n.tagName)) return true;
  return isRenderedCard(n);
}

/* BG/Image url resolution and the portrait frame are shared across all card
   renderers (renderers/cardImage.js): cardBgUrl(), cardPortrait(). */

function objHeadingMatch(text) {
  return text.trim().match(/^\s*(obje|object|poi)\s*:/i);
}

function objTitleText(head) {
  const raw = head.textContent.trim();
  const m = raw.match(/^\s*(obje|object|poi)\s*:\s*(.*)$/i);
  if (!m) return raw;

  const title = m[2].trim();
  return title ? "Point Of Interest: " + title : "Point Of Interest";
}

/* Text phase (runs before marked): inside an Obje section, isolate each bare
   "Checks:" / "Loot:" label on its own blank-separated line. Without this a
   label written right after a "> ..." line would be swallowed into the
   blockquote (lazy continuation) and the following list would glue to it. */
function normalizeObjMarkdown(text) {
  return normalizeSectionDirectives(text, {
    startsSection: (line) =>
      /^#{2,3}\s+/.test(line) && objHeadingMatch(line.replace(/^#{2,3}\s+/, "")),
    endsSection: (line) => /^#{1,3} /.test(line),
    shouldIsolate: (line) => (
      /^(checks|loot)\s*:\s*$/i.test(line.trim()) ||
      /^bg\s*:/i.test(line.trim()) ||
      /^image\s*:/i.test(line.trim()) ||
      /^side\s*:/i.test(line.trim())
    ),
  });
}

// A bare "Checks:" / "Loot:" line becomes its own paragraph -> a mode switch.
function objMode(node) {
  if (node.tagName !== "P") return "";
  const t = rsLower(node.textContent.trim());
  if (t === "checks:") return "checks";
  if (t === "loot:") return "loot";
  return "";
}

// A small uppercase label used above the Checks / Loot sub-sections.
function objSectionTitle(text) {
  const el = document.createElement("div");
  el.className = "obj-section-title";
  el.textContent = text;
  return el;
}

// Build one Obje card from its heading + body nodes (produced by marked from the
// card's parsed source). Returns the card element, or null when there is no body.
function buildObjCard(head, nodes) {
    if (!nodes.length) return null;

    // Obje renders in the left column by default; a "Side: R" line (handled in
    // the node loop below) tags the card .card-right so layout moves it.
    const card = document.createElement("div");
    card.className = "obj-card";

    const title = document.createElement("div");
    title.className = "obj-title";
    title.textContent = objTitleText(head);

    // Header = title + leading "> ..." description, placed beside the portrait
    // when an Image is given; Checks/Loot sub-sections flow full-width below.
    const headEls = [title];
    let imageRaw = "";

    let mode = "desc";
    let checksBox = null; // .skillchecks container, created on first Checks node
    let lootPanel = null; // .obj-loot container, created on first Loot node
    const checkNodes = []; // collected and rendered together after the loop

    nodes.forEach((node) => {
      // "BG: file.png" picks the watermark behind this card. The CSS ::before
      // falls back to the standard chest image when --obj-bg is left unset.
      const bg = node.tagName === "P" && node.textContent.trim().match(/^bg\s*:\s*(.+)$/i);
      if (bg) {
        card.style.setProperty("--obj-bg", 'url("' + cardBgUrl(bg[1]) + '")');
        return; // the BG line itself is dropped
      }

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

      const switchTo = objMode(node);
      if (switchTo) {
        mode = switchTo;
        return; // the label paragraph itself is dropped
      }

      if (mode === "checks") {
        if (!checksBox) {
          const section = document.createElement("div");
          section.className = "obj-section";
          section.appendChild(objSectionTitle("Checks"));
          checksBox = document.createElement("div");
          checksBox.className = "skillchecks";
          section.appendChild(checksBox);
          card.appendChild(section);
        }
        checkNodes.push(node);
      } else if (mode === "loot") {
        if (!lootPanel) {
          lootPanel = document.createElement("div");
          lootPanel.className = "obj-loot";
          lootPanel.appendChild(objSectionTitle("Loot"));
          card.appendChild(lootPanel);
        }
        lootPanel.appendChild(node.cloneNode(true));
      } else {
        // Description: bare "> ..." blocks become read-aloud DM blocks. These
        // are the leading content, kept beside the portrait in the header.
        headEls.push(cloneAsReadAloud(node));
      }
    });

    // Render collected Checks together so skill names share one grid column.
    if (checksBox) renderSkillCheckNodes(checksBox, checkNodes);

    // Place the header at the top: wrapped beside the portrait when an Image was
    // given, otherwise as plain stacked elements (no empty portrait reserved).
    insertCardHeader(card, headEls, imageRaw);

    return card;
}
