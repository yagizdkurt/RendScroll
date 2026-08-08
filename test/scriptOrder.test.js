"use strict";

/* Guard: the <script> ORDER in index.html is load-bearing (browser code is not
   modular — every file attaches a global), and the jsdom harnesses restate a
   subset of that order to boot the reader.

   Nothing used to check that the two agreed. If index.html reordered, renamed,
   or dropped a file, the tests kept validating a load order the app no longer
   used — passing while the real page was broken. That is what this file closes.

   The contract each harness list must satisfy:
     order-preserving SUBSEQUENCE of index.html's <script src> list.
   Subsequence (not equality) because each list is deliberately a subset — the
   card layer without the editor/printer/debug layers, and so on. Order still has
   to match, so a swap in index.html fails here. */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  READER_SCRIPTS,
  CARD_LAYER_SCRIPTS,
  indexHtmlScripts,
  ROOT,
} = require("./helpers/readerDom.js");

const INDEX = indexHtmlScripts();

// Walk both lists once: every entry of `list` must appear in `full`, in order.
// Returns the first entry that breaks the contract, or null.
function firstOutOfOrder(list, full) {
  let cursor = 0;
  for (const entry of list) {
    const at = full.indexOf(entry, cursor);
    if (at < 0) return entry;
    cursor = at + 1;
  }
  return null;
}

const LISTS = [
  ["READER_SCRIPTS", READER_SCRIPTS],
  ["CARD_LAYER_SCRIPTS", CARD_LAYER_SCRIPTS],
];

test("index.html lists some scripts (the parse actually matched)", () => {
  assert.ok(INDEX.length > 20, "expected index.html to list many scripts, got " + INDEX.length);
});

test("every <script src> in index.html exists on disk", () => {
  const missing = INDEX.filter((rel) => !fs.existsSync(path.join(ROOT, rel)));
  assert.deepEqual(missing, [], "index.html references files that do not exist");
});

for (const [name, list] of LISTS) {
  test(name + " is an order-preserving subsequence of index.html", () => {
    const offender = firstOutOfOrder(list, INDEX);
    assert.equal(offender, null,
      offender +
      " is missing from index.html, or comes before a script listed earlier in " +
      name + ". Update the list in test/helpers/readerDom.js to match index.html.");
  });

  test(name + " references only files that exist", () => {
    const missing = list.filter((rel) => !fs.existsSync(path.join(ROOT, rel)));
    assert.deepEqual(missing, [], name + " references files that do not exist");
  });

  test(name + " has no duplicate entries", () => {
    assert.equal(new Set(list).size, list.length, name + " must not list a file twice");
  });
}

test("the harness lists cover every card TYPE builder", () => {
  // A new card type added to index.html but forgotten in the harness lists would
  // silently drop out of every render/registry guard. Catch it here instead.
  // A type builder is src/cards/<type>/<type>.js — support files inside a card
  // folder (enemyModel.js, *.editor.js) and cards/shared/* are opt-in, not types.
  const typeBuilders = INDEX.filter((rel) => {
    const m = /^src\/cards\/([^/]+)\/([^/]+)\.js$/.exec(rel);
    return !!m && m[1] !== "shared" && m[1] === m[2];
  });
  assert.ok(typeBuilders.length > 5, "expected index.html to load several card types");
  for (const [name, list] of LISTS) {
    const missing = typeBuilders.filter((rel) => !list.includes(rel));
    assert.deepEqual(missing, [],
      name + " is missing card type builders that index.html loads");
  }
});
