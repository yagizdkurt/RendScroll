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
