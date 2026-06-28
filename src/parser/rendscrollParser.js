/* RendScroll structural parser — the single canonical model of a scene.

   Markdown text -> RendScrollDocument (an AST). It is SOURCE-PRESERVING: every
   node carries a SourceRange back into the original bytes, unknown/malformed
   content is kept verbatim (never destroyed), and the document can be sliced back
   to the exact input.

   This module is the ONE place that knows "what a RendScroll card/directive is".
   The classification + directive/check parsing rules used to be restated in three
   shapes (cards/<type>/*.js heading regexes, editor/outline.js, editor/cardSchemas.js);
   those now delegate here. See the migration plan for the full background.

   Phase 1 deliverable: parse structure only. It does NOT render. The renderer
   migration (Phase 2) consumes this AST.

   Loaded as a browser global (`RendScrollParser`) like the rest of the app, and
   `module.exports` for Node tests. */

const RendScrollParser = (() => {
  // --- low-level text helpers (canonical; outline.js delegates here) --------

  // Turkish-aware lowercase (İ/I -> dotted/dotless i), matching every renderer's
  // rsLower(). Used for the includes-based classification (npc / skill check) and
  // for truthy-value tests — the same places the card builders use it.
  function lower(s) {
    return String(s).replace(/İ/g, "i").replace(/I/g, "ı").toLowerCase();
  }

  // ASCII-leaning lowercase for DIRECTIVE KEYWORDS. The card builders match these with
  // case-insensitive regex (e.g. /^image\s*:/i), NOT rsLower — so "Image" must map
  // to "image", not the dotless "ımage" that lower() would produce. Both İ and I
  // fold to a plain "i" here so the keyword set stays ASCII.
  function keywordLower(s) {
    return String(s).replace(/İ/g, "i").replace(/I/g, "i").toLowerCase();
  }

  // Split into lines that each KEEP their trailing newline, so join("") is the
  // exact original (handles mixed LF / CRLF across files). Empty input -> [].
  function splitLines(md) {
    if (md === "") return [];
    return md.match(/[^\n]*\n|[^\n]+$/g) || [];
  }

  // Strip the trailing line break from a stored line for pattern testing.
  function lineText(line) {
    return line.replace(/\r?\n$/, "");
  }

  // --- regexes (canonical) --------------------------------------------------

  const HEADING_RE = /^(#{1,6})\s+(.*)$/;
  const HR_RE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
  // Docking flag (item.js / ability.js): yapışık|connect|combine + truthy value.
  const STUCK_RE = /^(yapışık|connect|combine)\s*:\s*(t|true|yes|1)\s*$/;
  const SIDE_RE = /^side\s*:\s*(.+)$/i;
  // Heading-level "Collapsable:" directive (cardCollapse.js markHeadingCollapsable).
  const COLLAPSABLE_RE = /^collaps[ai]ble\s*:\s*(t|f|true|false)?$/i;
  // Universal, cross-card directive lines. Type-specific scalar fields (NPC
  // stats, item Tür/Nadirlik, dialogue topics, …) are intentionally NOT here —
  // they stay in the card body, and each type's renderer interprets them, exactly
  // as the card builders do today. Keeping the core directive set universal avoids
  // leaking type knowledge into the parser.
  const DIRECTIVE_NAMES = new Set([
    "side", "image", "bg", "closed", "textsize", "yapışık", "connect", "combine",
  ]);
  const STUCK_NAMES = new Set(["yapışık", "connect", "combine"]);
  const TRUTHY = new Set(["t", "true", "yes", "1", "evet"]);

  function isHeading(text) { return HEADING_RE.test(text); }
  function isHr(text) { return HR_RE.test(text); }

  // --- classification (canonical; outline.js delegates here) ----------------

  // Heading content (after "## ") -> card type, or "" when the heading is not a
  // card (an event divider / page title / plain section).
  // `level` matters: only Obje/Object/POI render as cards at H2 (obj.js queries
  // h2+h3); every other card type is H3-only.
  // The colon-form types are matched with case-insensitive regex on the RAW
  // heading (exactly like the card builders, e.g. item.js's /^\s*item:/i). Turkish
  // lower() must NOT be applied first — it maps "I"->"ı" (dotless), which turns
  // "Item" into "ıtem" and breaks the match. Only the includes-based checks
  // (npc / skill checks, which the card builders also lower) use lower().
  function cardType(level, content) {
    const raw = String(content).trim();
    if (level === 2) {
      return /^\s*(obje|object|poi)\s*:/i.test(raw) ? "obj" : "";
    }
    if (level !== 3) return "";
    const tl = lower(raw);
    if (tl.includes("skill check")) return "skillchecks";
    if (/^\s*source\s*item\s*:/i.test(raw) || /^\s*sourceitem\s*:/i.test(raw)) return "sourceitem";
    if (/^\s*source\s*enemy\s*:/i.test(raw) || /^\s*sourceenemy\s*:/i.test(raw)) return "sourceenemy";
    if (/^\s*item\s*:/i.test(raw)) return "item";
    if (/^\s*(skill|spell|passive|effect)\s*:/i.test(raw)) return "ability";
    if (/^\s*(obje|object|poi)\s*:/i.test(raw)) return "obj";
    if (/^\s*(sava[şs]|combat)\s*:/i.test(raw)) return "combat";
    if (/^\s*(beklenmedik|unexpected)\s*:/i.test(raw)) return "unexpected";
    if (/^\s*narrative\s*$/i.test(raw)) return "narrative";
    if (/^std\s*:/i.test(raw)) return "std";
    if (tl.includes("npc")) return "npc";
    if (/^\s*(yankı|yanki|echo)\b/i.test(raw)) return "echo";
    return ""; // plain ### section (renders as a normal heading)
  }

  // Card title text (what the renderer shows), used for menus/labels.
  function cardTitle(type, content) {
    const c = String(content).trim();
    switch (type) {
      case "npc": return c.replace(/^\s*npc\s*:\s*/i, "").trim() || "NPC";
      case "sourceitem": return c.replace(/^\s*source\s*item\s*:\s*/i, "").replace(/^\s*sourceitem\s*:\s*/i, "").trim() || "SourceItem";
      case "sourceenemy": return c.replace(/^\s*source\s*enemy\s*:\s*/i, "").replace(/^\s*sourceenemy\s*:\s*/i, "").trim() || "SourceEnemy";
      case "item": return c.replace(/^\s*item\s*:\s*/i, "").trim() || "Item";
      case "ability": return c.replace(/^\s*(skill|spell|passive|effect)\s*:\s*/i, "").trim() || "Ability";
      case "obj": return c.replace(/^\s*(obje|object|poi)\s*:\s*/i, "").trim() || "POI";
      case "combat": return c.replace(/^\s*(sava[şs]|combat)\s*:\s*/i, "").trim() || "Combat";
      case "unexpected": return c.replace(/^\s*(beklenmedik|unexpected)\s*:\s*/i, "").trim() || "Unexpected";
      case "narrative": return "Narrative";
      case "std": return c.replace(/^\s*std\s*:\s*/i, "").trim() || "STD";
      case "skillchecks": return c.trim();
      default: return c.trim();
    }
  }

  // Mirror of layout.js:canDockUnder for model cards (docking rules).
  function canDock(card, host) {
    if (!host) return false;
    if (card.type === "item" && card.stuck) {
      return host.type === "obj" || (host.type === "item" && host.stuck);
    }
    if (card.type === "ability" && card.stuck) {
      return host.type === "item" || host.type === "obj" || (host.type === "ability" && host.stuck);
    }
    return false;
  }

  // --- check / outcome parsing (canonical; cardSchemas.js delegates here) ---

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

  // Raw checks markdown -> entries [{kind:"check",skill,outcomes[]} | {kind:"category",label} | {kind:"raw",text}].
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
        current = { kind: "check", skill: item[1].trim().replace(/:\s*$/, ""), outcomes: [] };
        return;
      }

      const quote = t.match(/^>\s*(.*)$/);
      if (quote) {
        if (!current) { entries.push({ kind: "raw", text: line }); return; }
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

  // A line that ends an embedded "Checks:" block, depending on the card's mode.
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
        segments.push({ kind: "checksBlock", label: active.label, checks: parseChecks(checkLines.join("\n")) });
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

  // --- document AST ---------------------------------------------------------

  // Pre-compute the character offset at the start of each line, so any line span
  // [a, b) maps to exact byte offsets in `raw`.
  function lineOffsets(lines) {
    const offs = new Array(lines.length + 1);
    let acc = 0;
    for (let i = 0; i < lines.length; i++) { offs[i] = acc; acc += lines[i].length; }
    offs[lines.length] = acc;
    return offs;
  }

  // Half-open [startLine, endLine) -> SourceRange with byte offsets.
  function makeRange(offs, startLine, endLine) {
    const lastIdx = offs.length - 1;
    const s = Math.min(startLine, lastIdx);
    const e = Math.min(endLine, lastIdx);
    return { startLine, endLine, startOffset: offs[s], endOffset: offs[e] };
  }

  // Classify one trimmed body line. Returns a directive descriptor, a malformed
  // marker (a known directive word written wrong — kept, never dropped), or null.
  function matchDirective(t) {
    const m = t.match(/^([^:]+):\s*(.*)$/);
    if (m) {
      const name = keywordLower(m[1].trim()).replace(/[\s_-]+/g, "");
      const value = m[2].trim();
      if (DIRECTIVE_NAMES.has(name)) {
        if (name === "textsize") {
          const size = Number(value);
          if (!/^\d+(?:\.\d+)?$/.test(value) || size < 8 || size > 32) return null;
        }
        if (value === "") return { kind: "malformed", reason: "directive missing value" };
        return { kind: "directive", name, rawLabel: m[1].trim(), value };
      }
      return null;
    }
    // No colon at all: a bare known directive word (e.g. "Side R") is malformed.
    const first = keywordLower(t.split(/\s+/)[0] || "");
    if (DIRECTIVE_NAMES.has(first)) return { kind: "malformed", reason: "directive missing colon" };
    return null;
  }

  // Parse a card's body line span into directives / check groups / body / unknown,
  // tracking absolute line indices so every node keeps a precise SourceRange.
  function parseCardBody(lines, offs, type, bodyStart, bodyEnd) {
    const directives = [];
    const checkGroups = [];
    const unknown = [];
    const body = []; // { line, text } in source order (verbatim)

    const mode = type === "npc" || type === "obj" || type === "combat" ? type : "";

    // A Skill Checks card has no "Checks:" label — its whole body is checks.
    if (type === "skillchecks") {
      const captured = [];
      for (let i = bodyStart; i < bodyEnd; i++) {
        const t = lineText(lines[i]).trim();
        const dir = matchDirective(t);
        if (dir && dir.kind === "directive") {
          directives.push({ name: dir.name, rawLabel: dir.rawLabel, value: dir.value, range: makeRange(offs, i, i + 1) });
        } else {
          captured.push(lineText(lines[i]));
        }
      }
      const checks = parseChecks(captured.join("\n"));
      if (checks.length) checkGroups.push({ label: null, range: makeRange(offs, bodyStart, bodyEnd), checks });
      return { directives, checkGroups, body, unknown };
    }

    let i = bodyStart;
    while (i < bodyEnd) {
      const raw = lineText(lines[i]);
      const t = raw.trim();

      if (t === "") { body.push({ line: i, text: raw }); i++; continue; }

      const dir = matchDirective(t);
      if (dir && dir.kind === "directive") {
        directives.push({ name: dir.name, rawLabel: dir.rawLabel, value: dir.value, range: makeRange(offs, i, i + 1) });
        i++;
        continue;
      }
      if (dir && dir.kind === "malformed") {
        unknown.push({ kind: "unknown", reason: dir.reason, lines: [raw], range: makeRange(offs, i, i + 1) });
        i++;
        continue;
      }

      // A "Checks:" label opens an embedded check group; capture until the next
      // boundary (another Checks:, a Loot:/topic/combat label, or card end).
      if (CHECK_LABEL_RE.test(t)) {
        const label = t.replace(/:\s*$/, "");
        const start = i;
        let j = i + 1;
        const captured = [];
        while (j < bodyEnd && !isEmbeddedBoundary(lineText(lines[j]), mode)) {
          captured.push(lineText(lines[j]));
          j++;
        }
        checkGroups.push({ label, range: makeRange(offs, start, j), checks: parseChecks(captured.join("\n")) });
        i = j;
        continue;
      }

      body.push({ line: i, text: raw });
      i++;
    }

    return { directives, checkGroups, body, unknown };
  }

  // Build a Card AST node from a heading at `line` whose body runs until `end`.
  function buildCard(lines, offs, line, level, content, end) {
    const type = cardType(level, content);
    const card = {
      kind: "card",
      type,
      title: cardTitle(type, content),
      level,
      column: "left",
      stuck: false,
      directives: [],
      checkGroups: [],
      body: [],
      unknown: [],
      titleRange: makeRange(offs, line, line + 1),
      range: makeRange(offs, line, end),
    };

    const parsed = parseCardBody(lines, offs, type, line + 1, end);
    card.directives = parsed.directives;
    card.checkGroups = parsed.checkGroups;
    card.body = parsed.body;
    card.unknown = parsed.unknown;

    // Column + docking derive from the universal directives.
    card.directives.forEach((d) => {
      if (d.name === "side") card.column = /^r/i.test(d.value) ? "right" : "left";
      if (STUCK_NAMES.has(d.name) && TRUTHY.has(lower(d.value))) card.stuck = true;
    });

    return card;
  }

  // Trim a plain/narrative line span to a tight body (drop outer blank lines)
  // and return the kept source line texts, or null if nothing remains.
  function spanLines(lines, start, end) {
    let s = start;
    let e = end;
    while (s < e && lineText(lines[s]).trim() === "") s++;
    while (e > s && lineText(lines[e - 1]).trim() === "") e--;
    if (e <= s) return null;
    const out = [];
    for (let i = s; i < e; i++) out.push(lineText(lines[i]));
    return { start: s, end: e, lines: out };
  }

  // Emit ordered narrative / plain blocks for the [start, end) gap between cards
  // inside a section. A run of "> …" lines becomes a NarrativeBlock; any other
  // non-blank run becomes a PlainBlock. Blank-only gaps emit nothing.
  // A standalone heading-level "Collapsable: T/F" line is pulled out and recorded
  // on the section (it is not card content); it breaks the surrounding run.
  function emitGapBlocks(lines, offs, start, end, section) {
    const blocks = section.blocks;
    let i = start;
    while (i < end) {
      const cur = lineText(lines[i]);
      if (cur.trim() === "") { i++; continue; }
      const cm = cur.trim().match(COLLAPSABLE_RE);
      if (cm) {
        section.collapsable = /^(f|false)$/i.test(cm[1] || "") ? false : true;
        i++;
        continue;
      }
      const isQuote = /^\s*>/.test(cur);
      const runStart = i;
      while (i < end) {
        const txt = lineText(lines[i]);
        if (txt.trim() === "") break;
        if (txt.trim().match(COLLAPSABLE_RE)) break;
        if (/^\s*>/.test(txt) !== isQuote) break;
        i++;
      }
      const span = spanLines(lines, runStart, i);
      if (!span) continue;
      blocks.push({
        kind: isQuote ? "narrative" : "plain",
        lines: span.lines,
        range: makeRange(offs, span.start, span.end),
      });
    }
  }

  // --- main entry -----------------------------------------------------------

  function parseRendScroll(md) {
    md = md == null ? "" : String(md);
    const lines = splitLines(md);
    const eol = md.includes("\r\n") ? "\r\n" : "\n";
    const offs = lineOffsets(lines);

    // Pass 1: record headings + HRs as boundaries.
    const headings = []; // { line, level, content }
    const boundaries = [];
    for (let i = 0; i < lines.length; i++) {
      const text = lineText(lines[i]);
      const hm = text.match(HEADING_RE);
      if (hm) { headings.push({ line: i, level: hm[1].length, content: hm[2] }); boundaries.push(i); }
      else if (isHr(text)) boundaries.push(i);
    }
    function nextBoundary(after) {
      for (const b of boundaries) if (b > after) return b;
      return lines.length;
    }

    // Pass 2: group into sections (header band + events) and attach blocks in
    // source order. Mirrors layout.js / outline.js region rules.
    const sections = [];
    let title = "";
    let titleTaken = false;
    let cur = {
      kind: "header", full: false, level: 0, title: "",
      collapsable: null, headingRange: null, start: 0, blocks: [],
    };
    let lastFilled = 0; // first line not yet emitted as a gap block

    function flushGap(upto) {
      emitGapBlocks(lines, offs, lastFilled, upto, cur);
      lastFilled = upto;
    }
    function closeSection(endLine) {
      flushGap(endLine);
      cur.range = makeRange(offs, cur.start, endLine);
      sections.push(cur);
    }

    for (const h of headings) {
      const type = cardType(h.level, h.content);
      if (type) {
        // A card heading (H3 card, or an H2 Obje) belongs to the current section.
        flushGap(h.line);
        const end = nextBoundary(h.line);
        cur.blocks.push(buildCard(lines, offs, h.line, h.level, h.content, end));
        lastFilled = end;
        continue;
      }

      // Page title: the first H1 in the header band.
      if (h.level === 1 && cur.kind === "header" && !titleTaken) {
        flushGap(h.line);
        title = h.content.trim();
        cur.title = title;
        cur.level = 1;
        cur.headingRange = makeRange(offs, h.line, h.line + 1);
        titleTaken = true;
        lastFilled = h.line + 1;
        continue;
      }

      // Otherwise this heading opens a new event section.
      closeSection(h.line);
      cur = {
        kind: "event",
        full: h.level === 1, // H1 after the header -> full-width section (layout.js)
        level: h.level,
        title: h.content.trim(),
        collapsable: null,
        headingRange: makeRange(offs, h.line, h.line + 1),
        start: h.line,
        blocks: [],
      };
      lastFilled = h.line + 1;
    }
    closeSection(lines.length);

    return { raw: md, lines, eol, title, sections };
  }

  // --- debug viewer (task 7, dev-only) --------------------------------------

  // Pretty JSON of the AST with offsets elided to keep it readable. Used to
  // eyeball the parse without touching rendering.
  function debugDump(doc) {
    function trimRange(r) {
      return r ? { startLine: r.startLine, endLine: r.endLine } : null;
    }
    const view = {
      title: doc.title,
      eol: doc.eol === "\r\n" ? "CRLF" : "LF",
      sections: doc.sections.map((s) => ({
        kind: s.kind,
        full: s.full,
        level: s.level,
        title: s.title,
        collapsable: s.collapsable,
        range: trimRange(s.range),
        blocks: s.blocks.map((b) => {
          if (b.kind === "card") {
            return {
              kind: "card",
              type: b.type,
              title: b.title,
              column: b.column,
              stuck: b.stuck,
              range: trimRange(b.range),
              directives: b.directives.map((d) => ({ name: d.name, value: d.value, range: trimRange(d.range) })),
              checkGroups: b.checkGroups.map((g) => ({ label: g.label, checks: g.checks, range: trimRange(g.range) })),
              body: b.body.map((l) => l.text),
              unknown: b.unknown.map((u) => ({ reason: u.reason, lines: u.lines, range: trimRange(u.range) })),
            };
          }
          return { kind: b.kind, lines: b.lines, range: trimRange(b.range) };
        }),
      })),
    };
    return JSON.stringify(view, null, 2);
  }

  return {
    parseRendScroll,
    debugDump,
    // Canonical primitives reused by editor/outline.js and editor/cardSchemas.js.
    lower,
    splitLines,
    lineText,
    cardType,
    cardTitle,
    canDock,
    parseChecks,
    serializeChecks,
    parseOutcome,
    serializeOutcome,
    parseLinesWithChecks,
    serializeLinesWithChecks,
    isEmbeddedBoundary,
    ensureColon,
    trimOuterBlankLines,
    regexes: { HEADING_RE, HR_RE, STUCK_RE, SIDE_RE, COLLAPSABLE_RE, CHECK_LABEL_RE, NPC_TOPIC_RE, COMBAT_LABEL_RE },
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = RendScrollParser;
