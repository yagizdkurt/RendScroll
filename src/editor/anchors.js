/* Anchoring: map rendered card elements back to source blocks WITHOUT touching
   any renderer. After renderPage() has produced the 2-column grid, we replay the
   exact routing rules from layout.js (layoutIsAside + canDockUnder) over the
   outline model to know, per event-row and column, the source order of cards —
   then zip that to the card <div>s in the DOM and stamp each with data-block-id.

   It also installs per-card editing handles and insert zones, wired to the
   handler callbacks the controller (editor.js) passes in. */

const EditorAnchors = (() => {
  // Card types that the card builders turn into a single card <div>. Plain "###"
  // sections and Yankı/Echo produce no card div, so they are not anchorable.
  const ANCHORABLE = new Set([
    "npc", "item", "ability", "obj", "combat", "unexpected", "std", "skillchecks",
  ]);

  // DOM class for each card type (from the card builders).
  const CARD_CLASS = {
    npc: "npc-card", item: "item-card", ability: "ability-card", obj: "obj-card",
    combat: "combat-card", unexpected: "unexpected-card", std: "std-card",
    skillchecks: "sc-card",
  };
  // Reference-sourced cards (`[item=Name]`) are rendered into the DOM but live in
  // the library, NOT the outline model — exclude them so the model<->DOM card zip
  // stays 1:1. They get their own editor tools (see editor.js decorateRefCards).
  const CARD_DIV_SELECTOR = Object.values(CARD_CLASS).map((c) => ":scope > ." + c + ":not([data-ref-source])").join(",");
  const CARD_DOM_SELECTOR = Object.values(CARD_CLASS).map((c) => "." + c + ":not([data-ref-source])").join(",");

  function editorOn() {
    return document.body.classList.contains("editor-on");
  }

  function anchorable(cards) {
    return cards.filter((c) => ANCHORABLE.has(c.type));
  }

  // Mirror of layout.js:canDockUnder — can `node` dock under `host`?
  function canDock(node, host) {
    if (!host) return false;
    if (node.type === "item" && node.stuck) {
      return host.type === "obj" || (host.type === "item" && host.stuck);
    }
    if (node.type === "ability" && node.stuck) {
      return host.type === "item" || host.type === "obj" || (host.type === "ability" && host.stuck);
    }
    return false;
  }

  // Replay dockOrPlace over a row's cards (source order) -> { left:[], right:[] }
  // in the same order the layout appended them to col-main / col-aside.
  function routeRow(cards) {
    const left = [];
    const right = [];
    let last = null; // { card, column }
    for (const card of cards) {
      let column;
      if (card.stuck && canDock(card, last && last.card)) {
        column = last.column; // docked into host's column
      } else {
        column = card.column;
      }
      (column === "right" ? right : left).push(card);
      last = { card, column };
    }
    return { left, right };
  }

  // Group an event/section's anchorable cards by how many <hr>s precede them
  // inside it. layout.js turns an <hr> into a gridFull that resets the current
  // row / full-box, so each <hr> between cards starts a new layout unit.
  function hrGroups(model, ev) {
    const hrs = (model.hrLines || []).filter((h) => h > ev.start && h < ev.end);
    const groups = new Map();
    for (const card of anchorable(ev.cards)) {
      let key = 0;
      for (const h of hrs) if (h < card.start) key++;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(card);
    }
    return [...groups.keys()].sort((a, b) => a - b).map((k) => groups.get(k));
  }

  // Two-column event -> one routed row per <hr> group.
  function eventRows(model, ev) {
    return hrGroups(model, ev).map((cards) => {
      const r = routeRow(cards);
      r.ev = ev;
      return r;
    });
  }

  // Walk the grid's children in document order and collect the card-bearing
  // units: two-column rows ([.col-main … .col-aside]) and full-width boxes
  // (a .grid-full that holds cards — the body of an H1 section). A .grid-full
  // that holds only a heading / <hr> is a divider and is skipped.
  function gridUnits(grid) {
    const units = [];
    let row = null;
    [...grid.children].forEach((el) => {
      if (el.classList.contains("col-main")) {
        row = { type: "row", main: el, aside: null };
        units.push(row);
      } else if (el.classList.contains("col-aside")) {
        if (row) row.aside = el;
      } else if (el.classList.contains("col-divider")) {
        /* spacer */
      } else if (el.classList.contains("grid-full")) {
        row = null;
        if (el.querySelector(CARD_DIV_SELECTOR.replace(/:scope > /g, ""))) {
          units.push({ type: "full", full: el });
        }
      }
    });
    return units;
  }

  // Stamp + decorate the card <div>s of one column against an ordered card list.
  // ctx = { eventRef } so insert targets in this column know their event.
  function zipColumn(container, cards, handlers, ctx) {
    if (!container) return;
    container._editorDropTarget = {
      afterCardId: cards.length ? cards[cards.length - 1].id : null,
      column: container.dataset.col || null,
      eventRef: ctx && ctx.eventRef,
    };
    const divs = [...container.querySelectorAll(CARD_DIV_SELECTOR)];
    if (divs.length !== cards.length) {
      console.warn(`[editor] card anchor mismatch in ${container.className || "container"}: dom=${divs.length} model=${cards.length}`);
      if (!container._editorContextMenuBound) bindColumnContextMenu(container, cards, handlers, ctx);
      container.appendChild(insertZone(container._editorDropTarget, handlers));
      return;
    }
    cards.forEach((card, i) => {
      const el = divs[i];
      if (!el) return;
      el.dataset.blockId = String(card.id);
      decorateCard(el, card, handlers, {
        column: container.dataset.col || null,
        eventRef: ctx && ctx.eventRef,
      });
    });
    bindColumnContextMenu(container, cards, handlers, ctx);
    // An explicit insert zone at the end of the column.
    container.appendChild(insertZone(container._editorDropTarget, handlers));
  }

  function insertTargetFromPoint(container, cards, y, ctx) {
    const column = container.dataset.col || null;
    const base = { column, eventRef: ctx && ctx.eventRef };
    if (!cards.length) return Object.assign({ afterCardId: null }, base);

    const divs = [...container.querySelectorAll(":scope > .editor-card[data-block-id]")];
    for (let i = 0; i < Math.min(cards.length, divs.length); i++) {
      const rect = divs[i].getBoundingClientRect();
      if (y < rect.top) return Object.assign({ beforeCardId: cards[i].id }, base);
      if (y <= rect.bottom) {
        return y < rect.top + rect.height / 2
          ? Object.assign({ beforeCardId: cards[i].id }, base)
          : Object.assign({ afterCardId: cards[i].id }, base);
      }
      const next = divs[i + 1];
      if (next && y < next.getBoundingClientRect().top) {
        const gapMid = rect.bottom + (next.getBoundingClientRect().top - rect.bottom) / 2;
        return y < gapMid
          ? Object.assign({ afterCardId: cards[i].id }, base)
          : Object.assign({ beforeCardId: cards[i + 1].id }, base);
      }
    }
    return Object.assign({ afterCardId: cards[cards.length - 1].id }, base);
  }

  function bindColumnContextMenu(container, cards, handlers, ctx) {
    container._editorInsertCards = cards.slice();
    container._editorInsertCtx = ctx || null;
    if (container._editorContextMenuBound) return;
    container._editorContextMenuBound = true;
    // Right-click anywhere empty in the column opens the insert menu at the
    // closest source position instead of always appending to the end.
    container.addEventListener("contextmenu", (e) => {
      if (!editorOn()) return; // listeners persist when toggled off
      if (e.target.closest(".editor-card")) return; // a card handles its own menu
      e.preventDefault();
      const target = insertTargetFromPoint(
        container,
        container._editorInsertCards || [],
        e.clientY,
        container._editorInsertCtx
      );
      handlers.insertMenu(target, e.clientX, e.clientY);
    });
  }

  function decorateCard(el, card, handlers, ctx) {
    if (el.querySelector(":scope > .editor-card-tools")) return; // idempotent
    el.classList.add("editor-card");
    const tools = document.createElement("div");
    tools.className = "editor-card-tools";
    if (handlers.beginCardDrag) {
      tools.appendChild(dragBtn(card.id, handlers));
    }
    tools.appendChild(toolBtn("✎", "Edit", () => handlers.editCard(card.id)));
    tools.appendChild(toolBtn("↑", "Move up", () => handlers.moveCard(card.id, -1)));
    tools.appendChild(toolBtn("↓", "Move down", () => handlers.moveCard(card.id, 1)));
    tools.appendChild(toolBtn("✕", "Delete", () => handlers.deleteCard(card.id)));
    el.appendChild(tools);
    el.addEventListener("contextmenu", (e) => {
      if (!editorOn()) return;
      e.preventDefault();
      e.stopPropagation();
      handlers.cardMenu(card.id, e.clientX, e.clientY, ctx || {});
    });
  }

  function dragBtn(id, handlers) {
    const b = toolBtn("↕", "Drag", () => {});
    b.classList.add("editor-drag-handle");
    b.addEventListener("pointerdown", (e) => handlers.beginCardDrag(id, e));
    return b;
  }

  function decoratePlainBlock(el, block, handlers) {
    if (!el || !block || el.querySelector(":scope > .editor-plain-tools")) return;
    el.dataset.plainBlockId = String(block.id);
    el.classList.add("editor-plain-block");

    const tools = document.createElement("div");
    tools.className = "editor-plain-tools";
    tools.appendChild(toolBtn("✎", "Edit text", () => handlers.editPlainBlock(block.id)));
    el.appendChild(tools);
  }

  function decorateNarrativeBlock(el, block, handlers) {
    if (!el || !block || el.querySelector(":scope > .editor-narrative-tools")) return;
    el.dataset.narrativeBlockId = String(block.id);
    el.classList.add("editor-narrative-block");

    const tools = document.createElement("div");
    tools.className = "editor-narrative-tools";
    tools.appendChild(toolBtn("✎", "Edit narrative", () => handlers.editNarrativeBlock(block.id)));
    el.appendChild(tools);
  }

  function toolBtn(glyph, label, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "editor-tool";
    b.textContent = glyph;
    b.title = label;
    b.setAttribute("aria-label", label);
    b.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
    return b;
  }

  // A thin "insert here" target carrying the resolved routing context.
  function insertZone(target, handlers) {
    const zone = document.createElement("div");
    zone.className = "editor-insert-zone";
    zone.innerHTML = '<span class="editor-insert-label">+ insert</span>';
    const open = (e) => {
      e.preventDefault();
      e.stopPropagation();
      handlers.insertMenu(target, e.clientX, e.clientY);
    };
    zone.addEventListener("click", open);
    zone.addEventListener("contextmenu", open);
    return zone;
  }

  function chapterZone(target, handlers) {
    const zone = document.createElement("div");
    zone.className = "grid-full editor-chapter-zone";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "editor-chapter";
    btn.textContent = "+ Chapter after this";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      handlers.insertChapter(target);
    });
    zone.appendChild(btn);
    return zone;
  }

  // Tag each column container with its default column so insert zones know it.
  function tagColumns(grid) {
    [...grid.querySelectorAll(".col-main")].forEach((c) => (c.dataset.col = "left"));
    [...grid.querySelectorAll(".col-aside")].forEach((c) => (c.dataset.col = "right"));
  }

  function decorate(page, model, handlers) {
    // Header band: single column, pure source order (layout puts everything there).
    const headerEl = page.querySelector(".page-header");
    const headerEv = model.events.find((e) => e.kind === "header");
    if (headerEl && headerEv) {
      headerEl.dataset.col = "left";
      zipColumn(headerEl, anchorable(headerEv.cards), handlers, { eventRef: headerEv });
      const headerPlain = (model.plainBlocks || []).find((b) => b.kind === "header");
      decoratePlainBlock(headerEl, headerPlain, handlers);
    }

    const narrativeEls = [...page.querySelectorAll("blockquote")].filter((el) => !el.closest(CARD_DOM_SELECTOR));
    (model.narrativeBlocks || []).forEach((block, i) => decorateNarrativeBlock(narrativeEls[i], block, handlers));

    const grid = page.querySelector(".page-grid");
    if (!grid) {
      if (handlers.insertChapter && headerEl && !headerEl.querySelector(":scope > .editor-chapter-zone")) {
        headerEl.appendChild(chapterZone({ lineIndex: model.lines.length }, handlers));
      }
      return;
    }
    tagColumns(grid);
    grid.querySelectorAll(":scope > .editor-chapter-zone").forEach((n) => n.remove());

    const sectionBlocks = (model.plainBlocks || []).filter((b) => b.kind === "section");
    const sectionEls = [...grid.querySelectorAll(":scope > .grid-full")].filter((el) => {
      const first = el.firstElementChild;
      return first && /^(H1|H2)$/.test(first.tagName);
    });
    sectionBlocks.forEach((block, i) => {
      const el = sectionEls[i];
      decoratePlainBlock(el, block, handlers);
      const ev = model.events.find((e) => e.headingStart === block.headingLine);
      if (el && ev && ev.cards.length === 0 && !el.querySelector(":scope > .editor-insert-zone")) {
        el._editorDropTarget = { afterCardId: null, column: null, eventRef: ev };
        el.appendChild(insertZone({ afterCardId: null, eventRef: ev }, handlers));
      }
      if (el && ev && handlers.insertChapter) {
        const nextSection = sectionEls[i + 1] || null;
        const nextBlock = sectionBlocks[i + 1] || null;
        const lineIndex = nextBlock && nextBlock.headingLine >= 0 ? nextBlock.headingLine : ev.end;
        const zone = chapterZone({ lineIndex }, handlers);
        grid.insertBefore(zone, nextSection);
      }
    });

    const domUnits = gridUnits(grid);

    // Model units in document order, matching the grid: an H2 event yields routed
    // two-column rows; an H1 section yields single-column full-width boxes.
    const modelUnits = [];
    model.events
      .filter((e) => e.kind === "event")
      .forEach((ev) => {
        if (ev.full) {
          hrGroups(model, ev).forEach((cards) => modelUnits.push({ type: "full", cards, ev }));
        } else {
          eventRows(model, ev).forEach((r) => modelUnits.push({ type: "row", left: r.left, right: r.right, ev }));
        }
      });

    const n = Math.min(domUnits.length, modelUnits.length);
    for (let i = 0; i < n; i++) {
      const du = domUnits[i];
      const mu = modelUnits[i];
      if (du.type !== mu.type) {
        console.warn(`[editor] unit type mismatch at ${i}: dom=${du.type} model=${mu.type}`);
        continue;
      }
      const ctx = { eventRef: mu.ev };
      if (du.type === "row") {
        zipColumn(du.main, mu.left, handlers, ctx);
        zipColumn(du.aside, mu.right, handlers, ctx);
      } else {
        zipColumn(du.full, mu.cards, handlers, ctx);
      }
    }
    if (domUnits.length !== modelUnits.length) {
      console.warn(`[editor] unit count mismatch: dom=${domUnits.length} model=${modelUnits.length}`);
    }
  }

  return { decorate, _internals: { eventRows, routeRow } };
})();

if (typeof module !== "undefined" && module.exports) module.exports = EditorAnchors;
