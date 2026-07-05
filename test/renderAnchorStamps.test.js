/* End-to-end guard for the render-time anchor stamps: renderPage() must stamp
   every card <div> with data-src-start/data-src-end, the two-column layout must
   only MOVE those nodes (stamps survive into the final grid), and every stamp
   must join back to exactly one EditorOutline card by its heading line. This is
   the drift guard that replaced editor/anchors.js's layout re-simulation — if a
   layout or builder change ever breaks card↔source identity, it fails here
   instead of silently making cards un-editable. */

"use strict";

const { test, before } = require("node:test");
const assert = require("node:assert/strict");

const EditorOutline = require("../src/editor/outline.js");
const { bootReader } = require("./helpers/readerDom.js");

// Exercises every layout path: header band, two-column row with a Side: R card,
// an <hr> row split, sticky docking, and an H1 full-width section.
const SCENE = [
  "# Scene Title",
  "",
  "### STD: Header Note",
  "> In the header band.",
  "",
  "## First Event",
  "",
  "### Narrative",
  "Text:",
  "> Read aloud.",
  "",
  "### Skill Checks",
  "Side: R",
  "Combat:",
  "- Athletics:",
  "> 10: climb",
  "",
  "---",
  "",
  "### Object: Shrine",
  "> A small shrine.",
  "",
  "### Item: Holy Symbol",
  "Connect: T",
  "Type: Wondrous",
  "",
  "# Interlude",
  "",
  "### STD: Full Width",
  "> Inside the H1 section.",
  "",
  "## Second Event",
  "",
].join("\n");

let win;

before(async () => {
  win = await bootReader({ withApp: true });
});

function render(src) {
  win.renderPage(src);
  return win.document.getElementById("page");
}

test("every card div is stamped and every stamp joins to exactly one outline card", () => {
  const page = render(SCENE);
  const model = EditorOutline.parse(SCENE);
  const modelCards = model.events.flatMap((ev) => ev.cards);
  const stamped = [...page.querySelectorAll("[data-src-start]")];

  assert.equal(stamped.length, modelCards.length,
    "one stamped div per outline card (dom=" + stamped.length + " model=" + modelCards.length + ")");

  const seen = new Set();
  for (const el of stamped) {
    const start = Number(el.dataset.srcStart);
    const hit = EditorOutline.findCardByStart(model, start);
    assert.ok(hit, "stamp data-src-start=" + start + " must resolve to an outline card");
    assert.equal(Number(el.dataset.srcEnd), hit.card.end,
      "data-src-end must match the outline card's end for " + hit.card.type);
    assert.ok(!seen.has(hit.card.id), "outline card matched twice: " + hit.card.id);
    seen.add(hit.card.id);
  }
});

test("stamps survive the two-column layout into every placement context", () => {
  const page = render(SCENE);

  // Header band: the STD card before the first H2.
  const headerCard = page.querySelector(".page-header .std-card");
  assert.ok(headerCard && headerCard.dataset.srcStart, "header-band card keeps its stamp");

  // Side: R routes to the aside column; the stamp must ride along.
  const asideCard = page.querySelector(".col-aside .sc-card");
  assert.ok(asideCard && asideCard.dataset.srcStart, "right-column card keeps its stamp");

  // A docked (Connect: T) item lands in its host's column, still stamped.
  const docked = page.querySelector(".page-grid .item-card");
  assert.ok(docked && docked.dataset.srcStart, "docked card keeps its stamp");

  // H1 full-width section body.
  const fullCard = page.querySelector(".grid-full .std-card");
  assert.ok(fullCard && fullCard.dataset.srcStart, "full-width section card keeps its stamp");
});

test("non-card content is never stamped", () => {
  const page = render(SCENE);
  for (const el of page.querySelectorAll("[data-src-start]")) {
    assert.match(el.className, /-card\b/, "only card divs may carry data-src-start");
  }
});
