"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..");

function loadDraftState(fetchImpl, warnings) {
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
  win.ServerApi = {
    withCampaign(url) {
      return url + "?campaign=Test";
    },
    withCampaignBody(body) {
      return Object.assign({}, body, { campaign: "Test" });
    },
  };

  const script = win.document.createElement("script");
  script.textContent = fs.readFileSync(path.join(ROOT, "src/session/draftState.js"), "utf8") +
    "\nwindow.__DraftState = DraftState;";
  win.document.body.appendChild(script);
  return { win, DraftState: win.__DraftState };
}

test("draft state migrates legacy localStorage drafts and saves to campaign sys", async () => {
  const warnings = [];
  let saved = null;
  const { win, DraftState } = loadDraftState(async (url, opts) => {
    if (url === "/__draft_state?campaign=Test") {
      return {
        ok: true,
        json: async () => ({ ok: true, state: { version: 1, create: {}, editManifest: {} }, readOnly: false }),
      };
    }
    if (url === "/__save_draft_state") {
      saved = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ ok: true }) };
    }
    throw new Error("unexpected fetch: " + url);
  }, warnings);

  win.localStorage.setItem("rendscroll-draft:item", JSON.stringify({ name: "Sword" }));
  win.localStorage.setItem("rendscroll-draft:edit-manifest:campaigns/Test/scenes/1.md", JSON.stringify({
    duration: "",
    summary: "Draft summary",
    goals: [],
    keyNpcs: [],
    rewards: [],
  }));

  await DraftState.loadForCampaign("Test");
  await DraftState.saveNow();

  assert.equal(DraftState.getCreate("item").name, "Sword");
  assert.equal(DraftState.getEditManifest("campaigns/Test/scenes/1.md").summary, "Draft summary");
  assert.equal(saved.campaign, "Test");
  assert.equal(saved.create.item.name, "Sword");
  assert.equal(saved.editManifest["scenes/1.md"].summary, "Draft summary");
  assert.equal(win.localStorage.getItem("rendscroll-draft:item"), null);
  assert.equal(win.localStorage.getItem("rendscroll-draft:edit-manifest:campaigns/Test/scenes/1.md"), null);
  assert.deepEqual(warnings, []);
});

test("draft state falls back to localStorage when server storage is unavailable", async () => {
  const warnings = [];
  const { win, DraftState } = loadDraftState(async () => {
    throw new Error("offline");
  }, warnings);

  await DraftState.loadForCampaign("Test");
  DraftState.setCreate("item", { name: "Fallback Sword" });

  assert.equal(JSON.parse(win.localStorage.getItem("rendscroll-draft:item")).name, "Fallback Sword");
  assert.equal(DraftState.getCreate("item").name, "Fallback Sword");
  assert.equal(DraftState._isLocalFallback(), true);
  assert.equal(warnings[0].area, "drafts");
});
