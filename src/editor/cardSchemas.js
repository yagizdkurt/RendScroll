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

  // Shared AST accessors + the per-type render body parsers. The editor consumes
  // the SAME parse<Type>Body functions the render builders use (see
  // RENDERER_AST_MIGRATION.md), so a card's type-specific fields are never parsed
  // two different ways. Browser: these are globals (cards loaded before the editor).
  // Node: require them, and mirror the browser by exposing the cardDirectives
  // helpers as globals so the required card files (which reference them as globals)
  // resolve at call time.
  const RENDER = (typeof cardBodySource !== "undefined")
    ? {
        cardBodySource, cardBodyLines, cardOrderedBody, cardDirective,
        parseItemBody, parseAbilityBody, parseManifestBody,
        parseNpcBody, parseObjBody, parseCombatBody, parseTransitionBody,
      }
    : (() => {
        const CD = require("../cards/shared/cardDirectives.js");
        Object.assign(globalThis, CD);
        if (typeof globalThis.RendScrollParser === "undefined") globalThis.RendScrollParser = RSP;
        if (typeof globalThis.rsLower === "undefined") globalThis.rsLower = require("../utils/text.js").rsLower;
        return Object.assign({}, CD, {
          parseItemBody: require("../cards/item/item.js").parseItemBody,
          parseAbilityBody: require("../cards/ability/ability.js").parseAbilityBody,
          parseManifestBody: require("../cards/manifest/manifest.js").parseManifestBody,
          parseNpcBody: require("../cards/npc/npc.js").parseNpcBody,
          parseObjBody: require("../cards/obj/obj.js").parseObjBody,
          parseCombatBody: require("../cards/combat/combat.js").parseCombatBody,
          parseTransitionBody: require("../cards/transition/transition.js").parseTransitionBody,
        });
      })();

  const lower = RSP.lower;

  function checkSkillOptions() {
    return SCR.skillOptions();
  }

  // Check / outcome / body parsing are owned by the canonical core — these used
  // to be a verbatim copy. Delegating keeps the editor and renderer identical.
  const parseChecks = RSP.parseChecks;
  const serializeChecks = RSP.serializeChecks;
  const serializeLinesWithChecks = RSP.serializeLinesWithChecks;

  // --- generic serialize ---------------------------------------------------

  // Field keys the parser resolves into universal directives/flags (Side is the
  // `column` field, emitted separately as "Side:"). serialize() emits these before
  // the body and the per-type adapters read them off the node instead of the body
  // — one source of truth for what "universal" means.
  const DIRECTIVE_KEYS = new Set(["image", "bg", "textSize", "closed", "stuck", "size", "file"]);

  function serialize(schema, values) {
    const eol = "\n"; // outline.frameBlock re-maps to the file's EOL
    let out = "### " + schema.heading(values).trim() + eol;
    // Column: left is the default and writes nothing; right emits one "Side: R".
    const hasColumn = schema.fields.some((f) => f.key === "column");
    if (hasColumn && values.column === "right") out += "Side: R" + eol;
    // Emit universal directive/flag fields (Image/BG/Text Size/Closed/Combine/…)
    // before the content fields: a "Closed: T" placed AFTER a trailing "Checks:"
    // block is swallowed by the parser's check capture (it stops only at a boundary,
    // not a directive line), so a card would silently lose its directive on reload.
    // Stable sort keeps each group's original schema order.
    const ordered = schema.fields.slice().sort((a, b) =>
      (DIRECTIVE_KEYS.has(a.key) ? 0 : 1) - (DIRECTIVE_KEYS.has(b.key) ? 0 : 1));
    for (const f of ordered) {
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

  // --- node-based parse (shared with the render builders) ------------------

  function initValues(schema) {
    const values = {};
    schema.fields.forEach((f) => {
      if (f.kind === "list") values[f.key] = [];
      else if (f.kind === "enemies") values[f.key] = [];
      else if (f.kind === "checks" || f.kind === "linesWithChecks") values[f.key] = [];
      else if (f.kind === "flag") values[f.key] = false;
      else values[f.key] = "";
    });
    return values;
  }

  function headingContentOf(rawLines) {
    const headIdx = rawLines.findIndex((l) => /^###\s+/.test(l));
    return headIdx >= 0 ? rawLines[headIdx].replace(/^###\s+/, "") : "";
  }

  // The first parsed card node from an editor block (its serialized markdown), so a
  // card's directives/body/checks are resolved by the canonical parser identically
  // to the reader.
  function firstCardNode(blockText) {
    return RSP.firstCardNode(RSP.parseRendScroll(blockText));
  }

  // Universal directives + column/stuck come off the AST node, exactly as the
  // render builders read them — the editor no longer hand-scans these lines.
  const UNIVERSAL_TRUTHY = /^(t|true)$/i;
  function fillUniversalFromNode(schema, node, values) {
    const D = (name) => RENDER.cardDirective(node, name);
    schema.fields.forEach((f) => {
      switch (f.key) {
        case "column": values.column = node.column; break;
        case "stuck": values.stuck = !!node.stuck; break;
        case "closed": values.closed = UNIVERSAL_TRUTHY.test(D("closed").trim()); break;
        case "image": values.image = D("image"); break;
        case "bg": values.bg = D("bg"); break;
        case "textSize": values.textSize = D("textsize"); break;
        case "size": values.size = D("size"); break;
        case "file": values.file = D("file"); break;
        default: break;
      }
    });
  }

  // Map a render model's metaRows (label/value scalars) onto the schema's scalar
  // fields by label (TR/EN aware, via the fields' own mdLabel/mdAliases). Returns
  // the leftover rows (unknown labels) as "Label: value" lines so nothing is lost.
  function mapMetaToScalars(schema, metaRows, values) {
    const byLabel = {};
    schema.fields.forEach((f) => {
      if (["text", "select", "itemType", "damage"].indexOf(f.kind) < 0) return;
      if (f.key === "image" || f.key === "textSize") return; // universal, from node
      fieldLabels(f).forEach((lab) => { byLabel[lower(lab).trim()] = f.key; });
    });
    const leftover = [];
    (metaRows || []).forEach((row) => {
      const key = byLabel[lower(row.label).trim()];
      if (key) values[key] = row.value;
      else leftover.push(row.label + ": " + row.value);
    });
    return leftover;
  }

  function trimBlankEdges(lines) {
    const out = lines.slice();
    while (out.length && out[0].trim() === "") out.shift();
    while (out.length && out[out.length - 1].trim() === "") out.pop();
    return out;
  }

  function bodyText(node) {
    return trimBlankEdges(RENDER.cardBodyLines(node)).join("\n");
  }

  function pushTextSegment(out, linesOrText) {
    const lines = Array.isArray(linesOrText)
      ? linesOrText
      : String(linesOrText || "").split(/\r?\n/);
    const text = trimBlankEdges(lines).join("\n");
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.kind === "text") last.text += "\n" + text;
    else out.push({ kind: "text", text });
  }

  function pushChecksSegment(out, label, checks) {
    out.push({ kind: "checksBlock", label: label || "Checks", checks: checks || [] });
  }

  function collectCheckGroups(node) {
    const out = [];
    RENDER.cardOrderedBody(node).forEach((seg) => {
      if (seg.kind === "checks") out.push(...seg.checks);
    });
    return out;
  }

  function consumeLeadingBullets(lines) {
    const items = [];
    let i = 0;
    while (i < lines.length) {
      const t = lines[i].trim();
      if (t === "") { i++; continue; }
      const bullet = t.match(/^[-*]\s+(.*)$/);
      if (!bullet) break;
      items.push(bullet[1].trim());
      i++;
    }
    return { items, rest: lines.slice(i) };
  }

  // Item / SourceItem: canonical ItemData.parse (via parseItemBody). Meta rows fold
  // to Type/Damage/Rarity scalars; description + extras + unknown meta -> Body.
  function itemFromBody(node, values, api) {
    const m = api.render.parseItemBody(node);
    values.sourceItem = m.sourceItem || "";
    const leftover = api.mapMeta(m.metaRows);
    values.properties = (m.properties || []).slice();
    values.body = [].concat(m.description || [], m.extras || [], leftover)
      .join("\n").replace(/[ \t\r\n]+$/, "");
  }

  // Ability: parseAbilityBody. Meta rows fold to Type/Cost/Range/Cooldown/Rarity;
  // Lore + description + extras + unknown meta -> Body (the "> …" / "Lore:" text).
  function abilityFromBody(node, values, api) {
    const m = api.render.parseAbilityBody(node);
    const leftover = api.mapMeta(m.metaRows);
    values.properties = (m.properties || []).slice();
    const parts = [].concat(m.description || [], m.extras || []);
    if ((m.lore || []).length) parts.push("Lore:", ...m.lore);
    values.body = [].concat(parts, leftover).join("\n").replace(/[ \t\r\n]+$/, "");
  }

  // Scene Manifest: parseManifestBody. Duration/Summary scalars + Goals/Key NPCs/
  // Rewards bullet lists come straight off the shared render parser.
  function manifestFromBody(node, values, api) {
    const m = api.render.parseManifestBody(node);
    values.duration = m.duration || "";
    values.summary = m.summary || "";
    values.goals = (m.goals || []).slice();
    values.keyNpcs = (m.keyNpcs || []).slice();
    values.rewards = (m.rewards || []).slice();
  }

  function sourceItemFromBody(node, values, api) {
    const m = api.render.parseItemBody(node);
    const leftover = api.mapMeta(m.metaRows);
    values.properties = (m.properties || []).slice();
    values.body = [].concat(m.description || [], m.extras || [], leftover)
      .join("\n").replace(/[ \t\r\n]+$/, "");
  }

  function npcFromBody(node, values, api) {
    const segments = [];
    let collectPersonality = false;
    const statKeys = {
      race: "race",
      age: "age",
      occupation: "occupation",
      alignment: "alignment",
      hp: "hp",
      ac: "ac",
    };
    api.render.parseNpcBody(node).forEach((seg) => {
      if (seg.kind === "stat") {
        const key = statKeys[lower(seg.label).trim()];
        if (key) values[key] = seg.value || "";
        collectPersonality = false;
        return;
      }
      if (seg.kind === "personality") {
        collectPersonality = true;
        return;
      }
      if (seg.kind === "checks") {
        collectPersonality = false;
        pushChecksSegment(segments, "Checks", seg.checks);
        return;
      }
      if (seg.kind === "topic") {
        collectPersonality = false;
        pushTextSegment(segments, seg.line || seg.title);
        return;
      }
      if (seg.kind === "lines") {
        let lines = seg.lines || [];
        if (collectPersonality) {
          const consumed = consumeLeadingBullets(lines);
          values.personality = consumed.items;
          lines = consumed.rest;
          collectPersonality = false;
        }
        pushTextSegment(segments, lines);
      }
    });
    values.body = segments;
  }

  function objFromBody(node, values, api) {
    const segments = [];
    api.render.parseObjBody(node).forEach((seg) => {
      if (seg.kind === "checks") {
        pushChecksSegment(segments, "Checks", seg.checks);
      } else if (seg.kind === "lines" && seg.mode === "loot") {
        pushTextSegment(segments, ["Loot:"].concat(seg.lines || []));
      } else if (seg.kind === "lines") {
        pushTextSegment(segments, seg.lines || []);
      }
    });
    values.body = segments;
  }

  function combatFromBody(node, values, api) {
    const segments = [];
    api.render.parseCombatBody(node).forEach((seg) => {
      if (seg.kind === "checks") {
        pushChecksSegment(segments, seg.label || "Checks", seg.checks);
      } else if (seg.kind === "enemies") {
        values.enemies = (values.enemies || []).concat(CEM.parseEnemyBlock(seg.lines || []));
      } else if (seg.kind === "section") {
        pushTextSegment(segments, (seg.label || "").replace(/\s*:\s*$/, "") + ":");
      } else if (seg.kind === "lines") {
        pushTextSegment(segments, seg.lines || []);
      }
    });
    values.body = segments;
  }

  function plainLinesFromBody(node, values) {
    values.body = bodyText(node);
  }

  function skillChecksFromBody(node, values) {
    values.checks = collectCheckGroups(node);
  }

  function sourceEnemyFromBody(node, values, api) {
    values.enemy = CEM.parseEnemyBlock(api.render.cardBodyLines(node));
  }

  function narrativeFromBody(node, values) {
    values.text = unquoteNarrativeText(stripTextLabel(bodyText(node), "Text"));
  }

  function transitionFromBody(node, values, api) {
    const m = api.render.parseTransitionBody(node);
    values.scene = m.sceneRef || "";
    values.body = trimBlankEdges(m.descriptionLines || []).join("\n");
  }

  function noBodyFieldsFromBody() {}

  // --- parse (markdown block -> values) ------------------------------------

  // One spine for every card type: parse the block to its AST node, take the title
  // from the heading and the universals off the node, then dispatch to the type's
  // explicit fromBody adapter. Each adapter reads the SAME node the reader renders
  // from, using the shared per-type render parser where one exists.
  function parse(schema, blockText) {
    const rawLines = blockText.split(/\r?\n/);
    const values = initValues(schema);
    schema.parseHeading(headingContentOf(rawLines), values);
    const node = firstCardNode(blockText);
    if (node) {
      fillUniversalFromNode(schema, node, values);
      if (typeof schema.fromBody !== "function") throw new Error("Schema missing fromBody: " + schema.type);
      schema.fromBody(node, values, {
        render: RENDER,
        mapMeta: (rows) => mapMetaToScalars(schema, rows, values),
      });
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
  const fImage = { key: "image", label: "Image (portrait)", kind: "text", mdLabel: "Image", assetType: "images" };
  const fBg = { key: "bg", label: "BG (watermark)", kind: "text", mdLabel: "BG", assetType: "images" };
  const fClosed = { key: "closed", label: "Start collapsed", kind: "flag", mdLabel: "Closed" };
  const fStuck = { key: "stuck", label: "Stick to card above", kind: "flag", mdLabel: "Combine", mdAliases: ["Connect"] };
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
    key: "rarity", label: "Rarity", kind: "select", mdLabel: "Rarity",
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
  function define(type, label, headingPair, fields, extra) {
    REGISTRY[type] = Object.assign({ type, label, fields }, headingPair, extra || {});
  }

  define("npc", "NPC", keywordHeading("NPC"), [
    fTitle,
    { key: "personality", label: "Personality", kind: "list", mdLabel: "Personality" },
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
  ], { fromBody: npcFromBody });

  define("item", "Item", keywordHeading("Item"), [
    fTitle,
    { key: "sourceItem", label: "SourceItem", kind: "text", mdLabel: "SourceItem" },
    { key: "type", label: "Type", kind: "itemType", mdLabel: "Type" },
    { key: "damage", label: "Damage", kind: "damage", mdLabel: "Damage" },
    rarityField(),
    fImage,
    fColumn,
    fTextSize,
    { key: "properties", label: "Properties", kind: "list", mdLabel: "Properties" },
    fBody("> description, extra lines…"),
    fStuck, fClosed,
  ], { fromBody: itemFromBody });

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
    { key: "type", label: "Type", kind: "text", mdLabel: "Type" },
    { key: "cost", label: "Cost", kind: "text", mdLabel: "Cost" },
    { key: "range", label: "Range", kind: "text", mdLabel: "Range" },
    { key: "cooldown", label: "Cooldown", kind: "text", mdLabel: "Cooldown" },
    rarityField(),
    fColumn,
    fTextSize,
    { key: "properties", label: "Properties", kind: "list", mdLabel: "Properties" },
    fBody("> description, Lore: …"),
    fStuck, fClosed,
  ], { fromBody: abilityFromBody });

  define("obj", "Object / POI", keywordHeading("Object", ["POI"]), [
    fTitle,
    fImage, fBg,
    fColumn,
    fTextSize,
    fBodyWithChecks("> description, Checks: / Loot: …", "obj"),
    fClosed,
  ], { fromBody: objFromBody });

  define("combat", "Combat", keywordHeading("Combat"), [
    fTitle,
    fImage,
    fColumn,
    fTextSize,
    fBodyWithChecks("> opening, Tactics: ...", "combat"),
    { key: "enemies", label: "Enemies", kind: "enemies", mdLabel: "Enemies" },
    fClosed,
  ], { fromBody: combatFromBody });

  define("unexpected", "Unexpected", keywordHeading("Unexpected"), [
    { key: "title", label: "Title (optional)", kind: "text" },
    fColumn,
    fTextSize,
    fBody("- contingency lines…"),
    fClosed,
  ], { fromBody: plainLinesFromBody });

  define("std", "Standard (STD)", keywordHeading("STD"), [
    { key: "title", label: "Title (optional)", kind: "text" },
    fImage,
    fColumn,
    fTextSize,
    fBody("> read-aloud / paragraphs…"),
    fClosed,
  ], { fromBody: plainLinesFromBody });

  define("picture", "Picture", keywordHeading("Picture"), [
    { key: "title", label: "Caption (optional)", kind: "text" },
    { key: "image", label: "Image", kind: "text", mdLabel: "Image", required: true, assetType: "images" },
    { key: "size", label: "Size (% of column)", kind: "text", mdLabel: "Size", inputMode: "numeric" },
    fColumn,
    fClosed,
  ], { fromBody: noBodyFieldsFromBody });

  define("audio", "Audio", keywordHeading("Audio"), [
    { key: "title", label: "Caption (optional)", kind: "text" },
    { key: "file", label: "Audio file", kind: "text", mdLabel: "File", required: true, assetType: "audio" },
    fColumn,
    fClosed,
  ], { fromBody: noBodyFieldsFromBody });

  // Live scene list for the Transition target dropdown. Exposed via a property
  // getter on the field (form.js reads field.options when the form opens), so
  // the choices always match the current campaign without rebuilding the schema.
  function transitionSceneOptions() {
    const entries = (typeof RendScrollApp !== "undefined" && RendScrollApp.campaignEntries)
      ? RendScrollApp.campaignEntries() : [];
    const opts = [{ value: "", label: "—" }];
    entries.forEach((e) => {
      const stem = String(e.file || "").replace(/\.md$/i, "");
      if (!stem) return;
      const label = (e.number != null ? e.number + " · " : "") + (e.label || stem);
      opts.push({ value: stem, label });
    });
    return opts;
  }

  define("transition", "Transition", keywordHeading("Transition"), [
    fTitle,
    {
      key: "scene", label: "Target scene", kind: "select", mdLabel: "Scene",
      get options() { return transitionSceneOptions(); },
    },
    fColumn,
    fBody("> when the DM should use this transition…"),
    fClosed,
  ], { fromBody: transitionFromBody });

  define("skillchecks", "Skill Checks", {
    heading() { return "Skill Checks"; },
    parseHeading(content, values) { values.column = "left"; },
  }, [
    fChecks,
    fColumn,
    fTextSize,
    fClosed,
  ], { fromBody: skillChecksFromBody });

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
    { key: "type", label: "Type", kind: "itemType", mdLabel: "Type" },
    { key: "damage", label: "Damage", kind: "damage", mdLabel: "Damage" },
    rarityField(),
    fImage,
    { key: "properties", label: "Properties", kind: "list", mdLabel: "Properties" },
    fBody("> description, extra lines…"),
  ], { fromBody: sourceItemFromBody });

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
  ], { fromBody: sourceEnemyFromBody });

  define("narrative", "Narrative", {
    heading() { return "Narrative"; },
    parseHeading(content, values) { values.column = "left"; },
  }, [
    fColumn,
    fTextSize,
    { key: "text", label: "Text", kind: "narrativeText", mdLabel: "Text", hint: "Read-aloud text...", required: true },
  ], { fromBody: narrativeFromBody });

  // Scene Manifest: a compact scene-header card set at scene-creation time. It is
  // deliberately ABSENT from ORDER below, so it never appears in the insert ("add
  // card") menu (EditorSchemas.list()) — but get/serialize/parse and right-click Edit
  // on an existing manifest all work.
  define("manifest", "Scene Manifest", {
    heading() { return "Manifest"; },
    parseHeading(content, values) { values.column = "left"; },
  }, [
    { key: "duration", label: "Duration", kind: "text", mdLabel: "Duration" },
    { key: "summary", label: "Summary", kind: "text", mdLabel: "Summary" },
    { key: "goals", label: "Goals", kind: "list", mdLabel: "Goals" },
    { key: "keyNpcs", label: "Key NPCs", kind: "list", mdLabel: "Key NPCs" },
    { key: "rewards", label: "Rewards", kind: "list", mdLabel: "Rewards" },
  ], { fromBody: manifestFromBody });

  // Order shown in the insert menu. (manifest is intentionally excluded — see above.)
  const ORDER = ["narrative", "npc", "skillchecks", "obj", "combat", "item", "ability", "unexpected", "std", "picture", "audio", "transition"];

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
