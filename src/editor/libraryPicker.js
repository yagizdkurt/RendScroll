/* Item Library picker.
   A modal for choosing an existing library item to insert as a scene Item with
   SourceItem: Name, or starting a brand-new item. Reuses the editor modal styling
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

  function entries(type) {
    if (typeof RefLibrary === "undefined") return [];
    return RefLibrary.entries(type)
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }

  function open(opts) {
    const onPick = opts && opts.onPick;
    const onCreateNew = opts && opts.onCreateNew;
    const type = (opts && opts.type) || "item";
    const noun = type === "enemy" ? "Enemy" : "Item";
    const lc = noun.toLowerCase();
    close();

    backdrop = el("div", "editor-modal-backdrop");
    const modal = el("div", "editor-modal editor-picker-modal");

    const head = el("div", "editor-modal-head");
    head.appendChild(el("span", null, "Insert " + noun));
    const x = el("button", "editor-mini", "✕");
    x.type = "button";
    x.addEventListener("click", close);
    head.appendChild(x);

    const body = el("div", "editor-modal-body");

    const search = el("input", "editor-picker-search");
    search.type = "text";
    search.placeholder = "Search " + lc + "s…";
    search.autocomplete = "off";
    body.appendChild(search);

    const list = el("div", "editor-picker-list");
    body.appendChild(list);

    const all = entries(type);

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
    // The "New" affordance only appears when the caller can handle creation —
    // e.g. the combat "+ from library" picker authors enemies elsewhere.
    if (typeof onCreateNew === "function") {
      const newBtn = el("button", "editor-btn", "+ New " + lc);
      newBtn.type = "button";
      newBtn.addEventListener("click", () => {
        close();
        onCreateNew();
      });
      foot.appendChild(newBtn);
    }
    const cancel = el("button", "editor-btn", "Cancel");
    cancel.type = "button";
    cancel.addEventListener("click", close);
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
