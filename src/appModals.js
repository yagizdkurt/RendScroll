/* ============================================================
   Hand-built app dialogs: the "New Page" creator and the
   delete-confirm prompt. Both share one modal shell (makeModal)
   that reuses the editor-modal-* CSS. Generic enough that the
   editor's own form.js modals are intentionally out of scope.
   ============================================================ */

// Shared modal shell. Builds the backdrop/modal/head/body/foot DOM, appends it to
// the document, and wires teardown (Escape/keydown + backdrop dismissal); the caller
// fills body/foot and decides what closing means. Returns the structural hooks plus
// close(). Class names are passed in so existing per-modal CSS keeps matching.
function makeModal({
  backdropClass,
  modalClass,
  modalTag = "div",
  titleText,
  onKeydown,
  onClose,
  backdropEvent = "mousedown",
  allowBackdropClose,
}) {
  const backdrop = document.createElement("div");
  backdrop.className = "editor-modal-backdrop" + (backdropClass ? " " + backdropClass : "");

  const modal = document.createElement(modalTag);
  modal.className = "editor-modal" + (modalClass ? " " + modalClass : "");

  const head = document.createElement("div");
  head.className = "editor-modal-head";
  if (titleText != null) head.textContent = titleText;

  const body = document.createElement("div");
  body.className = "editor-modal-body";

  const foot = document.createElement("div");
  foot.className = "editor-modal-foot";

  modal.appendChild(head);
  modal.appendChild(body);
  modal.appendChild(foot);
  backdrop.appendChild(modal);

  function keyHandler(e) {
    if (onKeydown) onKeydown(e);
  }

  function close() {
    document.removeEventListener("keydown", keyHandler);
    backdrop.remove();
    if (onClose) onClose();
  }

  if (backdropEvent) {
    backdrop.addEventListener(backdropEvent, (e) => {
      if (e.target !== backdrop) return;
      if (allowBackdropClose && !allowBackdropClose()) return;
      close();
    });
  }

  document.body.appendChild(backdrop);
  document.addEventListener("keydown", keyHandler);

  return { backdrop, modal, head, body, foot, close };
}

// A reusable "Scene Manifest" field group (Duration / Summary + Goals / Key NPCs /
// Rewards). Shared by the New Page dialog (create) and the Edit Manifest dialog
// (edit an existing scene from the sidebar). Returns the wrapper plus read/fill/
// setBusy helpers so callers never restate the field list. `opts.headText` shows an
// optional section heading.
function createManifestFields(opts) {
  const wrap = document.createElement("div");
  wrap.className = "new-page-manifest";
  if (opts && opts.headText) {
    const head = document.createElement("div");
    head.className = "new-page-manifest-head";
    head.textContent = opts.headText;
    wrap.appendChild(head);
  }

  function field(id, labelText, placeholder, multiline) {
    const f = document.createElement("div");
    f.className = "editor-field";
    const l = document.createElement("label");
    l.htmlFor = id;
    l.textContent = labelText;
    const ctl = document.createElement(multiline ? "textarea" : "input");
    ctl.id = id;
    if (multiline) ctl.rows = 2;
    else { ctl.type = "text"; ctl.autocomplete = "off"; }
    if (placeholder) ctl.placeholder = placeholder;
    f.appendChild(l);
    f.appendChild(ctl);
    wrap.appendChild(f);
    return ctl;
  }

  const duration = field("manifest-duration", "Duration", "e.g. 20 min", false);
  const summary = field("manifest-summary", "Summary", "One-line overview", false);
  const goals = field("manifest-goals", "Goals", "One per line", true);
  const keyNpcs = field("manifest-npcs", "Key NPCs", "One per line", true);
  const rewards = field("manifest-rewards", "Rewards", "One per line", true);
  const inputs = [duration, summary, goals, keyNpcs, rewards];
  const toList = (t) => String(t || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

  return {
    wrap,
    read() {
      return {
        duration: duration.value.trim(),
        summary: summary.value.trim(),
        goals: toList(goals.value),
        keyNpcs: toList(keyNpcs.value),
        rewards: toList(rewards.value),
      };
    },
    fill(v) {
      v = v || {};
      duration.value = v.duration || "";
      summary.value = v.summary || "";
      goals.value = (v.goals || []).join("\n");
      keyNpcs.value = (v.keyNpcs || []).join("\n");
      rewards.value = (v.rewards || []).join("\n");
    },
    setBusy(busy) { inputs.forEach((el) => { el.disabled = busy; }); },
  };
}

function manifestValuesHaveContent(v) {
  return !!(v.duration || v.summary || v.goals.length || v.keyNpcs.length || v.rewards.length);
}

// Serialize manifest field values to a "### Manifest" markdown block, reusing the
// editor's schema serializer so the on-disk format is owned in exactly one place.
// Returns "" when every field is blank.
function serializeManifestValues(v) {
  if (!manifestValuesHaveContent(v) || typeof EditorSchemas === "undefined") return "";
  const schema = EditorSchemas.get("manifest");
  return schema ? EditorSchemas.serialize(schema, v) : "";
}

// Confirm deletion of a campaign scene / library entry. Resolves true on confirm,
// false on cancel/Escape/backdrop. Enter=confirm, Escape=cancel; Delete is focused.
function confirmDeleteCampaignEntry(entry) {
  return new Promise((resolve) => {
    let result = false;
    const settle = (value) => { result = value; close(); };

    const { modal, head, body, foot, close } = makeModal({
      backdropClass: "nav-delete-backdrop",
      modalClass: "nav-delete-modal",
      titleText: `Delete "${entry.label}"?`,
      onClose: () => resolve(result),
      onKeydown: (e) => {
        if (e.key === "Escape") settle(false);
        if (e.key === "Enter") settle(true);
      },
      // Default backdrop mousedown closes with result === false (cancel).
    });

    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "nav-delete-title");
    head.id = "nav-delete-title";

    const text = document.createElement("p");
    text.className = "nav-delete-message";
    text.textContent = "This cannot be undone.";
    body.appendChild(text);

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "editor-btn";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => settle(false));

    const del = document.createElement("button");
    del.type = "button";
    del.className = "editor-btn danger";
    del.textContent = "Delete";
    del.addEventListener("click", () => settle(true));

    foot.appendChild(cancel);
    foot.appendChild(del);
    del.focus();
  });
}

function openNewPageDialog() {
  if (document.querySelector(".new-page-backdrop")) return;

  const { modal, body, foot, close: closeModal } = makeModal({
    backdropClass: "new-page-backdrop",
    modalClass: "new-page-modal",
    modalTag: "form",
    titleText: "New Page",
    backdropEvent: "click",
    allowBackdropClose: () => !create.disabled,
    onKeydown: (e) => { if (e.key === "Escape" && !create.disabled) close(); },
    onClose: () => { newPageButton.disabled = false; },
  });
  modal.noValidate = true;

  const field = document.createElement("div");
  field.className = "editor-field";

  const label = document.createElement("label");
  label.htmlFor = "new-page-title";
  label.textContent = "Page title";

  const input = document.createElement("input");
  input.id = "new-page-title";
  input.type = "text";
  input.value = "New Page";
  input.maxLength = 120;
  input.autocomplete = "off";

  const error = document.createElement("div");
  error.className = "editor-field-error new-page-error";
  error.setAttribute("role", "alert");

  field.appendChild(label);
  field.appendChild(input);
  field.appendChild(error);
  body.appendChild(field);

  // Optional Scene Manifest fields. When any are filled they are serialized into a
  // "### Manifest" block written at the top of the new scene; left blank, none.
  const manifestFields = createManifestFields({ headText: "Scene Manifest (optional)" });
  body.appendChild(manifestFields.wrap);

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "editor-btn";
  cancel.textContent = "Cancel";

  const create = document.createElement("button");
  create.type = "submit";
  create.className = "editor-btn primary";
  create.textContent = "Create";

  foot.appendChild(cancel);
  foot.appendChild(create);

  function setBusy(busy) {
    input.disabled = busy;
    cancel.disabled = busy;
    create.disabled = busy;
    manifestFields.setBusy(busy);
    create.textContent = busy ? "Creating..." : "Create";
    newPageButton.disabled = busy;
  }

  function close() { closeModal(); }

  cancel.addEventListener("click", close);

  modal.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = input.value.trim();
    if (!title) {
      error.textContent = "Enter a page title.";
      input.focus();
      return;
    }

    error.textContent = "";
    setBusy(true);
    try {
      const entry = await createCampaignFile(title, serializeManifestValues(manifestFields.read()));
      const entries = await loadCampaignEntries();
      campaignEntries = entries;
      mountCampaignEntries(entries);
      await load(entry.path);
      close();
    } catch (err) {
      error.textContent = err.message || "Page creation failed.";
      setBusy(false);
      input.focus();
    }
  });

  requestAnimationFrame(() => {
    input.focus();
    input.select();
  });
}

// Edit (or add) a scene's Scene Manifest from the sidebar, without opening the full
// editor. Loads the scene off disk, prefills from its existing "### Manifest" card (if
// any), and on save replaces / inserts / removes that block via the editor's outline
// primitives (EOL-safe), writes through POST /__save, and reloads if it's on screen.
async function openEditManifestDialog(entry) {
  if (!entry || document.querySelector(".edit-manifest-backdrop")) return;
  if (typeof EditorSchemas === "undefined" || typeof EditorOutline === "undefined"
      || typeof EditorSave === "undefined" || typeof fetchMarkdown === "undefined") {
    alert("Editing the manifest needs the editor layer and the launcher's server.");
    return;
  }

  let text;
  try {
    text = await fetchMarkdown(entry.path);
  } catch (err) {
    alert((err && err.message) || "Could not load the scene.");
    return;
  }

  const schema = EditorSchemas.get("manifest");
  const model = EditorOutline.parse(text);
  let manifestCard = null;
  model.events.forEach((ev) => ev.cards.forEach((c) => {
    if (!manifestCard && c.type === "manifest") manifestCard = c;
  }));

  const { modal, body, foot, close: closeModal } = makeModal({
    backdropClass: "edit-manifest-backdrop",
    modalClass: "new-page-modal",
    modalTag: "form",
    titleText: manifestCard ? "Edit Scene Manifest" : "Add Scene Manifest",
    backdropEvent: "click",
    allowBackdropClose: () => !saveBtn.disabled,
    onKeydown: (e) => { if (e.key === "Escape" && !saveBtn.disabled) closeModal(); },
  });
  modal.noValidate = true;

  const manifestFields = createManifestFields();
  body.appendChild(manifestFields.wrap);
  if (manifestCard) {
    manifestFields.fill(EditorSchemas.parse(schema, EditorOutline.cardSource(model, manifestCard)));
  }

  const error = document.createElement("div");
  error.className = "editor-field-error";
  error.setAttribute("role", "alert");
  body.appendChild(error);

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "editor-btn";
  cancel.textContent = "Cancel";

  const saveBtn = document.createElement("button");
  saveBtn.type = "submit";
  saveBtn.className = "editor-btn primary";
  saveBtn.textContent = "Save";

  foot.appendChild(cancel);
  foot.appendChild(saveBtn);

  function setBusy(busy) {
    cancel.disabled = busy;
    saveBtn.disabled = busy;
    manifestFields.setBusy(busy);
    saveBtn.textContent = busy ? "Saving..." : "Save";
  }

  cancel.addEventListener("click", () => closeModal());

  modal.addEventListener("submit", async (e) => {
    e.preventDefault();
    error.textContent = "";

    const block = serializeManifestValues(manifestFields.read());
    let newModel;
    if (manifestCard) {
      // Replace the existing manifest, or drop it entirely when cleared out.
      newModel = block
        ? EditorOutline.replaceCard(model, manifestCard, block)
        : EditorOutline.deleteCard(model, manifestCard);
    } else {
      if (!block) { closeModal(); return; } // nothing to add
      // Insert just under the "# Title" header so it renders pinned at the top.
      const header = model.events[0];
      const insertLine = header && header.headingStart >= 0 ? header.headingStart + 1 : 0;
      newModel = EditorOutline.insertAtLine(model, insertLine, block);
    }

    setBusy(true);
    try {
      await EditorSave.save(entry.path, EditorOutline.serialize(newModel));
      closeModal();
      if (entry.path === currentPath) await load(entry.path);
    } catch (err) {
      error.textContent = (err && err.message) || "Save failed.";
      setBusy(false);
    }
  });

  requestAnimationFrame(() => {
    const first = body.querySelector("input, textarea");
    if (first) first.focus();
  });
}

function mountNewPageButton() {
  if (!newPageButton) return;
  newPageButton.addEventListener("click", openNewPageDialog);
}
