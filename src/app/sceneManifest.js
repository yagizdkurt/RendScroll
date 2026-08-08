/* Scene Manifest read/write, straight over the parser AST.

   The reader's New Page / Edit Manifest dialogs (app/appModals.js) need to read a
   scene's "### Manifest" card and write it back. They used to do that through the
   editor layer (EditorSchemas + EditorOutline), which made a core reader feature
   depend on an optional, additive layer. Everything needed is already in the
   parser and the manifest card:

     - classification + line ranges  -> RendScrollParser.parseRendScroll
     - the field model               -> parseManifestBody / serializeManifestBody
                                        (cards/manifest/manifest.js — the SAME
                                        functions the render builder uses)

   Only the line splice lived in the editor, and it is a handful of lines here.
   Source fidelity: everything outside the manifest's own line range is copied
   through byte-for-byte (doc.lines.join("") === doc.raw), and the file's EOL is
   preserved. */

const SceneManifest = (() => {
  const RSP = (typeof RendScrollParser !== "undefined")
    ? RendScrollParser
    : require("../parser/rendscrollParser.js");

  // The render pipeline's own manifest parse/serialize, so the dialog and the card
  // never model the fields two ways. In Node, manifest.js reads cardBodySource as a
  // browser global — mirror that the way editor/cardSchemas.js does.
  const CARD = (typeof parseManifestBody !== "undefined")
    ? { parseManifestBody, serializeManifestBody }
    : (() => {
        Object.assign(globalThis, require("../cards/shared/cardDirectives.js"));
        return require("../cards/manifest/manifest.js");
      })();

  function emptyValues() {
    return { duration: "", summary: "", goals: [], keyNpcs: [], rewards: [] };
  }

  // The first "### Manifest" card node in a parsed scene, or null.
  function find(doc) {
    for (const section of doc.sections) {
      for (const block of section.blocks || []) {
        if (block.kind === "card" && block.type === "manifest") return block;
      }
    }
    return null;
  }

  // Scene markdown -> { doc, node, values }. `values` is the empty model when the
  // scene has no manifest, so callers can prefill a form either way.
  function read(text) {
    const doc = RSP.parseRendScroll(String(text == null ? "" : text));
    const node = find(doc);
    return { doc, node, values: node ? CARD.parseManifestBody(node) : emptyValues() };
  }

  // Character offset of the start of line `index` (clamped to the last line).
  function offsetOf(doc, index) {
    let off = 0;
    for (let i = 0; i < index && i < doc.lines.length; i++) off += doc.lines[i].length;
    return off;
  }

  function spliceLines(doc, startLine, endLine, replacement) {
    return doc.raw.slice(0, offsetOf(doc, startLine)) +
      replacement +
      doc.raw.slice(offsetOf(doc, endLine));
  }

  // Separate an inserted block from its neighbours with one blank line on each
  // side, in the file's own EOL.
  function frame(doc, block) {
    return block.replace(/\r?\n/g, doc.eol).replace(/(\r?\n)+$/, "") + doc.eol + doc.eol;
  }

  // Where a new manifest goes: just under the "# Title" header, so the layout pass
  // pins it to the top of the page. Line 0 when the scene has no header heading.
  function insertLine(doc) {
    const header = doc.sections[0];
    return header && header.headingRange ? header.headingRange.startLine + 1 : 0;
  }

  /* Write `values` into a scene's markdown and return the new text:
       manifest present + values non-empty -> replace it
       manifest present + values empty     -> remove it
       manifest absent  + values non-empty -> insert under the "# Title" header
       manifest absent  + values empty     -> unchanged */
  function apply(text, values) {
    const src = String(text == null ? "" : text);
    const { doc, node } = read(src);
    const block = CARD.serializeManifestBody(values);

    if (node) {
      return spliceLines(doc, node.range.startLine, node.range.endLine,
        block ? frame(doc, block) : "");
    }
    if (!block) return src;

    const line = insertLine(doc);
    const before = doc.raw.slice(0, offsetOf(doc, line));
    // Never glue the block to the preceding line (or to a file with no trailing
    // newline); one blank line always separates them.
    let lead = "";
    if (before.length && !/(\r?\n){2}$/.test(before)) {
      lead = /\r?\n$/.test(before) ? doc.eol : doc.eol + doc.eol;
    }
    return spliceLines(doc, line, line, lead + frame(doc, block));
  }

  return { find, read, apply, emptyValues };
})();

if (typeof window !== "undefined") window.SceneManifest = SceneManifest;
if (typeof module !== "undefined" && module.exports) module.exports = SceneManifest;
