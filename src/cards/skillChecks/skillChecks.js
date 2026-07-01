/* Skill Checks renderer.
   Receives a root DOM element and modifies ONLY the DOM.
   It never fetches files, never touches the sidebar, and never calls
   another renderer. All Skill Check improvements happen in this file.

   It rebuilds each "### …Skill Check…" section into:
     category  ->  skill card  ->  DC rows. */

// Difficulty band for a DC value -> badge tint class.
function scDcClass(dc) {
  if (dc <= 10) return "sc-dc-easy";
  if (dc <= 14) return "sc-dc-medium";
  if (dc <= 19) return "sc-dc-hard";
  return "sc-dc-deadly";
}

// Resolve a raw skill name -> { display, icon, mystic, noDC }.
function scResolveSkill(name) {
  return RendScrollSkillChecks.resolveSkill(name);
}

/* ---------- Structured renderer (consumes the parsed AST checkGroups) ----------
   The parser already turns a "Checks:" block into structured entries
   (RendScrollParser.parseChecks): { kind:"check", skill, outcomes:[{kind,dc,text}] }
   | { kind:"category", label } | { kind:"raw", text }. renderSkillChecks renders
   those directly, with no marked → DOM → re-sniff round-trip. Shared by the
   migrated skillchecks/obj/combat/npc builders. */

// One structured outcome -> a .sc-row (mirrors scRow but reads {kind,dc,text}).
function scOutcomeRow(outcome, noDC) {
  const row = document.createElement("div");
  row.className = "sc-row";

  if (outcome.kind === "failure") {
    row.classList.add("sc-row-fail");
    const badge = document.createElement("span");
    badge.className = "sc-badge sc-badge-fail";
    badge.textContent = "✗ F";
    row.appendChild(badge);
    const text = document.createElement("span");
    text.className = "sc-text";
    text.textContent = outcome.text;
    row.appendChild(text);
    return row;
  }

  if (outcome.kind === "dc") {
    const dc = parseInt(outcome.dc, 10);
    const badge = document.createElement("span");
    badge.className = "sc-badge";
    if (!noDC && dc >= 1) badge.classList.add(scDcClass(dc));
    badge.textContent = noDC ? String(outcome.dc) : "DC " + outcome.dc;
    row.appendChild(badge);
    const text = document.createElement("span");
    text.className = "sc-text";
    text.textContent = outcome.text;
    row.appendChild(text);
    return row;
  }

  const text = document.createElement("span");
  text.className = "sc-text";
  text.textContent = outcome.text;
  row.appendChild(text);
  return row;
}

// One structured check entry -> name cell + DC-rows cell in the shared grid.
function scAppendCheck(grid, entry) {
  const { display, icon, mystic, noDC } = scResolveSkill(entry.skill);

  const nameCell = document.createElement("div");
  nameCell.className = "sc-skill-name";
  if (mystic) nameCell.classList.add("sc-skill-special");
  if (icon) {
    const iconEl = document.createElement("span");
    iconEl.className = "sc-skill-icon";
    iconEl.textContent = icon;
    nameCell.appendChild(iconEl);
    nameCell.appendChild(document.createTextNode(display));
  } else {
    nameCell.textContent = display;
  }
  grid.appendChild(nameCell);

  const rows = document.createElement("div");
  rows.className = "sc-skill-rows";
  let prevDC = null; // ascending-DC validation
  (entry.outcomes || []).forEach((o) => {
    if (!noDC && o.kind === "dc") {
      const dc = parseInt(o.dc, 10);
      if (prevDC !== null && dc < prevDC) {
        console.warn(`Skill "${entry.skill}": DC out of order (${prevDC} -> ${dc})`);
      }
      prevDC = dc;
    }
    rows.appendChild(scOutcomeRow(o, noDC));
  });
  grid.appendChild(rows);
}

// Render structured check entries into a .skillchecks box. Consecutive checks
// share one grid (aligned skill-name column); a category or raw entry breaks the
// run so the next check starts a fresh grid.
function renderSkillChecks(box, checks) {
  let grid = null;
  (checks || []).forEach((entry) => {
    if (entry.kind === "category") {
      grid = null;
      const cat = document.createElement("div");
      cat.className = "sc-category";
      cat.textContent = String(entry.label || "").trim();
      box.appendChild(cat);
    } else if (entry.kind === "check") {
      if (!grid) {
        grid = document.createElement("div");
        grid.className = "sc-grid";
        box.appendChild(grid);
      }
      scAppendCheck(grid, entry);
    } else if (entry.kind === "raw") {
      grid = null;
      // A standalone line (e.g. a "> description" read to players) — render it
      // through marked; a blockquote becomes a read-aloud box, as before.
      renderMarkdownEls(String(entry.text || "")).forEach((n) =>
        box.appendChild(n.tagName === "BLOCKQUOTE" ? cloneAsReadAloud(n) : n));
    }
  });
}

// Build one Skill Checks card from its parsed AST node. The whole body is one
// check group (parser special-cases the type), rendered from structured entries.
function buildSkillChecksCard(cardNode, head, nodes) {
  const card = document.createElement("div");
  card.className = "sc-card";

  // "Side: R" comes from the resolved directive (parser folds it into column).
  if (cardIsRight(cardNode)) card.classList.add("card-right");

  const title = document.createElement("div");
  title.className = "sc-card-title";
  title.textContent = head.textContent.trim();
  card.appendChild(title);

  const box = document.createElement("div");
  box.className = "skillchecks";
  const group = (cardNode && cardNode.checkGroups && cardNode.checkGroups[0]) || null;
  renderSkillChecks(box, group ? group.checks : []);
  card.appendChild(box);

  return card;
}

/* Self-register with the runtime card registry (cards/shared/cardRegistry.js).
   No normalizer: the builder reads checkGroups from the parsed AST node. */
if (typeof RendScrollCards !== "undefined") {
  RendScrollCards.register("skillchecks", { build: buildSkillChecksCard });
}
