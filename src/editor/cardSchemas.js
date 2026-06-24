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
  function lower(s) {
    return s.replace(/İ/g, "i").replace(/I/g, "ı").toLowerCase();
  }
  const TRUTHY = /^(t|true|evet|yes|1)$/i;

  const CHECK_SKILL_OPTIONS = [
    "Athletics",
    "Acrobatics",
    "Sleight of Hand",
    "Stealth",
    "Arcana",
    "History",
    "Investigation",
    "Nature",
    "Religion",
    "Animal Handling",
    "Insight",
    "Medicine",
    "Perception",
    "Survival",
    "Deception",
    "Intimidation",
    "Performance",
    "Persuasion",
    "STR",
    "DEX",
    "CON",
    "INT",
    "WIS",
    "CHA",
    "Passive Perception",
    "SWD",
    "DT",
    "SWA",
    "Detect Magic",
  ].map((name) => ({ value: name, label: name }));

  const CHECK_LABEL_RE = /^(skill\s+)?checks?\s*:\s*$/i;
  const NPC_TOPIC_RE = /^[ \t]*[\wÇĞİÖŞÜçğıöşü][\wÇĞİÖŞÜçğıöşü ]*:[ \t]*$/;
  const COMBAT_LABEL_RE = /^[A-Za-zÇĞİÖŞÜçğıöşü ]+:\s*$/;

  function trimOuterBlankLines(lines) {
    const out = lines.slice();
    while (out.length && out[0].trim() === "") out.shift();
    while (out.length && out[out.length - 1].trim() === "") out.pop();
    return out;
  }

  function ensureColon(text) {
    const t = String(text || "").trim();
    return /:\s*$/.test(t) || t.includes(":") ? t : t + ":";
  }

  function parseOutcome(text) {
    const f = text.match(/^F:\s*(.*)$/i);
    if (f) return { kind: "failure", text: f[1].trim() };
    const dc = text.match(/^(\d+):\s*(.*)$/);
    if (dc) return { kind: "dc", dc: dc[1], text: dc[2].trim() };
    return { kind: "plain", text: text.trim() };
  }

  function serializeOutcome(outcome) {
    const kind = outcome && outcome.kind ? outcome.kind : "dc";
    const text = outcome && outcome.text != null ? String(outcome.text).trim() : "";
    if (!text) return "";
    if (kind === "failure") return "F: " + text;
    if (kind === "plain") return text;
    const dc = outcome && outcome.dc != null ? String(outcome.dc).trim() : "";
    return (dc || "10") + ": " + text;
  }

  function parseChecks(text) {
    const entries = [];
    let current = null;

    function pushCheck() {
      if (current) entries.push(current);
      current = null;
    }

    String(text || "").split(/\r?\n/).forEach((line) => {
      const t = line.trim();
      if (!t) return;

      const item = t.match(/^[-*]\s+(.+)$/);
      if (item) {
        pushCheck();
        current = {
          kind: "check",
          skill: item[1].trim().replace(/:\s*$/, ""),
          outcomes: [],
        };
        return;
      }

      const quote = t.match(/^>\s*(.*)$/);
      if (quote) {
        if (!current) {
          entries.push({ kind: "raw", text: line });
          return;
        }
        current.outcomes.push(parseOutcome(quote[1]));
        return;
      }

      pushCheck();
      if (t.endsWith(":")) entries.push({ kind: "category", label: t.replace(/:\s*$/, "") });
      else entries.push({ kind: "raw", text: line });
    });

    pushCheck();
    return entries;
  }

  function serializeChecks(entries) {
    let out = "";
    (entries || []).forEach((entry) => {
      if (!entry) return;
      if (entry.kind === "category") {
        const label = String(entry.label || "").trim();
        if (label) out += ensureColon(label) + "\n";
        return;
      }
      if (entry.kind === "raw") {
        const text = String(entry.text || "").replace(/[ \t\r\n]+$/, "");
        if (text) out += text + "\n";
        return;
      }
      if (entry.kind !== "check") return;
      const skill = String(entry.skill || "").trim();
      if (!skill) return;
      out += "- " + ensureColon(skill) + "\n";
      (entry.outcomes || []).forEach((outcome) => {
        const line = serializeOutcome(outcome);
        if (line.trim()) out += "> " + line + "\n";
      });
    });
    return out.replace(/[ \t\r\n]+$/, "");
  }

  function isEmbeddedBoundary(line, mode) {
    const t = line.trim();
    if (CHECK_LABEL_RE.test(t)) return true;
    if (mode === "obj") return /^loot\s*:\s*$/i.test(t);
    if (mode === "combat") return COMBAT_LABEL_RE.test(t);
    if (mode === "npc") return NPC_TOPIC_RE.test(t);
    return false;
  }

  function parseLinesWithChecks(text, mode) {
    const segments = [];
    let textLines = [];
    let active = null;
    let checkLines = [];

    function flushText() {
      const lines = trimOuterBlankLines(textLines);
      if (lines.length) segments.push({ kind: "text", text: lines.join("\n") });
      textLines = [];
    }

    function flushChecks() {
      if (active) {
        segments.push({
          kind: "checksBlock",
          label: active.label,
          checks: parseChecks(checkLines.join("\n")),
        });
      }
      active = null;
      checkLines = [];
    }

    String(text || "").split(/\r?\n/).forEach((line) => {
      const t = line.trim();
      if (active) {
        if (isEmbeddedBoundary(line, mode)) {
          flushChecks();
          if (CHECK_LABEL_RE.test(t)) active = { label: t.replace(/:\s*$/, "") };
          else textLines.push(line);
        } else {
          checkLines.push(line);
        }
        return;
      }

      if (CHECK_LABEL_RE.test(t)) {
        flushText();
        active = { label: t.replace(/:\s*$/, "") };
      } else {
        textLines.push(line);
      }
    });

    flushChecks();
    flushText();
    return segments;
  }

  function serializeLinesWithChecks(segments) {
    const parts = [];
    (segments || []).forEach((segment) => {
      if (!segment) return;
      if (segment.kind === "checksBlock") {
        const checks = serializeChecks(segment.checks);
        const label = ensureColon(segment.label || "Checks");
        parts.push(checks ? label + "\n" + checks : label);
      } else {
        const text = String(segment.text || "").replace(/[ \t\r\n]+$/, "");
        if (text) parts.push(text);
      }
    });
    return parts.join("\n");
  }

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
      if (f.kind === "text" || f.kind === "select") {
        if (v != null && String(v).trim() !== "") out += f.mdLabel + ": " + String(v).trim() + eol;
      } else if (f.kind === "flag") {
        if (v) out += f.mdLabel + ": T" + eol;
      } else if (f.kind === "list") {
        const items = (v || []).map((x) => String(x).trim()).filter(Boolean);
        if (items.length) {
          out += f.mdLabel + ":" + eol;
          items.forEach((it) => (out += "- " + it + eol));
        }
      } else if (f.kind === "lines") {
        if (v != null && String(v).trim() !== "") out += String(v).replace(/[ \t\r\n]+$/, "") + eol;
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
    const catchAllKinds = new Set(["lines", "checks", "linesWithChecks"]);
    const labeled = schema.fields.filter((f) => f.mdLabel && !catchAllKinds.has(f.kind));
    const linesField = schema.fields.find((f) => catchAllKinds.has(f.kind));
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
        const lab = lower(f.mdLabel);
        const m = lower(t).match(/^([^:]+):\s*(.*)$/);
        if (!m || m[1].trim() !== lab) continue;

        if (f.kind === "text" || f.kind === "select") {
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
        }
        break;
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
      } else values[linesField.key] = text;
    }
    return values;
  }

  // --- heading helpers -----------------------------------------------------

  // Build a heading-content factory + matching parser for a fixed keyword type.
  // Column is no longer encoded in the heading — it is a "Side:" body line
  // (default left), handled by serialize()/parse().
  function keywordHeading(keyword) {
    return {
      heading(values) {
        const title = (values.title || "").trim();
        return keyword + ": " + title;
      },
      parseHeading(content, values) {
        values.column = "left";
        const re = new RegExp("^\\s*" + keyword + "\\s*:\\s*(.*)$", "i");
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
  const fStuck = { key: "stuck", label: "Stick to card above (Yapışık)", kind: "flag", mdLabel: "Yapışık" };
  // Column is serialized as a "Side:" body line (default left writes nothing,
  // "right" writes "Side: R"). See serialize()/parse().
  const fColumn = {
    key: "column", label: "Column", kind: "select",
    options: [{ value: "left", label: "Left" }, { value: "right", label: "Right" }],
    default: "left",
  };
  const rarityField = (md) => ({
    key: "rarity", label: "Rarity", kind: "select", mdLabel: md,
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
    checkOptions: CHECK_SKILL_OPTIONS,
  });
  const fChecks = {
    key: "checks",
    label: "Checks",
    kind: "checks",
    hint: "Add skills and outcomes.",
    checkOptions: CHECK_SKILL_OPTIONS,
  };

  // --- schema registry -----------------------------------------------------

  const REGISTRY = {};
  function define(type, label, headingPair, fields) {
    REGISTRY[type] = Object.assign({ type, label, fields }, headingPair);
  }

  define("npc", "NPC", keywordHeading("NPC"), [
    fTitle,
    { key: "personality", label: "Personality (Kişilik)", kind: "list", mdLabel: "Kişilik" },
    { key: "race", label: "Race", kind: "text", mdLabel: "Race" },
    { key: "age", label: "Age", kind: "text", mdLabel: "Age" },
    { key: "occupation", label: "Occupation", kind: "text", mdLabel: "Occupation" },
    { key: "alignment", label: "Alignment", kind: "text", mdLabel: "Alignment" },
    { key: "hp", label: "HP", kind: "text", mdLabel: "HP" },
    { key: "ac", label: "AC", kind: "text", mdLabel: "AC" },
    fImage, fBg,
    fColumn,
    fBodyWithChecks("İlk Diyalog: / Sorarsa: / Bildikleri: / dialogue topics / Checks: …", "npc"),
    fClosed,
  ]);

  define("item", "Item", keywordHeading("Item"), [
    fTitle,
    { key: "tur", label: "Type (Tür)", kind: "text", mdLabel: "Tür" },
    rarityField("Nadirlik"),
    fImage,
    fColumn,
    { key: "properties", label: "Properties (Özellikler)", kind: "list", mdLabel: "Özellikler" },
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
    { key: "tur", label: "Type (Tür)", kind: "text", mdLabel: "Tür" },
    { key: "cost", label: "Cost (Maliyet)", kind: "text", mdLabel: "Maliyet" },
    { key: "range", label: "Range (Menzil)", kind: "text", mdLabel: "Menzil" },
    { key: "cooldown", label: "Cooldown (Bekleme)", kind: "text", mdLabel: "Bekleme" },
    rarityField("Nadirlik"),
    fColumn,
    { key: "properties", label: "Properties (Özellikler)", kind: "list", mdLabel: "Özellikler" },
    fBody("> description, Lore: …"),
    fStuck, fClosed,
  ]);

  define("obj", "Object / POI", keywordHeading("Obje"), [
    fTitle,
    fImage, fBg,
    fColumn,
    fBodyWithChecks("> description, Checks: / Loot: …", "obj"),
    fClosed,
  ]);

  define("combat", "Combat (Savaş)", keywordHeading("Savaş"), [
    fTitle,
    fImage,
    fColumn,
    fBodyWithChecks("> opening, Stat: / Taktik: …", "combat"),
    fClosed,
  ]);

  define("unexpected", "Unexpected", keywordHeading("Unexpected"), [
    { key: "title", label: "Title (optional)", kind: "text" },
    fColumn,
    fBody("- contingency lines…"),
    fClosed,
  ]);

  define("std", "Standard (STD)", keywordHeading("STD"), [
    { key: "title", label: "Title (optional)", kind: "text" },
    fImage,
    fColumn,
    fBody("> read-aloud / paragraphs…"),
    fClosed,
  ]);

  define("skillchecks", "Skill Checks", {
    heading() { return "Skill Checks"; },
    parseHeading(content, values) { values.column = "left"; },
  }, [
    fChecks,
    fColumn,
    fClosed,
  ]);

  // Order shown in the insert menu.
  const ORDER = ["npc", "skillchecks", "obj", "combat", "item", "ability", "unexpected", "std"];

  return {
    get(type) { return REGISTRY[type] || null; },
    list() { return ORDER.map((t) => REGISTRY[t]).filter(Boolean); },
    checkSkillOptions() { return CHECK_SKILL_OPTIONS.slice(); },
    parseChecks,
    serializeChecks,
    serialize,
    parse,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = EditorSchemas;
