"use strict";

/* SceneManifest: the reader's own Scene Manifest read/write, straight over the
   parser AST (src/app/sceneManifest.js). It replaced a path that went through the
   editor layer (EditorSchemas + EditorOutline); the golden strings below were
   captured from that old path, so they double as a "the on-disk format did not
   change" guard. Source fidelity is the point: everything outside the manifest's
   own line range must come through byte-for-byte, in the file's own EOL. */

const test = require("node:test");
const assert = require("node:assert/strict");

const SceneManifest = require("../src/app/sceneManifest.js");
const { parseManifestBody, serializeManifestBody } = require("../src/cards/manifest/manifest.js");
const RendScrollParser = require("../src/parser/rendscrollParser.js");

const WITH_MANIFEST =
  "# Gate Scene\n\n### Manifest\nDuration: 5 min\nSummary: old\n\n## Event\n\nBody text.\n";
const WITHOUT_MANIFEST = "# Gate Scene\n\n## Event\n\nBody text.\n";

const VALUES = {
  duration: "20 min",
  summary: "The gate opens",
  goals: ["Find the key", "Escape"],
  keyNpcs: ["Warden"],
  rewards: ["50 gold"],
};
const EMPTY = { duration: "", summary: "", goals: [], keyNpcs: [], rewards: [] };

const BLOCK =
  "### Manifest\n" +
  "Duration: 20 min\n" +
  "Summary: The gate opens\n" +
  "Goals:\n- Find the key\n- Escape\n" +
  "Key NPCs:\n- Warden\n" +
  "Rewards:\n- 50 gold\n";

// --- serialize ------------------------------------------------------------

test("serializeManifestBody emits scalars then labelled lists, in schema order", () => {
  assert.equal(serializeManifestBody(VALUES), BLOCK);
});

test("serializeManifestBody returns '' when every field is blank", () => {
  assert.equal(serializeManifestBody(EMPTY), "");
  assert.equal(serializeManifestBody(null), "");
  assert.equal(serializeManifestBody({ goals: ["", "  "] }), "");
});

test("serializeManifestBody trims values and drops blank list rows", () => {
  assert.equal(
    serializeManifestBody({ duration: "  5 min  ", goals: ["a", "", "  b  "] }),
    "### Manifest\nDuration: 5 min\nGoals:\n- a\n- b\n");
});

test("serialize -> parse round-trips the model", () => {
  const doc = RendScrollParser.parseRendScroll(serializeManifestBody(VALUES));
  assert.deepEqual(parseManifestBody(RendScrollParser.firstCardNode(doc)), VALUES);
});

// --- read -----------------------------------------------------------------

test("read() finds the manifest card and returns the render parser's model", () => {
  const { node, values } = SceneManifest.read(WITH_MANIFEST);
  assert.ok(node);
  assert.equal(node.type, "manifest");
  assert.deepEqual(values, { duration: "5 min", summary: "old", goals: [], keyNpcs: [], rewards: [] });
});

test("read() on a scene with no manifest yields a null node and empty values", () => {
  const { node, values } = SceneManifest.read(WITHOUT_MANIFEST);
  assert.equal(node, null);
  assert.deepEqual(values, EMPTY);
});

// --- apply ----------------------------------------------------------------

test("apply() replaces an existing manifest and leaves the rest byte-identical", () => {
  assert.equal(
    SceneManifest.apply(WITH_MANIFEST, VALUES),
    "# Gate Scene\n\n" + BLOCK + "\n## Event\n\nBody text.\n");
});

test("apply() removes the manifest when every field is cleared", () => {
  assert.equal(SceneManifest.apply(WITH_MANIFEST, EMPTY), WITHOUT_MANIFEST);
});

test("apply() inserts a new manifest under the '# Title' header", () => {
  assert.equal(
    SceneManifest.apply(WITHOUT_MANIFEST, VALUES),
    "# Gate Scene\n\n" + BLOCK + "\n\n## Event\n\nBody text.\n");
});

test("apply() is a no-op when there is nothing on disk and nothing typed", () => {
  assert.equal(SceneManifest.apply(WITHOUT_MANIFEST, EMPTY), WITHOUT_MANIFEST);
});

test("apply() preserves CRLF line endings", () => {
  const crlf = WITH_MANIFEST.replace(/\n/g, "\r\n");
  const replaced = SceneManifest.apply(crlf, VALUES);
  assert.ok(!/[^\r]\n/.test(replaced), "no bare LF may survive in a CRLF file");
  assert.equal(replaced, ("# Gate Scene\n\n" + BLOCK + "\n## Event\n\nBody text.\n").replace(/\n/g, "\r\n"));
  assert.equal(SceneManifest.apply(crlf, EMPTY), WITHOUT_MANIFEST.replace(/\n/g, "\r\n"));
});

test("apply() never glues an inserted block to a file with no trailing newline", () => {
  assert.equal(SceneManifest.apply("# Gate Scene", VALUES), "# Gate Scene\n\n" + BLOCK + "\n");
});

test("apply() inserts at the top when the scene has no '# Title' heading", () => {
  assert.equal(SceneManifest.apply("Loose intro text.\n", VALUES), BLOCK + "\nLoose intro text.\n");
});

test("apply() tolerates empty and nullish source text", () => {
  assert.equal(SceneManifest.apply("", EMPTY), "");
  assert.equal(SceneManifest.apply(null, EMPTY), "");
  assert.equal(SceneManifest.apply("", VALUES), BLOCK + "\n");
});
