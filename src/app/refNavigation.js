/* ============================================================
   Inline [link=Name] navigation: jump to an on-page card (open
   any collapsed ancestors + flash it), or — when the referenced
   card isn't on this page — show it in a floating preview
   popover. Broken links flash red; the Debug panel reports them.
   ============================================================ */

function findCardByRefName(name) {
  const key = rsLower(String(name).trim());
  const sel = (window.CSS && CSS.escape) ? CSS.escape(key) : key.replace(/"/g, '\\"');
  return page.querySelector('[data-ref-name="' + sel + '"]');
}

// Open every collapsed card/heading hiding `el`, so a jump never lands on
// invisible content. Reuses the existing collapse toggles (cardCollapse.js /
// HeadingCollapse) so collapse state stays consistent.
function revealElement(el) {
  let node = el;
  while (node && node !== page) {
    if (node.classList && node.classList.contains("is-collapsed")) {
      const btn = node.querySelector(":scope > .card-head > .card-toggle");
      if (btn) btn.click();
    }
    node = node.parentElement;
  }
  let guard = 0;
  while (el.offsetParent === null && guard++ < 50) {
    const collapsed = [...page.querySelectorAll(".heading-collapsed")];
    if (!collapsed.length) break;
    let toOpen = collapsed[0];
    for (const h of collapsed) {
      if (h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) toOpen = h;
    }
    const btn = toOpen.querySelector(":scope > .card-toggle");
    if (!btn) break;
    btn.click();
  }
}

function flashCard(el) {
  el.classList.add("ref-flash");
  setTimeout(() => el.classList.remove("ref-flash"), 1200);
}

function flashBrokenLink(a) {
  a.classList.add("rs-ref-link-broken");
  setTimeout(() => a.classList.remove("rs-ref-link-broken"), 1200);
}

let activePreview = null;
function closeRefPreview() {
  if (!activePreview) return;
  activePreview.remove();
  activePreview = null;
  document.removeEventListener("mousedown", onPreviewOutside, true);
  document.removeEventListener("keydown", onPreviewKey, true);
}
function onPreviewOutside(e) {
  if (activePreview && !activePreview.contains(e.target)) closeRefPreview();
}
function onPreviewKey(e) {
  if (e.key === "Escape") closeRefPreview();
}

function positionPreview(pop, anchor) {
  const r = anchor.getBoundingClientRect();
  const margin = 8;
  pop.style.position = "fixed";
  pop.style.visibility = "hidden";
  pop.style.left = "0px";
  pop.style.top = "0px";
  const pr = pop.getBoundingClientRect();
  let left = Math.min(r.left, window.innerWidth - pr.width - margin);
  let top = r.bottom + margin;
  if (top + pr.height > window.innerHeight - margin) top = r.top - pr.height - margin;
  pop.style.left = Math.max(margin, left) + "px";
  pop.style.top = Math.max(margin, top) + "px";
  pop.style.visibility = "";
}

// Render the referenced library card into a floating popover anchored to the
// link, for references whose card isn't on the current page.
function showRefPreview(anchor, type, name) {
  closeRefPreview();
  if (typeof RefLibrary === "undefined") return;
  const resolved = RefLibrary.resolve(type, name);
  if (!resolved.ok) { flashBrokenLink(anchor); return; }
  const pop = document.createElement("div");
  pop.className = "ref-preview-popover";
  const { cardEl, els } = renderCardFromSource(resolved.cardType, resolved.source);
  const content = cardEl || (els && els[0]);
  if (!content) { flashBrokenLink(anchor); return; }
  pop.appendChild(content);
  document.body.appendChild(pop);
  positionPreview(pop, anchor);
  activePreview = pop;
  setTimeout(() => {
    document.addEventListener("mousedown", onPreviewOutside, true);
    document.addEventListener("keydown", onPreviewKey, true);
  }, 0);
}

function activateRefLink(a) {
  const name = a.dataset.refName || "";
  const target = findCardByRefName(name);
  if (target) {
    revealElement(target);
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    flashCard(target);
    return;
  }
  if (typeof RefLibrary !== "undefined") {
    const found = RefLibrary.lookupAny(name);
    if (found) { showRefPreview(a, found.type, found.entry.name); return; }
  }
  // Broken: the Debug panel reports it; give a small visual nudge here.
  flashBrokenLink(a);
}

function installRefLinkHandler() {
  page.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest(".rs-ref-link");
    if (!a || !page.contains(a)) return;
    e.preventDefault();
    activateRefLink(a);
  });
  page.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const a = e.target.closest && e.target.closest(".rs-ref-link");
    if (!a) return;
    e.preventDefault();
    activateRefLink(a);
  });
}
