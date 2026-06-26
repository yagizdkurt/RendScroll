/* Card collapse (aç/kapa).
   Runs AFTER every feature renderer has built its card, but does not touch any
   of them: it only adds a toggle button to each card's title and flips an
   `is-collapsed` class. It never fetches files and never touches the sidebar.

   Initial state, in order of precedence:
     1. A per-block markdown directive (no localStorage):
          Closed: T   -> this card starts collapsed
          Closed: F   -> this card starts open
     2. Otherwise the global "Start Closed" toggle (RendererOptions.startClosed):
          on  -> every card without a directive starts collapsed
          off -> every card without a directive starts open */

// Card containers produced by the feature card builders.
const CC_CARD_SELECTOR =
  ".sc-card,.npc-card,.obj-card,.item-card,.ability-card,.combat-card,.unexpected-card";

// The title element each renderer appends first inside its card. The button is
// placed here and this element stays visible while the card is collapsed.
const CC_TITLE_SELECTOR =
  ":scope > .sc-card-title," +
  ":scope > .npc-title," +
  ":scope > .obj-title," +
  ":scope > .item-title," +
  ":scope > .ability-title," +
  ":scope > .combat-title," +
  ":scope > .unexpected-title";

// A standalone "Closed: T" / "Closed: F" directive line (value optional).
const CC_DIRECTIVE = /^closed\s*:\s*(t|f|true|false)?$/i;

/* Text phase (runs before marked): isolate each "Closed: …" line into its own
   paragraph (blank line on both sides), so a directive written right after a
   "> …" block doesn't get swallowed by lazy continuation. */
function normalizeClosedMarkdown(text) {
  return normalizeStandaloneDirectives(text, (line) => CC_DIRECTIVE.test(line.trim()));
}

const CardCollapse = (() => {
  // Set a card's collapsed state and keep its toggle's a11y attributes in sync.
  function setCollapsed(card, collapsed) {
    card.classList.toggle("is-collapsed", collapsed);
    const btn = card.querySelector(":scope > .card-head > .card-toggle");
    if (btn) {
      btn.setAttribute("aria-expanded", String(!collapsed));
      btn.setAttribute("aria-label", collapsed ? "Kartı aç" : "Kartı kapat");
    }
  }

  // The state a card should start in: an explicit directive wins, otherwise the
  // global "Start Closed" toggle decides.
  function defaultCollapsed(card) {
    const d = card.dataset.ccDirective;
    if (d === "closed") return true;
    if (d === "open") return false;
    return !!(typeof RendererOptions !== "undefined" && RendererOptions.get("startClosed"));
  }

  // Re-apply every card's default state (used on initial build and whenever the
  // global toggle flips). Directive-pinned cards keep their fixed state.
  function applyDefaults(root) {
    root.querySelectorAll(CC_CARD_SELECTOR).forEach((card) => {
      if (card.querySelector(":scope > .card-head")) setCollapsed(card, defaultCollapsed(card));
    });
  }

  // Build the toggle button + read the directive for each card.
  function enhance(root) {
    root.querySelectorAll(CC_CARD_SELECTOR).forEach((card) => {
      // Prefer the image header row (.card-figure: title + portrait) so a
      // collapsed card keeps showing its portrait; otherwise anchor to the plain
      // title. A title-less card has nothing to anchor to, so we prepend a thin
      // header bar to host the toggle and stay visible while collapsed.
      let head = card.querySelector(":scope > .card-figure") || card.querySelector(CC_TITLE_SELECTOR);
      if (!head) {
        head = document.createElement("div");
        head.className = "card-bare-head";
        card.prepend(head);
      }
      head.classList.add("card-head");

      const p = [...card.querySelectorAll("p")].find((el) =>
        CC_DIRECTIVE.test(el.textContent.trim())
      );
      if (p) {
        const m = p.textContent.trim().match(CC_DIRECTIVE);
        card.dataset.ccDirective = /^(t|true)$/i.test(m[1] || "") ? "closed" : "open";
        p.remove();
      }

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "card-toggle";
      btn.textContent = "▾";
      head.appendChild(btn);
      btn.addEventListener("click", () =>
        setCollapsed(card, !card.classList.contains("is-collapsed"))
      );

      setCollapsed(card, defaultCollapsed(card));
    });
  }

  // Live update: flipping the global "Start Closed" toggle re-applies defaults.
  document.addEventListener("rendereroptionchange", (e) => {
    if (e.detail && e.detail.key === "startClosed") {
      const page = document.getElementById("page");
      if (page) applyDefaults(page);
    }
  });

  return { enhance };
})();

function enhanceCardCollapse(root) {
  CardCollapse.enhance(root);
}

/* Heading collapse (ana olaylar: H1/H2).
   Runs AFTER layoutTwoColumns. A heading "owns" every following sibling unit
   until the next heading of equal-or-higher level; H1 wins over H2 (collapsing
   an H1 hides the H2s under it too).

   It operates on the layout's two containers, which hold their units differently:
     - .page-header : flat children (the intro H1s and their content live here,
                      since the header band is everything before the first H2)
     - .page-grid   : H1/H2 are wrapped in .grid-full; content is .grid-full
                      (H1 body / HR) and .col-main/.col-divider/.col-aside triples

   A distinct `heading-collapsed` class (NOT the cards' `is-collapsed`) is used so
   the card rule that hides a collapsed element's children never hits a heading's
   own toggle button. */

/* The heading-level "Collapsable: T/F" directive is now read by the parser and
   carried on the parsed section (RendScrollParser); src/app.js stamps it onto the
   heading element as `dataset.collapsable` during render. HeadingCollapse below
   reads that flag exactly as before — the old DOM-scanning markHeadingCollapsable
   pass and its text-phase normalizer are no longer needed. */

const HeadingCollapse = (() => {
  function startClosed() {
    return !!(typeof RendererOptions !== "undefined" && RendererOptions.get("startClosed"));
  }

  // The heading element a unit represents, or null. A header-band unit IS the
  // heading; a grid unit wraps it in .grid-full.
  function unitHeading(unit, tag) {
    if (unit.matches(tag)) return unit;
    if (unit.classList.contains("grid-full")) return unit.querySelector(":scope > " + tag);
    return null;
  }

  function syncBtn(btn, collapsed) {
    btn.setAttribute("aria-expanded", String(!collapsed));
    btn.setAttribute("aria-label", collapsed ? "Olayı aç" : "Olayı kapat");
  }

  // Re-derive every unit's visibility from the headings' collapsed state.
  // Hierarchical: an H1 hides its H2s and their bodies; reopening the H1 keeps
  // any individually-collapsed H2 closed.
  function recompute(container) {
    let h1Collapsed = false;
    let h2Collapsed = false;
    [...container.children].forEach((unit) => {
      const h1 = unitHeading(unit, "h1");
      const h2 = unitHeading(unit, "h2");

      if (h1) {
        unit.classList.remove("is-hidden-by-heading"); // an H1 is always shown
        h1Collapsed = h1.classList.contains("heading-collapsed");
        h2Collapsed = false; // a new H1 section resets the H2 context
        return;
      }
      if (h2) {
        unit.classList.toggle("is-hidden-by-heading", h1Collapsed);
        h2Collapsed = h2.classList.contains("heading-collapsed");
        return;
      }
      unit.classList.toggle("is-hidden-by-heading", h1Collapsed || h2Collapsed);
    });
  }

  function setCollapsed(heading, collapsed, container) {
    heading.classList.toggle("heading-collapsed", collapsed);
    const btn = heading.querySelector(":scope > .card-toggle");
    if (btn) syncBtn(btn, collapsed);
    recompute(container);
  }

  function enhanceContainer(container, skipFirstH1) {
    if (!container) return;
    const closed = startClosed();
    [...container.children].forEach((unit) => {
      const heading = unitHeading(unit, "h1") || unitHeading(unit, "h2");
      if (!heading) return;

      // The page's main title (first H1) is not an event, so it is non-collapsible
      // by default — unless it explicitly opts in with "Collapsable: T".
      if (skipFirstH1 && heading.tagName === "H1") {
        skipFirstH1 = false;
        if (heading.dataset.collapsable !== "true") return;
      }

      // Opted out via "Collapsable: F": render no toggle, but recompute still
      // treats it as an always-open section boundary.
      if (heading.dataset.collapsable === "false") return;

      heading.classList.add("heading-collapsible");

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "card-toggle";
      btn.textContent = "▾";
      heading.appendChild(btn);
      btn.addEventListener("click", () =>
        setCollapsed(heading, !heading.classList.contains("heading-collapsed"), container)
      );

      heading.classList.toggle("heading-collapsed", closed);
      syncBtn(btn, closed);
    });
    recompute(container);
  }

  function enhance(root) {
    enhanceContainer(root.querySelector(".page-header"), true);
    enhanceContainer(root.querySelector(".page-grid"), false);
  }

  // Live update: flipping the global "Start Closed" toggle re-applies defaults
  // to every heading (mirrors the card-collapse behaviour).
  document.addEventListener("rendereroptionchange", (e) => {
    if (!e.detail || e.detail.key !== "startClosed") return;
    const page = document.getElementById("page");
    if (!page) return;
    const closed = startClosed();
    [page.querySelector(".page-header"), page.querySelector(".page-grid")].forEach((c) => {
      if (!c) return;
      c.querySelectorAll(".heading-collapsible").forEach((h) => {
        h.classList.toggle("heading-collapsed", closed);
        const btn = h.querySelector(":scope > .card-toggle");
        if (btn) syncBtn(btn, closed);
      });
      recompute(c);
    });
  });

  return { enhance };
})();

function enhanceHeadingCollapse(root) {
  HeadingCollapse.enhance(root);
}
