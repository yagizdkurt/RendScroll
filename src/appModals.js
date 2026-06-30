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
      const entry = await createCampaignFile(title);
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

function mountNewPageButton() {
  if (!newPageButton) return;
  newPageButton.addEventListener("click", openNewPageDialog);
}
