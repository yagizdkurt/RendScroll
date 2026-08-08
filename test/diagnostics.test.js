"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

global.RendScrollParser = require("../src/parser/rendscrollParser.js");
global.RendScrollSkillChecks = require("../src/cards/shared/skillCheckRules.js");
const RendScrollDiagnostics = require("../src/debug/diagnostics.js");

test("diagnostics treats asterisk check markers as check entries", () => {
  const parsed = RendScrollDiagnostics.parseScene([
    "### Skill Checks",
    "* Nose:",
    "> 10: The room smells of smoke.",
    "",
  ].join("\n"), "scene.md");

  const issues = RendScrollDiagnostics.computeSceneDiagnostics(parsed.doc, { file: "scene.md" });

  assert.ok(issues.some((issue) =>
    issue.code === "non-standard-check" &&
    issue.message === "non-standard check: Nose"
  ));
});

test("diagnostics accepts save checks and lockpicking as standard checks", () => {
  const parsed = RendScrollDiagnostics.parseScene([
    "# Scene",
    "### Skill Checks",
    "- Wisdom Save:",
    "> 12: Resist the whisper.",
    "- STR Save:",
    "> 15: Hold the gate.",
    "- Lockpicking:",
    "> 14: Open the warded lock.",
    "- Sleight of Hands:",
    "> 14: Open it quietly.",
    "",
  ].join("\n"), "scene.md");

  const issues = RendScrollDiagnostics.computeSceneDiagnostics(parsed.doc, { file: "scene.md" });

  assert.deepEqual(issues.filter((issue) => issue.code === "non-standard-check"), []);
});

test("diagnostics flags empty asset paths and malformed directives (via matchDirective)", () => {
  const parsed = RendScrollDiagnostics.parseScene([
    "### Item: Sword",
    "Image:",
    "Side",
    "Type: Junk",
    "",
  ].join("\n"), "scene.md");

  const issues = RendScrollDiagnostics.computeSceneDiagnostics(parsed.doc, { file: "scene.md" });

  assert.ok(issues.some((i) => i.code === "empty-asset-path" && i.message === "empty image path"),
    "empty Image: should be an empty-asset-path error");
  assert.ok(issues.some((i) => i.code === "malformed-directive" && /Side/.test(i.message)),
    "bare 'Side' (no colon) should warn as a malformed directive");
});

test("diagnostics warns about legacy standalone narrative blockquotes", () => {
  const parsed = RendScrollDiagnostics.parseScene([
    "# Scene",
    "## Event",
    "> Old read-aloud text.",
    "",
    "### Narrative",
    "Text:",
    "> New read-aloud text.",
    "",
  ].join("\n"), "scene.md");

  const issues = RendScrollDiagnostics.computeSceneDiagnostics(parsed.doc, { file: "scene.md" });
  const legacy = issues.filter((issue) => issue.code === "legacy-narrative-block");

  assert.equal(legacy.length, 1);
  assert.equal(legacy[0].line, 3);
});

// --- LoreRef: --------------------------------------------------------------

const LORE_PAGE = [
  "# Lore: The Gate",
  "",
  "## Entry: Ancient God",
  "",
  "Once worshipped beneath the gate.",
  "",
].join("\n");

// The lore half of the library, as diagnostics reads it.
function withLoreLibrary(run) {
  global.RefLibrary = {
    norm: (s) => String(s == null ? "" : s).trim().toLowerCase(),
    lookupAny: () => null,
    lookup(type, name) {
      if (type !== "lore") return null;
      return String(name || "").trim().toLowerCase() === "the gate"
        ? { name: "The Gate", source: LORE_PAGE }
        : null;
    },
  };
  global.LoreModel = require("../src/lore/loreModel.js");
  try { return run(); } finally {
    delete global.RefLibrary;
    delete global.LoreModel;
  }
}

test("several LoreRef: lines are not reported as a duplicate directive", () => {
  const parsed = RendScrollDiagnostics.parseScene([
    "# Scene",
    "### POI: Door",
    "LoreRef: The Gate/Ancient God",
    "LoreRef: The Gate",
    "Image: a.png",
    "Image: b.png",
    "",
  ].join("\n"), "scene.md");

  const issues = withLoreLibrary(() =>
    RendScrollDiagnostics.computeSceneDiagnostics(parsed.doc, { file: "scene.md" }));
  const dupes = issues.filter((i) => i.code === "duplicate-directive");

  assert.deepEqual(dupes.map((i) => i.message), ["duplicate directive: image (x2)"],
    "loreref is repeatable by design; image is not");
});

test("a LoreRef: pointing at a missing page or entry is reported", () => {
  const parsed = RendScrollDiagnostics.parseScene([
    "# Scene",
    "### POI: Door",
    "LoreRef: The Gate/Ancient God",
    "LoreRef: The Gate/Nobody",
    "LoreRef: No Such Page",
    "",
  ].join("\n"), "scene.md");

  const issues = withLoreLibrary(() =>
    RendScrollDiagnostics.computeSceneDiagnostics(parsed.doc, { file: "scene.md" }));
  const broken = issues.filter((i) => i.code === "broken-lore-link");

  assert.equal(broken.length, 2, "only the two unresolvable references are reported");
  assert.match(broken[0].message, /has no entry "Nobody"/);
  assert.equal(broken[0].line, 4);
  assert.match(broken[1].message, /no page "No Such Page"/);
});
