/* Narrative card renderer.
   A source-visible replacement for standalone read-aloud blockquotes:

     ### Narrative
     Side: R
     Text:
     > Read-aloud text.

   The wrapper is intentionally plain; it only gives layout/editor a card node. */

function normalizeNarrativeMarkdown(text) {
  return normalizeSectionDirectives(text, {
    startsSection: (line) => /^###\s+narrative\s*$/i.test(line),
    endsSection: (line) => /^#{1,3} /.test(line),
    shouldIsolate: (line) => /^side\s*:/i.test(line.trim()) || /^text\s*:\s*$/i.test(line.trim()),
  });
}

function buildNarrativeCard(head, nodes) {
  const card = document.createElement("div");
  card.className = "narrative-card";
  let inText = false;

  nodes.forEach((n) => {
    const text = n.textContent.trim();

    const side = n.tagName === "P" && text.match(CARD_SIDE_LINE);
    if (side) {
      if (cardSideIsRight(side[1])) card.classList.add("card-right");
      return;
    }

    if (n.tagName === "P" && /^text\s*:\s*$/i.test(text)) {
      inText = true;
      return;
    }

    if (!inText) return;
    if (n.tagName === "BLOCKQUOTE") {
      card.appendChild(cloneAsReadAloud(n));
    }
  });

  return card;
}

/* Self-register with the runtime card registry (cards/shared/cardRegistry.js). */
if (typeof RendScrollCards !== "undefined") {
  RendScrollCards.register("narrative", { build: buildNarrativeCard, normalize: normalizeNarrativeMarkdown });
}
