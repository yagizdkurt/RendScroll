/* Editing session for ONE open document, whatever kind it is.

   Extracted from editor.js, which owned two things at once: the session
   (undo / dirty / Save / navigation guard / toolbar / toast) and everything
   specific to editing a scene. Only the first half is generic, and Lore pages
   need exactly it — same 50-step Ctrl+Z, same Save button, same "you have
   unsaved edits" prompt.

   There is one toolbar and one beforeunload handler in the app, so there is one
   session. A document registers itself with setDocument(); registering a
   different document resets the undo stack (an undo must never restore another
   file's text). The document supplies the four things the session cannot know:

     serialize(model) -> string   what Save writes
     parse(raw)       -> model    how an undo snapshot comes back
     onChange(model)             re-render after every mutation
     save(model)      -> Promise  where it goes

   editor.js registers the scene document; lore/loreEditor.js registers a lore
   page. Neither knows about the other. */

const EditorDocSession = (() => {
  const UNDO_LIMIT = 50;

  // The registered document, or null when nothing is open for editing.
  let doc = null;
  const state = { enabled: false, dirty: false };
  let undoStack = [];
  let navigationPrompt = null;

  let toggleBtn = null;
  let saveBtn = null;
  let dirtyDot = null;
  let toastEl = null;
  let toastTimer = null;

  // --- document registration ---------------------------------------------

  function setDocument(next) {
    doc = next || null;
    undoStack = [];
    markDirty(false);
  }

  function clear() {
    setDocument(null);
  }

  function current() { return doc; }
  function model() { return doc ? doc.model : null; }
  function kind() { return doc ? doc.kind : null; }

  // --- undo ---------------------------------------------------------------

  function snapshot() {
    if (!doc) return;
    const raw = doc.serialize(doc.model);
    if (undoStack.length && undoStack[undoStack.length - 1] === raw) return;
    undoStack.push(raw);
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  }

  /* Adopt a new model. Every mutation goes through here, so the undo snapshot,
     the dirty flag and the re-render can never get out of step. */
  function apply(newModel, opts) {
    if (!doc) return;
    if (!opts || !opts.skipUndo) snapshot();
    doc.model = newModel;
    markDirty(true);
    if (doc.onChange) doc.onChange(doc.model);
  }

  function undo() {
    if (!state.enabled || !doc || !undoStack.length) return false;
    apply(doc.parse(undoStack.pop()), { skipUndo: true });
    return true;
  }

  function isEditableTarget(target) {
    for (let el = target; el && el !== document; el = el.parentNode) {
      const tag = el.tagName ? el.tagName.toLowerCase() : "";
      if (tag === "input" || tag === "textarea" || tag === "select") return true;
      if (el.isContentEditable || el.getAttribute && el.getAttribute("contenteditable") === "true") return true;
    }
    return false;
  }

  function onUndoKeydown(e) {
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey || String(e.key).toLowerCase() !== "z") return;
    if (isEditableTarget(e.target)) return;
    if (undo()) e.preventDefault();
  }

  // --- save ---------------------------------------------------------------

  async function save(opts) {
    opts = opts || {};
    if (!doc || !doc.save) return true;
    try {
      await doc.save(doc.model);
      markDirty(false);
      if (!opts.silent) toast("Saved " + (doc.path || ""));
      return true;
    } catch (err) {
      toast((err && err.message) || "Save failed", true);
      return false;
    }
  }

  // --- navigation guard ---------------------------------------------------

  function fallbackNavigationPrompt() {
    if (window.confirm("You have unsaved edits. Save changes before leaving this page?")) {
      return Promise.resolve("save");
    }
    if (window.confirm("Discard unsaved changes and leave this page?")) {
      return Promise.resolve("discard");
    }
    return Promise.resolve("cancel");
  }

  function openNavigationPrompt(opts) {
    if (navigationPrompt) return navigationPrompt;
    opts = opts || {};
    const titleText = opts.titleText || "Unsaved Changes";
    const messageText = opts.messageText ||
      "You have unsaved edits on this page. Save them before switching pages?";

    navigationPrompt = new Promise((resolve) => {
      if (typeof makeModal !== "function") {
        fallbackNavigationPrompt().then((choice) => {
          navigationPrompt = null;
          resolve(choice);
        });
        return;
      }

      let result = "cancel";
      const settle = (value) => {
        result = value;
        close();
      };

      const { modal, head, body, foot, close } = makeModal({
        backdropClass: "editor-unsaved-backdrop",
        modalClass: "nav-delete-modal",
        titleText,
        onClose: () => {
          navigationPrompt = null;
          resolve(result);
        },
        onKeydown: (e) => {
          if (e.key === "Escape") settle("cancel");
          if (e.key === "Enter") settle("save");
        },
      });

      modal.setAttribute("role", "dialog");
      modal.setAttribute("aria-modal", "true");
      modal.setAttribute("aria-labelledby", "editor-unsaved-title");
      head.id = "editor-unsaved-title";

      const text = document.createElement("p");
      text.className = "nav-delete-message";
      text.textContent = messageText;
      body.appendChild(text);

      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "editor-btn";
      cancel.textContent = "Cancel";
      cancel.addEventListener("click", () => settle("cancel"));

      const discard = document.createElement("button");
      discard.type = "button";
      discard.className = "editor-btn danger";
      discard.textContent = "Discard";
      discard.addEventListener("click", () => settle("discard"));

      const saveButton = document.createElement("button");
      saveButton.type = "button";
      saveButton.className = "editor-btn primary";
      saveButton.textContent = "Save";
      saveButton.addEventListener("click", () => settle("save"));

      foot.appendChild(cancel);
      foot.appendChild(discard);
      foot.appendChild(saveButton);
      saveButton.focus();
    });

    return navigationPrompt;
  }

  async function confirmNavigation(opts) {
    if (!state.dirty) return true;
    const action = await openNavigationPrompt(opts);
    if (action === "save") return save({ silent: true });
    return action === "discard";
  }

  // --- toolbar / toast ----------------------------------------------------

  function mountControls(onToggle) {
    const host = document.getElementById("topbar-primary") ||
      document.getElementById("topbar-tools") ||
      document.getElementById("options") || document.getElementById("sidebar");
    const box = document.createElement("div");
    box.className = "editor-controls";

    toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "editor-toggle";
    toggleBtn.textContent = "✎ Edit";
    toggleBtn.addEventListener("click", () => onToggle(!state.enabled));

    saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "editor-save";
    saveBtn.textContent = "Save";
    saveBtn.addEventListener("click", () => save());

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
    state.enabled = !!on;
    document.body.classList.toggle("editor-on", state.enabled);
    updateUi();
  }

  function markDirty(on) {
    state.dirty = !!on;
    updateUi();
  }

  function updateUi() {
    if (!toggleBtn) return;
    toggleBtn.classList.toggle("is-on", state.enabled);
    toggleBtn.setAttribute("aria-pressed", String(state.enabled));
    saveBtn.disabled = !state.dirty;
    dirtyDot.classList.toggle("is-visible", state.dirty);
  }

  function toast(msg, isError) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.toggle("is-error", !!isError);
    toastEl.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("is-visible"), 2600);
  }

  function init(onToggle) {
    mountControls(onToggle);
    window.addEventListener("beforeunload", (e) => {
      if (!state.dirty) return;
      e.preventDefault();
      e.returnValue = "";
    });
    document.addEventListener("keydown", onUndoKeydown);
  }

  return {
    init,
    setDocument, clear, current, model, kind,
    apply, snapshot, undo,
    save, confirmNavigation,
    setEnabled, markDirty, toast,
    isEnabled: () => state.enabled,
    isDirty: () => state.dirty,
    getState: () => state,
    _undoDepth: () => undoStack.length,
  };
})();

if (typeof window !== "undefined") window.EditorDocSession = EditorDocSession;
if (typeof module !== "undefined" && module.exports) module.exports = EditorDocSession;
