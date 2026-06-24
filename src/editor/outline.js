/* Outline model: the editor's single source of truth.

   Parses a scene's RAW markdown into a structural model (header band + events,
   each holding ordered cards with their source line ranges, type, default
   column, and docking flag) WITHOUT ever losing a byte. serialize() returns the
   exact original text, so saving an unedited scene is a guaranteed no-op.

   All edit operations are string splices over the original text followed by a
   re-parse — we never reconstruct markdown from a lossy tree.

   Classification mirrors the renderers exactly (src/renderers/*.js) so the
   model agrees with what actually gets drawn:
     - column: layout.js:layoutIsAside + the "_" column prefix/override
     - types : each renderer's heading regex
     - docked: item.js / ability.js "Yapışık:|Connect: T" flag
   Knows nothing about the DOM or the sidebar. */

const EditorOutline = (() => {
  // Turkish-aware lowercase (İ/I), matching every renderer's *Lower().
  function lower(s) {
    return s.replace(/İ/g, "i").replace(/I/g, "ı").toLowerCase();
  }

  // Split into lines that each KEEP their trailing newline, so join("") is the
  // exact original (handles mixed LF / CRLF across files).
  function splitLines(md) {
    if (md === "") return [];
    return md.match(/[^\n]*\n|[^\n]+$/g) || [];
  }

  // Strip the trailing line break from a stored line for pattern testing.
  function lineText(line) {
    return line.replace(/\r?\n$/, "");
  }

  const HEADING_RE = /^(#{1,6})\s+(.*)$/;
  const HR_RE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
  // item.js / ability.js: stuck if label yapışık|connect and value t|true.
  const STUCK_RE = /^(yapışık|connect)\s*:\s*(t|true)\s*$/;

  function isHeading(text) {
    return HEADING_RE.test(text);
  }
  function isHr(text) {
    return HR_RE.test(text);
  }

  // Heading content (after "## ") -> card type, or "" when the heading is not a
  // card (it is then an event divider / page title / plain section).
  // `level` matters: only Obje/Object/POI render as cards at H2 (obj.js queries
  // h2+h3); every other card type is H3-only.
  // IMPORTANT: the colon-form types are matched with case-insensitive regex on
  // the RAW heading (exactly like the renderers, e.g. item.js's /^_?\s*item:/i).
  // Turkish lower() must NOT be applied first — it maps "I"->"ı" (dotless), which
  // turns "Item" into "ıtem" and breaks the match. Only the includes-based checks
  // (npc / skill checks, which the renderers also do on lowered text) use lower().
  function cardType(level, content) {
    const raw = content.trim();
    if (level === 2) {
      return /^_?\s*(obje|object|poi)\s*:/i.test(raw) ? "obj" : "";
    }
    if (level !== 3) return "";
    const tl = lower(raw);
    if (tl.includes("skill check")) return "skillchecks";
    if (/^_?\s*item\s*:/i.test(raw)) return "item";
    if (/^_?\s*(skill|spell|passive|effect)\s*:/i.test(raw)) return "ability";
    if (/^_?\s*(obje|object|poi)\s*:/i.test(raw)) return "obj";
    if (/^_?\s*sava[şs]\s*:/i.test(raw)) return "combat";
    if (/^_?\s*(beklenmedik|unexpected)\s*:/i.test(raw)) return "unexpected";
    if (/^_?std\s*:/i.test(raw)) return "std";
    if (tl.includes("npc")) return "npc";
    if (/^_?\s*(yankı|yanki|echo)\b/i.test(raw)) return "echo";
    return ""; // plain ### section (renders as a normal heading)
  }

  function hasUnderscore(content) {
    return /^_/.test(content.trimStart());
  }

  // Default column before docking is considered. Mirrors layoutIsAside():
  // npc/ability/skillchecks are always right; item defaults right but "_item"
  // swaps left; obj/combat/unexpected/std go right only with the "_" prefix.
  function defaultColumn(type, content) {
    if (type === "item") {
      return hasUnderscore(content) ? "left" : "right";
    }
    if (type === "npc" || type === "ability" || type === "skillchecks") {
      return "right";
    }
    if (type === "obj" || type === "combat" || type === "unexpected" || type === "std") {
      return hasUnderscore(content) ? "right" : "left";
    }
    return "left";
  }

  // Card title text (what the renderer shows), used for menus/labels.
  function cardTitle(type, content) {
    const c = content.trim();
    switch (type) {
      case "npc": return c.replace(/^_?\s*npc\s*:\s*/i, "").trim() || "NPC";
      case "item": return c.replace(/^_?\s*item\s*:\s*/i, "").trim() || "Item";
      case "ability": return c.replace(/^_?\s*(skill|spell|passive|effect)\s*:\s*/i, "").trim() || "Ability";
      case "obj": return c.replace(/^_?\s*(obje|object|poi)\s*:\s*/i, "").trim() || "POI";
      case "combat": return c.replace(/^_?\s*sava[şs]\s*:\s*/i, "").trim() || "Savaş";
      case "unexpected": return c.replace(/^_?\s*(beklenmedik|unexpected)\s*:\s*/i, "").trim() || "Unexpected";
      case "std": return c.replace(/^_?\s*std\s*:\s*/i, "").trim() || "STD";
      case "skillchecks": return c.trim();
      default: return c.replace(/^_\s*/, "").trim();
    }
  }

  // --- Parse ---------------------------------------------------------------

  function parse(md) {
    const lines = splitLines(md);
    const eol = md.includes("\r\n") ? "\r\n" : "\n";

    // Pass 1: record every heading / HR line as a boundary, and collect cards
    // with their start line. Card end is filled from the boundary list after.
    const boundaries = []; // line indices that terminate a card body
    const headings = [];   // { line, level, content, type }
    const hrLines = [];    // <hr> line indices (used to split layout rows)
    for (let i = 0; i < lines.length; i++) {
      const text = lineText(lines[i]);
      const hm = text.match(HEADING_RE);
      if (hm) {
        const level = hm[1].length;
        const content = hm[2];
        headings.push({ line: i, level, content, type: cardType(level, content) });
        boundaries.push(i);
      } else if (isHr(text)) {
        boundaries.push(i);
        hrLines.push(i);
      }
    }

    function nextBoundary(after) {
      for (const b of boundaries) if (b > after) return b;
      return lines.length;
    }

    // Pass 2: group into regions (header band + events) and attach cards.
    let cardId = 0;
    let plainId = 0;
    const events = [];
    let cur = { kind: "header", headingStart: -1, title: "", start: 0, end: lines.length, cards: [] };
    let headerTitleTaken = false;

    function closeCur(endLine) {
      cur.end = endLine;
      events.push(cur);
    }

    for (const h of headings) {
      if (h.type) {
        // A card heading (H3 card, or an H2 Obje) — belongs to the current region.
        const end = nextBoundary(h.line);
        const content = h.content;
        const type = h.type;
        const card = {
          id: cardId++,
          type,
          title: cardTitle(type, content),
          level: h.level,
          underscore: hasUnderscore(content),
          column: defaultColumn(type, content),
          stuck: false,
          start: h.line,
          titleLine: h.line,
          end,
        };
        // Docking flag: scan the card body for "Yapışık:|Connect: T".
        for (let j = h.line + 1; j < end; j++) {
          if (STUCK_RE.test(lower(lineText(lines[j])).trim())) { card.stuck = true; break; }
        }
        cur.cards.push(card);
        continue;
      }

      // Non-card heading: page title (first H1 in the header) or an event divider.
      if (h.level === 1 && cur.kind === "header" && cur.headingStart === -1 && !headerTitleTaken) {
        cur.headingStart = h.line;
        cur.title = h.content.trim();
        headerTitleTaken = true;
        continue;
      }

      closeCur(h.line);
      cur = {
        kind: "event",
        // An H1 after the header opens a FULL-WIDTH section (layout.js): its body
        // cards render in a single .grid-full box, not the two-column row. An H2
        // is a normal event with a two-column row.
        full: h.level === 1,
        headingStart: h.line,
        title: h.content.trim(),
        start: h.line,
        end: lines.length,
        cards: [],
      };
    }
    closeCur(lines.length);

    function inCardRange(lineIndex) {
      return events.some((ev) => ev.cards.some((card) => lineIndex >= card.start && lineIndex < card.end));
    }

    // Pass 3: expose editable non-card heading/body blocks. These are leading
    // plain markdown spans only; card ranges remain owned by their card editors.
    const plainBlocks = [];
    events.forEach((ev) => {
      const hasHeading = ev.headingStart >= 0;
      const bodyStart = hasHeading ? ev.headingStart + 1 : ev.start;
      let bodyEnd = ev.end;

      if (ev.cards.length) {
        bodyEnd = Math.min(bodyEnd, ev.cards[0].start);
      }
      for (const h of hrLines) {
        if (h >= bodyStart && h < bodyEnd) {
          // Keep the header scene separator editable with top metadata; for
          // event sections, an HR is a layout boundary rather than intro body.
          if (ev.kind !== "header") bodyEnd = h;
          break;
        }
      }

      if (!hasHeading && bodyEnd <= bodyStart) return;
      plainBlocks.push({
        id: plainId++,
        kind: ev.kind === "header" ? "header" : "section",
        eventKind: ev.kind,
        level: hasHeading ? lineText(lines[ev.headingStart]).match(HEADING_RE)[1].length : 0,
        title: hasHeading ? ev.title : "",
        start: hasHeading ? ev.headingStart : bodyStart,
        headingLine: hasHeading ? ev.headingStart : -1,
        bodyStart,
        bodyEnd,
        end: bodyEnd,
      });
    });

    // Pass 4: editable standalone narrative blocks. These are consecutive
    // blockquote source lines outside structured cards, so they can be edited
    // next to the rendered read-aloud box without taking over card internals.
    const narrativeBlocks = [];
    let narrativeId = 0;
    for (let i = 0; i < lines.length; i++) {
      if (inCardRange(i) || !/^\s*>/.test(lineText(lines[i]))) continue;
      const start = i;
      while (i < lines.length && !inCardRange(i) && /^\s*>/.test(lineText(lines[i]))) i++;
      narrativeBlocks.push({
        id: narrativeId++,
        start,
        end: i,
      });
      i--;
    }

    return { raw: md, lines, eol, events, boundaries, hrLines, plainBlocks, narrativeBlocks };
  }

  // --- Serialize (exact) ---------------------------------------------------

  function serialize(model) {
    return model.lines.join("");
  }

  // --- Edit primitives -----------------------------------------------------

  // Character offset of the start of line `index`.
  function offsetOf(model, index) {
    let off = 0;
    for (let i = 0; i < index && i < model.lines.length; i++) off += model.lines[i].length;
    return off;
  }

  // Replace source lines [startLine, endLine) with `replacement` (a string),
  // then re-parse. Returns a fresh model. The single low-level mutation.
  function spliceText(model, startLine, endLine, replacement) {
    const a = offsetOf(model, startLine);
    const b = offsetOf(model, endLine);
    return parse(model.raw.slice(0, a) + replacement + model.raw.slice(b));
  }

  // The exact source text of a card's block [start, end).
  function cardSource(model, card) {
    const a = offsetOf(model, card.start);
    const b = card.end >= model.lines.length ? model.raw.length : offsetOf(model, card.end);
    return model.raw.slice(a, b);
  }

  function plainBlockSource(model, block) {
    const a = offsetOf(model, block.bodyStart);
    const b = block.bodyEnd >= model.lines.length ? model.raw.length : offsetOf(model, block.bodyEnd);
    return model.raw.slice(a, b);
  }

  function narrativeBlockSource(model, block) {
    const a = offsetOf(model, block.start);
    const b = block.end >= model.lines.length ? model.raw.length : offsetOf(model, block.end);
    return model.raw.slice(a, b);
  }

  // Find a card across all events by id.
  function findCard(model, id) {
    for (const ev of model.events) {
      const c = ev.cards.find((x) => x.id === id);
      if (c) return { event: ev, card: c };
    }
    return null;
  }

  function findPlainBlock(model, id) {
    return (model.plainBlocks || []).find((b) => b.id === id) || null;
  }

  function findNarrativeBlock(model, id) {
    return (model.narrativeBlocks || []).find((b) => b.id === id) || null;
  }

  // Ensure an inserted markdown block is separated from its neighbours by a
  // blank line on each side, using the model's EOL. `block` should be the card's
  // own text (the normalize* passes tolerate single blank-line spacing).
  function frameBlock(model, block) {
    let b = block.replace(/\r?\n/g, model.eol);
    b = b.replace(/(\r?\n)+$/, ""); // trim trailing blank lines
    return b + model.eol + model.eol;
  }

  // Insert a new block at a source line index. Returns a new model. Guarantees a
  // blank line separates the block from preceding content (so a block inserted at
  // EOF, or after a no-trailing-newline file, never glues to the previous line).
  function insertAtLine(model, lineIndex, block) {
    const a = offsetOf(model, lineIndex);
    const before = model.raw.slice(0, a);
    let lead = "";
    if (before.length && !/(\r?\n){2}$/.test(before)) {
      lead = /\r?\n$/.test(before) ? model.eol : model.eol + model.eol;
    }
    return spliceText(model, lineIndex, lineIndex, lead + frameBlock(model, block));
  }

  function replaceCard(model, card, block) {
    return spliceText(model, card.start, card.end, frameBlock(model, block));
  }

  function replacePlainBlock(model, block, values) {
    const title = String(values && values.title != null ? values.title : block.title).trim();
    const requestedLevel = parseInt(values && values.level != null ? values.level : block.level, 10);
    const level = block.kind === "section" && (requestedLevel === 1 || requestedLevel === 2)
      ? requestedLevel
      : block.level;
    const body = String(values && values.body != null ? values.body : "").replace(/\r?\n/g, model.eol);
    let replacement = "";
    if (block.headingLine >= 0) {
      replacement += "#".repeat(level || 1) + " " + title + model.eol;
    }
    if (body) {
      replacement += body;
      if (!replacement.endsWith(model.eol)) replacement += model.eol;
    }
    return spliceText(model, block.start, block.end, replacement);
  }

  function quoteNarrative(text, eol) {
    const raw = String(text || "").replace(/\r?\n/g, "\n").replace(/[ \t\r\n]+$/, "");
    if (!raw) return "";
    return raw.split("\n").map((line) => {
      if (/^\s*>/.test(line)) return line;
      return line ? "> " + line : ">";
    }).join(eol);
  }

  function replaceNarrativeBlock(model, block, text) {
    const quoted = quoteNarrative(text, model.eol);
    const replacement = quoted ? quoted + model.eol : "";
    return spliceText(model, block.start, block.end, replacement);
  }

  function narrativeBlock(text) {
    const quoted = quoteNarrative(text || "New narrative text.", "\n");
    return quoted || "> New narrative text.";
  }

  function chapterBlock(values) {
    const title = String(values && values.title ? values.title : "New Chapter").trim();
    const level = parseInt(values && values.level, 10) === 1 ? 1 : 2;
    return "---\n\n" + "#".repeat(level) + " " + title;
  }

  function deleteCard(model, card) {
    return spliceText(model, card.start, card.end, "");
  }

  return {
    parse,
    serialize,
    spliceText,
    insertAtLine,
    replaceCard,
    deleteCard,
    findCard,
    findPlainBlock,
    findNarrativeBlock,
    cardSource,
    plainBlockSource,
    narrativeBlockSource,
    replacePlainBlock,
    replaceNarrativeBlock,
    narrativeBlock,
    chapterBlock,
    // exposed for anchors.js / tests
    _internals: { cardType, defaultColumn, lower, splitLines },
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = EditorOutline;
