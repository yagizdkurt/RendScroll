/* Card schemas: a declarative description of each card type's form fields plus a
   generic markdown serializer/parser driven by those fields.

   Design (v1): scalar metadata is fully structured (typed inputs/selects/flags
   that map to exact "Label: value" lines), while genuinely tree-shaped content
   (descriptions, dialogue topics, layered skill-check DC lines) lives in a single
   "Body" markdown field. Parsing pulls the known labels out and routes everything
   else to Body verbatim, so editing a card never loses or corrupts content — an
   unrecognized line simply round-trips through Body.

   Field kinds rendered by form.js:
     text   -> single-line input            -> "Label: value"
     select -> dropdown (options)            -> "Label: value"
     flag   -> checkbox                      -> "Label: T" when on
     list   -> repeatable single-line rows   -> "Label:\n- a\n- b"
     checks -> repeatable skill/outcome rows -> "- Skill:\n> 10: result"
     lines  -> textarea (raw markdown)       -> verbatim (the Body catch-all)
   Every card type also carries a "Closed" flag and a left/right "Column" select;
   the column is serialized as a "Side:" body line ("Side: R" for the right
   column, nothing for the default left). */

const EditorSchemas = (() => {
  // The canonical RendScroll parser owns the check/directive/body parsing helpers
  // (parseChecks, parseLinesWithChecks, …). Browser: global `RendScrollParser`
  // (loaded before this file). Node: require it. Delegating here keeps the editor
  // and the renderer parsing identical by construction.
  const RSP = (typeof RendScrollParser !== "undefined")
    ? RendScrollParser
    : require("../parser/rendscrollParser.js");

  // Structured combat-enemy parse/serialize lives in one shared module so the
  // editor (save path) and the reader (render path) never drift.
  const CEM = (typeof CombatEnemyModel !== "undefined")
    ? CombatEnemyModel
    : require("../cards/combat/enemyModel.js");

  const SCR = (typeof RendScrollSkillChecks !== "undefined")
    ? RendScrollSkillChecks
    : require("../cards/shared/skillCheckRules.js");

  const lower = RSP.lower;
  const TRUTHY = /^(t|true|evet|yes|1)$/i;

  function checkSkillOptions() {
    return SCR.skillOptions();
  }

  // Check / outcome / body parsing are owned by the canonical core — these used
  // to be a verbatim copy. Delegating keeps the editor and renderer identical.
  const ensureColon = RSP.ensureColon;
  const parseOutcome = RSP.parseOutcome;
  const serializeOutcome = RSP.serializeOutcome;
  const parseChecks = RSP.parseChecks;
  const serializeChecks = RSP.serializeChecks;
  const parseLinesWithChecks = RSP.parseLinesWithChecks;
  const serializeLinesWithChecks = RSP.serializeLinesWithChecks;

  // --- generic serialize ---------------------------------------------------

  function serialize(schema, values) {
    const eol = "\n"; // outline.frameBlock re-maps to the file's EOL
    let out = "### " + schema.heading(values).trim() + eol;
    // Column: left is the default and writes nothing; right emits one "Side: R".
    const hasColumn = schema.fields.some((f) => f.key === "column");
    if (hasColumn && values.column === "right") out += "Side: R" + eol;
    for (const f of schema.fields) {
      // title/column/keyword are encoded in the heading / Side line above, never
      // as plain body lines.
      if (f.key === "title" || f.key === "column" || f.key === "keyword") continue;
      const v = values[f.key];
      // itemType + damage carry rich editor UI but store as plain "Label: value"
      // lines (the parser/renderer own the icon-ization), so they serialize like
      // a scalar text field.
      if (f.kind === "text" || f.kind === "select" || f.kind === "itemType" || f.kind === "damage") {
        if (v != null && String(v).trim() !== "") out += f.mdLabel + ": " + String(v).trim() + eol;
      } else if (f.kind === "flag") {
        if (v) out += f.mdLabel + ": T" + eol;
      } else if (f.kind === "list") {
        const items = (v || []).map((x) => String(x).trim()).filter(Boolean);
        if (items.length) {
          out += f.mdLabel + ":" + eol;
          items.forEach((it) => (out += "- " + it + eol));
        }
      } else if (f.kind === "enemies") {
        // `single` (SourceEnemy library file): one enemy, named from the card
        // title, written bare (no "Enemies:" label). Otherwise a labelled block.
        let recs = v || [];
        if (f.single) {
          const first = recs[0]
            ? Object.assign({}, recs[0], { name: (values.title || recs[0].name || "").trim(), ref: "" })
            : null;
          recs = first ? [first] : [];
        }
        const block = CEM.serializeEnemies(recs);
        if (block) out += (f.mdLabel ? f.mdLabel + ":" + eol : "") + block + eol;
      } else if (f.kind === "lines") {
        if (v != null && String(v).trim() !== "") out += String(v).replace(/[ \t\r\n]+$/, "") + eol;
      } else if (f.kind === "narrativeText") {
        const text = quoteNarrativeText(v);
        if (text) out += f.mdLabel + ":" + eol + text + eol;
      } else if (f.kind === "checks") {
        const checks = serializeChecks(v);
        if (checks) out += checks + eol;
      } else if (f.kind === "linesWithChecks") {
        const body = serializeLinesWithChecks(v);
        if (body) out += body + eol;
      }
    }
    return out;
  }

  // --- generic parse (markdown block -> values) ----------------------------

  function parse(schema, blockText) {
    const rawLines = blockText.split(/\r?\n/);
    // drop a trailing empty element from a final newline
    if (rawLines.length && rawLines[rawLines.length - 1] === "") rawLines.pop();

    const values = {};
    schema.fields.forEach((f) => {
      if (f.kind === "list") values[f.key] = [];
      else if (f.kind === "enemies") values[f.key] = [];
      else if (f.kind === "checks" || f.kind === "linesWithChecks") values[f.key] = [];
      else if (f.kind === "flag") values[f.key] = false;
      else values[f.key] = "";
    });

    // Heading line -> title (+ column prefix, + dynamic keyword).
    const headIdx = rawLines.findIndex((l) => /^###\s+/.test(l));
    const headContent = headIdx >= 0 ? rawLines[headIdx].replace(/^###\s+/, "") : "";
    schema.parseHeading(headContent, values);

    const body = rawLines.slice(headIdx + 1);

    // Build label lookups.
    const catchAllKinds = new Set(["lines", "checks", "linesWithChecks", "narrativeText"]);
    const labeled = schema.fields.filter((f) => f.mdLabel && !catchAllKinds.has(f.kind));
    const linesField = schema.fields.find((f) => catchAllKinds.has(f.kind));
    // A label-less enemies field (SourceEnemy file): the bullet block sits directly
    // under the heading, so it's matched by shape, not by a preceding label.
    const bareEnemies = schema.fields.find((f) => f.kind === "enemies" && !f.mdLabel);
    const hasColumn = schema.fields.some((f) => f.key === "column");
    const bodyOut = [];

    for (let i = 0; i < body.length; i++) {
      const line = body[i];
      const t = line.trim();
      let matched = false;

      // "Side: R"/"Side: L" sets the column and is consumed (never reaches Body).
      if (hasColumn) {
        const sm = t.match(/^side\s*:\s*(.+)$/i);
        if (sm) { values.column = /^r/i.test(sm[1].trim()) ? "right" : "left"; continue; }
      }

      for (const f of labeled) {
        const labs = fieldLabels(f).map((label) => lower(label));
        const m = lower(t).match(/^([^:]+):\s*(.*)$/);
        if (!m || !labs.includes(m[1].trim())) continue;

        if (f.kind === "text" || f.kind === "select" || f.kind === "itemType" || f.kind === "damage") {
          // recover original-case value from the raw line
          const rv = t.match(/^[^:]+:\s*(.*)$/);
          values[f.key] = rv ? rv[1].trim() : "";
          matched = true;
        } else if (f.kind === "flag") {
          const rv = t.match(/^[^:]+:\s*(.*)$/);
          values[f.key] = !!(rv && TRUTHY.test(rv[1].trim()));
          matched = true;
        } else if (f.kind === "list") {
          // consume following "- " bullets (tolerating one blank line between).
          const items = [];
          let j = i + 1;
          while (j < body.length) {
            const bt = body[j].trim();
            if (bt === "") { j++; continue; }
            const bm = bt.match(/^[-*]\s+(.*)$/);
            if (!bm) break;
            items.push(bm[1].trim());
            j++;
          }
          values[f.key] = items;
          i = j - 1;
          matched = true;
        } else if (f.kind === "enemies") {
          // consume following bullet lines (top-level enemies + indented
          // abilities), tolerating one blank line between rows.
          const block = [];
          let j = i + 1;
          while (j < body.length) {
            const bl = body[j];
            if (bl.trim() === "") { j++; continue; }
            if (!/^\s*[-*]\s+/.test(bl)) break;
            block.push(bl);
            j++;
          }
          values[f.key] = CEM.parseEnemyBlock(block);
          i = j - 1;
          matched = true;
        }
        break;
      }

      // Bare enemies block (no preceding label): consume the contiguous bullets.
      if (!matched && bareEnemies && /^[-*]\s+/.test(t)) {
        const block = [];
        let j = i;
        while (j < body.length) {
          const bl = body[j];
          if (bl.trim() === "") { j++; continue; }
          if (!/^\s*[-*]\s+/.test(bl)) break;
          block.push(bl);
          j++;
        }
        values[bareEnemies.key] = CEM.parseEnemyBlock(block);
        i = j - 1;
        matched = true;
      }

      if (!matched) bodyOut.push(line);
    }

    if (linesField) {
      // trim leading/trailing blank lines from the catch-all body
      while (bodyOut.length && bodyOut[0].trim() === "") bodyOut.shift();
      while (bodyOut.length && bodyOut[bodyOut.length - 1].trim() === "") bodyOut.pop();
      const text = bodyOut.join("\n");
      if (linesField.kind === "checks") values[linesField.key] = parseChecks(text);
      else if (linesField.kind === "linesWithChecks") {
        values[linesField.key] = parseLinesWithChecks(text, linesField.checkMode);
      } else if (linesField.kind === "narrativeText") {
        values[linesField.key] = unquoteNarrativeText(stripTextLabel(text, linesField.mdLabel));
      } else values[linesField.key] = text;
    }
    return values;
  }

  // --- heading helpers -----------------------------------------------------

  // Build a heading-content factory + matching parser for a fixed keyword type.
  // Column is no longer encoded in the heading — it is a "Side:" body line
  // (default left), handled by serialize()/parse().
  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function fieldLabels(field) {
    return [field.mdLabel].concat(field.mdAliases || []).filter(Boolean);
  }

  function keywordHeading(keyword, aliases) {
    const keywords = [keyword].concat(aliases || []);
    const re = new RegExp("^\\s*(?:" + keywords.map(escapeRegExp).join("|") + ")\\s*:\\s*(.*)$", "i");
    return {
      heading(values) {
        const title = (values.title || "").trim();
        return keyword + ": " + title;
      },
      parseHeading(content, values) {
        values.column = "left";
        const m = content.match(re);
        values.title = m ? m[1].trim() : content.trim();
      },
    };
  }

  // --- shared field factories ---------------------------------------------

  const fTitle = { key: "title", label: "Name", kind: "text", required: true };
  const fImage = { key: "image", label: "Image (portrait)", kind: "text", mdLabel: "Image" };
  const fBg = { key: "bg", label: "BG (watermark)", kind: "text", mdLabel: "BG" };
  const fClosed = { key: "closed", label: "Start collapsed", kind: "flag", mdLabel: "Closed" };
  const fStuck = { key: "stuck", label: "Stick to card above", kind: "flag", mdLabel: "Combine", mdAliases: ["Yapışık", "Connect"] };
  // Column is serialized as a "Side:" body line (default left writes nothing,
  // "right" writes "Side: R"). See serialize()/parse().
  const fColumn = {
    key: "column", label: "Column", kind: "select",
    options: [{ value: "left", label: "Left" }, { value: "right", label: "Right" }],
    default: "left",
  };
  const fTextSize = {
    key: "textSize", label: "Text Size", kind: "text", mdLabel: "Text Size",
    inputMode: "numeric", defaultOption: "defaultCardTextSize",
  };
  const rarityField = () => ({
    key: "rarity", label: "Rarity", kind: "select", mdLabel: "Rarity", mdAliases: ["Nadirlik"],
    options: [
      { value: "", label: "—" },
      { value: "1", label: "1 · Common" },
      { value: "2", label: "2 · Rare" },
      { value: "3", label: "3 · Epic" },
    ],
  });
  const fBody = (hint) => ({ key: "body", label: "Body (markdown)", kind: "lines", hint });
  const fBodyWithChecks = (hint, checkMode) => ({
    key: "body",
    label: "Body (markdown)",
    kind: "linesWithChecks",
    checkMode,
    hint,
    checkOptions: checkSkillOptions(),
  });
  const fChecks = {
    key: "checks",
    label: "Checks",
    kind: "checks",
    hint: "Add skills and outcomes.",
    checkOptions: checkSkillOptions(),
  };

  function quoteNarrativeText(value) {
    const raw = String(value || "").replace(/\r?\n/g, "\n").replace(/[ \t\r\n]+$/, "");
    if (!raw) return "";
    return raw.split("\n").map((line) => {
      if (/^\s*>/.test(line)) return line;
      return line ? "> " + line : ">";
    }).join("\n");
  }

  function unquoteNarrativeText(value) {
    return String(value || "")
      .replace(/[ \t\r\n]+$/, "")
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*>\s?/, ""))
      .join("\n");
  }

  function stripTextLabel(text, label) {
    const lines = String(text || "").split(/\r?\n/);
    const wanted = lower(String(label || "Text"));
    if (lines.length) {
      const first = lower(lines[0].trim()).match(/^([^:]+):\s*$/);
      if (first && first[1].trim() === wanted) lines.shift();
    }
    while (lines.length && lines[0].trim() === "") lines.shift();
    return lines.join("\n");
  }

  // --- schema registry -----------------------------------------------------

  const REGISTRY = {};
  function define(type, label, headingPair, fields) {
    REGISTRY[type] = Object.assign({ type, label, fields }, headingPair);
  }

  define("npc", "NPC", keywordHeading("NPC"), [
    fTitle,
    { key: "personality", label: "Personality", kind: "list", mdLabel: "Personality", mdAliases: ["Kişilik"] },
    { key: "race", label: "Race", kind: "text", mdLabel: "Race" },
    { key: "age", label: "Age", kind: "text", mdLabel: "Age" },
    { key: "occupation", label: "Occupation", kind: "text", mdLabel: "Occupation" },
    { key: "alignment", label: "Alignment", kind: "text", mdLabel: "Alignment" },
    { key: "hp", label: "HP", kind: "text", mdLabel: "HP" },
    { key: "ac", label: "AC", kind: "text", mdLabel: "AC" },
    fImage, fBg,
    fColumn,
    fTextSize,
    fBodyWithChecks("First dialogue / questions / known topics / dialogue topics / Checks: ...", "npc"),
    fClosed,
  ]);

  define("item", "Item", keywordHeading("Item"), [
    fTitle,
    { key: "sourceItem", label: "SourceItem", kind: "text", mdLabel: "SourceItem" },
    { key: "tur", label: "Type", kind: "itemType", mdLabel: "Type", mdAliases: ["Tür"] },
    { key: "damage", label: "Damage", kind: "damage", mdLabel: "Damage", mdAliases: ["Hasar"] },
    rarityField(),
    fImage,
    fColumn,
    fTextSize,
    { key: "properties", label: "Properties", kind: "list", mdLabel: "Properties", mdAliases: ["Özellikler"] },
    fBody("> description, extra lines…"),
    fStuck, fClosed,
  ]);

  define("ability", "Ability", {
    heading(values) {
      const kw = values.keyword || "Spell";
      return kw + ": " + (values.title || "").trim();
    },
    parseHeading(content, values) {
      values.column = "left";
      const m = content.match(/^\s*(skill|spell|passive|effect)\s*:\s*(.*)$/i);
      values.keyword = m ? m[1].replace(/^\w/, (c) => c.toUpperCase()) : "Spell";
      values.title = m ? m[2].trim() : content.trim();
    },
  }, [
    {
      key: "keyword", label: "Kind", kind: "select",
      options: ["Spell", "Skill", "Passive", "Effect"].map((k) => ({ value: k, label: k })),
      default: "Spell",
    },
    fTitle,
    { key: "tur", label: "Type", kind: "text", mdLabel: "Type", mdAliases: ["Tür"] },
    { key: "cost", label: "Cost", kind: "text", mdLabel: "Cost", mdAliases: ["Maliyet"] },
    { key: "range", label: "Range", kind: "text", mdLabel: "Range", mdAliases: ["Menzil"] },
    { key: "cooldown", label: "Cooldown", kind: "text", mdLabel: "Cooldown", mdAliases: ["Bekleme"] },
    rarityField(),
    fColumn,
    fTextSize,
    { key: "properties", label: "Properties", kind: "list", mdLabel: "Properties", mdAliases: ["Özellikler"] },
    fBody("> description, Lore: …"),
    fStuck, fClosed,
  ]);

  define("obj", "Object / POI", keywordHeading("Object", ["Obje", "POI"]), [
    fTitle,
    fImage, fBg,
    fColumn,
    fTextSize,
    fBodyWithChecks("> description, Checks: / Loot: …", "obj"),
    fClosed,
  ]);

  define("combat", "Combat", keywordHeading("Combat", ["Savaş", "Savas"]), [
    fTitle,
    fImage,
    fColumn,
    fTextSize,
    fBodyWithChecks("> opening, Tactics: ...", "combat"),
    { key: "enemies", label: "Enemies", kind: "enemies", mdLabel: "Enemies" },
    fClosed,
  ]);

  define("unexpected", "Unexpected", keywordHeading("Unexpected"), [
    { key: "title", label: "Title (optional)", kind: "text" },
    fColumn,
    fTextSize,
    fBody("- contingency lines…"),
    fClosed,
  ]);

  define("std", "Standard (STD)", keywordHeading("STD"), [
    { key: "title", label: "Title (optional)", kind: "text" },
    fImage,
    fColumn,
    fTextSize,
    fBody("> read-aloud / paragraphs…"),
    fClosed,
  ]);

  define("picture", "Picture", keywordHeading("Picture"), [
    { key: "title", label: "Caption (optional)", kind: "text" },
    { key: "image", label: "Image", kind: "text", mdLabel: "Image", required: true },
    { key: "size", label: "Size (% of column)", kind: "text", mdLabel: "Size", inputMode: "numeric" },
    fColumn,
    fClosed,
  ]);

  define("skillchecks", "Skill Checks", {
    heading() { return "Skill Checks"; },
    parseHeading(content, values) { values.column = "left"; },
  }, [
    fChecks,
    fColumn,
    fTextSize,
    fClosed,
  ]);

  define("sourceitem", "SourceItem", {
    heading(values) {
      return "SourceItem: " + (values.title || "").trim();
    },
    parseHeading(content, values) {
      const m = content.match(/^\s*(source\s*item|sourceitem)\s*:\s*(.*)$/i);
      values.title = m ? m[2].trim() : content.trim();
    },
  }, [
    fTitle,
    { key: "tur", label: "Type", kind: "itemType", mdLabel: "Type", mdAliases: ["Tür"] },
    { key: "damage", label: "Damage", kind: "damage", mdLabel: "Damage", mdAliases: ["Hasar"] },
    rarityField(),
    fImage,
    { key: "properties", label: "Properties", kind: "list", mdLabel: "Properties", mdAliases: ["Özellikler"] },
    fBody("> description, extra lines…"),
  ]);

  // A standalone library enemy: a "### SourceEnemy: Name" heading + one enemy
  // block (no "Enemies:" label). The single enemy's name is the card title.
  define("sourceenemy", "SourceEnemy", {
    heading(values) {
      return "SourceEnemy: " + (values.title || "").trim();
    },
    parseHeading(content, values) {
      const m = content.match(/^\s*(source\s*enemy|sourceenemy)\s*:\s*(.*)$/i);
      values.title = m ? m[2].trim() : content.trim();
    },
  }, [
    fTitle,
    { key: "enemy", label: "Enemy stats", kind: "enemies", single: true },
  ]);

  define("narrative", "Narrative", {
    heading() { return "Narrative"; },
    parseHeading(content, values) { values.column = "left"; },
  }, [
    fColumn,
    fTextSize,
    { key: "text", label: "Text", kind: "narrativeText", mdLabel: "Text", hint: "Read-aloud text...", required: true },
  ]);

  // Order shown in the insert menu.
  const ORDER = ["narrative", "npc", "skillchecks", "obj", "combat", "item", "ability", "unexpected", "std", "picture"];

  return {
    get(type) { return REGISTRY[type] || null; },
    list() { return ORDER.map((t) => REGISTRY[t]).filter(Boolean); },
    checkSkillOptions,
    parseChecks,
    serializeChecks,
    serialize,
    parse,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = EditorSchemas;
