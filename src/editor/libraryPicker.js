/* Item Library picker.
   A modal for choosing an existing library item to insert as an [item=Name]
   reference, or starting a brand-new item. Reuses the editor modal styling
   (.editor-modal*) and reads the item list from RefLibrary. Knows nothing about
   the outline model — it just reports the chosen name / "create new" to its
   caller (editor.js wires those to insertion). */

const EditorLibraryPicker = (() => {
  let backdrop = null;

  function close() {
    if (!backdrop) return;
    backdrop.remove();
    backdrop = null;
    document.removeEventListener("keydown", onKey, true);
  }

  function onKey(e) {
    if (e.key === "Escape") { e.stopPropagation(); close(); }
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function entries() {
    if (typeof RefLibrary === "undefined") return [];
    return RefLibrary.entries("item")
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }

  function open(opts) {
    const onPick = opts && opts.onPick;
    const onCreateNew = opts && opts.onCreateNew;
    close();

    backdrop = el("div", "editor-modal-backdrop");
    const modal = el("div", "editor-modal editor-picker-modal");

    const head = el("div", "editor-modal-head");
    head.appendChild(el("span", null, "Insert Item"));
    const x = el("button", "editor-mini", "✕");
    x.type = "button";
    x.addEventListener("click", close);
    head.appendChild(x);

    const body = el("div", "editor-modal-body");

    const search = el("input", "editor-picker-search");
    search.type = "text";
    search.placeholder = "Search items…";
    search.autocomplete = "off";
    body.appendChild(search);

    const list = el("div", "editor-picker-list");
    body.appendChild(list);

    const all = entries();

    function pick(name) {
      close();
      if (typeof onPick === "function") onPick(name);
    }

    function renderList(filter) {
      list.innerHTML = "";
      const q = (typeof RefLibrary !== "undefined" ? RefLibrary.norm(filter) : String(filter || "").toLowerCase());
      const shown = all.filter((e) =>
        !q || (typeof RefLibrary !== "undefined" ? RefLibrary.norm(e.name) : e.name.toLowerCase()).includes(q)
      );
      if (!shown.length) {
        list.appendChild(el("div", "editor-picker-empty", all.length ? "No matches." : "Library is empty — create one."));
        return;
      }
      shown.forEach((e) => {
        const row = el("button", "editor-picker-item", e.name);
        row.type = "button";
        row.addEventListener("click", () => pick(e.name));
        list.appendChild(row);
      });
    }

    renderList("");
    search.addEventListener("input", () => renderList(search.value));
    search.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      const first = list.querySelector(".editor-picker-item");
      if (first) first.click();
    });

    const foot = el("div", "editor-modal-foot");
    const newBtn = el("button", "editor-btn", "+ New item");
    newBtn.type = "button";
    newBtn.addEventListener("click", () => {
      close();
      if (typeof onCreateNew === "function") onCreateNew();
    });
    const cancel = el("button", "editor-btn", "Cancel");
    cancel.type = "button";
    cancel.addEventListener("click", close);
    foot.appendChild(newBtn);
    foot.appendChild(cancel);

    modal.appendChild(head);
    modal.appendChild(body);
    modal.appendChild(foot);
    backdrop.appendChild(modal);
    backdrop.addEventListener("mousedown", (e) => { if (e.target === backdrop) close(); });
    document.body.appendChild(backdrop);
    document.addEventListener("keydown", onKey, true);
    search.focus();
  }

  return { open };
})();

if (typeof module !== "undefined" && module.exports) module.exports = EditorLibraryPicker;
