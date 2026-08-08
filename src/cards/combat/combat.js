/* Combat card builder: classification, body parse, and card structure.

   The combat feature is four files, each with one job:
     enemyModel.js   parse/serialize enemy records          (pure, tested)
     enemyRoster.js  render those records as stat blocks    (DOM, no state)
     combatRunner.js the live at-the-table session          (owns SessionState)
     combat.js       this file — parse the card body, build the card
   Load order is that order; each layer only calls the ones above it.

   It never fetches files and never touches the sidebar.

   A Combat block is written as:

     ### Combat: Name
     `DM note (a side note, not read-aloud)`     (optional)
     Stat:
     - AC 16 | HP 80 | Speed 30 ft.
     - Attack: ...
     Tactics:
     - ...
     Special Mechanic:      (any "Label:" line opens a new titled sub-section)
     - ...

   Layout produced (a single .combat-card):
     - title
     - leading "> ..." blocks   -> read-aloud DM blocks
     - inline-code lines         -> DM side notes (kept as-is)
     - each "Label:" line         -> a titled sub-section header, with the list /
                                     content that follows grouped under it

   The card renders in the left column by default; a "Side: R" line moves it to
   the right column. */

// A bare "Label:" line (letters/spaces only, ending in a colon) opens a combat
// sub-section. Canonical regex lives in the parser; reuse it so the rule is not
// restated. Read-aloud (">") and list ("-") lines never match.
function combatLabelText(line) {
  const t = String(line).trim();
  return RendScrollParser.regexes.COMBAT_LABEL_RE.test(t) ? t.replace(/\s*:\s*$/, "") : "";
}

function combatSectionTitle(text) {
  const el = document.createElement("div");
  el.className = "combat-section-title";
  el.textContent = text;
  return el;
}

// Pure per-type body parser: AST card node -> ordered combat segments. Walks the
// body in source order (cardOrderedBody), classifying each line as a "Checks:"
// group, a bare "Label:" that opens a sub-section (an "Enemies:" roster collects
// the bullet lines that follow it; any other label is a plain titled section), or a
// content run. The builder maps segments to DOM + expands/renders enemies; keeping
// the classification here as one named function mirrors the shared-parse discipline.
//   { kind: "checks",  label, checks }
//   { kind: "enemies", label, lines }   bullet lines feeding the roster
//   { kind: "section", label }          any other "Label:" sub-section
//   { kind: "lines",   lines }          a contiguous content run
function parseCombatBody(cardNode) {
  const segs = [];
  let enemyTarget = null;
  cardOrderedBody(cardNode).forEach((seg) => {
    if (seg.kind === "checks") {
      segs.push({ kind: "checks", label: seg.label || "Checks", checks: seg.checks });
      enemyTarget = null;
      return;
    }
    seg.lines.forEach((line) => {
      const label = combatLabelText(line);
      if (label) {
        if (rsLower(label).trim() === "enemies") {
          enemyTarget = { kind: "enemies", label, lines: [] };
          segs.push(enemyTarget);
        } else {
          segs.push({ kind: "section", label });
          enemyTarget = null;
        }
        return;
      }
      if (enemyTarget) { if (line.trim()) enemyTarget.lines.push(line); return; }
      const last = segs[segs.length - 1];
      if (last && last.kind === "lines") last.lines.push(line);
      else segs.push({ kind: "lines", lines: [line] });
    });
  });
  return segs;
}

// Build one Combat card from its parsed AST node. Image/Side come from the resolved
// directives; the Checks / Enemies / sub-section / content segments come from the
// shared parseCombatBody.
function buildCombatCard(cardNode, head, nodes, context) {
    const card = document.createElement("div");
    card.className = "combat-card";

    const title = document.createElement("div");
    title.className = "combat-title";
    title.textContent = head.textContent.trim().replace(/^\s*combat\s*:\s*/i, "").trim();

    // Header = title + leading content (before the first "Label:" section),
    // placed beside the portrait when an Image is given; sections flow below.
    const headEls = [title];
    const imageRaw = cardDirective(cardNode, "image").trim();
    if (cardIsRight(cardNode)) card.classList.add("card-right");

    let headOpen = true;        // leading content goes beside the portrait
    const enemyRecords = [];    // structured enemies powering roster + live runner

    parseCombatBody(cardNode).forEach((seg) => {
      if (seg.kind === "checks") {
        // "Checks:" renders identically to the Skill Checks panel (and Object's).
        headOpen = false;
        const section = document.createElement("div");
        section.className = "combat-section";
        section.appendChild(combatSectionTitle(seg.label));
        const box = document.createElement("div");
        box.className = "skillchecks";
        renderSkillChecks(box, seg.checks);
        section.appendChild(box);
        card.appendChild(section);
        return;
      }
      if (seg.kind === "enemies") {
        headOpen = false;
        const section = document.createElement("div");
        section.className = "combat-section";
        section.appendChild(combatSectionTitle(seg.label));
        const rosterBox = document.createElement("div");
        rosterBox.className = "combat-roster";
        section.appendChild(rosterBox);
        card.appendChild(section);
        const recs = CombatEnemyModel.expandEnemies(
          CombatEnemyModel.parseEnemyBlock(seg.lines), enemySourceResolver);
        recs.forEach((r) => enemyRecords.push(r));
        renderCombatRoster(rosterBox, recs);
        return;
      }
      if (seg.kind === "section") {
        headOpen = false;
        card.appendChild(combatSectionTitle(seg.label));
        return;
      }
      renderMarkdownEls(seg.lines.join("\n")).forEach((el) => {
        const node = cloneAsReadAloud(el);
        if (headOpen) headEls.push(node); // leading content stays beside portrait
        else card.appendChild(node);
      });
    });

    // When the card defines enemies, attach the live combat runner (Start Combat
    // -> initiative/turn order -> per-enemy HP tracking). State is ephemeral.
    if (enemyRecords.length) {
      const runner = document.createElement("div");
      runner.className = "combat-runner";
      card.appendChild(runner);
      renderCombatRunner(runner, enemyRecords, context || {});
    }

    // Place the header at the top: wrapped beside the portrait when an Image was
    // given, otherwise as plain stacked elements (no empty portrait reserved).
    insertCardHeader(card, headEls, imageRaw);

    return card;
}

// Resolve a live "[enemy=Name]" combat reference to its library source record.
// Returns null (-> a "(missing)" placeholder) when the library isn't loaded or
// the file is absent. Mirrors app.js's itemSourceResolver for items.
function enemySourceResolver(name) {
  if (typeof RefLibrary === "undefined") return null;
  const entry = RefLibrary.lookup("enemy", name);
  return entry ? CombatEnemyModel.parseSourceEnemy(entry.source) : null;
}

// A standalone library enemy (Enemies/Name.md, "### SourceEnemy:"): render the
// lone enemy as a stat block, reusing the combat roster. No live runner — this is
// a reference view, identical in look to one enemy inside a combat card. The lone
// enemy block is the card body, parsed straight from source via parseEnemyBlock.
function buildSourceEnemyCard(cardNode, head, nodes) {
  const card = document.createElement("div");
  card.className = "combat-card sourceenemy-card";
  const recs = CombatEnemyModel.parseEnemyBlock(cardBodyLines(cardNode));
  const box = combatEl("div", "combat-roster");
  renderCombatRoster(box, recs.length ? recs : [CombatEnemyModel.blankEnemy()]);
  card.appendChild(box);
  return card;
}

/* Self-register with the runtime card registry (cards/shared/cardRegistry.js).
   No normalizer: both builders read directives/checkGroups/body from the AST node. */
if (typeof RendScrollCards !== "undefined") {
  RendScrollCards.register("combat", { build: buildCombatCard, cssClass: "combat-card", titleClass: "combat-title", accentClass: "combat-section" });
  // Root carries "combat-card sourceenemy-card"; combat-card is the identifying one
  // (layout's cardTypeOf reads the first *-card class).
  RendScrollCards.register("sourceenemy", { build: buildSourceEnemyCard, cssClass: "combat-card" });
}

if (typeof window !== "undefined") window.parseCombatBody = parseCombatBody;
if (typeof module !== "undefined" && module.exports) module.exports = { parseCombatBody };
