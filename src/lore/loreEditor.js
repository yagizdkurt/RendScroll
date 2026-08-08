/* Lore editing — the editor half of the Lore subsystem.

   A lore page is a DOCUMENT, not a card: opening one registers it with
   EditorDocSession, so it gets the same 50-step Ctrl+Z, the same dirty dot and
   Save button, and the same "you have unsaved edits" guard as a scene. Every
   mutation goes through the session; nothing is written until Save.

   Editing itself reuses the app's modal shell (makeModal, app/appModals.js)
   rather than inline fields — the same shape as card editing.

   Renaming is not a separate flow: Save notices the page name drifted from the
   file name and sends `renameFrom`, which the server applies as one operation
   (and rejects with 409 if the target exists, leaving the model untouched). */

const LoreEditor = (() => {
  const S = typeof EditorDocSession !== "undefined" ? EditorDocSession : null;

  // The open page's view chrome: { name, host }. `host` is the .library-view div
  // a re-render rebuilds into.
  let ctx = null;

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function toast(msg, isError) {
    if (S) S.toast(msg, isError);
  }

  function doc() {
    const d = S && S.current();
    return d && d.kind === "lore" ? d : null;
  }

  function isCurrent(name) {
    const d = doc();
    return !!(d && LoreModel.nameKey(d.loreName) === LoreModel.nameKey(name));
  }

  // --- modal form ---------------------------------------------------------

  /* A small labelled form in the shared modal shell. `fields` is
     [{ key, label, kind: "text"|"area", value, placeholder }]; `onSubmit(values)`
     returns an error string to keep the modal open, or nothing to close it. */
  function openForm({ titleText, fields, submitText, onSubmit }) {
    if (typeof makeModal !== "function") return;
    const controls = {};

    const { modal, body, foot, close } = makeModal({
      backdropClass: "lore-form-backdrop",
      modalClass: "new-page-modal",
      modalTag: "form",
      titleText,
      backdropEvent: "click",
      onKeydown: (e) => { if (e.key === "Escape") close(); },
    });
    modal.noValidate = true;

    fields.forEach((field) => {
      const wrap = el("div", "editor-field");
      const id = "lore-field-" + field.key;
      const label = el("label", null, field.label);
      label.htmlFor = id;
      const control = document.createElement(field.kind === "area" ? "textarea" : "input");
      control.id = id;
      if (field.kind === "area") control.rows = 8;
      else { control.type = "text"; control.autocomplete = "off"; }
      if (field.placeholder) control.placeholder = field.placeholder;
      control.value = field.value == null ? "" : String(field.value);
      wrap.appendChild(label);
      wrap.appendChild(control);
      body.appendChild(wrap);
      controls[field.key] = control;
    });

    const error = el("div", "editor-field-error");
    error.setAttribute("role", "alert");
    body.appendChild(error);

    const cancel = el("button", "editor-btn", "Cancel");
    cancel.type = "button";
    cancel.addEventListener("click", close);
    const submit = el("button", "editor-btn primary", submitText || "OK");
    submit.type = "submit";
    foot.appendChild(cancel);
    foot.appendChild(submit);

    modal.addEventListener("submit", (e) => {
      e.preventDefault();
      const values = {};
      Object.keys(controls).forEach((key) => { values[key] = controls[key].value; });
      const message = onSubmit(values);
      if (message) { error.textContent = message; return; }
      close();
    });

    requestAnimationFrame(() => {
      const first = body.querySelector("input, textarea");
      if (first) { first.focus(); first.select && first.select(); }
    });
  }

  // --- mutations ----------------------------------------------------------

  function mutate(fn) {
    const d = doc();
    if (!d) return;
    S.apply(fn(d.model));
  }

  function editPageMeta() {
    const d = doc();
    if (!d) return;
    openForm({
      titleText: "Edit Lore Page",
      submitText: "Apply",
      fields: [
        { key: "name", label: "Page name", value: d.model.name },
        { key: "keywords", label: "Keywords", value: (d.model.keywords || []).join(", "),
          placeholder: "comma separated" },
      ],
      onSubmit: (values) => {
        const name = String(values.name || "").trim();
        if (!name) return "Enter a page name.";
        if (LoreModel.ILLEGAL_NAME.test(name)) return "A page name may not contain / or \\.";
        mutate((page) => LoreModel.setPageMeta(page, values));
      },
    });
  }

  function editEntry(index) {
    const d = doc();
    if (!d) return;
    const isNew = index < 0;
    const entry = isNew ? { name: "", keywords: [], body: "" } : d.model.entries[index];
    if (!entry) return;

    openForm({
      titleText: isNew ? "Add Entry" : "Edit Entry",
      submitText: isNew ? "Add" : "Apply",
      fields: [
        { key: "name", label: "Entry name", value: entry.name },
        { key: "keywords", label: "Keywords", value: (entry.keywords || []).join(", "),
          placeholder: "comma separated" },
        { key: "body", label: "Content (Markdown)", kind: "area", value: entry.body },
      ],
      onSubmit: (values) => {
        const name = String(values.name || "").trim();
        if (!name) return "Enter an entry name.";
        if (LoreModel.ILLEGAL_NAME.test(name)) return "An entry name may not contain / or \\.";
        if (LoreModel.entryNameTaken(d.model, name, isNew ? -1 : index)) {
          return "This page already has an entry called \"" + name + "\".";
        }
        mutate((page) => (isNew
          ? LoreModel.addEntry(page, values)
          : LoreModel.updateEntry(page, index, values)));
      },
    });
  }

  // Deleting is undoable (Ctrl+Z), so it does not ask for confirmation — the
  // same bargain scene cards make.
  function removeEntry(index) {
    mutate((page) => LoreModel.removeEntry(page, index));
  }

  function moveEntry(index, dir) {
    mutate((page) => LoreModel.moveEntry(page, index, dir));
  }

  // --- save ---------------------------------------------------------------

  async function saveDocument(model) {
    const d = doc();
    if (!d) return;
    const name = String(model.name || "").trim();
    if (!name) throw new Error("The lore page needs a name.");

    const entry = await RefLibrary.saveFile("lore", name, LoreModel.serialize(model), d.diskName);
    const renamed = LoreModel.nameKey(entry.name) !== LoreModel.nameKey(d.diskName);
    d.diskName = entry.name;
    d.loreName = entry.name;
    d.path = entry.path;
    if (ctx) ctx.name = entry.name;

    if (renamed) {
      // Follow the file: the reader stays on this page under its new name.
      ReaderState.setLibraryView("lore", entry.name);
      refreshLibrarySidebars();
      const nav = ReaderDom.loreNav();
      if (nav) {
        nav.querySelectorAll("button").forEach((b) =>
          b.classList.toggle("active", b.dataset.loreName === entry.name));
      }
      const titleEl = ctx && ctx.host && ctx.host.querySelector(".library-view-title");
      if (titleEl) titleEl.textContent = entry.name;
    }
    document.dispatchEvent(new CustomEvent("library:changed", {
      detail: { type: "lore", name: entry.name, edited: true },
    }));
  }

  // --- render + decorate --------------------------------------------------

  // Rebuild the page body from the session model (after a mutation or an undo).
  function rerender() {
    const d = doc();
    if (!d || !ctx || !ctx.host) return;
    const old = ctx.host.querySelector(".lore-page");
    if (old) old.remove();
    const root = LoreView.render(ctx.host, d.model, []);
    const titleEl = ctx.host.querySelector(".library-view-title");
    if (titleEl) titleEl.textContent = d.model.name || ctx.name;
    decorate(root);
  }

  function toolButton(label, title, onClick, disabled) {
    const b = el("button", "lore-tool", label);
    b.type = "button";
    b.title = title;
    b.disabled = !!disabled;
    if (!disabled) b.addEventListener("click", onClick);
    return b;
  }

  /* Add the editing controls to a rendered page. They are always present in the
     DOM and shown by CSS only while `body.editor-on` — the same trick the card
     tools use, so reader mode is untouched. */
  function decorate(root) {
    if (!root || !doc()) return;

    const pageChips = root.querySelector(".lore-page-chips");
    const pageTools = el("span", "lore-page-tools");
    pageTools.appendChild(toolButton("✎", "Edit page name and keywords", editPageMeta));
    if (pageChips) pageChips.appendChild(pageTools);
    else root.insertBefore(pageTools, root.firstChild);

    const entries = [...root.querySelectorAll(".lore-entry")];
    entries.forEach((section, index) => {
      const head = section.querySelector(".lore-entry-head");
      if (!head) return;
      const tools = el("span", "lore-entry-tools");
      tools.appendChild(toolButton("✎", "Edit this entry", () => editEntry(index)));
      tools.appendChild(toolButton("↑", "Move up", () => moveEntry(index, -1), index === 0));
      tools.appendChild(toolButton("↓", "Move down", () => moveEntry(index, 1),
        index === entries.length - 1));
      tools.appendChild(toolButton("🗑", "Delete this entry (Ctrl+Z undoes it)",
        () => removeEntry(index)));
      head.appendChild(tools);
    });

    const add = el("button", "editor-btn lore-add-entry", "+ Entry");
    add.type = "button";
    add.addEventListener("click", () => editEntry(-1));
    root.appendChild(add);
  }

  /* Called by renderLoreView after every render of a lore page. A page that just
     opened becomes the session's document; a re-render caused by one of our own
     mutations keeps the session (and therefore the undo stack) as it is. A page
     that failed to parse gets no session at all — it must be fixed on disk. */
  function attach(info) {
    if (!S) return;
    ctx = { name: info.name, host: info.viewEl };

    if (isCurrent(info.name)) { decorate(info.root); return; }

    if (!info.ok) {
      S.clear();
      ctx = null;
      return;
    }

    S.setDocument({
      kind: "lore",
      loreName: info.name,
      diskName: info.name,
      path: info.path,
      model: info.page,
      serialize: (m) => LoreModel.serialize(m),
      parse: (raw) => LoreModel.parse(raw).page,
      onChange: () => rerender(),
      save: (m) => saveDocument(m),
    });
    decorate(info.root);
  }

  // Add menu -> a new, empty lore page in the active campaign.
  function createPage(onCreated) {
    openForm({
      titleText: "New Lore Page",
      submitText: "Create",
      fields: [
        { key: "name", label: "Page name", placeholder: "e.g. The Sunken Choir" },
        { key: "keywords", label: "Keywords", placeholder: "comma separated (optional)" },
      ],
      onSubmit: (values) => {
        const name = String(values.name || "").trim();
        if (!name) return "Enter a page name.";
        if (LoreModel.ILLEGAL_NAME.test(name)) return "A page name may not contain / or \\.";
        RefLibrary.createFile("lore", name, LoreModel.newPageContent(name, values.keywords))
          .then((entry) => {
            document.dispatchEvent(new CustomEvent("library:changed", {
              detail: { type: "lore", name: entry.name, created: true },
            }));
            toast("Created lore page: " + entry.name);
            if (typeof onCreated === "function") onCreated(entry.name);
          })
          .catch((err) => toast((err && err.message) || "Lore page create failed", true));
      },
    });
  }

  return { attach, createPage, _rerender: rerender };
})();

if (typeof window !== "undefined") window.LoreEditor = LoreEditor;
if (typeof module !== "undefined" && module.exports) module.exports = LoreEditor;
