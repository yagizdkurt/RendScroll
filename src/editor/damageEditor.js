/* Reusable damage-parts editor: the count / dice / bonus / type rows shared by
   the combat enemy attack editor (src/editor/form.js) and the item Damage field
   (src/cards/item/item.editor.js). One implementation so the two never drift.

   build(damage, helpers) -> { wrap, getValue }
     wrap      a .ee-damage-editor element (list of rows + "+ damage")
     getValue  the serialized damage string ("1d8+1 Slashing + 1d4 Fire"),
               round-tripping through DamageModel so it matches the reader.

   `helpers` may supply { el, button } (form.js passes its own); otherwise a
   minimal built-in pair is used. Damage types come from StdIcons("damage").

   Loaded as a browser global (`DamageEditor`). */

const DamageEditor = (() => {
  function defaultEl(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function defaultButton(el) {
    return (cls, text, title) => {
      const b = el("button", cls, text);
      b.type = "button";
      if (title) b.title = title;
      return b;
    };
  }

  const DAMAGE_TYPES = (typeof StdIcons !== "undefined" && StdIcons.types)
    ? StdIcons.types("damage")
    : ["acid", "bludgeoning", "cold", "fire", "force", "lightning",
       "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"];

  const DM = (typeof DamageModel !== "undefined")
    ? DamageModel
    : (typeof require !== "undefined" ? require("../cards/shared/damageModel.js") : null);

  function damageLabel(type) {
    return String(type || "").replace(/^\w/, (c) => c.toUpperCase());
  }
  function knownDamageType(type) {
    const key = String(type || "").trim().toLowerCase();
    return DAMAGE_TYPES.includes(key) ? key : "";
  }
  function normalizeDamageExtra(value) {
    const raw = String(value || "").trim().replace(/\s+/g, "");
    if (!raw) return "";
    return /^[+-]/.test(raw) ? raw : "+" + raw;
  }

  function build(damage, helpers) {
    const h = helpers || {};
    const el = h.el || defaultEl;
    const button = h.button || defaultButton(el);

    function miniInput(cls, val, ph, numeric) {
      const inp = el("input", cls);
      inp.type = "text";
      inp.value = val != null ? val : "";
      if (ph) inp.placeholder = ph;
      if (numeric) inp.inputMode = "numeric";
      return inp;
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

    const wrap = el("div", "ee-damage-editor");
    const list = el("div", "ee-damage-list");

    function addDamagePart(part) {
      const data = part || {};
      const knownType = knownDamageType(data.type);
      const customType = data.type && !knownType ? String(data.type).trim() : "";
      const drow = el("div", "ee-damage-row");
      const countInp = miniInput("ee-dmg-count", data.count != null ? data.count : "1", "1", true);
      const sidesSel = el("select", "ee-dmg-sides");
      (DM ? DM.DICE : [4, 6, 8, 10, 12, 20]).forEach((side) => {
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
      list.appendChild(drow);
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
      list.appendChild(rawRow);
    }

    const parsed = DM ? DM.parseDamageTerms(damage) : null;
    if (parsed) parsed.forEach(addDamagePart);
    else if (String(damage || "").trim()) addRawDamage(damage);
    else addDamagePart({});

    const addDmg = button("editor-mini", "+ damage", "Add damage");
    addDmg.addEventListener("click", () => addDamagePart({}));
    wrap.append(list, addDmg);

    function getValue() {
      const parts = [...list.children]
        .map((node) => node._getDamagePart && node._getDamagePart())
        .filter(Boolean);
      const structured = [];
      const raw = [];
      parts.forEach((part) => (part.raw ? raw.push(part.raw) : structured.push(part)));
      const structuredText = DM
        ? DM.serializeDamageTerms(structured)
        : structured.map((p) => p.count + "d" + p.sides + p.extra + (p.type ? " " + p.type : "")).join(" + ");
      return raw.concat(structuredText ? [structuredText] : []).join(" + ");
    }

    return { wrap, getValue };
  }

  return { build };
})();

if (typeof window !== "undefined") window.DamageEditor = DamageEditor;
if (typeof module !== "undefined" && module.exports) module.exports = DamageEditor;
