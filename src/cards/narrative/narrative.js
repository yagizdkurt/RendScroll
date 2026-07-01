/* Narrative card renderer.
   A source-visible replacement for standalone read-aloud blockquotes:

     ### Narrative
     Side: R
     Text:
     > Read-aloud text.

   The wrapper is intentionally plain; it only gives layout/editor a card node. */

// Build one Narrative card from its parsed AST node. Side comes from the resolved
// directive; the read-aloud text is the body after the "Text:" label, rendered
// through marked — only its blockquotes are kept (as read-aloud), as before.
function buildNarrativeCard(cardNode, head, nodes) {
  const card = document.createElement("div");
  card.className = "narrative-card";
  if (cardIsRight(cardNode)) card.classList.add("card-right");

  const lines = cardBodyLines(cardNode);
  const idx = lines.findIndex((l) => /^text\s*:\s*$/i.test(l.trim()));
  if (idx >= 0) {
    renderMarkdownEls(lines.slice(idx + 1).join("\n")).forEach((n) => {
      if (n.tagName === "BLOCKQUOTE") card.appendChild(cloneAsReadAloud(n));
    });
  }

  return card;
}

/* Self-register with the runtime card registry (cards/shared/cardRegistry.js).
   No normalizer: the builder reads directives/body from the parsed AST node. */
if (typeof RendScrollCards !== "undefined") {
  RendScrollCards.register("narrative", { build: buildNarrativeCard });
}
