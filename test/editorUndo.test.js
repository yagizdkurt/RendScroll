"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..");
const EditorOutline = require("../src/editor/outline.js");

function loadEditor() {
  const dom = new JSDOM(
    "<!DOCTYPE html><body><div id=\"topbar-primary\"></div><main id=\"page\"></main></body>",
    { runScripts: "dangerously" }
  );
  const win = dom.window;
  win.EditorOutline = EditorOutline;
  win.EditorAnchors = { decorate() {} };
  win.renderPage = (text) => {
    win.__rendered = text;
    win.__renderCount = (win.__renderCount || 0) + 1;
  };
  win.setTimeout = (fn) => {
    win.__timer = fn;
    return 1;
  };
  win.clearTimeout = () => {};

  // The undo stack, the dirty flag and the toolbar live in the shared document
  // session; editor.js registers the open scene with it.
  ["docSession.js", "editor.js"].forEach((file) => {
    const script = win.document.createElement("script");
    script.textContent = fs.readFileSync(path.join(ROOT, "src", "editor", file), "utf8");
    win.document.body.appendChild(script);
  });
  const expose = win.document.createElement("script");
  expose.textContent = "window.__Editor = Editor;";
  win.document.body.appendChild(expose);
  return { dom, win, Editor: win.__Editor };
}

function loadScene(win, text) {
  win.document.dispatchEvent(new win.CustomEvent("scene:loaded", {
    detail: { path: "campaigns/Test/scenes/1.md", text },
  }));
  // Turn edit mode on the way a user does — through the toolbar toggle.
  const toggle = win.document.querySelector(".editor-toggle");
  if (!toggle.classList.contains("is-on")) toggle.click();
}

function firstCardId(Editor) {
  return Editor.getState().model.events.flatMap((ev) => ev.cards)[0].id;
}

function pressUndo(win, target) {
  const event = new win.KeyboardEvent("keydown", {
    key: "z",
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  (target || win.document).dispatchEvent(event);
  return event;
}

test("Ctrl+Z restores the previous editor model snapshot and rerenders dirty", () => {
  const { win, Editor } = loadEditor();
  const source = "# Scene\n\n## Event\n\n### STD: One\n> body\n";
  loadScene(win, source);

  Editor._handlers.deleteCard(firstCardId(Editor));
  assert.equal(Editor._undoDepth(), 1);
  assert.doesNotMatch(Editor.getState().model.raw, /### STD: One/);

  const beforeUndoRenders = win.__renderCount;
  const event = pressUndo(win);

  assert.equal(event.defaultPrevented, true);
  assert.equal(Editor._undoDepth(), 0);
  assert.equal(Editor.getState().dirty, true);
  assert.match(Editor.getState().model.raw, /### STD: One/);
  assert.ok(win.__renderCount > beforeUndoRenders);
});

test("loading a new scene clears editor undo history", () => {
  const { win, Editor } = loadEditor();
  loadScene(win, "# Scene\n\n## Event\n\n### STD: One\n> body\n");

  Editor._handlers.deleteCard(firstCardId(Editor));
  assert.equal(Editor._undoDepth(), 1);

  loadScene(win, "# Other\n\n## Event\n");

  assert.equal(Editor._undoDepth(), 0);
  assert.equal(Editor._undo(), false);
  assert.equal(Editor.getState().model.raw, "# Other\n\n## Event\n");
});

test("Ctrl+Z in a textarea is left to native field undo", () => {
  const { win, Editor } = loadEditor();
  loadScene(win, "# Scene\n\n## Event\n\n### STD: One\n> body\n");
  Editor._handlers.deleteCard(firstCardId(Editor));

  const textarea = win.document.createElement("textarea");
  win.document.body.appendChild(textarea);
  const event = pressUndo(win, textarea);

  assert.equal(event.defaultPrevented, false);
  assert.equal(Editor._undoDepth(), 1);
  assert.doesNotMatch(Editor.getState().model.raw, /### STD: One/);
});
