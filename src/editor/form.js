/* Schema-driven modal form. Renders EditorSchemas fields into inputs, validates,
   and returns the serialized markdown block to a callback. Used for both creating
   a new card and editing an existing one (prefilled via EditorSchemas.parse). */

const EditorForm = (() => {
  let backdrop = null;

  function close() {
    if (backdrop) {
      backdrop.remove();
      backdrop = null;
      document.removeEventListener("keydown", onKey);
    }
  }

  function onKey(e) {
    if (e.key === "Escape") close();
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function button(cls, text, title) {
    const b = el("button", cls, text);
    b.type = "button";
    if (title) b.title = title;
    return b;
  }

  function moveNode(node, dir) {
    const parent = node.parentNode;
    if (!parent) return;
    if (dir < 0 && node.previousElementSibling) parent.insertBefore(node, node.previousElementSibling);
    if (dir > 0 && node.nextElementSibling) parent.insertBefore(node.nextElementSibling, node);
  }

  function knownSkill(value, options) {
    return (options || []).some((o) => o.value === value);
  }

  function createSkillPicker(value, options) {
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

  function addOutcomeRow(host, value) {
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

  function addCheckRow(host, value, options) {
    const entry = value || { kind: "check", skill: "", outcomes: [] };
    const row = el("div", "editor-check-row");
    const head = el("div", "editor-check-head");
    const picker = createSkillPicker(entry.skill || "", options);
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
    rows.forEach((outcome) => addOutcomeRow(outcomes, outcome));

    const add = button("editor-mini", "+ outcome");
    add.addEventListener("click", () => addOutcomeRow(outcomes, { kind: "dc", dc: "10", text: "" }));

    row.appendChild(head);
    row.appendChild(outcomes);
    row.appendChild(add);
    host.appendChild(row);

    return {
      row,
      getValue() {
        return {
          kind: "check",
          skill: picker.getValue(),
          outcomes: [...outcomes.querySelectorAll(":scope > .editor-check-outcome")].map((outcomeRow) => {
            const type = outcomeRow.querySelector("select").value;
            const inputs = outcomeRow.querySelectorAll("input, textarea");
            return {
              kind: type,
              dc: inputs[0].value.trim(),
              text: inputs[1].value.trim(),
            };
          }).filter((outcome) => outcome.text || (outcome.kind === "dc" && outcome.dc)),
        };
      },
    };
  }

  function addCategoryRow(host, value) {
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

  function addRawCheckRow(host, value) {
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

  function checksEditor(value, field) {
    const wrap = el("div", "editor-checks");
    const entries = Array.isArray(value) ? value : [];
    const options = field.checkOptions || (typeof EditorSchemas !== "undefined" ? EditorSchemas.checkSkillOptions() : []);

    function addEntry(entry) {
      if (entry && entry.kind === "category") addCategoryRow(wrap, entry);
      else if (entry && entry.kind === "raw") addRawCheckRow(wrap, entry);
      else addCheckRow(wrap, entry, options);
    }

    entries.length ? entries.forEach(addEntry) : addEntry({ kind: "check", skill: "Investigation", outcomes: [] });

    const actions = el("div", "editor-check-actions");
    const addCheck = button("editor-mini", "+ check");
    addCheck.addEventListener("click", () => addCheckRow(wrap, { kind: "check", skill: "Investigation", outcomes: [] }, options));
    const addCategory = button("editor-mini", "+ category");
    addCategory.addEventListener("click", () => addCategoryRow(wrap, { kind: "category", label: "" }));
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

  function linesWithChecksEditor(value, field) {
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
      const checks = checksEditor((segmentValue && segmentValue.checks) || [], field);
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

  // --- per-kind field rendering -------------------------------------------

  function fieldRow(field, value) {
    const inlineKinds = new Set(["text", "select"]);
    const wrap = el("div", "editor-field" + (inlineKinds.has(field.kind) ? " editor-field-inline" : ""));
    const id = "ef-" + field.key;
    const label = el("label", null, field.label + ":" + (field.required ? " *" : ""));
    label.setAttribute("for", id);
    wrap.appendChild(label);

    let getValue;
    if (field.kind === "text") {
      const input = el("input");
      input.type = "text";
      input.id = id;
      input.value = value || "";
      if (field.inputMode) input.inputMode = field.inputMode;
      if (field.hint) input.placeholder = field.hint;
      wrap.appendChild(input);
      getValue = () => input.value;
    } else if (field.kind === "select") {
      const sel = el("select");
      sel.id = id;
      (field.options || []).forEach((o) => {
        const opt = el("option", null, o.label);
        opt.value = o.value;
        sel.appendChild(opt);
      });
      sel.value = value != null && value !== "" ? value : field.default != null ? field.default : "";
      wrap.appendChild(sel);
      getValue = () => sel.value;
    } else if (field.kind === "flag") {
      const cb = el("input");
      cb.type = "checkbox";
      cb.id = id;
      cb.checked = !!value;
      // put checkbox inline with label
      label.prepend(cb);
      label.prepend(document.createTextNode(" "));
      getValue = () => cb.checked;
    } else if (field.kind === "lines" || field.kind === "narrativeText") {
      const ta = el("textarea");
      ta.id = id;
      ta.value = value || "";
      if (field.hint) ta.placeholder = field.hint;
      wrap.appendChild(ta);
      getValue = () => ta.value;
    } else if (field.kind === "checks") {
      const editor = checksEditor(value, field);
      wrap.appendChild(editor.wrap);
      wrap.appendChild(editor.actions);
      getValue = () => editor.getValue();
    } else if (field.kind === "linesWithChecks") {
      const editor = linesWithChecksEditor(value, field);
      wrap.appendChild(editor.wrap);
      wrap.appendChild(editor.actions);
      getValue = () => editor.getValue();
    } else if (field.kind === "list") {
      const list = el("div", "editor-list");
      const items = Array.isArray(value) ? value.slice() : [];
      if (!items.length) items.push("");
      function addRow(text) {
        const row = el("div", "editor-list-item");
        const input = el("input");
        input.type = "text";
        input.value = text || "";
        const rm = el("button", "editor-mini", "−");
        rm.type = "button";
        rm.title = "Remove";
        rm.addEventListener("click", () => row.remove());
        row.appendChild(input);
        row.appendChild(rm);
        list.appendChild(row);
      }
      items.forEach(addRow);
      const add = el("button", "editor-mini", "+ add");
      add.type = "button";
      add.addEventListener("click", () => addRow(""));
      wrap.appendChild(list);
      wrap.appendChild(add);
      getValue = () =>
        [...list.querySelectorAll(".editor-list-item input")].map((i) => i.value.trim()).filter(Boolean);
    } else if (field.kind === "enemies") {
      const list = el("div", "editor-enemy-list");
      const rows = Array.isArray(value) ? value.slice() : [];

      function miniInput(cls, val, ph, numeric) {
        const inp = el("input", cls);
        inp.type = "text";
        inp.value = val != null ? val : "";
        if (ph) inp.placeholder = ph;
        if (numeric) inp.inputMode = "numeric";
        return inp;
      }
      // A small "Label [input]" pair for the defenses line.
      function labeledInput(cls, labelText, val, ph) {
        const cell = el("div", "ee-def-cell");
        cell.appendChild(el("span", "ee-def-label", labelText));
        const inp = miniInput(cls, val, ph);
        cell.appendChild(inp);
        return { cell, inp };
      }
      function linesArea(val, ph) {
        const ta = el("textarea", "ee-lines");
        ta.rows = 2;
        ta.placeholder = ph;
        ta.value = (val || []).join("\n");
        return ta;
      }
      const DAMAGE_TYPES = (typeof StdIcons !== "undefined" && StdIcons.types)
        ? StdIcons.types("damage")
        : [
          "acid", "bludgeoning", "cold", "fire", "force", "lightning",
          "necrotic", "piercing", "poison", "psychic", "radiant",
          "slashing", "thunder",
        ];
      function damageLabel(type) {
        return String(type || "").replace(/^\w/, (c) => c.toUpperCase());
      }
      function knownDamageType(type) {
        const key = String(type || "").trim().toLowerCase();
        return DAMAGE_TYPES.includes(key) ? key : "";
      }
      function damageSelect(value) {
        const sel = el("select", "ee-dmg-type");
        const empty = el("option", null, "Type");
        empty.value = "";
        sel.appendChild(empty);
        DAMAGE_TYPES.forEach((type) => {
          const opt = el("option", null, damageLabel(type));
          opt.value = type;
          sel.appendChild(opt);
        });
        const custom = el("option", null, "Custom");
        custom.value = "__custom__";
        sel.appendChild(custom);
        sel.value = value || "";
        return sel;
      }
      function normalizeDamageExtra(value) {
        const raw = String(value || "").trim().replace(/\s+/g, "");
        if (!raw) return "";
        return /^[+-]/.test(raw) ? raw : "+" + raw;
      }

      // A live library reference renders as a compact linked row (no inline stats);
      // the full enemy is resolved from Enemies/Name.md at render time.
      function addRefEnemy(rec) {
        const row = el("div", "editor-enemy-row editor-enemy-ref");
        const nameEl = el("span", "ee-ref-name", "🔗 " + rec.ref);
        const count = miniInput("ee-num", rec.count != null && rec.count !== 1 ? rec.count : "", "×", true);
        const lib = button("editor-mini", "Library", "Edit in library");
        lib.addEventListener("click", () => {
          if (typeof Editor !== "undefined" && Editor.editLibraryItem) Editor.editLibraryItem("enemy", rec.ref);
        });
        const rm = button("editor-mini", "−", "Remove enemy");
        rm.addEventListener("click", () => row.remove());
        const statline = el("div", "editor-enemy-statline");
        [nameEl, el("span", "ee-x", "×"), count, lib, rm].forEach((n) => statline.appendChild(n));
        row.appendChild(statline);
        row._getEnemy = () => ({ ref: rec.ref, count: parseInt(count.value, 10) || 1 });
        list.appendChild(row);
      }

      function addEnemy(rec) {
        rec = rec || {};
        if ((rec.ref || "").toString().trim()) { addRefEnemy(rec); return; }
        const row = el("div", "editor-enemy-row");

        // Identity + numeric stats on one compact line.
        const name = miniInput("ee-name", rec.name, "Name");
        const ac = miniInput("ee-num", rec.ac, "AC", true);
        const hp = miniInput("ee-num", rec.hp, "HP", true);
        const init = miniInput("ee-num ee-init", rec.init, "Init", false);
        const speed = miniInput("ee-num ee-speed", rec.speed, "Spd");
        const count = miniInput("ee-num", rec.count != null && rec.count !== 1 ? rec.count : "", "×", true);
        const rm = button("editor-mini", "−", "Remove enemy");
        rm.addEventListener("click", () => row.remove());
        const statline = el("div", "editor-enemy-statline");
        const statKids = [name, ac, hp, init, speed, el("span", "ee-x", "×"), count];
        // A "→ Library" action saves this inline enemy as a library file and swaps
        // the row for a live [enemy=Name] reference. Not offered in single mode (a
        // SourceEnemy file is already the library record).
        if (!field.single) {
          const toLib = button("editor-mini", "→ Lib", "Move this enemy to the library");
          toLib.addEventListener("click", async () => {
            if (typeof Editor === "undefined" || !Editor.moveEnemyToLibrary) return;
            const current = row._getEnemy();
            const name = await Editor.moveEnemyToLibrary(current);
            if (name) { addRefEnemy({ ref: name, count: current.count }); row.remove(); }
          });
          statKids.push(toLib);
        }
        statKids.push(rm);
        statKids.forEach((n) => statline.appendChild(n));
        row.appendChild(statline);

        // Subtitle / creature type.
        const subtitle = miniInput("ee-subtitle", rec.subtitle, "Type / subtitle (e.g. Village Woman • Humanoid)");
        row.appendChild(subtitle);

        // Attacks: a repeatable [name | +hit | damage] sub-list.
        const attacksWrap = el("div", "ee-attacks");
        attacksWrap.appendChild(el("div", "ee-sub-label", "Attacks"));
        const attacksList = el("div", "ee-attacks-list");
        function addAttack(a) {
          a = a || {};
          const arow = el("div", "ee-attack-row");
          const an = miniInput("ee-atk-name", a.name, "Attack name");
          const ah = miniInput("ee-atk-hit", a.hit, "+hit");
          const arm = button("editor-mini", "−", "Remove attack");
          arm.addEventListener("click", () => arow.remove());
          const ahead = el("div", "ee-attack-head");
          [an, ah, arm].forEach((n) => ahead.appendChild(n));

          const damageBox = el("div", "ee-damage-editor");
          const damageList = el("div", "ee-damage-list");
          const parsedDamage = (typeof CombatEnemyModel !== "undefined" && CombatEnemyModel.parseDamageTerms)
            ? CombatEnemyModel.parseDamageTerms(a.damage)
            : null;

          function addDamagePart(part) {
            const data = part || {};
            const knownType = knownDamageType(data.type);
            const customType = data.type && !knownType ? String(data.type).trim() : "";
            const drow = el("div", "ee-damage-row");
            const countInp = miniInput("ee-dmg-count", data.count != null ? data.count : "1", "1", true);
            const sidesSel = el("select", "ee-dmg-sides");
            [4, 6, 8, 10, 12, 20].forEach((side) => {
              const opt = el("option", null, "d" + side);
              opt.value = String(side);
              sidesSel.appendChild(opt);
            });
            sidesSel.value = String(data.sides || 4);
            const extraInp = miniInput("ee-dmg-extra", data.extra || "", "+2");
            const typeSel = damageSelect(customType ? "__custom__" : knownType);
            const customInp = miniInput("ee-dmg-custom", customType, "Custom type");
            const drm = button("editor-mini", "−", "Remove damage");
            drm.addEventListener("click", () => drow.remove());
            function syncCustom() {
              customInp.classList.toggle("is-visible", typeSel.value === "__custom__");
            }
            typeSel.addEventListener("change", syncCustom);
            syncCustom();

            drow.append(countInp, sidesSel, extraInp, typeSel, customInp, drm);
            drow._getDamagePart = () => {
              const count = countInp.value.trim() || "1";
              const sides = sidesSel.value;
              const extra = normalizeDamageExtra(extraInp.value);
              const type = typeSel.value === "__custom__" ? customInp.value.trim() : typeSel.value;
              const changed = count !== "1" || sides !== "4" || extra || type;
              return changed ? { count, sides, extra, type } : null;
            };
            damageList.appendChild(drow);
          }

          function addRawDamage(raw) {
            const rawRow = el("div", "ee-damage-raw");
            const rawInp = miniInput("ee-dmg-raw", raw, "Damage");
            const rmRaw = button("editor-mini", "−", "Remove damage");
            rmRaw.addEventListener("click", () => rawRow.remove());
            rawRow.append(rawInp, rmRaw);
            rawRow._getDamagePart = () => {
              const text = rawInp.value.trim();
              return text ? { raw: text } : null;
            };
            damageList.appendChild(rawRow);
          }

          if (parsedDamage) parsedDamage.forEach(addDamagePart);
          else if ((a.damage || "").trim()) addRawDamage(a.damage);
          else addDamagePart({});

          const addDmg = button("editor-mini", "+ damage", "Add damage");
          addDmg.addEventListener("click", () => addDamagePart({}));
          damageBox.append(damageList, addDmg);
          arow.append(ahead, damageBox);
          arow._getAttack = () => {
            const parts = [...damageList.children].map((node) => node._getDamagePart && node._getDamagePart()).filter(Boolean);
            const structured = [];
            const raw = [];
            parts.forEach((part) => {
              if (part.raw) raw.push(part.raw);
              else structured.push(part);
            });
            const structuredText = (typeof CombatEnemyModel !== "undefined" && CombatEnemyModel.serializeDamageTerms)
              ? CombatEnemyModel.serializeDamageTerms(structured)
              : structured.map((part) => {
                const type = part.type ? " " + part.type : "";
                return part.count + "d" + part.sides + part.extra + type;
              }).join(" + ");
            return {
              name: an.value.trim(),
              hit: ah.value.trim(),
              damage: raw.concat(structuredText ? [structuredText] : []).join(" + "),
            };
          };
          attacksList.appendChild(arow);
        }
        (rec.attacks || []).forEach(addAttack);
        const addAtk = button("editor-mini", "+ attack");
        addAtk.addEventListener("click", () => addAttack({}));
        attacksWrap.appendChild(attacksList);
        attacksWrap.appendChild(addAtk);
        row.appendChild(attacksWrap);

        // Defenses: weak/strong saves + resistances/immunities.
        const def = el("div", "ee-defenses");
        const weak = labeledInput("ee-def", "Weak Save", rec.weakSave, "e.g. Wisdom");
        const strong = labeledInput("ee-def", "Strong Save", rec.strongSave, "e.g. Dexterity");
        const resist = labeledInput("ee-def", "Resist", rec.resist, "e.g. Fire");
        const immune = labeledInput("ee-def", "Immune", rec.immune, "e.g. Poison");
        [weak, strong, resist, immune].forEach((d) => def.appendChild(d.cell));
        row.appendChild(def);

        // Traits + tactics, one entry per line.
        const traitsLbl = el("div", "ee-sub-label", "Traits (one per line)");
        const traits = linesArea(rec.traits, "Keen Senses\nPack Tactics");
        const tacticsLbl = el("div", "ee-sub-label", "Tactics (one per line)");
        const tactics = linesArea(rec.tactics, "Attacks the nearest creature.\nBelow half HP she panics.");
        row.append(traitsLbl, traits, tacticsLbl, tactics);

        row._getEnemy = () => ({
          name: name.value.trim(),
          subtitle: subtitle.value.trim(),
          ac: ac.value.trim(),
          hp: hp.value.trim(),
          init: init.value.trim(),
          speed: speed.value.trim(),
          count: parseInt(count.value, 10) || 1,
          attacks: [...attacksList.querySelectorAll(".ee-attack-row")]
            .map((ar) => ar._getAttack())
            .filter((a) => a.name || a.hit || a.damage),
          weakSave: weak.inp.value.trim(),
          strongSave: strong.inp.value.trim(),
          resist: resist.inp.value.trim(),
          immune: immune.inp.value.trim(),
          traits: traits.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
          tactics: tactics.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
        });

        // A SourceEnemy library file holds exactly one enemy whose name is the
        // card title — hide the per-row name + remove controls in single mode.
        if (field.single) { name.style.display = "none"; rm.style.display = "none"; }
        list.appendChild(row);
      }

      // Open the enemy library picker and append the chosen enemy as a ref row.
      // Picks existing library enemies only — authoring happens via the Enemies
      // sidebar ("+ New enemy"), so we never nest a second editor form here.
      function openEnemyPicker() {
        if (typeof EditorLibraryPicker === "undefined") return;
        EditorLibraryPicker.open({
          type: "enemy",
          onPick: (name) => addEnemy({ ref: name }),
        });
      }

      if (field.single) {
        addEnemy(rows[0] || {});
        wrap.appendChild(list);
      } else {
        (rows.length ? rows : [{}]).forEach(addEnemy);
        const controls = el("div", "editor-enemy-controls");
        const add = button("editor-mini", "+ enemy");
        add.addEventListener("click", () => addEnemy({}));
        const addLib = button("editor-mini", "+ from library", "Insert a library enemy");
        addLib.addEventListener("click", openEnemyPicker);
        controls.append(add, addLib);
        wrap.appendChild(list);
        wrap.appendChild(controls);
      }

      getValue = () => [...list.querySelectorAll(".editor-enemy-row")].map((row) => row._getEnemy());
    } else {
      getValue = () => value;
    }

    return { wrap, getValue, field };
  }

  // --- modal shell ---------------------------------------------------------

  function open(schema, values, titleText, onSubmit) {
    close();
    backdrop = el("div", "editor-modal-backdrop");
    const modal = el("div", "editor-modal");

    const head = el("div", "editor-modal-head");
    head.appendChild(el("span", null, titleText));
    const x = el("button", "editor-mini", "✕");
    x.addEventListener("click", close);
    head.appendChild(x);

    const body = el("div", "editor-modal-body");
    const controls = schema.fields.map((f) => {
      const ctl = fieldRow(f, values[f.key]);
      body.appendChild(ctl.wrap);
      return ctl;
    });

    const foot = el("div", "editor-modal-foot");
    const cancel = el("button", "editor-btn", "Cancel");
    cancel.addEventListener("click", close);
    const ok = el("button", "editor-btn primary", "Insert");
    ok.textContent = titleText.startsWith("Edit") ? "Apply" : "Insert";

    const err = el("div", "editor-field-error");

    ok.addEventListener("click", () => {
      const out = {};
      controls.forEach((c) => (out[c.field.key] = c.getValue()));
      // validation
      const missing = schema.fields.find((f) => f.required && (!out[f.key] || !String(out[f.key]).trim()));
      if (missing) {
        err.textContent = missing.label + " is required.";
        return;
      }
      const block = EditorSchemas.serialize(schema, out);
      close();
      onSubmit(block);
    });

    foot.appendChild(err);
    foot.appendChild(cancel);
    foot.appendChild(ok);

    modal.appendChild(head);
    modal.appendChild(body);
    modal.appendChild(foot);
    backdrop.appendChild(modal);
    backdrop.addEventListener("mousedown", (e) => {
      if (e.target === backdrop) close();
    });
    document.body.appendChild(backdrop);
    document.addEventListener("keydown", onKey);

    const first = body.querySelector("input, select, textarea");
    if (first) first.focus();
  }

  function openPlain(block, model, onSubmit) {
    close();
    backdrop = el("div", "editor-modal-backdrop");
    const modal = el("div", "editor-modal");

    const head = el("div", "editor-modal-head");
    head.appendChild(el("span", null, block.kind === "header" ? "Edit Scene Text" : "Edit Section Text"));
    const x = button("editor-mini", "✕", "Close");
    x.addEventListener("click", close);
    head.appendChild(x);

    const body = el("div", "editor-modal-body");
    const titleField = el("div", "editor-field editor-field-inline");
    const titleId = "ef-plain-title";
    const titleLabel = el("label", null, "Title:");
    titleLabel.setAttribute("for", titleId);
    const titleInput = el("input");
    titleInput.type = "text";
    titleInput.id = titleId;
    titleInput.value = block.title || "";
    titleField.appendChild(titleLabel);
    titleField.appendChild(titleInput);

    let levelInput = null;
    let levelField = null;
    if (block.kind === "section") {
      levelField = el("div", "editor-field editor-field-inline");
      const levelId = "ef-plain-level";
      const levelLabel = el("label", null, "Columns:");
      levelLabel.setAttribute("for", levelId);
      levelInput = el("select");
      levelInput.id = levelId;
      [
        { value: "1", label: "1 column" },
        { value: "2", label: "2 columns" },
      ].forEach((o) => {
        const opt = el("option", null, o.label);
        opt.value = o.value;
        levelInput.appendChild(opt);
      });
      levelInput.value = String(block.level === 1 ? 1 : 2);
      levelField.appendChild(levelLabel);
      levelField.appendChild(levelInput);
    }

    const bodyField = el("div", "editor-field");
    const bodyId = "ef-plain-body";
    const bodyLabel = el("label", null, "Body (markdown)");
    bodyLabel.setAttribute("for", bodyId);
    const text = el("textarea");
    text.id = bodyId;
    text.className = "editor-plain-body";
    text.value = EditorOutline.plainBlockSource(model, block);
    text.placeholder = "> read-aloud text, bullets, notes...";
    bodyField.appendChild(bodyLabel);
    bodyField.appendChild(text);

    body.appendChild(titleField);
    if (levelField) body.appendChild(levelField);
    body.appendChild(bodyField);

    const foot = el("div", "editor-modal-foot");
    const cancel = button("editor-btn", "Cancel");
    cancel.addEventListener("click", close);
    const ok = button("editor-btn primary", "Apply");
    ok.addEventListener("click", () => {
      close();
      onSubmit({ title: titleInput.value, level: levelInput ? levelInput.value : block.level, body: text.value });
    });
    foot.appendChild(cancel);
    foot.appendChild(ok);

    modal.appendChild(head);
    modal.appendChild(body);
    modal.appendChild(foot);
    backdrop.appendChild(modal);
    backdrop.addEventListener("mousedown", (e) => {
      if (e.target === backdrop) close();
    });
    document.body.appendChild(backdrop);
    document.addEventListener("keydown", onKey);
    titleInput.focus();
  }

  function openChapter(onSubmit) {
    close();
    backdrop = el("div", "editor-modal-backdrop");
    const modal = el("div", "editor-modal editor-modal-chapter");

    const head = el("div", "editor-modal-head");
    head.appendChild(el("span", null, "New Chapter"));
    const x = button("editor-mini", "✕", "Close");
    x.addEventListener("click", close);
    head.appendChild(x);

    const body = el("div", "editor-modal-body");
    const titleField = el("div", "editor-field editor-field-inline");
    const titleLabel = el("label", null, "Title:");
    titleLabel.setAttribute("for", "ef-chapter-title");
    const title = el("input");
    title.type = "text";
    title.id = "ef-chapter-title";
    title.value = "New Chapter";
    titleField.appendChild(titleLabel);
    titleField.appendChild(title);

    const levelField = el("div", "editor-field editor-field-inline");
    const levelLabel = el("label", null, "Columns:");
    levelLabel.setAttribute("for", "ef-chapter-level");
    const level = el("select");
    level.id = "ef-chapter-level";
    [
      { value: "2", label: "2 columns" },
      { value: "1", label: "1 column" },
    ].forEach((o) => {
      const opt = el("option", null, o.label);
      opt.value = o.value;
      level.appendChild(opt);
    });
    levelField.appendChild(levelLabel);
    levelField.appendChild(level);

    body.appendChild(titleField);
    body.appendChild(levelField);

    const foot = el("div", "editor-modal-foot");
    const cancel = button("editor-btn", "Cancel");
    cancel.addEventListener("click", close);
    const ok = button("editor-btn primary", "Insert");
    ok.addEventListener("click", () => {
      close();
      onSubmit({ title: title.value, level: level.value });
    });
    foot.appendChild(cancel);
    foot.appendChild(ok);

    modal.appendChild(head);
    modal.appendChild(body);
    modal.appendChild(foot);
    backdrop.appendChild(modal);
    backdrop.addEventListener("mousedown", (e) => {
      if (e.target === backdrop) close();
    });
    document.body.appendChild(backdrop);
    document.addEventListener("keydown", onKey);
    title.focus();
    title.select();
  }

  function defaults(schema) {
    const v = {};
    schema.fields.forEach((f) => {
      if (f.kind === "list") v[f.key] = [];
      else if (f.kind === "enemies") v[f.key] = [];
      else if (f.kind === "flag") v[f.key] = false;
      else if (f.defaultOption && typeof RendererOptions !== "undefined") v[f.key] = RendererOptions.get(f.defaultOption) || "";
      else v[f.key] = f.default != null ? f.default : "";
    });
    return v;
  }

  return {
    openCreate(type, model, onSubmit) {
      const schema = EditorSchemas.get(type);
      if (!schema) return;
      open(schema, defaults(schema), "New " + schema.label, onSubmit);
    },
    openEdit(card, model, onSubmit) {
      const schema = EditorSchemas.get(card.type);
      if (!schema) return;
      const src = EditorOutline.cardSource(model, card);
      open(schema, EditorSchemas.parse(schema, src), "Edit " + schema.label, onSubmit);
    },
    openPlain,
    openChapter,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = EditorForm;
