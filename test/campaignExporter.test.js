"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const CampaignExporter = require("../src/exporter/exporter.js");
const { collect, scanAssets, collectRefNames, imageRefPath, audioRefPath } = CampaignExporter;

// A minimal stand-in for RefLibrary: maps item/enemy names to entries with a
// path + source, using the same Turkish-safe normalization the real one uses.
function fakeRefLib(items, enemies) {
  const norm = (s) =>
    String(s == null ? "" : s).trim().replace(/İ/g, "i").replace(/I/g, "ı").toLowerCase();
  const map = { item: new Map(), enemy: new Map() };
  Object.entries(items || {}).forEach(([name, source]) =>
    map.item.set(norm(name), { name, path: "Items/" + name + ".md", source })
  );
  Object.entries(enemies || {}).forEach(([name, source]) =>
    map.enemy.set(norm(name), { name, path: "Enemies/" + name + ".md", source })
  );
  return {
    norm,
    lookup: (type, name) => map[type] && map[type].get(norm(name)) || null,
    lookupAny: (name) => {
      for (const type of ["item", "enemy"]) {
        if (map[type].has(norm(name))) return { type, entry: map[type].get(norm(name)) };
      }
      return null;
    },
  };
}

test("imageRefPath mirrors cardBgUrl rules (repo-relative)", () => {
  assert.equal(imageRefPath("skull"), "images/skull.png");
  assert.equal(imageRefPath("skull.jpg"), "images/skull.jpg");
  assert.equal(imageRefPath("art/boss.png"), "art/boss.png");
  assert.equal(imageRefPath("/images/x.png"), "images/x.png");
  assert.equal(imageRefPath("https://example.com/a.png"), null);
  assert.equal(imageRefPath("   "), null);
});

test("audioRefPath mirrors audioSrcUrl rules (repo-relative)", () => {
  assert.equal(audioRefPath("tavern"), "audio/tavern.mp3");
  assert.equal(audioRefPath("tavern.ogg"), "audio/tavern.ogg");
  assert.equal(audioRefPath("sfx/door.mp3"), "sfx/door.mp3");
  assert.equal(audioRefPath("http://x/y.mp3"), null);
});

test("scanAssets picks up Image/BG and only audio-section File lines", () => {
  const text = [
    "### NPC: Guard",
    "Image: guard",
    "BG: wall.jpg",
    "File: notaudio", // not inside an Audio section -> ignored
    "### Audio: Theme",
    "File: theme",
  ].join("\n");
  assert.deepEqual(scanAssets(text).sort(), ["audio/theme.mp3", "images/guard.png", "images/wall.jpg"]);
});

test("collectRefNames finds SourceItem, [item=], [enemy=], [link=]", () => {
  const text = [
    "### Item: Sword",
    "SourceItem: Calamity",
    "Some prose with [link=Kate] and [item=Kazma] and [enemy=Goblin].",
  ].join("\n");
  const refs = collectRefNames(text);
  assert.deepEqual(refs, [
    { type: "item", name: "Calamity" },
    { type: "enemy", name: "Goblin" },
    { type: "item", name: "Kazma" },
    { type: "any", name: "Kate" },
  ]);
});

test("collect resolves transitive refs + assets, flags missing", () => {
  const refLib = fakeRefLib(
    {
      Calamity: "### SourceItem: Calamity\nImage: calamity\n",
      Kazma: "### SourceItem: Kazma\n",
    },
    { Kate: "### SourceEnemy: Kate\nImage: kate.jpg\nDrops [item=Kazma].\n" }
  );

  const scenes = [
    {
      path: "Campaign/1.md",
      text: [
        "# Scene One",
        "Image: scene1",
        "### Item: Blade",
        "SourceItem: Calamity",
        "### Combat",
        "Enemies:",
        "- [enemy=Kate] x2",
        "### Audio: Ambience",
        "File: wind",
      ].join("\n"),
    },
    { path: "Campaign/2.md", text: "# Scene Two\nA mention of [link=MissingThing]." },
  ];

  const { files, assetCandidates, missingRefs } = collect(scenes, refLib);

  // Scenes + every resolved library file (including the one Kate transitively pulls in).
  assert.deepEqual(
    files.sort(),
    ["Campaign/1.md", "Campaign/2.md", "Enemies/Kate.md", "Items/Calamity.md", "Items/Kazma.md"]
  );
  // Assets from scenes AND from resolved ref sources (Calamity's + Kate's images).
  assert.deepEqual(
    assetCandidates.sort(),
    ["audio/wind.mp3", "images/calamity.png", "images/kate.jpg", "images/scene1.png"]
  );
  // The unresolved inline link is reported, nothing else.
  assert.deepEqual(missingRefs, [{ type: "any", name: "MissingThing" }]);
});

test("collect de-dupes references by normalized name", () => {
  const refLib = fakeRefLib({ Kazma: "### SourceItem: Kazma\n" }, {});
  const scenes = [
    { path: "Campaign/1.md", text: "SourceItem: Kazma\n[item=kazma]\n[item=KAZMA]" },
  ];
  const { files } = collect(scenes, refLib);
  assert.deepEqual(files.sort(), ["Campaign/1.md", "Items/Kazma.md"]);
});
