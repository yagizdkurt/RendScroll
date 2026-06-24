/* Editor mode controller.
   Owns editor state (on/off, current scene path, the outline model, dirty flag),
   mounts the sidebar controls, and orchestrates re-render + save. All markdown
   manipulation goes through EditorOutline; all card<->source mapping through
   EditorAnchors; forms/menus through EditorForm / EditorContextMenu.

   The reader pipeline (toHtml + renderPage, from src/app.js) is reused verbatim:
   after every model change we re-render from the serialized model and re-decorate.
   When editor mode is OFF nothing here runs beyond caching the scene source. */

const Editor = (() => {
  const state = { enabled: false, path: null, model: null, dirty: false };
  let page = null;

  // --- model edit ops (operate on the CURRENT model only; ids are not stable
  //     across re-parse, so never carry an id across a mutation) ------------

  function applyModel(newModel) {
    state.model = newModel;
    markDirty(true);
    rerender();
  }

  function deleteCard(id) {
    const found = EditorOutline.findCard(state.model, id);
    if (!found) return;
    applyModel(EditorOutline.deleteCard(state.model, found.card));
  }

  // Swap two source blocks a (earlier) and b (later). Preserves the gap between.
  function swapBlocks(model, a, b) {
    const off = (i) => {
      let o = 0;
      for (let k = 0; k < i && k < model.lines.length; k++) o += model.lines[k].length;
      return o;
    };
    const aText = model.raw.slice(off(a.start), off(a.end));
    const gap = model.raw.slice(off(a.end), off(b.start));
    const bText = model.raw.slice(off(b.start), off(b.end));
    return EditorOutline.spliceText(model, a.start, b.end, bText + gap + aText);
  }

  function moveCard(id, dir) {
    const found = EditorOutline.findCard(state.model, id);
    if (!found) return;
    const sibs = found.event.cards; // same-event order; no cross-event moves
    const idx = sibs.findIndex((c) => c.id === id);
    const j = idx + dir;
    if (j < 0 || j >= sibs.length) return;
    const a = dir < 0 ? sibs[j] : sibs[idx];
    const b = dir < 0 ? sibs[idx] : sibs[j];
    applyModel(swapBlocks(state.model, a, b));
  }

  // Insert markdown `block` for a new card relative to a target descriptor.
  // target = { afterCardId, eventRef } resolved by the caller (menu/anchors).
  function insertCardBlock(block, target) {
    let lineIndex;
    if (target && target.afterCardId != null) {
      const found = EditorOutline.findCard(state.model, target.afterCardId);
      lineIndex = found ? found.card.end : firstEventEnd();
    } else if (target && target.eventRef) {
      lineIndex = insertEndOfEvent(target.eventRef);
    } else {
      lineIndex = firstEventEnd();
    }
    applyModel(EditorOutline.insertAtLine(state.model, lineIndex, block));
  }

  // Insert point at the end of an event's cards (before a trailing <hr>).
  function insertEndOfEvent(ev) {
    if (ev.cards.length) return ev.cards[ev.cards.length - 1].end;
    return ev.end;
  }

  function firstEventEnd() {
    const ev = state.model.events.find((e) => e.kind === "event") ||
      state.model.events[state.model.events.length - 1];
    return insertEndOfEvent(ev);
  }

  function replaceCardBlock(id, block) {
    const found = EditorOutline.findCard(state.model, id);
    if (!found) return;
    applyModel(EditorOutline.replaceCard(state.model, found.card, block));
  }

  function replacePlainBlock(id, values) {
    const block = EditorOutline.findPlainBlock(state.model, id);
    if (!block) return;
    applyModel(EditorOutline.replacePlainBlock(state.model, block, values));
  }

  function replaceNarrativeBlock(id, text) {
    const block = EditorOutline.findNarrativeBlock(state.model, id);
    if (!block) return;
    applyModel(EditorOutline.replaceNarrativeBlock(state.model, block, text));
  }

  // --- handlers handed to anchors/menus ----------------------------------

  const handlers = {
    deleteCard,
    moveCard,
    editCard(id) {
      const found = EditorOutline.findCard(state.model, id);
      if (found && typeof EditorForm !== "undefined") {
        EditorForm.openEdit(found.card, state.model, (block) => replaceCardBlock(id, block));
      }
    },
    editPlainBlock(id) {
      const block = EditorOutline.findPlainBlock(state.model, id);
      if (block && typeof EditorForm !== "undefined") {
        EditorForm.openPlain(block, state.model, (values) => replacePlainBlock(id, values));
      }
    },
    editNarrativeBlock(id) {
      const block = EditorOutline.findNarrativeBlock(state.model, id);
      if (block && typeof EditorForm !== "undefined") {
        EditorForm.openNarrative(block, state.model, (text) => replaceNarrativeBlock(id, text));
      }
    },
    cardMenu(id, x, y) {
      // Listeners persist after toggling off (no re-render), so gate here.
      if (!state.enabled) return;
      if (typeof EditorContextMenu !== "undefined") EditorContextMenu.openCard(id, x, y, handlers);
    },
    insertMenu(target, x, y) {
      if (!state.enabled) return;
      if (typeof EditorContextMenu !== "undefined") EditorContextMenu.openInsert(target, x, y, handlers);
    },
    pickInsert(type, target) {
      if (typeof EditorForm !== "undefined") {
        EditorForm.openCreate(type, state.model, (block) => insertCardBlock(block, target));
      }
    },
    pickNarrative(target) {
      if (typeof EditorForm !== "undefined") {
        EditorForm.openNarrative(null, state.model, (text) =>
          insertCardBlock(EditorOutline.narrativeBlock(text), target)
        );
      }
    },
    insertChapter(target) {
      if (typeof EditorForm !== "undefined") {
        EditorForm.openChapter((values) =>
          applyModel(EditorOutline.insertAtLine(
            state.model,
            target && target.lineIndex != null ? target.lineIndex : state.model.lines.length,
            EditorOutline.chapterBlock(values)
          ))
        );
      }
    },
  };

  // --- render / save -----------------------------------------------------

  function decorate() {
    if (state.model && state.enabled) EditorAnchors.decorate(page, state.model, handlers);
  }

  function rerender() {
    // Reuse the reader pipeline verbatim (globals from src/app.js).
    renderPage(toHtml(EditorOutline.serialize(state.model)));
    decorate();
  }

  async function save() {
    if (!state.path) return;
    try {
      await EditorSave.save(state.path, EditorOutline.serialize(state.model));
      markDirty(false);
      toast("Saved " + state.path);
    } catch (err) {
      toast(err.message, true);
    }
  }

  // --- UI ----------------------------------------------------------------

  let toggleBtn, saveBtn, dirtyDot, toastEl;

  function mountControls() {
    const host = document.getElementById("options") || document.getElementById("sidebar");
    const box = document.createElement("div");
    box.className = "editor-controls";

    toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "editor-toggle";
    toggleBtn.textContent = "✎ Edit";
    toggleBtn.addEventListener("click", () => setEnabled(!state.enabled));

    saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "editor-save";
    saveBtn.textContent = "Save";
    saveBtn.addEventListener("click", save);

    dirtyDot = document.createElement("span");
    dirtyDot.className = "editor-dirty";
    dirtyDot.title = "Unsaved changes";

    box.appendChild(toggleBtn);
    box.appendChild(saveBtn);
    box.appendChild(dirtyDot);
    host.appendChild(box);

    toastEl = document.createElement("div");
    toastEl.className = "editor-toast";
    document.body.appendChild(toastEl);

    updateUi();
  }

  function setEnabled(on) {
    state.enabled = on;
    document.body.classList.toggle("editor-on", on);
    if (on) decorate();
    else if (page) clearDecorations();
    updateUi();
  }

  function clearDecorations() {
    page.querySelectorAll(".editor-card-tools, .editor-plain-tools, .editor-narrative-tools, .editor-insert-zone, .editor-chapter-zone").forEach((n) => n.remove());
    page.querySelectorAll("[data-block-id]").forEach((n) => {
      n.removeAttribute("data-block-id");
      n.classList.remove("editor-card");
    });
    page.querySelectorAll("[data-plain-block-id]").forEach((n) => {
      n.removeAttribute("data-plain-block-id");
      n.classList.remove("editor-plain-block");
    });
    page.querySelectorAll("[data-narrative-block-id]").forEach((n) => {
      n.removeAttribute("data-narrative-block-id");
      n.classList.remove("editor-narrative-block");
    });
  }

  function markDirty(on) {
    state.dirty = on;
    updateUi();
  }

  function updateUi() {
    if (!toggleBtn) return;
    toggleBtn.classList.toggle("is-on", state.enabled);
    toggleBtn.setAttribute("aria-pressed", String(state.enabled));
    saveBtn.disabled = !state.dirty;
    dirtyDot.classList.toggle("is-visible", state.dirty);
  }

  let toastTimer = null;
  function toast(msg, isError) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.toggle("is-error", !!isError);
    toastEl.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("is-visible"), 2600);
  }

  function init() {
    page = document.getElementById("page");
    mountControls();
    document.addEventListener("scene:loaded", (e) => {
      state.path = e.detail.path;
      state.model = EditorOutline.parse(e.detail.text);
      markDirty(false);
      decorate();
    });
  }

  return { init, getState: () => state, _handlers: handlers };
})();

Editor.init();
