/* Lore page renderer — the reader half of the Lore subsystem.

   Turns a lore markdown file into the page view: the page title, its keyword
   chips, then every entry in source order (title, chips, markdown body).
   Keyword chips are display only; searching by keyword is the top bar's "key:"
   mode (src/app/appSearch.js).

   Reader-only by design: the editor layer adds its tools on top of this DOM
   (src/lore/loreEditor.js) and is never required for a lore page to render. */

const LoreView = (() => {
  const M = typeof LoreModel !== "undefined"
    ? LoreModel
    : require("./loreModel.js");

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // One row of small keyword chips, or null when there are none.
  function chips(keywords) {
    const list = M.normalizeKeywords(keywords || []);
    if (!list.length) return null;
    const row = el("div", "lore-chips");
    list.forEach((word) => row.appendChild(el("span", "lore-chip", word)));
    return row;
  }

  // A visible, non-destructive report. A file that does not satisfy the contract
  // is shown as-is and never silently rewritten — the editor refuses to save it.
  function errorBlock(errors) {
    const box = el("div", "lore-errors");
    box.appendChild(el("div", "lore-errors-title", "This lore page could not be read"));
    const list = el("ul", "lore-error-list");
    errors.forEach((e) => {
      const line = e.line ? "Line " + e.line + ": " : "";
      list.appendChild(el("li", null, line + e.message));
    });
    box.appendChild(list);
    box.appendChild(el("div", "lore-errors-hint",
      "Fix the file on disk; RendScroll will not rewrite it for you."));
    return box;
  }

  function entryElement(entry, index) {
    const section = el("section", "lore-entry");
    section.dataset.loreEntry = M.nameKey(entry.name);
    section.dataset.loreIndex = String(index);

    const head = el("div", "lore-entry-head");
    head.appendChild(el("h3", "lore-entry-title", entry.name || "(unnamed)"));
    section.appendChild(head);

    const chipRow = chips(entry.keywords);
    if (chipRow) section.appendChild(chipRow);

    const body = el("div", "lore-entry-body");
    if (String(entry.body || "").trim()) {
      renderMarkdownEls(entry.body).forEach((node) => body.appendChild(node));
    } else {
      body.appendChild(el("p", "lore-entry-empty", "(no content yet)"));
    }
    section.appendChild(body);
    return section;
  }

  /* Render `page` into `host`. `errors` (from LoreModel.parse) are shown above
     the content when the file is malformed. Returns nothing; the caller owns the
     surrounding view chrome (kicker, toolbar) — see appLibrary.renderLibraryView. */
  function render(host, page, errors) {
    const root = el("div", "lore-page");

    if (errors && errors.length) root.appendChild(errorBlock(errors));

    const chipRow = chips(page && page.keywords);
    if (chipRow) {
      chipRow.classList.add("lore-page-chips");
      root.appendChild(chipRow);
    }

    const entries = (page && page.entries) || [];
    if (!entries.length) {
      root.appendChild(el("p", "lore-empty",
        "This page has no entries yet."));
    } else {
      const list = el("div", "lore-entries");
      entries.forEach((entry, index) => list.appendChild(entryElement(entry, index)));
      root.appendChild(list);
    }

    host.appendChild(root);
    // Blockquotes become read-aloud boxes exactly as in a scene. Card collapse and
    // the two-column pass are deliberately NOT run: a lore page is prose, not cards.
    if (typeof enhanceBaseStyling === "function") enhanceBaseStyling(root);
    return root;
  }

  // Scroll target for an entry inside an already-rendered page.
  function findEntry(host, name) {
    if (!host) return null;
    const key = M.nameKey(name);
    if (!key) return null;
    return [...host.querySelectorAll(".lore-entry")]
      .find((node) => node.dataset.loreEntry === key) || null;
  }

  return { render, findEntry, chips };
})();

/* Glue for appLibrary's LIBRARY_VIEWS.render hook: read the page out of the
   RefLibrary cache, render it, then let the editor layer (if loaded) open a
   document session and decorate. Declared as a global function to match the
   other render entry points (enhanceCardCollapse, layoutTwoColumns, …). */
function renderLoreView(kind, name, viewEl) {
  const resolved = (typeof RefLibrary !== "undefined")
    ? RefLibrary.resolve(kind, name)
    : { ok: false };
  if (!resolved.ok) {
    viewEl.appendChild(refMissingCard(kind, name));
    return null;
  }

  const parsed = LoreModel.parse(resolved.source);
  const root = LoreView.render(viewEl, parsed.page, parsed.errors);

  if (typeof LoreEditor !== "undefined") {
    LoreEditor.attach({
      name,
      path: resolved.entry ? resolved.entry.path : "",
      page: parsed.page,
      ok: parsed.ok,
      root,
      viewEl,
    });
  }
  return root;
}

if (typeof window !== "undefined") {
  window.LoreView = LoreView;
  window.renderLoreView = renderLoreView;
}
if (typeof module !== "undefined" && module.exports) module.exports = LoreView;
