/* Cross-language guard: RefLibrary's REF_TYPES (JS) and launcher.py's LIBRARY_DIRS
   (Python) both name the on-disk folder for each reference kind, and they must
   agree exactly — RefLibrary fetches from those folders, the launcher writes to
   them. Nothing else holds them in sync, so this asserts they do. */

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const RefLibrary = require("../src/refLibrary.js");

// kind -> folder, straight from the JS registry.
function jsFolders() {
  const out = {};
  for (const [kind, def] of Object.entries(RefLibrary.REF_TYPES)) out[kind] = def.folder;
  return out;
}

// kind -> folder, parsed out of the `LIBRARY_DIRS = {...}` literal in launcher.py.
function pyFolders() {
  const src = fs.readFileSync(path.join(__dirname, "..", "launcher.py"), "utf8");
  const m = src.match(/LIBRARY_DIRS\s*=\s*\{([^}]*)\}/);
  assert.ok(m, "LIBRARY_DIRS literal not found in launcher.py");
  const out = {};
  const pairRe = /["']([^"']+)["']\s*:\s*["']([^"']+)["']/g;
  let pair;
  while ((pair = pairRe.exec(m[1]))) out[pair[1]] = pair[2];
  return out;
}

test("REF_TYPES (JS) and LIBRARY_DIRS (Python) name the same kinds and folders", () => {
  assert.deepStrictEqual(
    pyFolders(),
    jsFolders(),
    "RefLibrary.REF_TYPES folders and launcher.py LIBRARY_DIRS must match exactly"
  );
});
