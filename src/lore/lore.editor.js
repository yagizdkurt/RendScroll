/* Lore attachment field for the card editor.

   Registers the "loreRefs" form-field renderer used by the card schemas that opted
   into LoreRef: chips (src/editor/cardSchemas.js fLoreRefs) — repeatable rows, each
   a dropdown of every lore Page / Entry in the campaign. The schema stores plain
   "Page/Entry" strings and writes one "LoreRef:" line each; the picker lives here,
   mirroring src/cards/item/item.editor.js.

   The option list is read WHEN THE FORM OPENS (RefLibrary already holds every lore
   file's source in memory, so this is synchronous), which is why a lore page created
   moments ago shows up without a reload. */

const LoreRefEditor = (() => {
  function resolveEditorForm() {
    if (typeof EditorForm !== "undefined") return EditorForm;
    if (typeof require !== "undefined") {
      try { return require("../editor/form.js"); } catch (err) { return null; }
    }
    return null;
  }

  /* Every addressable lore target, as [{ value: "Page/Entry", label: "Page / Entry" }].
     Each page is offered whole (link to the page) and once per entry. */
  function loreOptions() {
    if (typeof RefLibrary === "undefined" || typeof LoreModel === "undefined") return [];
    const out = [];
    RefLibrary.entries("lore").forEach((file) => {
      out.push({ value: file.name, label: file.name });
      const parsed = LoreModel.parse(file.source);
      ((parsed.page && parsed.page.entries) || []).forEach((entry) => {
        if (!entry.name) return;
        out.push({ value: file.name + "/" + entry.name, label: file.name + " / " + entry.name });
      });
    });
    return out;
  }

  // A stored reference whose page/entry is gone must still be offered, or opening
  // the form would silently drop it on the next Save.
  function optionsWith(value, options) {
    const has = options.some((o) => o.value === value);
    if (!value || has) return options;
    return [{ value, label: value + "  (missing)" }].concat(options);
  }

  function renderLoreRefsField(value, field, context) {
    const { el, button } = context;
    const options = loreOptions();
    const list = el("div", "editor-list lore-ref-list");

    function addRow(ref) {
      const row = el("div", "editor-list-item");
      const select = el("select", "lore-ref-select");
      const empty = el("option", null, "—");
      empty.value = "";
      select.appendChild(empty);
      optionsWith(ref, options).forEach((o) => {
        const opt = el("option", null, o.label);
        opt.value = o.value;
        select.appendChild(opt);
      });
      select.value = ref || "";

      const remove = button("editor-mini", "−", "Remove");
      remove.addEventListener("click", () => row.remove());
      row.append(select, remove);
      list.appendChild(row);
    }

    const refs = Array.isArray(value) ? value.slice() : [];
    refs.forEach(addRow);

    const add = button("editor-mini", "+ add", options.length ? "" : "No lore pages in this campaign yet");
    add.addEventListener("click", () => addRow(""));

    const wrap = el("div", "lore-ref-field");
    wrap.append(list, add);
    return {
      wrap,
      getValue: () => [...list.querySelectorAll(".lore-ref-select")]
        .map((s) => s.value.trim())
        .filter(Boolean),
    };
  }

  function register(editorForm) {
    if (!editorForm || !editorForm.registerFieldRenderer) return;
    editorForm.registerFieldRenderer("loreRefs", renderLoreRefsField);
  }

  const api = { loreOptions, renderLoreRefsField, register };
  register(resolveEditorForm());
  return api;
})();

if (typeof window !== "undefined") window.LoreRefEditor = LoreRefEditor;
if (typeof module !== "undefined" && module.exports) module.exports = LoreRefEditor;
