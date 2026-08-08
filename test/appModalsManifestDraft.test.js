"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..");
const DRAFT_KEY = "rendscroll-draft:edit-manifest:campaigns/Test/scenes/1.md";

// The real modules the manifest dialogs read/write through. Loading these (rather
// than faking them) is the point: the dialog is a READER feature and must work with
// the editor layer absent — no Editor* global is defined in this window.
const SCRIPTS = [
  "src/utils/text.js",
  "src/parser/rendscrollParser.js",
  "src/cards/shared/cardDirectives.js",
  "src/cards/manifest/manifest.js",
  "src/app/sceneManifest.js",
  "src/app/readerState.js",
];

function loadHarness(sceneText) {
  const dom = new JSDOM("<!DOCTYPE html><body></body>", {
    runScripts: "dangerously",
    url: "http://localhost/",
  });
  const win = dom.window;
  win.requestAnimationFrame = (fn) => fn();
  win.alert = (msg) => { throw new Error(msg); };
  win.load = async (p) => { win.__loaded = p; };
  win.fetchMarkdown = async () => (sceneText === undefined ? "# Scene\n" : sceneText);
  // The only stub: we assert what would be written, without touching the network.
  win.SceneSave = {
    save: async (p, text) => { win.__saved = { path: p, text }; },
  };

  const add = (code) => {
    const el = win.document.createElement("script");
    el.textContent = code;
    win.document.body.appendChild(el);
  };
  SCRIPTS.forEach((rel) => add(fs.readFileSync(path.join(ROOT, rel), "utf8")));
  add(fs.readFileSync(path.join(ROOT, "src", "app", "appModals.js"), "utf8") +
    "\nwindow.__openEditManifestDialog = openEditManifestDialog;\n");
  return { win };
}

// The reader must not reach into the editor layer for its own dialogs (see
// MODULARITY_REPORT.md B3). Guards the regression directly at the source.
test("appModals.js references no editor-layer global", () => {
  const src = fs.readFileSync(path.join(ROOT, "src", "app", "appModals.js"), "utf8");
  const hits = [...src.matchAll(/\bEditor[A-Z]\w*/g)].map((m) => m[0]);
  assert.deepEqual([...new Set(hits)], [], "appModals.js must stay free of Editor* globals");
});

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

  // Written through the real SceneManifest: inserted under the "# Scene" header.
  assert.equal(win.__saved.path, "campaigns/Test/scenes/1.md");
  assert.equal(win.__saved.text, "# Scene\n\n### Manifest\nSummary: Draft summary\n\n");
  assert.equal(win.localStorage.getItem(DRAFT_KEY), null);
});

test("opening and canceling an unchanged manifest does not create a draft", async () => {
  const { win } = loadHarness();
  const entry = { path: "campaigns/Test/scenes/1.md" };

  await win.__openEditManifestDialog(entry);
  clickButton(win, "Cancel");

  assert.equal(win.localStorage.getItem(DRAFT_KEY), null);
});

test("an existing manifest prefills the form and is replaced in place on save", async () => {
  const scene = "# Scene\n\n### Manifest\nDuration: 10 min\nSummary: Saved summary\n\n## Event\n\nBody.\n";
  const { win } = loadHarness(scene);
  const entry = { path: "campaigns/Test/scenes/1.md" };

  await win.__openEditManifestDialog(entry);
  assert.equal(win.document.getElementById("manifest-duration").value, "10 min");
  assert.equal(win.document.getElementById("manifest-summary").value, "Saved summary");

  const summary = win.document.getElementById("manifest-summary");
  summary.value = "Rewritten";
  summary.dispatchEvent(new win.Event("input", { bubbles: true }));
  win.document.querySelector("form").dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
  await flush();

  assert.equal(
    win.__saved.text,
    "# Scene\n\n### Manifest\nDuration: 10 min\nSummary: Rewritten\n\n## Event\n\nBody.\n");
});

test("clearing every field removes the manifest block from the scene", async () => {
  const scene = "# Scene\n\n### Manifest\nDuration: 10 min\nSummary: Saved summary\n\n## Event\n\nBody.\n";
  const { win } = loadHarness(scene);
  const entry = { path: "campaigns/Test/scenes/1.md" };

  await win.__openEditManifestDialog(entry);
  ["manifest-duration", "manifest-summary"].forEach((id) => {
    const el = win.document.getElementById(id);
    el.value = "";
    el.dispatchEvent(new win.Event("input", { bubbles: true }));
  });
  win.document.querySelector("form").dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
  await flush();

  assert.equal(win.__saved.text, "# Scene\n\n## Event\n\nBody.\n");
});
