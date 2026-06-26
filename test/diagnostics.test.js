"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

global.RendScrollParser = require("../src/parser/rendscrollParser.js");
global.RendScrollSkillChecks = require("../src/renderers/shared/skillCheckRules.js");
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
