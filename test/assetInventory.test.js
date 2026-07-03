"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const AssetInventory = require("../src/assets/assetInventory.js");

test("asset value resolution matches renderer/export defaults", () => {
  assert.equal(AssetInventory.imageRefPath("portrait"), "images/portrait.png");
  assert.equal(AssetInventory.imageRefPath("portrait.jpg"), "images/portrait.jpg");
  assert.equal(AssetInventory.imageRefPath("/images/nested/map.webp"), "images/nested/map.webp");
  assert.equal(AssetInventory.audioRefPath("theme"), "audio/theme.mp3");
  assert.equal(AssetInventory.audioRefPath("theme.ogg"), "audio/theme.ogg");
  assert.equal(AssetInventory.audioRefPath("https://example.com/theme.mp3"), null);
});

test("campaign asset analysis reports missing and unused assets", () => {
  const scenes = [{
    path: "campaigns/Legacy/scenes/1.md",
    text: [
      "### NPC: Guard",
      "Image: guard",
      "BG: missing-bg",
      "### Audio: Theme",
      "File: theme",
      "",
    ].join("\n"),
  }];
  const assets = {
    images: [
      { name: "guard", path: "campaigns/Legacy/images/guard.png", origin: "campaign" },
      { name: "unused", path: "images/unused.png", origin: "global" },
    ],
    audio: [
      { name: "theme", path: "audio/theme.mp3", origin: "global" },
    ],
  };

  const report = AssetInventory.analyzeAssets(scenes, null, assets);

  assert.deepEqual(report.missingAssets.map((r) => r.path), ["images/missing-bg.png"]);
  assert.deepEqual(report.unused.map((a) => a.path), ["images/unused.png"]);
  assert.equal(report.refs.length, 3);
});
