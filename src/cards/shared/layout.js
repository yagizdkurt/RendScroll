/* Two-column layout.
   Runs LAST in the render pipeline (after the feature card builders and base
   styling). It only RE-ARRANGES the existing direct children of #page into a
   header band + a two-column grid. It creates no content and reads no files.

   Layout:
     #page
      ├─ .page-header   full width: everything before the first <h2>
      └─ .page-grid     two columns (50/50), with per-event dividers
           ├─ .col-main / .col-divider / .col-aside   one set per event
           └─ .grid-full               each <h1> divider spans both columns */

// Every card renders in the left column by default; a "Side: R" line makes its
// renderer tag the card with .card-right, which is the only thing that routes a
// node to the right (aside) column. Plain narrative content has no class and
// stays on the left.
function layoutIsAside(node) {
  return !!(node.classList && node.classList.contains("card-right"));
}

// Read a card type ("item"/"obj"/…) off a rendered card <div> by its "<type>-card"
// class, and whether it is a "<type>-stuck" docked card. The DOM adapter that lets
// layout reuse the parser's canonical dock rule instead of re-encoding it.
function cardTypeOf(node) {
  const cls = [...node.classList].find((c) => /-card$/.test(c));
  return cls ? cls.replace(/-card$/, "") : null;
}
function cardStuckOf(node, type) {
  return !!type && node.classList.contains(type + "-stuck");
}

// Whether a "Yapışık" card (node) may dock seamlessly under the last-placed host
// card. The rule itself lives once in the parser (RendScrollParser.dockAllows); a
// stuck item hangs off an Obje or another stuck item, a stuck ability off an item,
// an Obje, or another stuck ability.
function canDockUnder(node, host) {
  const nt = cardTypeOf(node);
  const ht = cardTypeOf(host);
  return RendScrollParser.dockAllows(nt, cardStuckOf(node, nt), ht, cardStuckOf(host, ht));
}

// --- Sticky docking, shared by every placement context (header / H1 full
// section / two-column body). The connect RULES live solely in canDockUnder;
// these helpers only carry out the placement, so a new connect type means
// editing canDockUnder alone — not each loop below.

// Try to dock `node` under the last-placed host recorded in `state`. On a
// match the node is appended to the host's OWN container (not the requested
// one), so the dock overrides default column routing. Returns true if docked.
function tryDock(node, state) {
  if (
    node.classList &&
    state.lastPlaced &&
    canDockUnder(node, state.lastPlaced.node)
  ) {
    state.lastPlaced.node.classList.add("has-stuck-below");
    state.lastPlaced.col.appendChild(node);
    state.lastPlaced = { node, col: state.lastPlaced.col };
    return true;
  }
  return false;
}

// Append `node` to `container` and record it as the new dock host.
function place(node, container, state) {
  container.appendChild(node);
  state.lastPlaced = { node, col: container };
}

// Unified entry: dock if possible, otherwise place into `container`.
function dockOrPlace(node, container, state) {
  if (!tryDock(node, state)) place(node, container, state);
}

function layoutTwoColumns(root) {
  const all = [...root.children];

  // --- Header: everything up to the first H2 (event). ---
  const header = document.createElement("div");
  header.className = "page-header";

  // The header is a single column, so docking just stacks cards within it —
  // this is what makes connect work when there are no events (no H2) at all.
  const headerState = { lastPlaced: null };
  let i = 0;
  for (; i < all.length && all[i].tagName !== "H2"; i++) {
    dockOrPlace(all[i], header, headerState); // moves the node out of root
  }

  // No events at all -> the whole page is just the header band.
  if (i >= all.length) {
    root.append(header);
    return;
  }

  // --- Body: split the remaining nodes into rows. ---
  const grid = document.createElement("div");
  grid.className = "page-grid";

  let main = null;
  let aside = null;
  let fullMode = false; // inside an H1 section: content stays full-width until H2
  let fullBox = null;   // current full-width content container (H1 section body)
  // Single docking context for the whole body — shared by both columns and the
  // H1 full-width box. Reset at every new event/heading below.
  const bodyState = { lastPlaced: null };

  // Open a fresh event row (a main/aside cell pair) and place it in the grid.
  function newRow() {
    main = document.createElement("div");
    main.className = "col-main";
    const divider = document.createElement("div");
    divider.className = "col-divider";
    divider.setAttribute("aria-hidden", "true");
    aside = document.createElement("div");
    aside.className = "col-aside";
    grid.append(main, divider, aside);
    bodyState.lastPlaced = null; // a new event starts a fresh sticky context
  }

  // Emit a standalone full-width divider node (heading / separator).
  function gridFull(node) {
    main = aside = fullBox = null;
    bodyState.lastPlaced = null;
    const full = document.createElement("div");
    full.className = "grid-full";
    full.appendChild(node);
    grid.appendChild(full);
  }

  for (; i < all.length; i++) {
    const node = all[i];

    // H1 opens a full-width section (its body spans both columns until the next
    // H2). H2 closes it and resumes the two-column event layout. HR is a plain
    // full-width separator and keeps whichever mode is active.
    if (node.tagName === "H1") { fullMode = true; gridFull(node); continue; }
    if (node.tagName === "H2") { fullMode = false; gridFull(node); continue; }
    if (node.tagName === "HR") { gridFull(node); continue; }

    // Body of an H1 section: collect into one full-width container. Docking
    // still applies so a "Yapışık: T" card stacks under its host here too.
    if (fullMode) {
      if (!fullBox) {
        fullBox = document.createElement("div");
        fullBox.className = "grid-full";
        grid.appendChild(fullBox);
      }
      dockOrPlace(node, fullBox, bodyState);
      continue;
    }

    if (!main) newRow();

    // A "Yapışık: T" card docks under the preceding host in that host's OWN
    // column — overriding the default aside placement. dockOrPlace tries the
    // dock first (see canDockUnder for the rules); only if it can't dock does
    // it route to the requested column, so the flag bites only when the card is
    // truly right below its host.
    const container = layoutIsAside(node) ? aside : main;
    dockOrPlace(node, container, bodyState);
  }

  root.append(header, grid);
}
