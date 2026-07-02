/* Anchoring: map rendered card elements back to source blocks WITHOUT touching
   any renderer. renderPage() stamps every card <div> with data-src-start/
   data-src-end (the card's source line range) at render time, and layout only
   MOVES nodes, so identity is carried by the DOM itself — no layout re-simulation.
   decorate() finds the stamped elements, joins each to its outline card by line
   (EditorOutline.findCardByStart), and stamps data-block-id.

   It also installs per-card editing handles and insert zones, wired to the
   handler callbacks the controller (editor.js) passes in. */

const EditorAnchors = (() => {
  function editorOn() {
    return document.body.classList.contains("editor-on");
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

  // Resolve one container's stamped card <div>s to their outline cards (DOM order),
  // decorate them, and wire the container as a drop/insert target for dragDrop.js
  // and the column context menu. A stamp that resolves to no outline card is a
  // per-card failure (warned), not a whole-column one.
  function wireContainer(container, eventRef, model, handlers) {
    if (!container) return;
    const column = container.dataset.col || null;
    const found = [];
    [...container.querySelectorAll(":scope > [data-src-start]")].forEach((el) => {
      const hit = EditorOutline.findCardByStart(model, Number(el.dataset.srcStart));
      if (!hit) {
        console.warn("[editor] no outline card at source line " + el.dataset.srcStart);
        return;
      }
      found.push({ el, card: hit.card, event: hit.event });
    });
    const ev = eventRef || (found.length ? found[0].event : null);
    found.forEach(({ el, card }) => {
      el.dataset.blockId = String(card.id);
      decorateCard(el, card, handlers, { column, eventRef: ev });
    });
    const cards = found.map((f) => f.card);
    container._editorDropTarget = {
      afterCardId: cards.length ? cards[cards.length - 1].id : null,
      column,
      eventRef: ev,
    };
    bindColumnContextMenu(container, cards, handlers, { eventRef: ev });
    // An explicit insert zone at the end of the column.
    if (!container.querySelector(":scope > .editor-insert-zone")) {
      container.appendChild(insertZone(container._editorDropTarget, handlers));
    }
  }

  function decorate(page, model, handlers) {
    // Header band: single column (layout puts everything before the first H2 there).
    const headerEl = page.querySelector(".page-header");
    const headerEv = model.events.find((e) => e.kind === "header");
    if (headerEl && headerEv) {
      headerEl.dataset.col = "left";
      wireContainer(headerEl, headerEv, model, handlers);
      const headerPlain = (model.plainBlocks || []).find((b) => b.kind === "header");
      decoratePlainBlock(headerEl, headerPlain, handlers);
    }

    const grid = page.querySelector(".page-grid");
    if (!grid) {
      if (handlers.insertChapter && headerEl && !headerEl.querySelector(":scope > .editor-chapter-zone")) {
        headerEl.appendChild(chapterZone({ lineIndex: model.lines.length }, handlers));
      }
      return;
    }
    tagColumns(grid);
    grid.querySelectorAll(":scope > .editor-chapter-zone").forEach((n) => n.remove());

    // Walk the grid children in document order. A heading .grid-full (H1/H2)
    // advances the "current event"; every card container after it — the row
    // columns and the H1 section's full-width card box — is wired to that event.
    const sectionBlocks = (model.plainBlocks || []).filter((b) => b.kind === "section");
    const sectionEls = [];
    let currentEv = null;
    [...grid.children].forEach((el) => {
      const cl = el.classList;
      if (cl.contains("grid-full")) {
        const first = el.firstElementChild;
        if (first && /^(H1|H2)$/.test(first.tagName)) {
          const block = sectionBlocks[sectionEls.length];
          sectionEls.push(el);
          currentEv = block
            ? model.events.find((e) => e.headingStart === block.headingLine) || null
            : null;
          return;
        }
        // Full-width content box: only card-bearing ones are drop/insert targets
        // (a lone <hr> divider is not).
        if (el.querySelector("[data-src-start]")) wireContainer(el, currentEv, model, handlers);
        return;
      }
      if (cl.contains("col-main") || cl.contains("col-aside")) {
        wireContainer(el, currentEv, model, handlers);
      }
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
  }

  return { decorate };
})();

if (typeof module !== "undefined" && module.exports) module.exports = EditorAnchors;
