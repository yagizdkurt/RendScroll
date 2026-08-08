/* Cross-language guard: RefLibrary's REF_TYPES (JS) and src/server/paths.py's
   LIBRARY_DIRS / CAMPAIGN_LIBRARY_DIRS (Python) both name the on-disk folder for
   each reference kind, and they must agree exactly — RefLibrary fetches from
   those folders, the server writes to them. Nothing else holds them in sync.

   The Python side is split in two on purpose: a kind in LIBRARY_DIRS gets a
   global content/<folder> root (writable + served as a URL root), a kind in
   CAMPAIGN_LIBRARY_DIRS does not. That split must line up with the JS `scope`,
   or a campaign-only kind would quietly grow a global root. */

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const RefLibrary = require("../src/refLibrary.js");

const PATHS_PY = fs.readFileSync(
  path.join(__dirname, "..", "src", "server", "paths.py"), "utf8");

// Parse a `NAME = {"k": "v", ...}` literal out of paths.py, anchored to the start
// of a line so LIBRARY_DIRS does not also match CAMPAIGN_LIBRARY_DIRS.
function pyDict(name) {
  const m = PATHS_PY.match(new RegExp("^" + name + "\\s*=\\s*\\{([^}]*)\\}", "m"));
  assert.ok(m, name + " literal not found in src/server/paths.py");
  const out = {};
  const pairRe = /["']([^"']+)["']\s*:\s*["']([^"']+)["']/g;
  let pair;
  while ((pair = pairRe.exec(m[1]))) out[pair[1]] = pair[2];
  return out;
}

const GLOBAL_DIRS = pyDict("LIBRARY_DIRS");
const CAMPAIGN_DIRS = pyDict("CAMPAIGN_LIBRARY_DIRS");

test("every JS ref kind has a Python folder, and the folders match", () => {
  const py = Object.assign({}, GLOBAL_DIRS, CAMPAIGN_DIRS);
  const js = {};
  for (const [kind, def] of Object.entries(RefLibrary.REF_TYPES)) js[kind] = def.folder;
  assert.deepStrictEqual(py, js,
    "RefLibrary.REF_TYPES folders and the paths.py library dicts must match exactly");
});

test("a kind's JS scope decides which Python dict it belongs to", () => {
  for (const [kind, def] of Object.entries(RefLibrary.REF_TYPES)) {
    if (def.scope === "campaign") {
      assert.ok(kind in CAMPAIGN_DIRS, kind + " is campaign-only, so it belongs in CAMPAIGN_LIBRARY_DIRS");
      assert.ok(!(kind in GLOBAL_DIRS),
        kind + " is campaign-only and must NOT be in LIBRARY_DIRS (that would open a global root)");
    } else {
      assert.ok(kind in GLOBAL_DIRS, kind + " is global-backed, so it belongs in LIBRARY_DIRS");
      assert.ok(!(kind in CAMPAIGN_DIRS), kind + " must not be in both dicts");
    }
  }
});

test("every ref kind declares the behaviour flags the app reads", () => {
  for (const [kind, def] of Object.entries(RefLibrary.REF_TYPES)) {
    assert.ok(def.folder, kind + " needs a folder");
    assert.ok(def.label, kind + " needs a label (sidebar/search wording)");
    assert.ok(def.view, kind + " needs a view name (appLibrary LIBRARY_VIEWS)");
    assert.ok(def.scope === "global" || def.scope === "campaign",
      kind + " scope must be \"global\" or \"campaign\", got " + def.scope);
    assert.equal(typeof def.untypedLink, "boolean",
      kind + " must say whether a bare [link=Name] may resolve to it");
  }
});

test("lore is campaign-only and excluded from untyped [link=] resolution", () => {
  const lore = RefLibrary.REF_TYPES.lore;
  assert.ok(lore, "lore must be registered");
  assert.equal(lore.scope, "campaign");
  assert.equal(lore.untypedLink, false);
  assert.equal(lore.cardType, null, "lore has its own renderer, not a card type");
});
