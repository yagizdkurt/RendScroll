"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");

test("reader context menu offers edit mode switch", () => {
  const dom = new JSDOM("<!DOCTYPE html><body></body>");
  const oldWindow = global.window;
  const oldDocument = global.document;
  global.window = dom.window;
  global.document = dom.window.document;

  try {
    delete require.cache[require.resolve("../src/editor/contextMenu.js")];
    const EditorContextMenu = require("../src/editor/contextMenu.js");
    let enabled = false;

    EditorContextMenu.openReader(12, 20, { enableEditor: () => { enabled = true; } });

    const item = dom.window.document.querySelector(".editor-menu-item");
    assert.ok(item);
    assert.equal(item.textContent, "Go to edit mode");

    item.click();
    assert.equal(enabled, true);
    assert.equal(dom.window.document.querySelector(".editor-menu"), null);
  } finally {
    global.window = oldWindow;
    global.document = oldDocument;
  }
});
