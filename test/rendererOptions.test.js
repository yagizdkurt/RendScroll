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
    if (url === "/__renderer_options") {
      return { ok: false, status: 404, json: async () => { throw new Error("not found"); } };
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
    if (url === "/__renderer_options") {
      return { ok: false, status: 404, json: async () => { throw new Error("not found"); } };
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

test("renderer options prefer sys endpoint before legacy file and local mirror", async () => {
  const warnings = [];
  const options = loadRendererOptions(async (url) => {
    if (url === "src/Options/options.defaults.json") {
      return { ok: true, json: async () => ({ textSize: "md" }) };
    }
    if (url === "/__renderer_options") {
      return { ok: true, json: async () => ({ ok: true, options: { textSize: "lg" }, source: "sys" }) };
    }
    throw new Error("unexpected fetch: " + url);
  }, warnings);

  await options.init();

  assert.equal(options.get("textSize"), "lg");
  assert.deepEqual(warnings, []);
});

test("renderer options save clears local mirror after successful sys save", async () => {
  const warnings = [];
  let saved = null;
  const dom = new JSDOM("<!DOCTYPE html><body></body>", {
    runScripts: "dangerously",
    url: "http://localhost/",
  });
  const win = dom.window;
  win.localStorage.setItem("rendererOptions", JSON.stringify({ textSize: "sm" }));
  win.fetch = async (url, opts) => {
    if (url === "src/Options/options.defaults.json") {
      return { ok: true, json: async () => ({ textSize: "md" }) };
    }
    if (url === "/__renderer_options") {
      return { ok: true, json: async () => ({ ok: true, options: {}, source: "missing" }) };
    }
    if (url === "/__save_options") {
      saved = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ ok: true }) };
    }
    throw new Error("unexpected fetch: " + url);
  };
  win.RSLog = { warn(area, message, detail) { warnings.push({ area, message, detail }); } };

  const script = win.document.createElement("script");
  script.textContent = fs.readFileSync(path.join(ROOT, "src/Options/rendererOptions.js"), "utf8") +
    "\nwindow.__RendererOptions = RendererOptions;";
  win.document.body.appendChild(script);

  await win.__RendererOptions.init();
  win.__RendererOptions.set("textSize", "lg");
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(saved.textSize, "lg");
  assert.equal(win.localStorage.getItem("rendererOptions"), null);
  assert.deepEqual(warnings, []);
});
