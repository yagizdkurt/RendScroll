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

function objLower(s) {
  return s.replace(/İ/g, "i").replace(/I/g, "ı").toLowerCase();
}

/* A node ends the current section if it's a new heading/separator OR a card that
   another renderer already produced (e.g. an NPC card placed right after this
   Obje). Without the card check the collector would swallow the next card. */
function objIsBoundary(n) {
  if (/^(H[1-3]|HR)$/.test(n.tagName)) return true;
  return n.classList && (
    n.classList.contains("npc-card") ||
    n.classList.contains("item-card") ||
    n.classList.contains("ability-card") ||
    n.classList.contains("obj-card") ||
    n.classList.contains("unexpected-card")
  );
}

/* BG/Image url resolution and the portrait frame are shared across all card
   renderers (renderers/cardImage.js): cardBgUrl(), cardPortrait(). */

function objHeadingMatch(text) {
  return text.trim().match(/^_?\s*(obje|object|poi)\s*:/i);
}

function objTitleText(head) {
  const raw = head.textContent.trim();
  const m = raw.match(/^_?\s*(obje|object|poi)\s*:\s*(.*)$/i);
  if (!m) return raw;

  const title = m[2].trim();
  return title ? "Point Of Interest: " + title : "Point Of Interest";
}

/* Text phase (runs before marked): inside an Obje section, isolate each bare
   "Checks:" / "Loot:" label on its own blank-separated line. Without this a
   label written right after a "> ..." line would be swallowed into the
   blockquote (lazy continuation) and the following list would glue to it. */
function normalizeObjMarkdown(text) {
  const out = [];
  let inObj = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^#{2,3}\s+/.test(line) && objHeadingMatch(line.replace(/^#{2,3}\s+/, ""))) {
      inObj = true;
      out.push(line);
      continue;
    }
    if (/^#{1,3} /.test(line)) { inObj = false; out.push(line); continue; }
    if (inObj && (/^(checks|loot)\s*:\s*$/i.test(line.trim()) || /^bg\s*:/i.test(line.trim()) || /^image\s*:/i.test(line.trim()))) {
      if (out.length && out[out.length - 1].trim() !== "") out.push("");
      out.push(line);
      out.push("");
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

// A bare "Checks:" / "Loot:" line becomes its own paragraph -> a mode switch.
function objMode(node) {
  if (node.tagName !== "P") return "";
  const t = objLower(node.textContent.trim());
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

function enhanceObjSections(root) {
  const heads = [...root.querySelectorAll("h2, h3")].filter((h) =>
    objHeadingMatch(h.textContent)
  );

  heads.forEach((head) => {
    // Stop at the next H2/H3 or an <hr> so the event separator stays standalone.
    const nodes = [];
    for (let n = head.nextElementSibling; n && !objIsBoundary(n); n = n.nextElementSibling) {
      nodes.push(n);
    }

    if (!nodes.length) return;

    // "### _Obje: …" renders the SAME card, just placed in the right column.
    // The layout step keys off the .obj-right marker; everything else is shared.
    const right = head.textContent.trim().startsWith("_");

    const card = document.createElement("div");
    card.className = right ? "obj-card obj-right" : "obj-card";

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
        const clone = node.cloneNode(true);
        if (clone.tagName === "BLOCKQUOTE") clone.classList.add("read-aloud");
        headEls.push(clone);
      }
    });

    // Render collected Checks together so skill names share one grid column.
    if (checksBox) renderSkillCheckNodes(checksBox, checkNodes);

    // Place the header at the top: wrapped beside the portrait when an Image was
    // given, otherwise as plain stacked elements (no empty portrait reserved).
    const portrait = cardPortrait(imageRaw);
    if (portrait) {
      card.insertBefore(cardFigure(headEls, portrait), card.firstChild);
    } else {
      for (let j = headEls.length - 1; j >= 0; j--) card.insertBefore(headEls[j], card.firstChild);
    }

    const marker = document.createComment("obj-card");
    head.before(marker);
    head.remove();
    nodes.forEach((n) => n.remove());
    marker.replaceWith(card);
  });
}
