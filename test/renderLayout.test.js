/* Full-scene golden render test for the two-column layout pass (cards/shared/layout.js).
   layout.js is pure DOM logic — header band, two-column routing (Side: R -> aside),
   sticky docking (Connect/Combine -> stuck under host, host gets has-stuck-below),
   H1 full-width sections, and H2/HR full-width dividers — and had NO structural
   coverage: only anchor stamps were checked (renderAnchorStamps.test.js), never card
   PLACEMENT. A docking or column regression that scrambled which card lands where was
   caught only by eye.

   This renders each test/fixtures/*.md through the REAL renderPage() + layout.js
   (bootReader withApp) and asserts a compact structural SIGNATURE per fixture. The
   signature deliberately keeps only the classes layout acts on (the "<type>-card"
   root, "card-right" routing, "<type>-stuck" docking, "has-stuck-below" host marker)
   plus bare tag names for non-card nodes — so it survives cosmetic markup churn inside
   a card but fails loudly if routing/docking changes. Signatures were captured from the
   real pipeline (golden values); regenerate with the same walk if layout intentionally
   changes. */

"use strict";

const { test, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { bootReader } = require("./helpers/readerDom.js");

const FIXTURES = path.join(__dirname, "fixtures");

// A layout unit's signature: the allowlisted classes for a card node (the ones
// layout routes/docks on), or the bare tag name for anything else (headings,
// prose, dividers).
function unitSig(el) {
  const kept = [...el.classList].filter(
    (c) => /-card$/.test(c) || /-stuck$/.test(c) || c === "card-right" || c === "has-stuck-below"
  );
  return kept.length ? kept : el.tagName.toLowerCase();
}
function childSigs(container) {
  return [...container.children].map(unitSig);
}

// Walk the final #page grid into an ordered signature:
//   ["header", [unit,…]]              the pre-first-H2 band
//   ["row", [main units], [aside units]]   a two-column event row
//   ["full", [unit,…]]                a full-width block (H1/H2/HR divider or H1 body)
function signature(page) {
  const out = [];
  const header = page.querySelector(":scope > .page-header");
  if (header) out.push(["header", childSigs(header)]);
  const grid = page.querySelector(":scope > .page-grid");
  if (grid) {
    const kids = [...grid.children];
    for (let i = 0; i < kids.length; i++) {
      const k = kids[i];
      if (k.classList.contains("col-main")) {
        const aside = kids[i + 2]; // col-main, col-divider, col-aside triple
        out.push(["row", childSigs(k), aside ? childSigs(aside) : []]);
        i += 2;
      } else if (k.classList.contains("grid-full")) {
        out.push(["full", childSigs(k)]);
      }
    }
  }
  return out;
}

// Golden signatures captured from the real renderPage() + layout.js pipeline.
const EXPECTED = {
  "basic-scene.md": [["header", ["h1", "p"]], ["full", ["h2"]], ["row", ["blockquote"], []]],
  "classify.md": [["header", ["h1", ["obj-card"], ["combat-card"], ["unexpected-card"]]]],
  "collapsable.md": [["header", ["h1"]], ["full", ["h2"]], ["row", ["p"], []]],
  "combat.md": [["header", ["h1", ["combat-card"]]]],
  // A stuck chain: Object hosts a stuck Item, which hosts a stuck Ability. All land
  // in the header band (the Object heading classifies as an obj-card DIV, not an H2
  // divider), each host flagged has-stuck-below.
  "docked.md": [["header", ["h1",
    ["obj-card", "has-stuck-below"],
    ["item-card", "item-stuck", "has-stuck-below"],
    ["ability-card", "ability-stuck"],
  ]]],
  "item.md": [["header", ["h1", ["item-card"]]]],
  "malformed.md": [["header", ["h1", ["item-card"]]]],
  "manifest.md": [["header", ["h1", ["manifest-card"]]], ["full", ["h2"]], ["row", ["blockquote"], []]],
  // Side: R routes the NPC card into the aside (right) column; main stays empty.
  "npc.md": [["header", ["h1"]], ["full", ["h2"]], ["row", [], [["npc-card", "card-right"]]]],
  "object.md": [["header", ["h1", ["obj-card"]]]],
  "side-image-closed.md": [["header", ["h1", ["std-card", "card-right"]]]],
  "skill-checks.md": [["header", ["h1", ["sc-card", "card-right"]]]],
  // Two default (left) transitions + one Side: R transition (right).
  "transition.md": [["header", ["h1"]], ["full", ["h2"]],
    ["row", [["transition-card"], ["transition-card"]], [["transition-card", "card-right"]]]],
  "unknown-type.md": [["header", ["h1", "h3", "p"]]],
};

let win;
before(async () => {
  win = await bootReader({ withApp: true });
});

// Every fixture on disk must have a golden entry (a new fixture forces a decision
// instead of silently going uncovered).
test("every fixture has a golden layout signature", () => {
  const onDisk = fs.readdirSync(FIXTURES).filter((f) => f.endsWith(".md")).sort();
  const covered = Object.keys(EXPECTED).sort();
  assert.deepEqual(onDisk, covered, "fixtures without a golden entry (add one to EXPECTED)");
});

for (const [file, expected] of Object.entries(EXPECTED)) {
  test(`layout signature: ${file}`, () => {
    const src = fs.readFileSync(path.join(FIXTURES, file), "utf8");
    win.renderPage(src);
    const sig = signature(win.document.getElementById("page"));
    assert.deepEqual(sig, expected);
  });
}
