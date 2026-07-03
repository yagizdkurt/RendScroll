"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const RSLog = require("../src/debug/rsLog.js");

test("RSLog stores bounded runtime warnings", (t) => {
  const originalWarn = console.warn;
  console.warn = () => {};
  t.after(() => {
    console.warn = originalWarn;
    RSLog.clear();
  });

  RSLog.clear();
  const entry = RSLog.warn("library", "Could not load bundle.", new Error("HTTP 500"));
  const entries = RSLog.entries();

  assert.equal(entries.length, 1);
  assert.equal(entries[0], entry);
  assert.equal(entries[0].level, "warn");
  assert.equal(entries[0].area, "library");
  assert.match(entries[0].message, /bundle/);
  assert.match(entries[0].detail, /HTTP 500/);
  assert.equal(RSLog.warnings().length, 1);
});
