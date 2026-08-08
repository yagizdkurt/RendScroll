/* Editor mode controller — the SCENE document.
   Mounts the editor controls, registers the open scene with EditorDocSession,
   and owns every scene-specific operation. All markdown manipulation goes
   through EditorOutline; all card<->source mapping through EditorAnchors;
   forms/menus through EditorForm / EditorContextMenu.

   The session itself — 50-step undo, the dirty flag, Save, the navigation guard,
   the toolbar and the toast — lives in editor/docSession.js, shared with the
   Lore editor. This file no longer owns any of that; it hands the session a
   scene document and reacts to its callbacks.

   The reader pipeline (renderPage, from src/app/app.js) is reused verbatim:
   after every model change we re-render from the serialized model and re-decorate.
   When editor mode is OFF nothing here runs beyond caching the scene source. */

const Editor = (() => {
  const S = EditorDocSession;
  // Mirrors the session so existing readers of Editor.getState() (appLibrary,
  // debugPanel) keep working; `path`/`model` stay scene-specific.
  const state = { enabled: false, path: null, model: null, dirty: false };
  let page = null;

  // --- model edit ops (operate on the CURRENT model only; ids are not stable
  //     across re-parse, so never carry an id across a mutation) ------------

  function syncState() {
    state.enabled = S.isEnabled();
    state.dirty = S.isDirty();
    if (S.kind() === "scene") state.model = S.model();
  }

  // Every scene mutation goes through the session, which snapshots for undo,
  // marks dirty and calls back into rerender().
  function applyModel(newModel, opts) {
    S.apply(newModel, opts);
    syncState();
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

  // --- library-backed items -----------------------------------------------
  // SourceItems live once in /Items as standalone files; scenes hold lightweight
  // Item instances whose empty fields inherit from the named SourceItem.

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

  // First parsed card node in a block's markdown, so name extraction relies on the
  // parser's classification/title rules instead of restating heading regexes.
  function firstCardOfBlock(block) {
    return RendScrollParser.firstCardNode(RendScrollParser.parseRendScroll(String(block || "")));
  }

  function itemNameFromBlock(block) {
    const c = firstCardOfBlock(block);
    return c && (c.type === "item" || c.type === "sourceitem") ? String(c.title || "").trim() : "";
  }

  // New item from the create form -> write /Items/Name.md as SourceItem, then
  // insert a scene Item instance with SourceItem: Name.
  async function createItemToLibrary(block, target) {
    const name = itemNameFromBlock(block);
    if (!name || typeof RefLibrary === "undefined") { insertCardBlock(block, target); return; }
    try {
      await RefLibrary.createFile("item", name, ensureTrailingNewline(RefLibrary.sourceItemContent(name, block)));
      insertCardBlock(RefLibrary.itemInstanceContent(name), target);
      notifyLibraryChanged("item", name, { created: true });
      toast("Created library item: " + name);
    } catch (err) {
      toast(err.message || "Item create failed", true);
    }
  }

  // Create a library item with no scene instance, parallel to
  // createEnemyToLibrary. `onCreated(name)` runs after the file is written
  // (e.g. to open the new item's library view).
  function createLibraryItem(onCreated, scope) {
    if (typeof RefLibrary === "undefined" || typeof EditorForm === "undefined") return;
    EditorForm.openCreate("sourceitem", state.model, async (block) => {
      const name = itemNameFromBlock(block);
      if (!name) { toast("Item has no name", true); return; }
      try {
        await RefLibrary.createFile("item", name, ensureTrailingNewline(RefLibrary.sourceItemContent(name, block)), scope);
        notifyLibraryChanged("item", name, { created: true });
        toast("Created library item: " + name);
        if (typeof onCreated === "function") onCreated(name);
      } catch (err) {
        toast(err.message || "Item create failed", true);
      }
    });
  }

  function enemyNameFromBlock(block) {
    const c = firstCardOfBlock(block);
    return c && c.type === "sourceenemy" ? String(c.title || "").trim() : "";
  }

  // Create a new enemy library file from the SourceEnemy form. Used by the combat
  // card's "+ from library -> create new" and the shared Add menu.
  // `onCreated(name)` (optional) runs after the file is written (e.g. to add a ref
  // row to the open combat card, or open the new enemy's library view).
  function createEnemyToLibrary(onCreated, scope) {
    if (typeof RefLibrary === "undefined" || typeof EditorForm === "undefined") return;
    EditorForm.openCreate("sourceenemy", state.model, async (block) => {
      const name = enemyNameFromBlock(block);
      if (!name) { toast("Enemy has no name", true); return; }
      try {
        await RefLibrary.createFile("enemy", name, ensureTrailingNewline(RefLibrary.sourceEnemyContent(name, block)), scope);
        notifyLibraryChanged("enemy", name, { created: true });
        toast("Created library enemy: " + name);
        if (typeof onCreated === "function") onCreated(name);
      } catch (err) {
        toast(err.message || "Enemy create failed", true);
      }
    });
  }

  // Extract one inline combat enemy into the library: write Enemies/Name.md and
  // return the name so the caller can swap the inline row for a [enemy=Name] ref.
  // Resolves to the name on success (including when the file already exists), or
  // null on failure / no name.
  async function moveEnemyToLibrary(rec) {
    if (typeof RefLibrary === "undefined" || typeof CombatEnemyModel === "undefined") return null;
    const name = (rec && rec.name || "").trim();
    if (!name) { toast("Enemy has no name", true); return null; }
    const single = Object.assign({}, rec, { ref: "", count: 1 });
    const block = "### SourceEnemy: " + name + "\n" + CombatEnemyModel.serializeEnemies([single]) + "\n";
    try {
      await RefLibrary.createFile("enemy", name, ensureTrailingNewline(RefLibrary.sourceEnemyContent(name, block)));
      notifyLibraryChanged("enemy", name, { created: true });
      toast("Moved enemy to library: " + name);
      return name;
    } catch (err) {
      // A name collision means the library already has it — ref it as-is.
      if (/already exists/i.test(err && err.message || "")) {
        toast("Linked to existing library enemy: " + name);
        return name;
      }
      toast(err.message || "Move failed", true);
      return null;
    }
  }

  function cardIsItem(id) {
    const found = EditorOutline.findCard(state.model, id);
    return !!(found && found.card.type === "item");
  }

  // Migration: extract an inline item card into /Items and leave a scene Item
  // instance that points at the new SourceItem.
  async function moveItemToLibrary(id) {
    if (typeof RefLibrary === "undefined") return;
    const found = EditorOutline.findCard(state.model, id);
    if (!found || found.card.type !== "item") return;
    const name = found.card.title;
    if (!name) { toast("Item has no name", true); return; }
    const src = EditorOutline.cardSource(state.model, found.card);
    try {
      await RefLibrary.createFile("item", name, ensureTrailingNewline(RefLibrary.sourceItemContent(name, src)));
      applyModel(EditorOutline.replaceCard(state.model, found.card, RefLibrary.itemInstanceContent(name)));
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
    const path = entry.path;
    EditorForm.openEdit(libCard, libModel, async (block) => {
      try {
        await SceneSave.save(path, ensureTrailingNewline(block));
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
          onPick: (name) => insertCardBlock(RefLibrary.itemInstanceContent(name), target),
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
    }
  }

  function rerender() {
    // Reuse the reader pipeline verbatim (globals from src/app/app.js).
    renderPage(EditorOutline.serialize(state.model));
    decorate();
  }

  async function save(opts) {
    return S.save(opts);
  }

  function confirmNavigation(opts) {
    return S.confirmNavigation(opts);
  }

  // --- UI ----------------------------------------------------------------

  function setEnabled(on) {
    if (!on && typeof EditorDragDrop !== "undefined") EditorDragDrop.cancel();
    S.setEnabled(on);
    syncState();
    if (on) decorate();
    else if (page) clearDecorations();
  }

  function clearDecorations() {
    if (typeof EditorDragDrop !== "undefined") EditorDragDrop.cancel();
    page.querySelectorAll(".editor-card-tools, .editor-plain-tools, .editor-insert-zone, .editor-chapter-zone").forEach((n) => n.remove());
    page.querySelectorAll("[data-block-id]").forEach((n) => {
      n.removeAttribute("data-block-id");
      n.classList.remove("editor-card");
      n.classList.remove("editor-card-drag-source");
    });
    page.querySelectorAll("[data-plain-block-id]").forEach((n) => {
      n.removeAttribute("data-plain-block-id");
      n.classList.remove("editor-plain-block");
    });
  }

  function installReaderContextMenu() {
    if (!page) return;
    page.addEventListener("contextmenu", (e) => {
      if (state.enabled || !state.model || !state.path) return;
      if (typeof EditorContextMenu === "undefined") return;
      e.preventDefault();
      EditorContextMenu.openReader(e.clientX, e.clientY, {
        enableEditor: () => setEnabled(true),
      });
    });
  }

  function toast(msg, isError) {
    S.toast(msg, isError);
  }

  // Register the scene that just loaded as the session's document. A scene with
  // no path (the reader showing a library page) clears the session instead.
  function openScene(path, text) {
    if (typeof EditorDragDrop !== "undefined") EditorDragDrop.cancel();
    state.path = path;
    if (!path) {
      state.model = null;
      S.clear();
      syncState();
      return;
    }
    state.model = EditorOutline.parse(text);
    S.setDocument({
      kind: "scene",
      path,
      model: state.model,
      serialize: (m) => EditorOutline.serialize(m),
      parse: (raw) => EditorOutline.parse(raw),
      onChange: () => { syncState(); rerender(); },
      save: (m) => SceneSave.save(path, EditorOutline.serialize(m)),
    });
    syncState();
    decorate();
  }

  // The reader left the scene view (a library page is on screen). Drop the scene
  // document so its model can never be saved over, or undone into, from there.
  function closeScene() {
    if (typeof EditorDragDrop !== "undefined") EditorDragDrop.cancel();
    state.path = null;
    state.model = null;
    S.clear();
    syncState();
  }

  function init() {
    page = document.getElementById("page");
    S.init(setEnabled);
    installReaderContextMenu();
    document.addEventListener("scene:loaded", (e) => openScene(e.detail.path, e.detail.text));
  }

  return {
    init,
    getState: () => { syncState(); return state; },
    // Re-render the current scene with editing decorations (used by app.js after
    // a library change while the editor is on).
    rerender,
    // Edit a library file via the item form (used by the library sidebar view and
    // by reference-card tools). Works regardless of scene edit mode.
    editLibraryItem,
    confirmNavigation,
    save,
    // Called by the library reader when it takes the scene off screen.
    closeScene,
    hasUnsavedChanges: () => S.isDirty(),
    // Create a new library item with no scene instance.
    createLibraryItem,
    // Create a new enemy library file (combat picker + shared Add menu).
    createEnemyToLibrary,
    // Move one inline combat enemy into the library (combat enemy editor).
    moveEnemyToLibrary,
    _undo: () => S.undo(),
    _undoDepth: () => S._undoDepth(),
    _handlers: handlers,
  };
})();

Editor.init();
