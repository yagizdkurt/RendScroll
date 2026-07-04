"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..");
const DRAFT_KEY = "rendscroll-draft:edit-manifest:campaigns/Test/scenes/1.md";

function loadHarness() {
  const dom = new JSDOM("<!DOCTYPE html><body></body>", {
    runScripts: "dangerously",
    url: "http://localhost/",
  });
  const win = dom.window;
  win.requestAnimationFrame = (fn) => fn();
  win.alert = (msg) => { throw new Error(msg); };
  win.currentPath = "";
  win.load = async (p) => { win.__loaded = p; };
  win.fetchMarkdown = async () => "# Scene\n";
  win.EditorSchemas = {
    get(type) {
      assert.equal(type, "manifest");
      return { type };
    },
    parse() {
      return {
        duration: "10 min",
        summary: "Saved summary",
        goals: [],
        keyNpcs: [],
        rewards: [],
      };
    },
    serialize(schema, values) {
      const lines = ["### Manifest"];
      if (values.duration) lines.push("Duration: " + values.duration);
      if (values.summary) lines.push("Summary: " + values.summary);
      return lines.join("\n") + "\n";
    },
  };
  win.EditorOutline = {
    parse() {
      return { events: [{ headingStart: 0, cards: [] }] };
    },
    cardSource() {
      return "### Manifest\nSummary: Saved summary\n";
    },
    insertAtLine(model, line, block) {
      win.__insert = { line, block };
      return { raw: "# Scene\n" + block };
    },
    replaceCard(model, card, block) {
      return { raw: block };
    },
    deleteCard() {
      return { raw: "# Scene\n" };
    },
    serialize(model) {
      return model.raw;
    },
  };
  win.EditorSave = {
    save: async (p, text) => { win.__saved = { path: p, text }; },
  };

  const script = win.document.createElement("script");
  script.textContent = fs.readFileSync(path.join(ROOT, "src", "app", "appModals.js"), "utf8") +
    "\nwindow.__openEditManifestDialog = openEditManifestDialog;\n";
  win.document.body.appendChild(script);
  return { win };
}

function clickButton(win, label) {
  const btn = [...win.document.querySelectorAll("button")]
    .find((b) => b.textContent.trim() === label);
  assert.ok(btn, "expected button " + label);
  btn.click();
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test("edit manifest caches typed draft by scene path and restores it on reopen", async () => {
  const { win } = loadHarness();
  const entry = { path: "campaigns/Test/scenes/1.md" };

  await win.__openEditManifestDialog(entry);
  const summary = win.document.getElementById("manifest-summary");
  summary.value = "Draft summary";
  summary.dispatchEvent(new win.Event("input", { bubbles: true }));
  clickButton(win, "Cancel");

  assert.equal(JSON.parse(win.localStorage.getItem(DRAFT_KEY)).summary, "Draft summary");

  await win.__openEditManifestDialog(entry);
  assert.equal(win.document.getElementById("manifest-summary").value, "Draft summary");
});

test("edit manifest save clears the cached draft", async () => {
  const { win } = loadHarness();
  const entry = { path: "campaigns/Test/scenes/1.md" };
  win.localStorage.setItem(DRAFT_KEY, JSON.stringify({
    duration: "",
    summary: "Draft summary",
    goals: [],
    keyNpcs: [],
    rewards: [],
  }));

  await win.__openEditManifestDialog(entry);
  win.document.querySelector("form").dispatchEvent(new win.Event("submit", {
    bubbles: true,
    cancelable: true,
  }));
  await flush();

  assert.equal(win.__insert.line, 1);
  assert.match(win.__saved.text, /Summary: Draft summary/);
  assert.equal(win.localStorage.getItem(DRAFT_KEY), null);
});

test("opening and canceling an unchanged manifest does not create a draft", async () => {
  const { win } = loadHarness();
  const entry = { path: "campaigns/Test/scenes/1.md" };

  await win.__openEditManifestDialog(entry);
  clickButton(win, "Cancel");

  assert.equal(win.localStorage.getItem(DRAFT_KEY), null);
});
