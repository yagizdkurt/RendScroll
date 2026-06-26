/* ============================================================
   Entry point: builds the sidebar, reacts to file selection,
   and orchestrates the render pipeline. Stays small on purpose.
   Feature-specific rendering lives in renderers/*.js.
   ============================================================ */

const SIDEBAR_COLLAPSED_KEY = "sidebarCollapsed";
const TOP_SCROLL_IMAGE = "src/STDImages/RendScroll1.png";

const nav = document.getElementById("nav");
const page = document.getElementById("page");
const sidebarToggle = document.getElementById("sidebar-toggle");
const newPageButton = document.getElementById("new-page-button");
let currentPath = null;
let campaignEntries = [];

/* Known label lines from the template that should stand out. */
const FIELD_LABELS = new Set([
  "kişilik:", "ilk diyalog:", "sorarsa:", "bildikleri:", "bilmedikleri:",
  "stat:", "taktik:", "genel:", "cesetler:", "köpek:", "sandıklar:",
  "amaç:", "öz:", "kültist:", "cult hunter:",
]);

function createTopScrollImage() {
  const wrap = document.createElement("div");
  wrap.className = "top-scroll-image";

  const img = document.createElement("img");
  img.src = TOP_SCROLL_IMAGE;
  img.alt = "";
  img.decoding = "async";

  wrap.appendChild(img);
  return wrap;
}

/* Base styling shared by every scene (not tied to one feature). */
function enhanceBaseStyling(root) {
  // Read-aloud boxes.
  root.querySelectorAll("blockquote").forEach((bq) => bq.classList.add("read-aloud"));

  // Section headings get an accent based on their text.
  root.querySelectorAll("h2, h3").forEach((h) => {
    const t = rsLower(h.textContent);
    if (t.includes("skill check")) h.classList.add("skill-section");
    else if (t.includes("npc")) h.classList.add("npc-section");
    else if (t.includes("savaş")) h.classList.add("combat-section");
    else if (t.includes("beklenmedik")) h.classList.add("contingency-section");
    else if (t.includes("yankı")) h.classList.add("echo-section");
  });

  // Short "Label:" paragraphs become emphasized field labels.
  root.querySelectorAll("p").forEach((p) => {
    const t = p.textContent.trim();
    const isKnown = FIELD_LABELS.has(rsLower(t));
    const looksLikeLabel = t.endsWith(":") && t.length <= 24 && !t.includes(" ");
    if (isKnown || looksLikeLabel) p.classList.add("field-label");
  });
}

/* Render a scene from raw markdown via the RendScroll parser model.

   Pipeline: parse -> walk the document model -> for each card, render its
   (per-card normalized) source through marked and hand the heading + body nodes
   to that card type's builder; non-card blocks render straight through marked.
   Card discovery is driven by the parser, NOT by scanning a flat HTML DOM — this
   replaced the old global normalize* + sibling-walking enhancers.

   After the flat card/heading DOM exists, the shared passes run exactly as
   before: base styling, per-card collapse, the two-column layout, and heading
   collapse. */

// Card type -> builder(headingEl, bodyEls) -> card element (or null to leave the
// bare heading, mirroring each old enhancer's "no body -> skip" behaviour).
const CARD_BUILDERS = {
  skillchecks: buildSkillChecksCard,
  npc: buildNpcCard,
  item: buildItemCard,
  ability: buildAbilityCard,
  obj: buildObjCard,
  combat: buildCombatCard,
  unexpected: buildUnexpectedCard,
  std: buildStdCard,
};

const CARD_TEXT_SIZE_DEFAULT_PX = 18.24; // current .page p default: 1.14rem at 16px
const CARD_TEXT_SIZE_RE = /^\s*text\s*size\s*:\s*(\d+(?:\.\d+)?)\s*$/i;

function validCardTextSize(value) {
  const n = Number(value);
  return /^\d+(?:\.\d+)?$/.test(String(value || "")) && n >= 8 && n <= 32;
}

function cardTextSize(card) {
  const d = card.directives.find((x) => x.name === "textsize");
  return d && validCardTextSize(d.value) ? Number(d.value) : null;
}

function stripCardTextSize(src) {
  return String(src || "")
    .split(/\r?\n/)
    .filter((line) => {
      const m = line.match(CARD_TEXT_SIZE_RE);
      return !(m && validCardTextSize(m[1]));
    })
    .join("\n");
}

function applyCardTextSize(cardEl, size) {
  if (!cardEl || !cardEl.classList || size == null) return;
  cardEl.style.setProperty("--rs-card-text-scale", String(size / CARD_TEXT_SIZE_DEFAULT_PX));
}

/* Per-card source isolation, selected by the parsed card type. Each helper only
   isolates directive/label lines WITHIN its own card (the card source starts with
   its heading), so a card written with "Az Enter" still parses. This is the
   AST-scoped replacement for the old global normalize* pipeline. */
function isolateCardSource(type, src) {
  switch (type) {
    case "skillchecks": src = normalizeSkillChecksMarkdown(src); break;
    case "item": src = normalizeItemMarkdown(src); break;
    case "npc": src = normalizeNpcMarkdown(src); break;
    case "obj": src = normalizeObjMarkdown(src); break;
    case "ability": src = normalizeAbilityMarkdown(src); break;
    case "combat": src = normalizeCombatMarkdown(src); break;
    case "std": src = normalizeStdMarkdown(src); break;
    case "unexpected": src = normalizeUnexpectedMarkdown(src); break;
    default: break; // "echo"/unknown: rendered as a plain heading + body
  }
  return normalizeClosedMarkdown(src); // "Closed:" may appear in any card
}

// Render a markdown string and return its top-level ELEMENT nodes (the old
// pipeline only ever walked element siblings, so text/whitespace nodes are
// dropped here too).
function markedToElements(md) {
  const tmp = document.createElement("div");
  tmp.innerHTML = renderMarkdown(md);
  return [...tmp.children];
}

function cardRawSource(doc, card) {
  return doc.raw.slice(card.range.startOffset, card.range.endOffset);
}

// Heading element for a section, carrying the AST "Collapsable:" flag (which
// replaces the old markHeadingCollapsable DOM scan).
function renderSectionHeading(doc, section) {
  const els = markedToElements(RendScrollParser.lineText(doc.lines[section.headingRange.startLine]));
  const h = els[0];
  if (h && section.collapsable !== null && section.collapsable !== undefined) {
    h.dataset.collapsable = section.collapsable ? "true" : "false";
  }
  return h;
}

// One card block -> the element(s) to append. A builder turns (heading, body
// nodes) into a card; a missing builder or a null result leaves the raw nodes.
function renderCardBlock(doc, card) {
  const builder = CARD_BUILDERS[card.type];
  const src = stripCardTextSize(cardRawSource(doc, card));
  const els = markedToElements(isolateCardSource(card.type, src));
  if (!builder) return els;
  const cardEl = builder(els[0], els.slice(1));
  applyCardTextSize(cardEl, cardTextSize(card));
  return cardEl ? [cardEl] : els;
}

function renderPage(text) {
  const doc = RendScrollParser.parseRendScroll(text);
  page.innerHTML = "";
  page.appendChild(createTopScrollImage());

  doc.sections.forEach((section) => {
    if (section.headingRange) {
      const h = renderSectionHeading(doc, section);
      if (h) page.appendChild(h);
    }
    // Consecutive non-card blocks (narrative / plain / HR) are rendered together
    // from their original source slice, so marked sees them exactly as it did in
    // the old whole-document parse (e.g. a list immediately followed by a "> …"
    // blockquote stays one structure). A card boundary flushes the run.
    let buffer = [];
    const flushNonCards = () => {
      if (!buffer.length) return;
      const a = buffer[0].range.startOffset;
      const b = buffer[buffer.length - 1].range.endOffset;
      // Heading-level "Collapsable:" lines live on the section, never shown.
      const src = doc.raw.slice(a, b)
        .split(/\r?\n/)
        .filter((l) => !RendScrollParser.regexes.COLLAPSABLE_RE.test(l.trim()))
        .join(doc.eol);
      markedToElements(src).forEach((el) => page.appendChild(el));
      buffer = [];
    };
    section.blocks.forEach((block) => {
      if (block.kind === "card") {
        flushNonCards();
        renderCardBlock(doc, block).forEach((el) => page.appendChild(el));
      } else {
        buffer.push(block);
      }
    });
    flushNonCards();
  });

  enhanceBaseStyling(page);
  enhanceCardCollapse(page);
  // Re-arrange the styled nodes into the header band + two-column grid.
  layoutTwoColumns(page);
  // After the grid exists, add collapse toggles to the main event headings.
  enhanceHeadingCollapse(page);
}

function setSidebarCollapsed(collapsed) {
  document.body.classList.toggle("sidebar-collapsed", collapsed);
  sidebarToggle.setAttribute("aria-expanded", String(!collapsed));
  sidebarToggle.setAttribute("aria-label", collapsed ? "Expand sidebar" : "Collapse sidebar");
  localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
}

async function load(path) {
  const text = await fetchMarkdown(path);
  currentPath = path;
  renderPage(text);
  page.parentElement.scrollTop = 0;
  document.querySelectorAll("#nav button").forEach((b) =>
    b.classList.toggle("active", b.dataset.path === path)
  );
  // Editor mode (editor/*.js) listens for this to cache the scene's raw source.
  // No-op when the editor isn't loaded.
  document.dispatchEvent(new CustomEvent("scene:loaded", { detail: { path, text } }));
}

function showNavError(message) {
  nav.innerHTML = "";
  const error = document.createElement("div");
  error.className = "nav-error";
  error.textContent = message;
  nav.appendChild(error);
}

async function loadCampaignEntries() {
  const res = await fetch("/__campaign_files", { cache: "no-store" });
  if (!res.ok) throw new Error("campaign discovery failed");
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error("bad discovery response");
  return data;
}

async function createCampaignFile(title) {
  const res = await fetch("/__create_campaign_file", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });

  let payload = null;
  try {
    payload = await res.json();
  } catch {
    /* non-JSON body */
  }

  if (!res.ok || !payload || !payload.ok || !payload.entry) {
    const detail = payload && payload.error ? payload.error : `HTTP ${res.status}`;
    throw new Error("Page creation failed: " + detail);
  }
  return payload.entry;
}

async function deleteCampaignFile(path) {
  const res = await fetch("/__delete_campaign_file", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });

  let payload = null;
  try {
    payload = await res.json();
  } catch {
    /* non-JSON body */
  }

  if (!res.ok || !payload || !payload.ok) {
    const detail = payload && payload.error ? payload.error : `HTTP ${res.status}`;
    throw new Error("Page deletion failed: " + detail);
  }
}

function removeNavContextMenu() {
  const menu = document.querySelector(".nav-context-menu");
  if (menu) menu.remove();
  document.removeEventListener("mousedown", onNavContextMouseDown, true);
  document.removeEventListener("keydown", onNavContextKey, true);
  window.removeEventListener("scroll", removeNavContextMenu, true);
}

function onNavContextMouseDown(e) {
  const menu = document.querySelector(".nav-context-menu");
  if (menu && menu.contains(e.target)) return;
  removeNavContextMenu();
}

function onNavContextKey(e) {
  if (e.key === "Escape") removeNavContextMenu();
}

async function deleteCampaignEntry(entry) {
  const index = campaignEntries.findIndex((item) => item.path === entry.path);
  if (!confirm(`Delete "${entry.label}"? This cannot be undone.`)) return;

  try {
    await deleteCampaignFile(entry.path);
    const entries = await loadCampaignEntries();
    campaignEntries = entries;

    if (currentPath === entry.path) {
      currentPath = null;
      mountCampaignEntries(entries);
      if (entries.length) {
        const next = entries[Math.min(Math.max(index, 0), entries.length - 1)];
        await load(next.path);
      } else {
        page.innerHTML = "";
        document.dispatchEvent(new CustomEvent("scene:loaded", { detail: { path: null, text: "" } }));
      }
    } else {
      mountCampaignEntries(entries);
    }
  } catch (err) {
    alert(err.message || "Page deletion failed.");
  }
}

function openNavContextMenu(entry, x, y) {
  removeNavContextMenu();

  const menu = document.createElement("div");
  menu.className = "nav-context-menu";
  menu.setAttribute("role", "menu");

  const del = document.createElement("button");
  del.type = "button";
  del.className = "nav-context-menu-item danger";
  del.setAttribute("role", "menuitem");
  del.textContent = "Delete";
  del.addEventListener("click", () => {
    removeNavContextMenu();
    deleteCampaignEntry(entry);
  });
  menu.appendChild(del);
  document.body.appendChild(menu);

  const rect = menu.getBoundingClientRect();
  const left = Math.min(x, window.innerWidth - rect.width - 8);
  const top = Math.min(y, window.innerHeight - rect.height - 8);
  menu.style.left = Math.max(8, left) + "px";
  menu.style.top = Math.max(8, top) + "px";

  document.addEventListener("mousedown", onNavContextMouseDown, true);
  document.addEventListener("keydown", onNavContextKey, true);
  window.addEventListener("scroll", removeNavContextMenu, true);
}

function mountCampaignEntries(entries) {
  nav.innerHTML = "";
  entries.forEach((entry, index) => {
    const { path, number, label } = entry;
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.dataset.path = path;
    btn.dataset.navIndex = String(index + 1);
    if (number !== null && number !== undefined) {
      btn.dataset.navIndex = String(number);
    }
    btn.classList.toggle("active", path === currentPath);
    btn.addEventListener("click", () => load(path));
    btn.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      openNavContextMenu(entry, e.clientX, e.clientY);
    });
    nav.appendChild(btn);
  });
}

function removeNewPageDialog(backdrop) {
  document.removeEventListener("keydown", backdrop._onKeydown);
  backdrop.remove();
}

function openNewPageDialog() {
  if (document.querySelector(".new-page-backdrop")) return;

  const backdrop = document.createElement("div");
  backdrop.className = "editor-modal-backdrop new-page-backdrop";

  const modal = document.createElement("form");
  modal.className = "editor-modal new-page-modal";
  modal.noValidate = true;

  const head = document.createElement("div");
  head.className = "editor-modal-head";
  head.textContent = "New Page";

  const body = document.createElement("div");
  body.className = "editor-modal-body";

  const field = document.createElement("div");
  field.className = "editor-field";

  const label = document.createElement("label");
  label.htmlFor = "new-page-title";
  label.textContent = "Page title";

  const input = document.createElement("input");
  input.id = "new-page-title";
  input.type = "text";
  input.value = "New Page";
  input.maxLength = 120;
  input.autocomplete = "off";

  const error = document.createElement("div");
  error.className = "editor-field-error new-page-error";
  error.setAttribute("role", "alert");

  field.appendChild(label);
  field.appendChild(input);
  field.appendChild(error);
  body.appendChild(field);

  const foot = document.createElement("div");
  foot.className = "editor-modal-foot";

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "editor-btn";
  cancel.textContent = "Cancel";

  const create = document.createElement("button");
  create.type = "submit";
  create.className = "editor-btn primary";
  create.textContent = "Create";

  foot.appendChild(cancel);
  foot.appendChild(create);
  modal.appendChild(head);
  modal.appendChild(body);
  modal.appendChild(foot);
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  function setBusy(busy) {
    input.disabled = busy;
    cancel.disabled = busy;
    create.disabled = busy;
    create.textContent = busy ? "Creating..." : "Create";
    newPageButton.disabled = busy;
  }

  function close() {
    newPageButton.disabled = false;
    removeNewPageDialog(backdrop);
  }

  backdrop._onKeydown = (e) => {
    if (e.key === "Escape" && !create.disabled) close();
  };
  document.addEventListener("keydown", backdrop._onKeydown);

  cancel.addEventListener("click", close);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop && !create.disabled) close();
  });

  modal.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = input.value.trim();
    if (!title) {
      error.textContent = "Enter a page title.";
      input.focus();
      return;
    }

    error.textContent = "";
    setBusy(true);
    try {
      const entry = await createCampaignFile(title);
      const entries = await loadCampaignEntries();
      campaignEntries = entries;
      mountCampaignEntries(entries);
      await load(entry.path);
      close();
    } catch (err) {
      error.textContent = err.message || "Page creation failed.";
      setBusy(false);
      input.focus();
    }
  });

  requestAnimationFrame(() => {
    input.focus();
    input.select();
  });
}

function mountNewPageButton() {
  if (!newPageButton) return;
  newPageButton.addEventListener("click", openNewPageDialog);
}

/* Dev-only: inspect the parsed RendScroll AST for the current scene without
   touching rendering. In the console: `__rsDump()` prints readable JSON, and
   `__rsParse()` returns the live document. Caches the raw source each scene load.
   This is a passive observer of the existing pipeline (Phase 1 of the parser
   migration); it changes nothing the user sees. */
document.addEventListener("scene:loaded", (e) => {
  window.__rsLastSource = e.detail && e.detail.text ? e.detail.text : "";
});
window.__rsParse = () => RendScrollParser.parseRendScroll(window.__rsLastSource || "");
window.__rsDump = () => {
  const json = RendScrollParser.debugDump(window.__rsParse());
  console.log(json);
  return json;
};

/* Small, read-only accessor so tooling (e.g. the Debug panel, src/debug/) can
   read the same scene state the renderer/editor use, without duplicating the
   file-fetch logic. Additive — the dev hooks above are unchanged. */
window.RendScrollApp = {
  currentSource: () => window.__rsLastSource || "",
  currentPath: () => currentPath,
  campaignEntries: () => campaignEntries.slice(),
};

async function init() {
  setSidebarCollapsed(localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true");
  sidebarToggle.addEventListener("click", () =>
    setSidebarCollapsed(!document.body.classList.contains("sidebar-collapsed"))
  );
  mountNewPageButton();

  // Renderer options (persisted toggles) + their topbar popover controls.
  RendererOptions.apply();
  const optionsEl = document.getElementById("topbar-tools") || document.getElementById("options");
  if (optionsEl) RendererOptions.mount(optionsEl);

  let entries;
  try {
    entries = await loadCampaignEntries();
    campaignEntries = entries;
  } catch {
    showNavError("Campaign files could not be discovered. Start RendScroll with launcher.py.");
    return;
  }

  mountCampaignEntries(entries);

  if (entries.length) load(entries[0].path);
}

init();
