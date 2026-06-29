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

  const fieldRenderers = {};

  function registerFieldRenderer(kind, renderer) {
    if (!kind || typeof renderer !== "function") return;
    fieldRenderers[kind] = renderer;
  }

  function getFieldRenderer(kind) {
    return fieldRenderers[kind] || null;
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
    const customRenderer = getFieldRenderer(field.kind);
    if (customRenderer) {
      const editor = customRenderer(value, field, { el, button, moveNode });
      if (editor && editor.wrap) wrap.appendChild(editor.wrap);
      if (editor && editor.actions) wrap.appendChild(editor.actions);
      getValue = () => editor && editor.getValue ? editor.getValue() : value;
    } else if (field.kind === "text") {
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

          // The count/dice/bonus/type rows are the shared DamageEditor so the
          // combat editor and the item Damage field stay identical.
          const damage = DamageEditor.build(a.damage, { el, button });
          arow.append(ahead, damage.wrap);
          arow._getAttack = () => ({
            name: an.value.trim(),
            hit: ah.value.trim(),
            damage: damage.getValue(),
          });
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
    registerFieldRenderer,
    getFieldRenderer,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = EditorForm;
