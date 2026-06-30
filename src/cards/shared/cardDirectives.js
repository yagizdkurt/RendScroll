/* Shared accessors for reading the parsed RendScroll AST card node inside a
   builder. The parser (src/parser/rendscrollParser.js) already resolves each
   card's universal directives (image / bg / side / size / file / textsize / the
   stuck flags) into `cardNode.directives` and computes `cardNode.column` /
   `cardNode.stuck`. Builders read those here instead of re-sniffing the
   re-rendered DOM. Global (non-module) like the other shared card files.

   A directive value is the trimmed text after the colon; a missing directive
   yields "". Names are the parser's normalized keys (lowercased, separators
   stripped): "image", "bg", "side", "size", "file", "textsize". */

function cardDirective(cardNode, name) {
  if (!cardNode || !cardNode.directives) return "";
  const d = cardNode.directives.find((x) => x.name === name);
  return d ? d.value : "";
}

// True when the card is placed in the right column ("Side: R"). The parser folds
// the Side directive into cardNode.column, so this is the single read for it.
function cardIsRight(cardNode) {
  return !!cardNode && cardNode.column === "right";
}

// The card body as plain source-text lines (verbatim, in order), or [] when the
// card has none. This is what a builder parses for its type-specific fields,
// replacing the old "re-render with marked, then sniff the DOM" round-trip.
function cardBodyLines(cardNode) {
  if (!cardNode || !cardNode.body) return [];
  return cardNode.body.map((b) => b.text);
}

// Render the card body's prose (directives already excluded by the parser)
// through marked and return its top-level element nodes. For directive-only and
// prose cards this replaces the marked-rendered `bodyEls` the builder used to
// sniff: the directive lines are simply not in `cardNode.body`.
function cardBodyElements(cardNode) {
  const md = cardBodyLines(cardNode).join("\n");
  const tmp = document.createElement("div");
  tmp.innerHTML = (typeof renderMarkdown !== "undefined") ? renderMarkdown(md) : md;
  return [...tmp.children];
}

// Merge the card's body text and its parsed check groups back into SOURCE ORDER,
// so a builder can walk a card with interleaved prose and "Checks:" blocks without
// losing their relative position. The parser pulls "Checks:" blocks out of `body`
// into `checkGroups` (each with a SourceRange); this stitches them back together.
// Returns an ordered list of:
//   { kind: "text",   lines: [string] }   consecutive verbatim body lines
//   { kind: "checks", label, checks }      a parsed check group (see parseChecks)
function cardOrderedBody(cardNode) {
  const body = (cardNode && cardNode.body) || [];
  const groups = (cardNode && cardNode.checkGroups) || [];
  const out = [];
  let bi = 0;
  let gi = 0;
  let curText = null;
  const flush = () => { if (curText) { out.push(curText); curText = null; } };
  while (bi < body.length || gi < groups.length) {
    const bLine = bi < body.length ? body[bi].line : Infinity;
    const gLine = gi < groups.length ? groups[gi].range.startLine : Infinity;
    if (gLine < bLine) {
      flush();
      out.push({ kind: "checks", label: groups[gi].label, checks: groups[gi].checks });
      gi++;
    } else {
      if (!curText) curText = { kind: "text", lines: [] };
      curText.lines.push(body[bi].text);
      bi++;
    }
  }
  flush();
  return out;
}

// Reconstruct the card's non-heading source lines (directives + body + any
// malformed/unknown lines) in their original source order. Lets a builder hand a
// faithful text body to an existing text parser (e.g. ItemData.parse) without
// re-rendering through marked. Excludes check groups (consume those structurally
// via cardOrderedBody); cards that have no checks reconstruct fully here.
function cardBodySource(cardNode) {
  if (!cardNode) return "";
  const events = [];
  (cardNode.body || []).forEach((b) => events.push({ line: b.line, text: b.text }));
  (cardNode.directives || []).forEach((d) =>
    events.push({ line: d.range.startLine, text: d.rawLabel + ": " + d.value }));
  (cardNode.unknown || []).forEach((u) =>
    (u.lines || []).forEach((t, k) => events.push({ line: u.range.startLine + k, text: t })));
  events.sort((a, b) => a.line - b.line);
  return events.map((e) => e.text).join("\n");
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    cardDirective, cardIsRight, cardBodyLines, cardBodyElements, cardOrderedBody, cardBodySource,
  };
}
