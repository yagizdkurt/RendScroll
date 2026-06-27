/* Outline model: the editor's single source of truth.

   Parses a scene's RAW markdown into a structural model (header band + events,
   each holding ordered cards with their source line ranges, type, default
   column, and docking flag) WITHOUT ever losing a byte. serialize() returns the
   exact original text, so saving an unedited scene is a guaranteed no-op.

   All edit operations are string splices over the original text followed by a
   re-parse — we never reconstruct markdown from a lossy tree.

   Classification mirrors the cards exactly (src/cards/<type>/*.js) so the
   model agrees with what actually gets drawn:
     - column: layout.js:layoutIsAside (left default + the "Side: R" override)
     - types : each renderer's heading regex
     - docked: item.js / ability.js "Yapışık:|Connect: T" flag
   Knows nothing about the DOM or the sidebar. */

const EditorOutline = (() => {
  // The canonical RendScroll parser owns classification + the line primitives.
  // Browser: global `RendScrollParser` (loaded before this file). Node: require.
  const RSP = (typeof RendScrollParser !== "undefined")
    ? RendScrollParser
    : require("../parser/rendscrollParser.js");

  // Classification + line primitives are delegated to the shared core so the
  // editor model and the renderer agree by construction (single source of truth).
  const lower = RSP.lower;
  const splitLines = RSP.splitLines;
  const lineText = RSP.lineText;
  const cardType = RSP.cardType;
  const cardTitle = RSP.cardTitle;
  const canDock = RSP.canDock;

  const HEADING_RE = RSP.regexes.HEADING_RE;
  const HR_RE = RSP.regexes.HR_RE;
  const STUCK_RE = RSP.regexes.STUCK_RE;
  const SIDE_RE = RSP.regexes.SIDE_RE;

  function isHeading(text) {
    return HEADING_RE.test(text);
  }
  function isHr(text) {
    return HR_RE.test(text);
  }

  // Every card renders in the left column by default; a "Side: R" line in the
  // body (scanned where the card is built) moves it to the right.
  function defaultColumn(type, content) {
    return "left";
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
          column: defaultColumn(type, content),
          stuck: false,
          start: h.line,
          titleLine: h.line,
          end,
        };
        // Scan the card body for the docking flag ("Yapışık:|Connect: T") and a
        // "Side: R" column override (default stays left).
        for (let j = h.line + 1; j < end; j++) {
          const bt = lineText(lines[j]).trim();
          if (STUCK_RE.test(lower(bt))) card.stuck = true;
          const sm = bt.match(SIDE_RE);
          if (sm) card.column = /^r/i.test(sm[1].trim()) ? "right" : "left";
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

    return { raw: md, lines, eol, events, boundaries, hrLines, plainBlocks };
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

  function cardHrGroup(model, ev, card) {
    const hrs = (model.hrLines || []).filter((h) => h > ev.start && h < ev.end);
    let key = 0;
    for (const h of hrs) if (h < card.start) key++;
    return ev.cards.filter((c) => {
      let ck = 0;
      for (const h of hrs) if (h < c.start) ck++;
      return ck === key;
    });
  }

  // Return the visual dock stack that contains `id`: root host plus every
  // immediately docked descendant in the same event/<hr> group.
  function connectedCardGroup(model, id) {
    const found = findCard(model, id);
    if (!found) return null;
    const siblings = cardHrGroup(model, found.event, found.card);
    const at = siblings.findIndex((c) => c.id === id);
    if (at < 0) return null;

    let first = at;
    while (first > 0 && canDock(siblings[first], siblings[first - 1])) first--;

    let last = at;
    if (first < at) last = at;
    for (let i = Math.max(first, at); i + 1 < siblings.length; i++) {
      if (!canDock(siblings[i + 1], siblings[i])) break;
      last = i + 1;
    }
    // When the dragged card was a child, include the root's full descendant chain.
    if (first < at) {
      last = first;
      for (let i = first; i + 1 < siblings.length; i++) {
        if (!canDock(siblings[i + 1], siblings[i])) break;
        last = i + 1;
      }
    }

    const cards = siblings.slice(first, last + 1);
    return {
      event: found.event,
      root: cards[0],
      cards,
      ids: cards.map((c) => c.id),
      start: cards[0].start,
      end: cards[cards.length - 1].end,
    };
  }

  function lineEnding(line, fallback) {
    const m = String(line || "").match(/(\r?\n)$/);
    return m ? m[1] : fallback;
  }

  function rewriteRootColumn(model, groupText, group, column) {
    if (column !== "left" && column !== "right") return groupText;
    const lines = splitLines(groupText);
    const rootLineCount = group.root.end - group.start;
    if (!lines.length || rootLineCount <= 0) return groupText;

    const out = [];
    let wroteSide = false;
    for (let i = 0; i < lines.length; i++) {
      const inRootBody = i > 0 && i < rootLineCount;
      if (inRootBody && SIDE_RE.test(lineText(lines[i]).trim())) {
        if (column === "right" && !wroteSide) {
          out.push("Side: R" + lineEnding(lines[i], model.eol));
          wroteSide = true;
        }
        continue;
      }
      out.push(lines[i]);
      if (i === 0 && column === "right" && !wroteSide) {
        out.push("Side: R" + model.eol);
        wroteSide = true;
      }
    }
    return out.join("");
  }

  function rewriteBlockColumn(model, blockText, column) {
    if (column !== "left" && column !== "right") return blockText;
    const lines = splitLines(String(blockText || ""));
    if (!lines.length) return blockText;

    const hm = lineText(lines[0]).match(HEADING_RE);
    if (!hm || !cardType(hm[1].length, hm[2])) return blockText;

    const out = [lines[0]];
    let wroteSide = false;
    for (let i = 1; i < lines.length; i++) {
      const text = lineText(lines[i]).trim();
      if (HEADING_RE.test(lineText(lines[i]))) {
        out.push(lines[i]);
        continue;
      }
      if (SIDE_RE.test(text)) {
        if (column === "right" && !wroteSide) {
          out.push("Side: R" + lineEnding(lines[i], model.eol));
          wroteSide = true;
        }
        continue;
      }
      if (column === "right" && !wroteSide && text !== "") {
        out.push("Side: R" + model.eol);
        wroteSide = true;
      }
      out.push(lines[i]);
    }
    if (column === "right" && !wroteSide) out.push("Side: R" + model.eol);
    return out.join("");
  }

  function eventInsertLine(ev) {
    if (!ev) return 0;
    if (ev.cards && ev.cards.length) return ev.cards[ev.cards.length - 1].end;
    return ev.end;
  }

  function dropLine(model, target) {
    if (!target) return null;
    if (target.beforeCardId != null) {
      const found = findCard(model, target.beforeCardId);
      return found ? found.card.start : null;
    }
    if (target.afterCardId != null) {
      const found = findCard(model, target.afterCardId);
      return found ? found.card.end : null;
    }
    if (target.eventRef) return eventInsertLine(target.eventRef);
    return null;
  }

  function sameIds(a, b) {
    return String(a) === String(b);
  }

  function targetTouchesGroup(target, group) {
    if (!target || !group) return false;
    return group.ids.some((id) =>
      sameIds(id, target.beforeCardId) || sameIds(id, target.afterCardId)
    );
  }

  function moveCardGroup(model, id, target) {
    const group = connectedCardGroup(model, id);
    if (!group) return model;

    const lineIndex = dropLine(model, target);
    if (lineIndex == null) return model;

    const requestedColumn = target && (target.column === "left" || target.column === "right")
      ? target.column
      : null;
    const rawGroupText = model.raw.slice(offsetOf(model, group.start), offsetOf(model, group.end));
    const groupText = rewriteRootColumn(model, rawGroupText, group, requestedColumn);

    if (lineIndex >= group.start && lineIndex <= group.end) {
      if (!requestedColumn || requestedColumn === group.root.column) return model;
      return spliceText(model, group.start, group.end, frameBlock(model, groupText));
    }
    if (targetTouchesGroup(target, group)) return model;

    const cutStart = offsetOf(model, group.start);
    const cutEnd = offsetOf(model, group.end);
    const without = model.raw.slice(0, cutStart) + model.raw.slice(cutEnd);
    const cutModel = parse(without);
    const adjustedLine = lineIndex > group.end ? lineIndex - (group.end - group.start) : lineIndex;
    return insertAtLine(cutModel, adjustedLine, groupText);
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
    cardSource,
    plainBlockSource,
    replacePlainBlock,
    chapterBlock,
    connectedCardGroup,
    moveCardGroup,
    rewriteBlockColumn,
    // exposed for anchors.js / tests
    _internals: { cardType, defaultColumn, lower, splitLines, canDock },
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = EditorOutline;
