/* Skill Checks renderer.
   Receives a root DOM element and modifies ONLY the DOM.
   It never fetches files, never touches the sidebar, and never calls
   another renderer. All Skill Check improvements happen in this file.

   It rebuilds each "### …Skill Check…" section into:
     category  ->  skill card  ->  DC rows. */

/* Text phase (runs before marked): inside a Skill Checks section, isolate a bare
   "Side:" line into its own paragraph so a card written with "Az Enter" (no blank
   line before the first check/category) still exposes the Side directive as a
   standalone node. Without this the line glues to the next line into one
   paragraph and the renderer can't see it — mirrors the other card normalizers. */
function normalizeSkillChecksMarkdown(text) {
  return normalizeSectionDirectives(text, {
    startsSection: (line) => /^#{2,3}\s+/.test(line) && rsLower(line).includes("skill check"),
    endsSection: (line) => /^#{1,3} /.test(line),
    shouldIsolate: (line) => /^side\s*:/i.test(line.trim()),
  });
}

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

// One DC line ("15: text" / "1: text" / "F: text") -> a row with a compact badge.
function scRow(line, noDC) {
  const row = document.createElement("div");
  row.className = "sc-row";

  // Failure line: "F: …" gets its own neutral (charcoal) channel.
  const f = line.match(/^F:\s*(.+)$/i);
  if (f) {
    row.classList.add("sc-row-fail");
    const badge = document.createElement("span");
    badge.className = "sc-badge sc-badge-fail";
    badge.textContent = "✗ F";
    row.appendChild(badge);
    const text = document.createElement("span");
    text.className = "sc-text";
    text.textContent = f[1];
    row.appendChild(text);
    return row;
  }

  const m = line.match(/^(\d+):\s*(.+)$/);
  if (m) {
    const dc = parseInt(m[1], 10);
    const badge = document.createElement("span");
    badge.className = "sc-badge";
    // DC difficulty tint: only for real DCs (not Speak-with-Dead sequence
    // numbers, and not the special "0" auto-result).
    if (!noDC && dc >= 1) badge.classList.add(scDcClass(dc));
    badge.textContent = noDC ? m[1] : "DC " + m[1];
    row.appendChild(badge);
    const text = document.createElement("span");
    text.className = "sc-text";
    text.textContent = m[2];
    row.appendChild(text);
  } else {
    const text = document.createElement("span");
    text.className = "sc-text";
    text.textContent = line;
    row.appendChild(text);
  }
  return row;
}

// One <li> ("Skill:<blockquote>…</blockquote>") -> two grid cells
// (skill name + its DC rows) appended to a shared .sc-grid, so every skill
// name in a topic aligns to one shared column.
function scAppendSkill(grid, li) {
  const blocks = [...li.querySelectorAll("blockquote")];
  const naked = li.cloneNode(true);
  naked.querySelectorAll("blockquote").forEach((b) => b.remove());
  const name = naked.textContent.trim().replace(/:\s*$/, "");

  // Resolve display name, leading icon (ability or special), and noDC.
  const { display, icon, mystic, noDC } = scResolveSkill(name);

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
  let prevDC = null; // for ascending-DC validation
  blocks.forEach((bq) =>
    bq.querySelectorAll("p").forEach((p) =>
      p.textContent.split("\n").forEach((line) => {
        line = line.trim();
        if (!line) return;
        if (!noDC) {
          const dm = line.match(/^(\d+):/);
          if (dm) {
            const dc = parseInt(dm[1], 10);
            if (prevDC !== null && dc < prevDC) {
              console.warn(`Skill "${name}": DC out of order (${prevDC} -> ${dc})`);
            }
            prevDC = dc;
          }
        }
        rows.appendChild(scRow(line, noDC));
      })
    )
  );
  grid.appendChild(rows);
}

// Render a sequence of Skill-Check source nodes into a .skillchecks box.
// Shared by buildSkillChecksCard and obj.js so both look identical.
// A run of consecutive lists shares one grid; a category or any other node
// breaks the run so the next list starts a fresh grid (and column width).
function renderSkillCheckNodes(box, nodes) {
  let grid = null;
  nodes.forEach((node) => {
    if (node.tagName === "P" && node.textContent.trim().endsWith(":")) {
      grid = null;
      const cat = document.createElement("div");
      cat.className = "sc-category";
      cat.textContent = node.textContent.trim().replace(/:\s*$/, "");
      box.appendChild(cat);
    } else if (node.tagName === "UL") {
      if (!grid) {
        grid = document.createElement("div");
        grid.className = "sc-grid";
        box.appendChild(grid);
      }
      [...node.children].forEach((li) => scAppendSkill(grid, li));
    } else if (node.tagName === "BLOCKQUOTE") {
      grid = null;
      // Standalone description (read to players) — keep it as a read-aloud box.
      box.appendChild(cloneAsReadAloud(node));
    } else {
      grid = null;
      box.appendChild(node.cloneNode(true));
    }
  });
}

// Build one Skill Checks card from its heading + body nodes (produced by marked
// from the card's parsed source). Returns the card element.
function buildSkillChecksCard(head, nodes) {
  // Outer panel that also holds the "Skill Checks" heading.
  const card = document.createElement("div");
  card.className = "sc-card";

  // "Side: R" moves the card to the right column; it is pulled out of the
  // rendered nodes so it never shows as a stray line.
  const renderNodes = nodes.filter((n) => {
    const side = n.tagName === "P" && n.textContent.trim().match(CARD_SIDE_LINE);
    if (side) {
      if (cardSideIsRight(side[1])) card.classList.add("card-right");
      return false;
    }
    return true;
  });

  const title = document.createElement("div");
  title.className = "sc-card-title";
  title.textContent = head.textContent.trim();
  card.appendChild(title);

  const box = document.createElement("div");
  box.className = "skillchecks";
  renderSkillCheckNodes(box, renderNodes);
  card.appendChild(box);

  return card;
}

/* Self-register with the runtime card registry (cards/shared/cardRegistry.js). */
if (typeof RendScrollCards !== "undefined") {
  RendScrollCards.register("skillchecks", { build: buildSkillChecksCard, normalize: normalizeSkillChecksMarkdown });
}
