/* Guard: the editor's universal-directive field labels must stay in lockstep with
   the parser's directive set. The editor serializes these fields as "Label: value"
   body lines; the renderer relies on the PARSER folding them into card.directives.
   If a label drifts so the parser no longer recognizes it, the directive would
   leak into the rendered body as a stray line. This catches that at test time,
   mirroring cardBuilders.test.js's manifest<->registry guard philosophy.

   (Type-specific labels — Tür/Nadirlik/Hasar/… — are owned by the card builders,
   not the parser, so they are intentionally not checked here.) */

const { test } = require("node:test");
const assert = require("node:assert");
const RSP = require("../src/parser/rendscrollParser.js");
const EditorSchemas = require("../src/editor/cardSchemas.js");

// Schema field keys whose "Label: value" line is a UNIVERSAL directive the parser
// owns (not a type-specific scalar). "column" serializes as "Side:" (special).
const DIRECTIVE_KEYS = new Set(["image", "bg", "closed", "stuck", "textSize", "size", "file"]);

function normalize(label) {
  return RSP.keywordLower(label).replace(/[\s_-]+/g, "");
}

test("every universal-directive schema label normalizes to a parser directive", () => {
  const offenders = [];
  EditorSchemas.list().forEach((schema) => {
    (schema.fields || []).forEach((f) => {
      if (!DIRECTIVE_KEYS.has(f.key)) return;
      [f.mdLabel].concat(f.mdAliases || []).filter(Boolean).forEach((label) => {
        if (!RSP.directiveNames.has(normalize(label))) {
          offenders.push(`${schema.type}.${f.key}: "${label}" -> "${normalize(label)}"`);
        }
      });
    });
  });
  assert.strictEqual(offenders.length, 0,
    "schema labels the parser does not recognize as directives:\n  " + offenders.join("\n  "));
});

test("column field serializes as a Side: directive the parser recognizes", () => {
  // The editor writes the right column as "Side: R" (see EditorSchemas.serialize);
  // the parser must fold "side" into a directive.
  assert.ok(RSP.directiveNames.has("side"), "parser must recognize the side directive");
});
