"use strict";

/* Pure geometry + label math for the Scene Progression Map
   (src/sceneGraph/graphGeometry.js). This had no coverage while it lived inside
   the panel closure; extracting it is what made these assertions possible. */

const test = require("node:test");
const assert = require("node:assert/strict");

const G = require("../src/sceneGraph/graphGeometry.js");

const { NODE_W, NODE_H } = G;
// A node at the origin, so expected values read as plain offsets.
const node = (x, y) => ({ scene: "scenes/x.md", x, y });
const ORIGIN = node(0, 0);
const CX = NODE_W / 2;
const CY = NODE_H / 2;

// --- rectExitPoint --------------------------------------------------------

test("rectExitPoint leaves through the right edge for a target due east", () => {
  const p = G.rectExitPoint(ORIGIN, 1000, CY);
  assert.equal(p.x, NODE_W);
  assert.equal(p.y, CY);
});

test("rectExitPoint leaves through the left edge for a target due west", () => {
  const p = G.rectExitPoint(ORIGIN, -1000, CY);
  assert.equal(p.x, 0);
  assert.equal(p.y, CY);
});

test("rectExitPoint leaves through the bottom edge for a target due south", () => {
  const p = G.rectExitPoint(ORIGIN, CX, 1000);
  assert.equal(p.x, CX);
  assert.equal(p.y, NODE_H);
});

test("rectExitPoint leaves through the top edge for a target due north", () => {
  const p = G.rectExitPoint(ORIGIN, CX, -1000);
  assert.equal(p.x, CX);
  assert.equal(p.y, 0);
});

test("rectExitPoint returns the centre when the target IS the centre", () => {
  // No direction to leave in; must not divide by zero or return NaN.
  const p = G.rectExitPoint(ORIGIN, CX, CY);
  assert.deepEqual({ x: p.x, y: p.y }, { x: CX, y: CY });
});

test("rectExitPoint honours the node's own offset", () => {
  const p = G.rectExitPoint(node(100, 40), 1000, 40 + CY);
  assert.equal(p.x, 100 + NODE_W);
  assert.equal(p.y, 40 + CY);
});

// --- edgePath -------------------------------------------------------------

test("edgePath returns null when either endpoint is off the map", () => {
  assert.equal(G.edgePath(null, ORIGIN, false), null);
  assert.equal(G.edgePath(ORIGIN, null, false), null);
  assert.equal(G.edgePath(null, null, false), null);
});

test("edgePath draws a straight quadratic between two side-by-side nodes", () => {
  const a = ORIGIN;
  const b = node(400, 0);
  const geo = G.edgePath(a, b, false);

  // Exits a's right edge, enters b's left edge, both at mid-height.
  assert.equal(geo.d, "M " + NODE_W + " " + CY + " Q " + (NODE_W + 400) / 2 + " " + CY +
    " " + 400 + " " + CY);
  assert.equal(geo.labelY, CY, "a horizontal run must keep its label on the centre line");
});

test("edgePath bows the curve sideways when the reverse edge is also displayed", () => {
  const a = ORIGIN;
  const b = node(400, 0);
  const straight = G.edgePath(a, b, false);
  const bowed = G.edgePath(a, b, true);

  assert.notEqual(bowed.d, straight.d, "a two-way pair must not collapse into one line");
  // Perpendicular to a due-east run is straight down, by REVERSE_EDGE_OFFSET.
  assert.equal(bowed.labelX, straight.labelX);
  assert.equal(bowed.labelY, straight.labelY + G.REVERSE_EDGE_OFFSET / 2);
});

test("edgePath puts the label at the quadratic midpoint, not the chord midpoint", () => {
  const geo = G.edgePath(ORIGIN, node(400, 0), true);
  // Quadratic midpoint is (p1 + 2m + p2) / 4 — a quarter of the way from the
  // chord toward the control point, not on the chord itself.
  assert.ok(Number.isFinite(geo.labelX) && Number.isFinite(geo.labelY));
  assert.notEqual(geo.labelY, CY);
});

// --- hit tests ------------------------------------------------------------

test("nodeIntersectsBox is true for an overlapping marquee and false for a disjoint one", () => {
  const box = (minX, minY, maxX, maxY) => ({ minX, minY, maxX, maxY });
  assert.equal(G.nodeIntersectsBox(ORIGIN, box(-10, -10, 10, 10)), true);
  assert.equal(G.nodeIntersectsBox(ORIGIN, box(1000, 1000, 2000, 2000)), false);
});

test("nodeIntersectsBox counts an exactly-touching edge as a hit", () => {
  const box = { minX: NODE_W, minY: 0, maxX: NODE_W + 50, maxY: NODE_H };
  assert.equal(G.nodeIntersectsBox(ORIGIN, box), true);
});

test("nodeContainsPoint covers the rectangle inclusive of its corners", () => {
  assert.equal(G.nodeContainsPoint(ORIGIN, { x: CX, y: CY }), true);
  assert.equal(G.nodeContainsPoint(ORIGIN, { x: 0, y: 0 }), true);
  assert.equal(G.nodeContainsPoint(ORIGIN, { x: NODE_W, y: NODE_H }), true);
  assert.equal(G.nodeContainsPoint(ORIGIN, { x: NODE_W + 1, y: CY }), false);
  assert.equal(G.nodeContainsPoint(ORIGIN, { x: CX, y: -1 }), false);
});

test("clampZoom holds the view between ZOOM_MIN and ZOOM_MAX", () => {
  assert.equal(G.clampZoom(1), 1);
  assert.equal(G.clampZoom(0), G.ZOOM_MIN);
  assert.equal(G.clampZoom(99), G.ZOOM_MAX);
});

// --- title text -----------------------------------------------------------

test("truncateTitle only shortens text longer than the limit", () => {
  assert.equal(G.truncateTitle("short", 10), "short");
  assert.equal(G.truncateTitle("exactlyten", 10), "exactlyten");
  assert.equal(G.truncateTitle("one word too many", 10), "one word …");
});

test("wrapTitle keeps a short title on one line", () => {
  assert.deepEqual(G.wrapTitle("The Gate", 16), ["The Gate"]);
});

test("wrapTitle breaks onto a second line at a word boundary", () => {
  assert.deepEqual(G.wrapTitle("The Gate of Broken Oaths", 12), ["The Gate of", "Broken Oaths"]);
});

test("wrapTitle ellipsizes what does not fit in two lines", () => {
  const lines = G.wrapTitle("one two three four five six seven eight", 10);
  assert.equal(lines.length, 2);
  assert.ok(lines[1].endsWith("…"), "overflow must be marked: " + JSON.stringify(lines));
});

test("wrapTitle never lets a line exceed maxChars", () => {
  const lines = G.wrapTitle("Supercalifragilisticexpialidocious voyage", 12);
  lines.forEach((line) => assert.ok(line.length <= 12, "too long: " + line));
});

test("wrapTitle returns a single empty line for empty input", () => {
  assert.deepEqual(G.wrapTitle("", 16), [""]);
  assert.deepEqual(G.wrapTitle("   ", 16), [""]);
});

// --- edge identity --------------------------------------------------------

test("edgeIdentity is direction-sensitive", () => {
  const ab = { from: "scenes/a.md", to: "scenes/b.md" };
  const ba = { from: "scenes/b.md", to: "scenes/a.md" };
  assert.equal(G.edgeIdentity(ab), "scenes/a.md|scenes/b.md");
  assert.notEqual(G.edgeIdentity(ab), G.edgeIdentity(ba));
});

test("edgeIdentity ignores label and locked — callers compare those separately", () => {
  const manual = { from: "a", to: "b", label: "if bribed" };
  const derived = { from: "a", to: "b", locked: true };
  assert.equal(G.edgeIdentity(manual), G.edgeIdentity(derived));
});
