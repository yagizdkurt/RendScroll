"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const EditorForm = require("../src/editor/form.js");
const SkillChecksEditor = require("../src/cards/skillChecks/skillChecks.editor.js");
const SkillRules = require("../src/cards/shared/skillCheckRules.js");
const EditorSchemas = require("../src/editor/cardSchemas.js");

test("EditorForm stores and resolves registered field renderers", () => {
  function renderer() {}

  EditorForm.registerFieldRenderer("unitTestField", renderer);

  assert.equal(EditorForm.getFieldRenderer("unitTestField"), renderer);
  assert.equal(EditorForm.getFieldRenderer("missingField"), null);
});

test("Skill Checks editor registers checks field renderers", () => {
  assert.equal(EditorForm.getFieldRenderer("checks"), SkillChecksEditor.renderChecksField);
  assert.equal(EditorForm.getFieldRenderer("linesWithChecks"), SkillChecksEditor.renderLinesWithChecksField);
});

test("EditorSchemas skill options are derived from shared skill rules", () => {
  assert.deepEqual(EditorSchemas.checkSkillOptions(), SkillRules.skillOptions());
});

test("Skill Checks schema remains registered and round-trips markdown", () => {
  const schema = EditorSchemas.get("skillchecks");
  const values = EditorSchemas.parse(schema, [
    "### Skill Checks",
    "- Investigation:",
    "> 12: A hidden crack in the stone.",
    "",
  ].join("\n"));

  assert.ok(schema);
  assert.deepEqual(values.checks.map((entry) => entry.skill), ["Investigation"]);
  assert.match(EditorSchemas.serialize(schema, values), /^- Investigation:$/m);
});

test("embedded Checks blocks still serialize through linesWithChecks fields", () => {
  ["npc", "obj", "combat"].forEach((type) => {
    const schema = EditorSchemas.get(type);
    const bodyField = schema.fields.find((field) => field.kind === "linesWithChecks");
    const out = EditorSchemas.serialize(schema, {
      title: type + " title",
      column: "left",
      textSize: "",
      body: [
        { kind: "text", text: "> Opening." },
        {
          kind: "checksBlock",
          label: "Checks",
          checks: [
            {
              kind: "check",
              skill: "Investigation",
              outcomes: [{ kind: "dc", dc: "12", text: "Find the clue." }],
            },
          ],
        },
      ],
      enemies: [],
      closed: false,
    });

    assert.equal(bodyField && bodyField.kind, "linesWithChecks");
    assert.match(out, /^Checks:$/m, type);
    assert.match(out, /^- Investigation:$/m, type);
    assert.match(out, /^> 12: Find the clue\.$/m, type);
  });
});
