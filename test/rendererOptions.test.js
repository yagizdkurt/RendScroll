"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..");

function loadRendererOptions(fetchImpl, warnings) {
  const dom = new JSDOM("<!DOCTYPE html><body></body>", {
    runScripts: "dangerously",
    url: "http://localhost/",
  });
  const win = dom.window;
  win.fetch = fetchImpl;
  win.RSLog = {
    warn(area, message, detail) {
      warnings.push({ area, message, detail });
    },
  };

  const script = win.document.createElement("script");
  script.textContent = fs.readFileSync(path.join(ROOT, "src/Options/rendererOptions.js"), "utf8");
  win.document.body.appendChild(script);

  const expose = win.document.createElement("script");
  expose.textContent = "window.__RendererOptions = RendererOptions;";
  win.document.body.appendChild(expose);
  return win.__RendererOptions;
}

test("missing options.current.json is a normal first-run fallback, not a runtime warning", async () => {
  const warnings = [];
  const defaults = {
    textSize: "md",
    pageBackground: "parchiment",
    check_for_updates: true,
  };
  const options = loadRendererOptions(async (url) => {
    if (url === "src/Options/options.defaults.json") {
      return { ok: true, json: async () => defaults };
    }
    if (url === "options.current.json") {
      return { ok: false, status: 404, json: async () => { throw new Error("not found"); } };
    }
    throw new Error("unexpected fetch: " + url);
  }, warnings);

  await options.init();

  assert.deepEqual(warnings, []);
  assert.equal(options.get("textSize"), "md");
});

test("non-404 options.current.json load failures still warn", async () => {
  const warnings = [];
  const options = loadRendererOptions(async (url) => {
    if (url === "src/Options/options.defaults.json") {
      return { ok: true, json: async () => ({}) };
    }
    if (url === "options.current.json") {
      return { ok: false, status: 500, json: async () => ({}) };
    }
    throw new Error("unexpected fetch: " + url);
  }, warnings);

  await options.init();

  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].area, "options");
  assert.match(warnings[0].message, /options\.current\.json \(HTTP 500\)/);
});
