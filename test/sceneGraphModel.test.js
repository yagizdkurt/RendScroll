const test = require("node:test");
const assert = require("node:assert");

const M = require("../src/sceneGraph/graphModel.js");

test("emptyGraph shape", () => {
  assert.deepStrictEqual(M.emptyGraph(), { version: 1, nodes: [], edges: [] });
});

test("normalizeGraph: garbage inputs degrade to empty graph", () => {
  for (const raw of [null, undefined, 42, "x", [], { nodes: "no", edges: 7 }]) {
    const { graph, readOnly } = M.normalizeGraph(raw);
    assert.deepStrictEqual(graph, M.emptyGraph());
    assert.strictEqual(readOnly, false);
  }
});

test("normalizeGraph: keeps valid entries, drops malformed/dupes/self-loops, warns", () => {
  const { graph, warnings } = M.normalizeGraph({
    version: 1,
    nodes: [
      { scene: "scenes\\1_intro.md", x: 10, y: 20 },
      { scene: "scenes/1_intro.md", x: 99, y: 99 },       // duplicate
      { scene: "", x: 1, y: 2 },                          // malformed
      { scene: "scenes/2.md", x: "a", y: 2 },             // malformed x
      { scene: "scenes/3.md", x: 5, y: 6 },
    ],
    edges: [
      { from: "scenes/1_intro.md", to: "scenes/3.md", label: "  go  " },
      { from: "scenes/1_intro.md", to: "scenes/3.md" },   // duplicate
      { from: "scenes/3.md", to: "scenes/3.md" },         // self-loop
      { from: "", to: "scenes/3.md" },                    // malformed
    ],
  });
  assert.deepStrictEqual(graph.nodes, [
    { scene: "scenes/1_intro.md", x: 10, y: 20 },
    { scene: "scenes/3.md", x: 5, y: 6 },
  ]);
  assert.deepStrictEqual(graph.edges, [
    { from: "scenes/1_intro.md", to: "scenes/3.md", label: "go" },
  ]);
  assert.ok(warnings.length >= 4);
});

test("normalizeGraph: future version goes read-only, never rewritten", () => {
  const { graph, readOnly, warnings } = M.normalizeGraph({ version: 2, nodes: [], edges: [] });
  assert.strictEqual(readOnly, true);
  assert.deepStrictEqual(graph, M.emptyGraph());
  assert.ok(warnings[0].includes("version"));
});

test("path conversion round-trips, including import-renamed campaigns", () => {
  const entries = [
    { path: "campaigns/foo (2)/scenes/1_intro.md" },
    { path: "campaigns/foo (2)/scenes/2_baron.md" },
  ];
  const prefix = M.campaignPrefixFromEntries(entries);
  assert.strictEqual(prefix, "campaigns/foo (2)/");
  const rel = M.toRelativeScene("campaigns/foo (2)/scenes/1_intro.md", prefix);
  assert.strictEqual(rel, "scenes/1_intro.md");
  assert.strictEqual(M.toFullPath(rel, prefix), "campaigns/foo (2)/scenes/1_intro.md");
  // Outside the campaign (e.g. a library path) -> null, never a bogus node id.
  assert.strictEqual(M.toRelativeScene("items/sword.md", prefix), null);
  assert.strictEqual(M.campaignPrefixFromEntries([]), "");
});

test("syncWithScenes: adds new scenes at deterministic grid positions", () => {
  const scenes = ["scenes/1.md", "scenes/2.md", "scenes/3.md", "scenes/4.md", "scenes/5.md"];
  const { graph, added, changed } = M.syncWithScenes(M.emptyGraph(), scenes);
  assert.strictEqual(added, 5);
  assert.strictEqual(changed, true);
  assert.deepStrictEqual(graph.nodes[0], { scene: "scenes/1.md", x: 40, y: 40 });
  assert.deepStrictEqual(graph.nodes[3], { scene: "scenes/4.md", x: 640, y: 40 });
  assert.deepStrictEqual(graph.nodes[4], { scene: "scenes/5.md", x: 40, y: 150 }); // second row
  // Deterministic: same input, same output.
  assert.deepStrictEqual(M.syncWithScenes(M.emptyGraph(), scenes).graph, graph);
});

test("syncWithScenes: keeps placed nodes, prunes deleted scenes and their edges", () => {
  const graph = {
    version: 1,
    nodes: [
      { scene: "scenes/1.md", x: 500, y: 500 },
      { scene: "scenes/gone.md", x: 1, y: 1 },
    ],
    edges: [
      { from: "scenes/1.md", to: "scenes/gone.md", label: "dead" },
      { from: "scenes/gone.md", to: "scenes/1.md" },
    ],
  };
  const res = M.syncWithScenes(graph, ["scenes/1.md", "scenes/new.md"]);
  assert.strictEqual(res.prunedNodes, 1);
  assert.strictEqual(res.prunedEdges, 2);
  assert.strictEqual(res.added, 1);
  assert.strictEqual(res.changed, true);
  const kept = res.graph.nodes.find((n) => n.scene === "scenes/1.md");
  assert.deepStrictEqual(kept, { scene: "scenes/1.md", x: 500, y: 500 }); // position preserved
  assert.deepStrictEqual(res.graph.edges, []);
});

test("syncWithScenes: no-op when nothing changed", () => {
  const base = M.syncWithScenes(M.emptyGraph(), ["scenes/1.md"]).graph;
  const res = M.syncWithScenes(base, ["scenes/1.md"]);
  assert.strictEqual(res.changed, false);
});

test("syncWithScenes: empty scene list never wipes a non-empty graph", () => {
  const graph = { version: 1, nodes: [{ scene: "scenes/1.md", x: 1, y: 2 }], edges: [] };
  const res = M.syncWithScenes(graph, []);
  assert.strictEqual(res.changed, false);
  assert.strictEqual(res.graph, graph); // untouched, same object
});

test("syncWithScenes: default position nudges off an occupied slot", () => {
  const graph = { version: 1, nodes: [{ scene: "scenes/old.md", x: 40, y: 40 }], edges: [] };
  // "scenes/old.md" is gone; new scene at index 0 wants (40,40) which is free
  // after pruning — but keep a survivor parked there to force the nudge.
  const survivor = { version: 1, nodes: [{ scene: "scenes/keep.md", x: 240, y: 40 }], edges: [] };
  const res = M.syncWithScenes(survivor, ["scenes/keep.md", "scenes/new.md"]);
  const fresh = res.graph.nodes.find((n) => n.scene === "scenes/new.md");
  // index 1 -> grid slot (240,40) is taken by keep.md -> nudged.
  assert.deepStrictEqual(fresh, { scene: "scenes/new.md", x: 264, y: 64 });
  assert.ok(graph); // silence unused warning-style lint habits
});

test("edge operations: add/remove/label with rejection rules", () => {
  const graph = M.syncWithScenes(M.emptyGraph(), ["scenes/a.md", "scenes/b.md"]).graph;

  assert.strictEqual(M.addEdge(graph, "scenes/a.md", "scenes/a.md"), false); // self-loop
  assert.strictEqual(M.addEdge(graph, "scenes/a.md", "scenes/zz.md"), false); // unknown target
  assert.strictEqual(M.addEdge(graph, "scenes/a.md", "scenes/b.md"), true);
  assert.strictEqual(M.addEdge(graph, "scenes/a.md", "scenes/b.md"), false); // duplicate
  assert.strictEqual(M.addEdge(graph, "scenes/b.md", "scenes/a.md"), true); // reverse is distinct

  assert.strictEqual(M.setEdgeLabel(graph, "scenes/a.md", "scenes/b.md", " if sneaky "), true);
  assert.strictEqual(M.findEdge(graph, "scenes/a.md", "scenes/b.md").label, "if sneaky");
  assert.strictEqual(M.setEdgeLabel(graph, "scenes/a.md", "scenes/b.md", "  "), true);
  assert.strictEqual("label" in M.findEdge(graph, "scenes/a.md", "scenes/b.md"), false);
  assert.strictEqual(M.setEdgeLabel(graph, "scenes/zz.md", "scenes/b.md", "x"), false);

  assert.strictEqual(M.removeEdge(graph, "scenes/a.md", "scenes/b.md"), true);
  assert.strictEqual(M.removeEdge(graph, "scenes/a.md", "scenes/b.md"), false);
  assert.strictEqual(graph.edges.length, 1);
});

test("setNodePosition updates only known nodes", () => {
  const graph = M.syncWithScenes(M.emptyGraph(), ["scenes/a.md"]).graph;
  assert.strictEqual(M.setNodePosition(graph, "scenes/a.md", 7, 8), true);
  assert.deepStrictEqual(graph.nodes[0], { scene: "scenes/a.md", x: 7, y: 8 });
  assert.strictEqual(M.setNodePosition(graph, "scenes/zz.md", 0, 0), false);
});

test("mergeDerivedEdges: derived edges are locked and hide manual duplicates", () => {
  const graph = M.syncWithScenes(M.emptyGraph(), ["scenes/a.md", "scenes/b.md", "scenes/c.md"]).graph;
  M.addEdge(graph, "scenes/a.md", "scenes/b.md"); // manual duplicate of a card edge
  M.addEdge(graph, "scenes/a.md", "scenes/c.md"); // manual only
  const derived = [
    { from: "scenes/a.md", to: "scenes/b.md", label: "Take the pass", cardName: "Take the pass" },
    { from: "scenes/a.md", to: "scenes/b.md", label: "Second card same link", cardName: "Second" },
    { from: "scenes/b.md", to: "scenes/gone.md", label: "broken", cardName: "broken" },
  ];
  const { edges, broken } = M.mergeDerivedEdges(graph, derived);

  const locked = edges.filter((e) => e.locked);
  assert.strictEqual(locked.length, 1); // dedupe of two cards on the same link
  assert.strictEqual(locked[0].label, "Take the pass");

  const manual = edges.filter((e) => !e.locked);
  assert.deepStrictEqual(manual.map((e) => e.to), ["scenes/c.md"]); // a->b hidden

  assert.strictEqual(broken.length, 1);
  assert.strictEqual(broken[0].to, "scenes/gone.md");

  // graph.json content untouched by display merging.
  assert.strictEqual(graph.edges.length, 2);
});
