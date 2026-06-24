/* Pointer-based editor drag/drop for rendered cards.
   This module never edits markdown directly. It finds a visual drop target from
   the anchored DOM and hands that descriptor back to editor.js. */

const EditorDragDrop = (() => {
  let active = null;

  function editorOn() {
    return document.body.classList.contains("editor-on");
  }

  function publicTarget(target) {
    if (!target) return null;
    return {
      beforeCardId: target.beforeCardId != null ? target.beforeCardId : null,
      afterCardId: target.afterCardId != null ? target.afterCardId : null,
      eventRef: target.eventRef || null,
      column: target.column || null,
    };
  }

  function dropColumn(container) {
    if (!container) return null;
    if (container.classList.contains("col-main")) return "left";
    if (container.classList.contains("col-aside")) return "right";
    return null;
  }

  function distanceToRect(x, y, rect) {
    const dx = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
    const dy = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
    return dx * dx + dy * dy;
  }

  function cardId(el) {
    return el && el.dataset ? Number(el.dataset.blockId) : null;
  }

  function containers(page) {
    return [...page.querySelectorAll(".page-header, .col-main, .col-aside, .grid-full")]
      .filter((el) => el._editorDropTarget && el.getBoundingClientRect().width > 0);
  }

  function nearestContainer(page, x, y) {
    const all = containers(page);
    let best = null;
    let bestD = Infinity;
    all.forEach((el) => {
      const rect = el.getBoundingClientRect();
      const d = distanceToRect(x, y, rect);
      if (d < bestD) {
        best = el;
        bestD = d;
      }
    });
    return best;
  }

  function resolveTarget(page, groupIds, x, y) {
    const container = nearestContainer(page, x, y);
    if (!container) return null;

    const cards = [...container.querySelectorAll(":scope > .editor-card[data-block-id]")]
      .filter((el) => !groupIds.has(cardId(el)));
    const base = container._editorDropTarget || {};
    const column = dropColumn(container);

    if (!cards.length) {
      return {
        container,
        beforeEl: container.querySelector(":scope > .editor-insert-zone") || null,
        beforeCardId: null,
        afterCardId: null,
        eventRef: base.eventRef || null,
        column,
      };
    }

    for (const el of cards) {
      const rect = el.getBoundingClientRect();
      if (y < rect.top + rect.height / 2) {
        return {
          container,
          beforeEl: el,
          beforeCardId: cardId(el),
          afterCardId: null,
          eventRef: base.eventRef || null,
          column,
        };
      }
    }

    const last = cards[cards.length - 1];
    return {
      container,
      beforeEl: container.querySelector(":scope > .editor-insert-zone") || last.nextSibling,
      beforeCardId: null,
      afterCardId: cardId(last),
      eventRef: base.eventRef || null,
      column,
    };
  }

  function createGhost(els, firstRect, startX, startY) {
    const ghost = document.createElement("div");
    ghost.className = "editor-drag-ghost";
    ghost.style.width = firstRect.width + "px";
    els.forEach((el) => {
      const clone = el.cloneNode(true);
      clone.querySelectorAll(".editor-card-tools").forEach((n) => n.remove());
      clone.removeAttribute("id");
      clone.classList.remove("editor-card-drag-source");
      ghost.appendChild(clone);
    });
    document.body.appendChild(ghost);
    moveGhost(ghost, startX - firstRect.left, startY - firstRect.top, startX, startY);
    return ghost;
  }

  function moveGhost(ghost, offsetX, offsetY, x, y) {
    ghost.style.transform = `translate(${Math.round(x - offsetX)}px, ${Math.round(y - offsetY)}px)`;
  }

  function placeMarker(marker, target) {
    if (!target || !target.container) {
      marker.remove();
      return;
    }
    if (target.beforeEl) target.container.insertBefore(marker, target.beforeEl);
    else target.container.appendChild(marker);
  }

  function cleanup() {
    if (!active) return;
    document.removeEventListener("pointermove", onPointerMove, true);
    document.removeEventListener("pointerup", onPointerUp, true);
    document.removeEventListener("pointercancel", onPointerCancel, true);
    document.removeEventListener("keydown", onKeyDown, true);
    active.els.forEach((el) => el.classList.remove("editor-card-drag-source"));
    active.ghost.remove();
    active.marker.remove();
    document.body.classList.remove("editor-card-dragging");
    active = null;
  }

  function update(e) {
    if (!active) return;
    moveGhost(active.ghost, active.offsetX, active.offsetY, e.clientX, e.clientY);
    active.target = resolveTarget(active.page, active.groupIds, e.clientX, e.clientY);
    placeMarker(active.marker, active.target);
  }

  function onPointerMove(e) {
    if (!active) return;
    e.preventDefault();
    update(e);
  }

  function onPointerUp(e) {
    if (!active) return;
    e.preventDefault();
    update(e);
    const target = publicTarget(active.target);
    const onDrop = active.onDrop;
    cleanup();
    if (target) onDrop(target);
  }

  function onPointerCancel() {
    cleanup();
  }

  function onKeyDown(e) {
    if (e.key === "Escape") cleanup();
  }

  function begin(options) {
    if (!options || !options.pointerEvent || !options.page || !options.model) return;
    const e = options.pointerEvent;
    if (e.button != null && e.button !== 0) return;
    if (!editorOn()) return;

    const group = EditorOutline.connectedCardGroup(options.model, options.cardId);
    if (!group || !group.cards.length) return;
    const els = group.cards
      .map((card) => options.page.querySelector(`.editor-card[data-block-id="${card.id}"]`))
      .filter(Boolean);
    if (!els.length) return;

    if (active) cleanup();
    e.preventDefault();
    e.stopPropagation();

    const firstRect = els[0].getBoundingClientRect();
    const marker = document.createElement("div");
    marker.className = "editor-drop-marker";
    const ghost = createGhost(els, firstRect, e.clientX, e.clientY);
    els.forEach((el) => el.classList.add("editor-card-drag-source"));
    document.body.classList.add("editor-card-dragging");

    active = {
      page: options.page,
      els,
      groupIds: new Set(group.ids),
      marker,
      ghost,
      offsetX: e.clientX - firstRect.left,
      offsetY: e.clientY - firstRect.top,
      target: null,
      onDrop: options.onDrop,
    };

    document.addEventListener("pointermove", onPointerMove, true);
    document.addEventListener("pointerup", onPointerUp, true);
    document.addEventListener("pointercancel", onPointerCancel, true);
    document.addEventListener("keydown", onKeyDown, true);
    update(e);
  }

  return { begin, cancel: cleanup };
})();

if (typeof module !== "undefined" && module.exports) module.exports = EditorDragDrop;
