"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..");

function loadCampaignManager(fetchImpl) {
  const dom = new JSDOM("<!DOCTYPE html><body></body>", {
    runScripts: "dangerously",
    url: "http://localhost/",
  });
  const win = dom.window;
  win.fetch = fetchImpl;
  const script = win.document.createElement("script");
  script.textContent = fs.readFileSync(path.join(ROOT, "src/campaign/campaignManager.js"), "utf8") +
    "\nwindow.__CampaignManager = CampaignManager;";
  win.document.body.appendChild(script);
  return { win, CampaignManager: win.__CampaignManager };
}

test("campaign manager restores active campaign from persistent endpoint", async () => {
  const selected = [];
  const { CampaignManager } = loadCampaignManager(async (url, opts) => {
    if (url === "/__campaigns") {
      return { ok: true, json: async () => [{ name: "Alpha", label: "Alpha" }] };
    }
    if (url === "/__active_campaign") {
      return { ok: true, json: async () => ({ ok: true, name: "Alpha" }) };
    }
    if (url === "/__select_campaign") {
      selected.push(JSON.parse(opts.body).name);
      return { ok: true, json: async () => ({ ok: true, name: "Alpha" }) };
    }
    throw new Error("unexpected fetch: " + url);
  });

  let switched = null;
  CampaignManager.configure({ onSwitch: async (name) => { switched = name; } });
  await CampaignManager.init();

  assert.deepEqual(selected, ["Alpha"]);
  assert.equal(CampaignManager.active(), "Alpha");
  assert.equal(switched, "Alpha");
});

test("campaign manager migrates legacy localStorage selection once", async () => {
  const selected = [];
  const { win, CampaignManager } = loadCampaignManager(async (url, opts) => {
    if (url === "/__campaigns") {
      return { ok: true, json: async () => [{ name: "Beta", label: "Beta" }] };
    }
    if (url === "/__active_campaign") {
      return { ok: true, json: async () => ({ ok: true, name: null }) };
    }
    if (url === "/__select_campaign") {
      selected.push(JSON.parse(opts.body).name);
      return { ok: true, json: async () => ({ ok: true, name: "Beta" }) };
    }
    throw new Error("unexpected fetch: " + url);
  });
  win.localStorage.setItem("rendscroll-current-campaign", "Beta");

  CampaignManager.configure({ onSwitch: async () => {} });
  await CampaignManager.init();

  assert.deepEqual(selected, ["Beta"]);
  assert.equal(CampaignManager.active(), "Beta");
  assert.equal(win.localStorage.getItem("rendscroll-current-campaign"), null);
});
