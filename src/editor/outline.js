/* Outline model: the editor's editing view over the canonical parser AST.

   parse() runs the ONE canonical parser (RendScrollParser.parseRendScroll) and
   maps its source-preserving AST into the editor's structural model (header band
   + events, each holding ordered cards with their source line ranges, type,
   column, and docking flag) WITHOUT ever losing a byte. There is no second
   structural parse here — grouping, classification, and the column/stuck
   derivation all come from the AST, so the editor model and the renderer agree
   by construction. serialize() returns the exact original text, so saving an
   unedited scene is a guaranteed no-op.

   All edit operations are string splices over the original text followed by a
   re-parse — we never reconstruct markdown from a lossy tree.

   The model mirrors what actually gets drawn because it IS the render AST:
     - column: parser side-directive derivation (left default + "Side: R")
     - types : the parser's CARD_TYPES manifest / heading classification
     - docked: the parser's Connect:/Combine: directive + TRUTHY derivation
   Knows nothing about the DOM or the sidebar. */

const EditorOutline = (() => {
  // The canonical RendScroll parser owns classification + the line primitives.
  // Browser: global `RendScrollParser` (loaded before this file). Node: require.
  const RSP = (typeof RendScrollParser !== "undefined")
    ? RendScrollParser
    : require("../parser/rendscrollParser.js");

  // Classification + line primitives are delegated to the shared core so the
  // editor model and the renderer agree by construction (single source of truth).
  const splitLines = RSP.splitLines;
  const lineText = RSP.lineText;
  const cardType = RSP.cardType;
  const canDock = RSP.canDock;

  const HEADING_RE = RSP.regexes.HEADING_RE;
  const HR_RE = RSP.regexes.HR_RE;
  const SIDE_RE = RSP.regexes.SIDE_RE;

  function isHr(text) {
    return HR_RE.test(text);
  }

  // --- Parse ---------------------------------------------------------------

  // The editor model is a thin view over the canonical parser AST — the parser
  // owns all structural grouping (header band + events), card classification, and
  // the source-preserving column/stuck derivation (so the editor and renderer
  // agree by construction). Only three extras are mapped on here: per-card ids,
  // the <hr> line list (used to split layout rows / dock groups), and the coarse
  // per-region "leading editable span" plainBlocks (which the AST has no
  // equivalent of). All edit ops remain raw-text splices followed by a re-parse.
  function parse(md) {
    const doc = RSP.parseRendScroll(md);
    const lines = doc.lines;

    // <hr> line indices: the parser records them as internal boundaries but does
    // not expose them, so re-scan the raw lines (an HR scan, not a re-parse).
    const hrLines = [];
    for (let i = 0; i < lines.length; i++) {
      if (isHr(lineText(lines[i]))) hrLines.push(i);
    }

    // Map AST sections -> editor regions, minting document-order card ids. Each
    // card's start/end are the AST range line indices verbatim, so they stay
    // byte-identical to the renderer's data-src-start/data-src-end stamps (the
    // join anchors.js relies on). column/stuck come straight off the AST — no
    // re-scan — which is what fixes the STUCK_RE-vs-TRUTHY drift (e.g. "Connect: yes").
    let cardId = 0;
    const events = doc.sections.map((s) => ({
      kind: s.kind,
      full: !!s.full,
      level: s.level,
      headingStart: s.headingRange ? s.headingRange.startLine : -1,
      title: s.title,
      start: s.start,
      end: s.range.endLine,
      cards: s.blocks
        .filter((b) => b.kind === "card")
        .map((b) => ({
          id: cardId++,
          type: b.type,
          title: b.title,
          level: b.level,
          column: b.column,
          stuck: b.stuck,
          start: b.range.startLine,
          titleLine: b.titleRange.startLine,
          end: b.range.endLine,
        })),
    }));

    // Expose editable non-card heading/body blocks. These are leading plain
    // markdown spans only; card ranges remain owned by their card editors.
    let plainId = 0;
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
        level: hasHeading ? ev.level : 0,
        title: hasHeading ? ev.title : "",
        start: hasHeading ? ev.headingStart : bodyStart,
        headingLine: hasHeading ? ev.headingStart : -1,
        bodyStart,
        bodyEnd,
        end: bodyEnd,
      });
    });

    return { raw: doc.raw, lines, eol: doc.eol, events, hrLines, plainBlocks };
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

  // Find a card by its heading line index. The renderer stamps each card element
  // with data-src-start (the parser AST's range.startLine, which equals the
  // outline card's `start` by construction), so this is the join anchors.js uses
  // to map a rendered card back to the model without replaying layout routing.
  function findCardByStart(model, startLine) {
    for (const ev of model.events) {
      const c = ev.cards.find((x) => x.start === startLine);
      if (c) return { event: ev, card: c };
    }
    return null;
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
    findCardByStart,
    findPlainBlock,
    cardSource,
    plainBlockSource,
    replacePlainBlock,
    chapterBlock,
    connectedCardGroup,
    moveCardGroup,
    rewriteBlockColumn,
    // exposed for anchors.js / tests
    _internals: { cardType, splitLines, canDock },
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = EditorOutline;
