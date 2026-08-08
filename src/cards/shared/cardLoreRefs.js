/* Lore chips on a card — the render half of the "LoreRef:" directive.

   A card of a type that declares `loreRefs` in the registry may carry one
   "LoreRef: Page/Entry" line per attached lore entry. renderCard.js stamps them onto
   the card element (data-lore-refs, newline separated); this pass turns them into
   small chips in the card's head, next to the collapse toggle.

   It runs AFTER enhanceCardCollapse because the head (.card-head) is that pass's
   doing, and the chips must live inside it — a collapsed card hides everything else,
   and the whole point is to see a card's lore at a glance while it is collapsed.

   Each chip is an .rs-ref-link with a "lore:Page/Entry" data-ref-name, so clicking
   (or Enter/Space on) one goes through the SAME navigation as a [link=lore:...] in
   prose: src/app/refNavigation.js resolves it, runs the unsaved-changes guard, opens
   the page and scrolls to the entry. No navigation code lives here.

   Global (non-module) like the other shared card files. Needs LoreModel for the
   address grammar; RefLibrary is optional (without it a chip simply is not checked
   against the library). */

// The one place a stamped "Page/Entry" line becomes a lore address. LoreModel owns
// the grammar, so a leading "lore:" is tolerated but never required in the file.
function loreRefAddress(raw) {
  if (typeof LoreModel === "undefined") return null;
  const text = String(raw || "").trim();
  if (!text) return null;
  return LoreModel.parseAddress(/^lore\s*:/i.test(text) ? text : "lore:" + text);
}

// Does this address still point at something? Same check refNavigation makes before
// it navigates. Unknown (no RefLibrary loaded) counts as fine — never cry wolf.
function loreRefResolves(address) {
  if (typeof RefLibrary === "undefined" || typeof LoreModel === "undefined") return true;
  const entry = RefLibrary.lookup("lore", address.page);
  if (!entry) return false;
  if (!address.entry) return true;
  return LoreModel.findEntryIndex(LoreModel.parse(entry.source).page, address.entry) >= 0;
}

function loreRefChip(address) {
  const lower = (typeof rsLower !== "undefined") ? rsLower : (s) => String(s).toLowerCase();
  const path = address.page + (address.entry ? "/" + address.entry : "");
  const label = address.entry || address.page;
  const ok = loreRefResolves(address);

  const chip = document.createElement("a");
  // .rs-ref-link + data-ref-name is the whole click/keyboard contract (refNavigation).
  chip.className = "rs-ref-link lore-ref-chip" + (ok ? "" : " is-broken");
  chip.dataset.refName = "lore:" + lower(path);
  chip.setAttribute("role", "link");
  chip.tabIndex = 0;
  chip.textContent = label;
  chip.title = "Lore: " + address.page + (address.entry ? " / " + address.entry : "") +
    (ok ? "" : " — this lore entry no longer exists");
  return chip;
}

/* Build the chip row for every stamped card under `root`. Idempotent: a card that
   already has its row is skipped, so a second pass over the same DOM is a no-op. */
function enhanceLoreRefs(root) {
  if (!root || typeof LoreModel === "undefined") return;
  root.querySelectorAll("[data-lore-refs]").forEach((card) => {
    const head = card.querySelector(":scope > .card-head");
    if (!head) return;

    // With a portrait the head is the figure row: put the chips in its text column,
    // beside the title, instead of after the image.
    const host = head.classList.contains("card-figure")
      ? (head.querySelector(":scope > .card-figure-main") || head)
      : head;
    if (host.querySelector(":scope > .card-lore-refs")) return;

    const addresses = card.dataset.loreRefs.split("\n")
      .map(loreRefAddress)
      .filter(Boolean);
    if (!addresses.length) return;

    const row = document.createElement("div");
    row.className = "card-lore-refs";
    addresses.forEach((address) => row.appendChild(loreRefChip(address)));
    host.classList.add("has-lore-refs");
    host.insertBefore(row, host.firstChild);
  });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { enhanceLoreRefs, loreRefAddress, loreRefResolves };
}
