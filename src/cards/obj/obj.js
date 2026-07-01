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

   The skill-check renderer (renderSkillChecks) is reused from skillChecks.js so
   Checks render identically to a Skill Checks section. */

/* A node ends the current section if it's a new heading/separator OR a card that
   another renderer already produced (e.g. an NPC card placed right after this
   Obje). Without the card check the collector would swallow the next card. */
function objIsBoundary(n) {
  if (/^(H[1-3]|HR)$/.test(n.tagName)) return true;
  return isRenderedCard(n);
}

/* BG/Image url resolution and the portrait frame are shared across all card
   cards (cards/shared/cardImage.js): cardBgUrl(), cardPortrait(). */

function objTitleText(head) {
  const raw = head.textContent.trim();
  const m = raw.match(/^\s*(obje|object|poi)\s*:\s*(.*)$/i);
  if (!m) return raw;

  const title = m[2].trim();
  return title ? "Point Of Interest: " + title : "Point Of Interest";
}

// A small uppercase label used above the Checks / Loot sub-sections.
function objSectionTitle(text) {
  const el = document.createElement("div");
  el.className = "obj-section-title";
  el.textContent = text;
  return el;
}

// Pure per-type body parser: AST card node -> ordered obj segments. Walks the
// body in source order (cardOrderedBody) classifying each run as a "Checks:" group,
// a description run, or a loot run (after a bare "Loot:" label). The builder below
// maps each segment to DOM; keeping the classification here as one named function
// mirrors the shared-parse discipline (RENDERER_AST_MIGRATION.md).
//   { kind: "checks", checks }                 a parsed check group
//   { kind: "lines", mode: "desc"|"loot", lines }   a contiguous content run
function parseObjBody(cardNode) {
  const segs = [];
  let mode = "desc";
  cardOrderedBody(cardNode).forEach((seg) => {
    if (seg.kind === "checks") { segs.push({ kind: "checks", checks: seg.checks }); mode = "desc"; return; }
    seg.lines.forEach((line) => {
      if (/^loot\s*:\s*$/i.test(line.trim())) { mode = "loot"; return; }
      const last = segs[segs.length - 1];
      if (last && last.kind === "lines" && last.mode === mode) last.lines.push(line);
      else segs.push({ kind: "lines", mode, lines: [line] });
    });
  });
  return segs;
}

// Build one Obje card from its parsed AST node. BG/Image/Side come from the
// resolved directives; the Checks / description / Loot segments come from the
// shared parseObjBody, so a title-only Obje still returns a real card editor
// anchors can attach to.
function buildObjCard(cardNode, head, nodes) {
    const card = document.createElement("div");
    card.className = "obj-card";

    const title = document.createElement("div");
    title.className = "obj-title";
    title.textContent = objTitleText(head);

    // Header = title + leading "> ..." description, placed beside the portrait
    // when an Image is given; Checks/Loot sub-sections flow full-width below.
    const headEls = [title];
    const imageRaw = cardDirective(cardNode, "image").trim();
    const bg = cardDirective(cardNode, "bg").trim();
    if (bg) card.style.setProperty("--obj-bg", 'url("' + cardBgUrl(bg) + '")');
    if (cardIsRight(cardNode)) card.classList.add("card-right");

    // Description runs go beside the portrait (header); loot runs fill the loot
    // panel; each run is rendered together so marked sees lists/blockquotes intact.
    let lootPanel = null;

    parseObjBody(cardNode).forEach((seg) => {
      if (seg.kind === "checks") {
        const section = document.createElement("div");
        section.className = "obj-section";
        section.appendChild(objSectionTitle("Checks"));
        const box = document.createElement("div");
        box.className = "skillchecks";
        renderSkillChecks(box, seg.checks);
        section.appendChild(box);
        card.appendChild(section);
        return;
      }
      const tmp = document.createElement("div");
      tmp.innerHTML = renderMarkdown(seg.lines.join("\n"));
      const els = [...tmp.children];
      if (seg.mode === "loot") {
        if (!lootPanel) {
          lootPanel = document.createElement("div");
          lootPanel.className = "obj-loot";
          lootPanel.appendChild(objSectionTitle("Loot"));
          card.appendChild(lootPanel);
        }
        els.forEach((e) => lootPanel.appendChild(e));
      } else {
        els.forEach((e) => headEls.push(cloneAsReadAloud(e)));
      }
    });

    // Place the header at the top: wrapped beside the portrait when an Image was
    // given, otherwise as plain stacked elements (no empty portrait reserved).
    insertCardHeader(card, headEls, imageRaw);

    return card;
}

/* Self-register with the runtime card registry (cards/shared/cardRegistry.js).
   No normalizer: the builder reads directives/checkGroups/body from the AST node. */
if (typeof RendScrollCards !== "undefined") {
  RendScrollCards.register("obj", { build: buildObjCard });
}

if (typeof window !== "undefined") window.parseObjBody = parseObjBody;
if (typeof module !== "undefined" && module.exports) module.exports = { parseObjBody };
