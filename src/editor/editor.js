/* Editor mode controller.
   Owns editor state (on/off, current scene path, the outline model, dirty flag),
   mounts the editor controls, and orchestrates re-render + save. All markdown
   manipulation goes through EditorOutline; all card<->source mapping through
   EditorAnchors; forms/menus through EditorForm / EditorContextMenu.

   The reader pipeline (renderPage, from src/app.js) is reused verbatim:
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

  function moveCardGroup(id, target) {
    if (!state.enabled || !state.model) return;
    const next = EditorOutline.moveCardGroup(state.model, id, target);
    if (next !== state.model) applyModel(next);
  }

  function blockWithTargetColumn(block, target) {
    if (!target || (target.column !== "left" && target.column !== "right")) return block;
    // A library reference line has no body to take a "Side:" directive.
    if (/^\s*\[[a-z][a-z0-9-]*=[^\]\r\n]+\]\s*$/i.test(block)) return block;
    return EditorOutline.rewriteBlockColumn(state.model, block, target.column);
  }

  // Insert markdown `block` for a new card relative to a target descriptor.
  // target = { beforeCardId, afterCardId, eventRef, column } resolved by menus/anchors.
  function insertCardBlock(block, target) {
    let lineIndex;
    if (target && target.beforeCardId != null) {
      const found = EditorOutline.findCard(state.model, target.beforeCardId);
      lineIndex = found ? found.card.start : firstEventEnd();
    } else if (target && target.afterCardId != null) {
      const found = EditorOutline.findCard(state.model, target.afterCardId);
      lineIndex = found ? found.card.end : firstEventEnd();
    } else if (target && target.eventRef) {
      lineIndex = insertEndOfEvent(target.eventRef);
    } else {
      lineIndex = firstEventEnd();
    }
    applyModel(EditorOutline.insertAtLine(state.model, lineIndex, blockWithTargetColumn(block, target)));
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

  // --- library references ([item=Name]) -----------------------------------
  // Items live once in /Items as standalone files; scenes only reference them, so
  // the editor never writes an item's body into a scene (see plan §6).

  function ensureTrailingNewline(text) {
    const t = String(text || "");
    return /\n$/.test(t) ? t : t + "\n";
  }

  // Tell the rest of the app a library file changed: app.js re-mounts the Item
  // Library sidebar and re-renders the current view so references resolve.
  function notifyLibraryChanged(type, name, extra) {
    document.dispatchEvent(new CustomEvent("library:changed", {
      detail: Object.assign({ type, name }, extra || {}),
    }));
  }

  function itemNameFromBlock(block) {
    const m = String(block).match(/^###\s+item\s*:\s*(.+?)\s*$/im);
    return m ? m[1].trim() : "";
  }

  // New item from the create form -> write /Items/Name.md, insert "[item=Name]".
  async function createItemToLibrary(block, target) {
    const name = itemNameFromBlock(block);
    if (!name || typeof RefLibrary === "undefined") { insertCardBlock(block, target); return; }
    try {
      await RefLibrary.createFile("item", name, ensureTrailingNewline(block));
      insertCardBlock("[item=" + name + "]\n", target);
      notifyLibraryChanged("item", name, { created: true });
      toast("Created library item: " + name);
    } catch (err) {
      toast(err.message || "Item create failed", true);
    }
  }

  function cardIsItem(id) {
    const found = EditorOutline.findCard(state.model, id);
    return !!(found && found.card.type === "item");
  }

  // Migration: extract an inline item card into /Items and leave "[item=Name]".
  async function moveItemToLibrary(id) {
    if (typeof RefLibrary === "undefined") return;
    const found = EditorOutline.findCard(state.model, id);
    if (!found || found.card.type !== "item") return;
    const name = found.card.title;
    if (!name) { toast("Item has no name", true); return; }
    const src = EditorOutline.cardSource(state.model, found.card);
    try {
      await RefLibrary.createFile("item", name, ensureTrailingNewline(src));
      applyModel(EditorOutline.replaceCard(state.model, found.card, "[item=" + name + "]\n"));
      notifyLibraryChanged("item", name, { created: true });
      toast("Moved to library: " + name);
    } catch (err) {
      toast(err.message || "Move failed", true);
    }
  }

  // Edit the underlying library file (from a reference card's "Library" button):
  // open the item form on the file's source and save back to /Items, so every
  // scene that references it updates on the next render.
  function editLibraryItem(type, name) {
    if (typeof RefLibrary === "undefined" || typeof EditorForm === "undefined") return;
    const def = RefLibrary.def(type);
    const entry = RefLibrary.lookup(type, name);
    if (!def || !entry) { toast("Library item not found: " + name, true); return; }
    const libModel = EditorOutline.parse(entry.source);
    const libCard = libModel.events.flatMap((e) => e.cards)[0];
    if (!libCard) { toast("Library file has no card", true); return; }
    const path = def.folder + "/" + name + ".md";
    EditorForm.openEdit(libCard, libModel, async (block) => {
      try {
        await EditorSave.save(path, ensureTrailingNewline(block));
        await RefLibrary.refresh(type, name);
        // app.js re-renders the right view (scene with decorations, or the
        // library view) in response to this; don't rerender the scene here.
        notifyLibraryChanged(type, name, { edited: true });
        toast("Saved library item: " + name);
      } catch (err) {
        toast(err.message || "Save failed", true);
      }
    });
  }

  // Remove a reference line from the current scene (safe only when unambiguous).
  function removeRef(type, name) {
    const p = RendScrollParser;
    const matches = [];
    state.model.lines.forEach((ln, i) => {
      const m = p.lineText(ln).trim().match(p.regexes.REF_LINE_RE);
      if (m && m[1].toLowerCase() === type && RefLibrary.norm(m[2]) === RefLibrary.norm(name)) matches.push(i);
    });
    if (!matches.length) { toast("Reference not found", true); return; }
    if (matches.length > 1) { toast("Multiple references — edit source to remove", true); return; }
    applyModel(EditorOutline.spliceText(state.model, matches[0], matches[0] + 1, ""));
  }

  // --- handlers handed to anchors/menus ----------------------------------

  const handlers = {
    deleteCard,
    moveCard,
    beginCardDrag(id, pointerEvent) {
      if (!state.enabled || !state.model || typeof EditorDragDrop === "undefined") return;
      EditorDragDrop.begin({
        page,
        model: state.model,
        cardId: id,
        pointerEvent,
        onDrop: (target) => moveCardGroup(id, target),
      });
    },
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
    cardMenu(id, x, y, ctx) {
      // Listeners persist after toggling off (no re-render), so gate here.
      if (!state.enabled) return;
      if (typeof EditorContextMenu !== "undefined") EditorContextMenu.openCard(id, x, y, handlers, ctx);
    },
    insertMenu(target, x, y) {
      if (!state.enabled) return;
      if (typeof EditorContextMenu !== "undefined") EditorContextMenu.openInsert(target, x, y, handlers);
    },
    pickInsert(type, target) {
      if (typeof EditorForm === "undefined") return;
      // Items are inserted as a reference to a library file, never embedded as a
      // card body. Open a picker of existing items (or create a new one).
      if (type === "item" && typeof RefLibrary !== "undefined" && typeof EditorLibraryPicker !== "undefined") {
        EditorLibraryPicker.open({
          onPick: (name) => insertCardBlock("[item=" + name + "]\n", target),
          onCreateNew: () => EditorForm.openCreate("item", state.model, (block) => createItemToLibrary(block, target)),
        });
        return;
      }
      if (type === "item" && typeof RefLibrary !== "undefined") {
        EditorForm.openCreate(type, state.model, (block) => createItemToLibrary(block, target));
        return;
      }
      EditorForm.openCreate(type, state.model, (block) => insertCardBlock(block, target));
    },
    moveItemToLibrary,
    cardIsItem,
    editLibraryItem,
    removeRef,
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
    if (state.model && state.enabled) {
      EditorAnchors.decorate(page, state.model, handlers);
      decorateRefCards();
    }
  }

  // Reference-sourced cards aren't in the outline model, so anchors.js skips them.
  // Give them their own minimal toolbar: edit the library file, or remove the
  // reference from this scene.
  function decorateRefCards() {
    page.querySelectorAll("[data-ref-source]").forEach((card) => {
      if (card.querySelector(":scope > .editor-ref-tools")) return;
      const [type, name] = String(card.dataset.refSource).split("::");
      card.classList.add("editor-ref-card");
      const tools = document.createElement("div");
      tools.className = "editor-ref-tools";

      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "editor-mini";
      edit.textContent = "✎ Library";
      edit.title = "Edit the library item (updates every scene)";
      edit.addEventListener("click", () => editLibraryItem(type, name));

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "editor-mini";
      remove.textContent = "✕ Ref";
      remove.title = "Remove this reference from the scene";
      remove.addEventListener("click", () => removeRef(type, name));

      tools.appendChild(edit);
      tools.appendChild(remove);
      card.appendChild(tools);
    });
  }

  function rerender() {
    // Reuse the reader pipeline verbatim (globals from src/app.js).
    renderPage(EditorOutline.serialize(state.model));
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
    const host = document.getElementById("topbar-primary") ||
      document.getElementById("topbar-tools") ||
      document.getElementById("options") || document.getElementById("sidebar");
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
    if (!on && typeof EditorDragDrop !== "undefined") EditorDragDrop.cancel();
    state.enabled = on;
    document.body.classList.toggle("editor-on", on);
    if (on) decorate();
    else if (page) clearDecorations();
    updateUi();
  }

  function clearDecorations() {
    if (typeof EditorDragDrop !== "undefined") EditorDragDrop.cancel();
    page.querySelectorAll(".editor-card-tools, .editor-plain-tools, .editor-narrative-tools, .editor-ref-tools, .editor-insert-zone, .editor-chapter-zone").forEach((n) => n.remove());
    page.querySelectorAll(".editor-ref-card").forEach((n) => n.classList.remove("editor-ref-card"));
    page.querySelectorAll("[data-block-id]").forEach((n) => {
      n.removeAttribute("data-block-id");
      n.classList.remove("editor-card");
      n.classList.remove("editor-card-drag-source");
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
      if (typeof EditorDragDrop !== "undefined") EditorDragDrop.cancel();
      state.path = e.detail.path;
      state.model = EditorOutline.parse(e.detail.text);
      markDirty(false);
      decorate();
    });
  }

  return {
    init,
    getState: () => state,
    // Re-render the current scene with editing decorations (used by app.js after
    // a library change while the editor is on).
    rerender,
    // Edit a library file via the item form (used by the library sidebar view and
    // by reference-card tools). Works regardless of scene edit mode.
    editLibraryItem,
    _handlers: handlers,
  };
})();

Editor.init();
