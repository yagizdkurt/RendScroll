/* Skill Checks editor fields.
   Owns the interactive form UI for standalone checks and embedded Checks:
   blocks while the parser/schema layer owns markdown parse/serialize. */

const SkillChecksEditor = (() => {
  function resolveEditorForm() {
    if (typeof EditorForm !== "undefined") return EditorForm;
    if (typeof require !== "undefined") {
      try { return require("../../editor/form.js"); } catch (err) { return null; }
    }
    return null;
  }

  function editorSchemaOptions() {
    if (typeof EditorSchemas !== "undefined" && EditorSchemas.checkSkillOptions) {
      return EditorSchemas.checkSkillOptions();
    }
    return [];
  }

  function knownSkill(value, options) {
    return (options || []).some((o) => o.value === value);
  }

  function createSkillPicker(value, options, context) {
    const { el } = context;
    const wrap = el("div", "editor-check-skill-picker");
    const sel = el("select");
    const customValue = value && !knownSkill(value, options);

    (options || []).forEach((o) => {
      const opt = el("option", null, o.label);
      opt.value = o.value;
      sel.appendChild(opt);
    });
    const customOpt = el("option", null, "Custom...");
    customOpt.value = "__custom__";
    sel.appendChild(customOpt);

    const custom = el("input");
    custom.type = "text";
    custom.placeholder = "Custom skill";
    custom.value = customValue ? value : "";

    function sync() {
      custom.classList.toggle("is-visible", sel.value === "__custom__");
    }

    sel.value = customValue ? "__custom__" : value || ((options && options[0] && options[0].value) || "__custom__");
    sel.addEventListener("change", sync);
    sync();

    wrap.appendChild(sel);
    wrap.appendChild(custom);

    return {
      wrap,
      getValue() {
        return sel.value === "__custom__" ? custom.value.trim() : sel.value;
      },
    };
  }

  function normalizeOutcome(value) {
    if (!value) return { kind: "dc", dc: "10", text: "" };
    return {
      kind: value.kind || "dc",
      dc: value.dc != null ? String(value.dc) : "10",
      text: value.text || "",
    };
  }

  function addOutcomeRow(host, value, context) {
    const { el, button, moveNode } = context;
    const data = normalizeOutcome(value);
    const row = el("div", "editor-check-outcome");
    const type = el("select");
    [
      { value: "dc", label: "DC" },
      { value: "failure", label: "F" },
      { value: "plain", label: "Plain" },
    ].forEach((o) => {
      const opt = el("option", null, o.label);
      opt.value = o.value;
      type.appendChild(opt);
    });
    type.value = data.kind;

    const dc = el("input");
    dc.type = "text";
    dc.inputMode = "numeric";
    dc.placeholder = "10";
    dc.value = data.dc;

    const text = el("textarea");
    text.placeholder = "Outcome";
    text.value = data.text;

    const up = button("editor-mini", "↑", "Move outcome up");
    up.addEventListener("click", () => moveNode(row, -1));
    const down = button("editor-mini", "↓", "Move outcome down");
    down.addEventListener("click", () => moveNode(row, 1));
    const rm = button("editor-mini", "−", "Remove outcome");
    rm.addEventListener("click", () => row.remove());

    function sync() {
      dc.classList.toggle("is-hidden", type.value !== "dc");
      row.classList.toggle("is-wide-outcome", type.value !== "dc");
    }
    type.addEventListener("change", sync);
    sync();

    row.appendChild(type);
    row.appendChild(dc);
    row.appendChild(text);
    row.appendChild(up);
    row.appendChild(down);
    row.appendChild(rm);
    host.appendChild(row);
  }

  function addCheckRow(host, value, options, context) {
    const { el, button, moveNode } = context;
    const entry = value || { kind: "check", skill: "", outcomes: [] };
    const row = el("div", "editor-check-row");
    const head = el("div", "editor-check-head");
    const picker = createSkillPicker(entry.skill || "", options, context);
    const up = button("editor-mini", "↑", "Move check up");
    up.addEventListener("click", () => moveNode(row, -1));
    const down = button("editor-mini", "↓", "Move check down");
    down.addEventListener("click", () => moveNode(row, 1));
    const rm = button("editor-mini", "−", "Remove check");
    rm.addEventListener("click", () => row.remove());
    head.appendChild(picker.wrap);
    head.appendChild(up);
    head.appendChild(down);
    head.appendChild(rm);

    const outcomes = el("div", "editor-check-outcomes");
    const rows = Array.isArray(entry.outcomes) && entry.outcomes.length ? entry.outcomes : [{ kind: "dc", dc: "10", text: "" }];
    rows.forEach((outcome) => addOutcomeRow(outcomes, outcome, context));

    const add = button("editor-mini", "+ outcome");
    add.addEventListener("click", () => addOutcomeRow(outcomes, { kind: "dc", dc: "10", text: "" }, context));

    row.appendChild(head);
    row.appendChild(outcomes);
    row.appendChild(add);
    host.appendChild(row);
  }

  function addCategoryRow(host, value, context) {
    const { el, button, moveNode } = context;
    const row = el("div", "editor-check-category");
    const input = el("input");
    input.type = "text";
    input.placeholder = "Category";
    input.value = value && value.label ? value.label : "";
    const up = button("editor-mini", "↑", "Move category up");
    up.addEventListener("click", () => moveNode(row, -1));
    const down = button("editor-mini", "↓", "Move category down");
    down.addEventListener("click", () => moveNode(row, 1));
    const rm = button("editor-mini", "−", "Remove category");
    rm.addEventListener("click", () => row.remove());
    row.appendChild(input);
    row.appendChild(up);
    row.appendChild(down);
    row.appendChild(rm);
    host.appendChild(row);
  }

  function addRawCheckRow(host, value, context) {
    const { el, button } = context;
    const row = el("div", "editor-check-raw");
    const ta = el("textarea");
    ta.value = value && value.text ? value.text : "";
    ta.placeholder = "Raw check markdown";
    const rm = button("editor-mini", "−", "Remove raw row");
    rm.addEventListener("click", () => row.remove());
    row.appendChild(ta);
    row.appendChild(rm);
    host.appendChild(row);
  }

  function fieldOptions(field) {
    return field.checkOptions || editorSchemaOptions();
  }

  function renderChecksField(value, field, context) {
    const { el, button } = context;
    const wrap = el("div", "editor-checks");
    const entries = Array.isArray(value) ? value : [];
    const options = fieldOptions(field);

    function addEntry(entry) {
      if (entry && entry.kind === "category") addCategoryRow(wrap, entry, context);
      else if (entry && entry.kind === "raw") addRawCheckRow(wrap, entry, context);
      else addCheckRow(wrap, entry, options, context);
    }

    entries.length ? entries.forEach(addEntry) : addEntry({ kind: "check", skill: "Investigation", outcomes: [] });

    const actions = el("div", "editor-check-actions");
    const addCheck = button("editor-mini", "+ check");
    addCheck.addEventListener("click", () => addCheckRow(wrap, { kind: "check", skill: "Investigation", outcomes: [] }, options, context));
    const addCategory = button("editor-mini", "+ category");
    addCategory.addEventListener("click", () => addCategoryRow(wrap, { kind: "category", label: "" }, context));
    actions.appendChild(addCheck);
    actions.appendChild(addCategory);

    return {
      wrap,
      actions,
      getValue() {
        return [...wrap.children].map((node) => {
          if (node.classList.contains("editor-check-category")) {
            return { kind: "category", label: node.querySelector("input").value.trim() };
          }
          if (node.classList.contains("editor-check-raw")) {
            return { kind: "raw", text: node.querySelector("textarea").value.trim() };
          }
          if (node.classList.contains("editor-check-row")) {
            const pickerWrap = node.querySelector(".editor-check-skill-picker");
            const select = pickerWrap.querySelector("select");
            const custom = pickerWrap.querySelector("input");
            const skill = select.value === "__custom__" ? custom.value.trim() : select.value;
            const outcomes = [...node.querySelectorAll(".editor-check-outcomes > .editor-check-outcome")].map((row) => {
              const type = row.querySelector("select").value;
              const dc = row.querySelector("input").value.trim();
              const text = row.querySelector("textarea").value.trim();
              return { kind: type, dc, text };
            }).filter((outcome) => outcome.text || (outcome.kind === "dc" && outcome.dc));
            return { kind: "check", skill, outcomes };
          }
          return null;
        }).filter((entry) => {
          if (!entry) return false;
          if (entry.kind === "check") return !!entry.skill;
          if (entry.kind === "category") return !!entry.label;
          return !!entry.text;
        });
      },
    };
  }

  function renderLinesWithChecksField(value, field, context) {
    const { el, button } = context;
    const wrap = el("div", "editor-lines-checks");
    const segments = Array.isArray(value) && value.length ? value : [{ kind: "text", text: "" }];
    const getSegmentValue = Symbol("getSegmentValue");

    function addText(text) {
      const segment = el("div", "editor-lines-segment");
      const ta = el("textarea");
      ta.value = text || "";
      if (field.hint) ta.placeholder = field.hint;
      const rm = button("editor-mini", "−", "Remove text block");
      rm.addEventListener("click", () => segment.remove());
      segment[getSegmentValue] = () => ({ kind: "text", text: ta.value.trim() });
      segment.appendChild(ta);
      segment.appendChild(rm);
      wrap.appendChild(segment);
    }

    function addChecks(segmentValue) {
      const segment = el("div", "editor-lines-segment editor-lines-check-block");
      const label = el("input");
      label.type = "text";
      label.value = (segmentValue && segmentValue.label) || "Checks";
      label.placeholder = "Checks";
      const checks = renderChecksField((segmentValue && segmentValue.checks) || [], field, context);
      const rm = button("editor-mini", "−", "Remove checks block");
      rm.addEventListener("click", () => segment.remove());
      segment[getSegmentValue] = () => ({
        kind: "checksBlock",
        label: label.value.trim() || "Checks",
        checks: checks.getValue(),
      });
      const head = el("div", "editor-lines-check-head");
      head.appendChild(label);
      head.appendChild(rm);
      segment.appendChild(head);
      segment.appendChild(checks.wrap);
      segment.appendChild(checks.actions);
      wrap.appendChild(segment);
    }

    segments.forEach((segment) => {
      if (segment.kind === "checksBlock") addChecks(segment);
      else addText(segment.text || "");
    });

    const actions = el("div", "editor-check-actions");
    const addTextBtn = button("editor-mini", "+ text");
    addTextBtn.addEventListener("click", () => addText(""));
    const addChecksBtn = button("editor-mini", "+ checks");
    addChecksBtn.addEventListener("click", () => addChecks({ label: "Checks", checks: [] }));
    actions.appendChild(addTextBtn);
    actions.appendChild(addChecksBtn);

    return {
      wrap,
      actions,
      getValue() {
        return [...wrap.children]
          .map((node) => node[getSegmentValue] && node[getSegmentValue]())
          .filter((segment) => segment && (segment.kind === "checksBlock" || segment.text));
      },
    };
  }

  function register(editorForm) {
    if (!editorForm || !editorForm.registerFieldRenderer) return;
    editorForm.registerFieldRenderer("checks", renderChecksField);
    editorForm.registerFieldRenderer("linesWithChecks", renderLinesWithChecksField);
  }

  const api = {
    renderChecksField,
    renderLinesWithChecksField,
    register,
  };

  register(resolveEditorForm());

  return api;
})();

if (typeof window !== "undefined") window.SkillChecksEditor = SkillChecksEditor;
if (typeof module !== "undefined" && module.exports) module.exports = SkillChecksEditor;
