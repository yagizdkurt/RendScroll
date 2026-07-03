/* Transition card renderer.
   A scene-flow signpost the DM clicks during play: "### Transition: Name" with
   a "Scene:" line naming the target scene by filename stem, and prose telling
   the DM when to take this path. Renders the name, the description, and a
   Continue button that navigates the reader to the target scene through the
   normal guarded load path (so unsaved editor changes still prompt).

   Transition cards are also the source of the LOCKED edges on the scene
   progression map (src/sceneGraph/sceneGraph.js): the panel re-parses each
   scene and calls extractTransitions() below — the card is the single author
   of "this scene leads there", the map only displays it. */

// Pure per-type body parser: AST card node -> { sceneRef, descriptionLines }.
// "Scene:" is a type-specific field read from the body text (the parser's
// universal directive set deliberately stays type-agnostic); every other body
// line is the DM-facing description.
function parseTransitionBody(cardNode) {
  const out = { sceneRef: "", descriptionLines: [] };
  cardBodyLines(cardNode).forEach((line) => {
    const m = line.match(/^\s*scene\s*:\s*(.*)$/i);
    if (m && !out.sceneRef) {
      out.sceneRef = m[1].trim();
      return;
    }
    out.descriptionLines.push(line);
  });
  return out;
}

// Resolve a "Scene:" ref (filename stem, ".md" optional) against the sidebar's
// campaign entries. Case-insensitive exact stem match; returns the entry or null.
function findTransitionScene(entries, sceneRef) {
  const wanted = rsLower(String(sceneRef || "").trim().replace(/\.md$/i, ""));
  if (!wanted) return null;
  for (const entry of entries || []) {
    const stem = rsLower(String(entry.file || "").replace(/\.md$/i, ""));
    if (stem === wanted) return entry;
  }
  return null;
}

// Walk a parsed RendScrollDocument and list its transition cards as
// { name, sceneRef } (name = card title, the map edge label). Pure — used by
// the scene-graph panel's cross-scene scan, never by the render pipeline.
function extractTransitions(doc) {
  const out = [];
  if (!doc || !Array.isArray(doc.sections)) return out;
  doc.sections.forEach((section) => {
    (section.blocks || []).forEach((block) => {
      if (block.kind !== "card" || block.type !== "transition") return;
      const parsed = parseTransitionBody(block);
      if (parsed.sceneRef) out.push({ name: block.title, sceneRef: parsed.sceneRef });
    });
  });
  return out;
}

// Build one Transition card from its parsed AST node.
function buildTransitionCard(cardNode, head, nodes) {
  const card = document.createElement("div");
  card.className = "transition-card";
  if (cardIsRight(cardNode)) card.classList.add("card-right");

  const name = head.textContent.trim().replace(/^\s*transition\s*:\s*/i, "").trim();

  const title = document.createElement("div");
  title.className = "transition-title";
  const glyph = document.createElement("span");
  glyph.className = "transition-glyph";
  glyph.setAttribute("aria-hidden", "true");
  glyph.textContent = "⤳";
  title.appendChild(glyph);
  title.appendChild(document.createTextNode(name || "Transition"));
  card.appendChild(title);

  const parsed = parseTransitionBody(cardNode);
  if (parsed.descriptionLines.length) {
    const desc = document.createElement("div");
    desc.className = "transition-desc";
    renderMarkdownEls(parsed.descriptionLines.join("\n")).forEach((n) => desc.appendChild(n));
    card.appendChild(desc);
  }

  const entries = (typeof RendScrollApp !== "undefined" && RendScrollApp.campaignEntries)
    ? RendScrollApp.campaignEntries() : [];
  const target = findTransitionScene(entries, parsed.sceneRef);

  const footer = document.createElement("div");
  footer.className = "transition-footer";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "transition-go";

  if (target) {
    button.textContent = "Continue → " + (target.label || target.file);
    button.addEventListener("click", () => {
      if (typeof RendScrollApp !== "undefined" && RendScrollApp.guardedLoad) {
        RendScrollApp.guardedLoad(target.path);
      }
    });
  } else {
    button.textContent = parsed.sceneRef ? "Continue →" : "No scene set";
    button.disabled = true;
    const warn = document.createElement("div");
    warn.className = "transition-warning";
    warn.textContent = parsed.sceneRef
      ? 'Scene "' + parsed.sceneRef + '" not found in this campaign.'
      : "Add a Scene: line naming the target scene.";
    footer.appendChild(warn);
  }
  footer.insertBefore(button, footer.firstChild);
  card.appendChild(footer);

  return card;
}

if (typeof window !== "undefined") {
  window.parseTransitionBody = parseTransitionBody;
  window.findTransitionScene = findTransitionScene;
  window.extractTransitions = extractTransitions;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { parseTransitionBody, findTransitionScene, extractTransitions };
}

/* Self-register with the runtime card registry (cards/shared/cardRegistry.js).
   No normalizer: the builder reads directives/body from the parsed AST node. */
if (typeof RendScrollCards !== "undefined") {
  RendScrollCards.register("transition", { build: buildTransitionCard, cssClass: "transition-card" });
}
