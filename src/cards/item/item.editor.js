/* Item editor fields.
   Registers two custom form-field renderers used by the Item / SourceItem
   schemas (src/editor/cardSchemas.js):
     - "itemType": a grouped DnD 5e type picker (ItemTypes) + Custom escape hatch,
     - "damage":   the shared count/dice/bonus/type editor (DamageEditor).
   The schema layer stores both as plain "Type:" / "Damage:" lines; the rich UI
   lives here, mirroring src/cards/skillChecks/skillChecks.editor.js. */

const ItemEditor = (() => {
  function resolveEditorForm() {
    if (typeof EditorForm !== "undefined") return EditorForm;
    if (typeof require !== "undefined") {
      try { return require("../../editor/form.js"); } catch (err) { return null; }
    }
    return null;
  }

  // Grouped <select> over the DnD 5e item taxonomy, with a Custom option that
  // reveals a free-text input for non-standard types.
  function renderItemTypeField(value, field, context) {
    const { el } = context;
    const wrap = el("div", "ee-itemtype");
    const sel = el("select", "ee-itemtype-select");
    const empty = el("option", null, "—");
    empty.value = "";
    sel.appendChild(empty);

    const groups = (typeof ItemTypes !== "undefined") ? ItemTypes.options() : [];
    groups.forEach((g) => {
      const og = el("optgroup");
      og.label = g.label;
      g.options.forEach((t) => {
        const opt = el("option", null, t);
        opt.value = t;
        og.appendChild(opt);
      });
      sel.appendChild(og);
    });
    const customOpt = el("option", null, "Custom");
    customOpt.value = "__custom__";
    sel.appendChild(customOpt);

    const custom = el("input", "ee-itemtype-custom");
    custom.type = "text";
    custom.placeholder = "Custom type";

    const known = (typeof ItemTypes !== "undefined") ? ItemTypes.find(value) : null;
    if (value && !known) {
      sel.value = "__custom__";
      custom.value = String(value).trim();
    } else {
      sel.value = known ? known.label : "";
    }
    function syncCustom() {
      custom.classList.toggle("is-visible", sel.value === "__custom__");
    }
    sel.addEventListener("change", syncCustom);
    syncCustom();

    wrap.append(sel, custom);
    return {
      wrap,
      getValue: () => (sel.value === "__custom__" ? custom.value.trim() : sel.value),
    };
  }

  // One item's damage, edited with the shared DamageEditor. getValue returns the
  // serialized damage string the schema writes to a "Damage:" line.
  function renderDamageField(value, field, context) {
    if (typeof DamageEditor === "undefined") {
      const { el } = context;
      const input = el("input");
      input.type = "text";
      input.value = value || "";
      return { wrap: input, getValue: () => input.value.trim() };
    }
    return DamageEditor.build(value, context);
  }

  function register(editorForm) {
    if (!editorForm || !editorForm.registerFieldRenderer) return;
    editorForm.registerFieldRenderer("itemType", renderItemTypeField);
    editorForm.registerFieldRenderer("damage", renderDamageField);
  }

  const api = { renderItemTypeField, renderDamageField, register };
  register(resolveEditorForm());
  return api;
})();

if (typeof window !== "undefined") window.ItemEditor = ItemEditor;
if (typeof module !== "undefined" && module.exports) module.exports = ItemEditor;
