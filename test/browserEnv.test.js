"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const BrowserEnv = require("../src/utils/browserEnv.js");

const UA = {
  chrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  edge:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0",
  firefox: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0",
  safari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 " +
    "(KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  jsdom: "Mozilla/5.0 (win32) AppleWebKit/537.36 (KHTML, like Gecko) jsdom/24.0.0",
};

test("Chromium-family UAs (Chrome, Edge) detect as chromium", () => {
  assert.equal(BrowserEnv.detectEngine(UA.chrome, true), "chromium");
  assert.equal(BrowserEnv.detectEngine(UA.edge, true), "chromium");
});

test("Firefox detects as firefox even though window.chrome is absent", () => {
  assert.equal(BrowserEnv.detectEngine(UA.firefox, false), "firefox");
});

test("Safari detects as webkit, not chromium", () => {
  assert.equal(BrowserEnv.detectEngine(UA.safari, false), "webkit");
});

test("unknown UAs fall back to other/webkit buckets safely", () => {
  // jsdom advertises AppleWebKit, so it lands in the webkit bucket…
  assert.equal(BrowserEnv.detectEngine(UA.jsdom, false), "webkit");
  // …and something with no engine markers at all is "other".
  assert.equal(BrowserEnv.detectEngine("CustomAgent/1.0", false), "other");
  assert.equal(BrowserEnv.detectEngine("", false), "other");
});
