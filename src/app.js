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

/* Insert the rendered HTML, then run the independent renderers.
   Feature renderers run BEFORE base styling so they can claim/replace
   their own nodes first (e.g. Skill Checks rebuilds its blockquotes). */
function renderPage(html) {
  page.innerHTML = html;
  page.prepend(createTopScrollImage());
  markHeadingCollapsable(page); // read heading "Collapsable: F" flags on flat DOM
  enhanceSkillChecks(page);
  enhanceNpcSections(page);
  enhanceItemSections(page);
  enhanceAbilitySections(page);
  enhanceObjSections(page);
  enhanceCombatSections(page);
  enhanceUnexpectedSections(page);
  enhanceStdSections(page);
  enhanceBaseStyling(page);
  enhanceCardCollapse(page);
  // Last: re-arrange the styled nodes into the header band + two-column grid.
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

/* Text phase: normalize raw markdown before marked.js. Renderers that need to
   touch the source (not just the DOM) contribute their step here. */
function toHtml(text) {
  text = normalizeSkillChecksMarkdown(text);
  text = normalizeItemMarkdown(text);
  text = normalizeNpcMarkdown(text);
  text = normalizeObjMarkdown(text);
  text = normalizeAbilityMarkdown(text);
  text = normalizeCombatMarkdown(text);
  text = normalizeStdMarkdown(text);
  text = normalizeUnexpectedMarkdown(text);
  text = normalizeClosedMarkdown(text);
  text = normalizeCollapsableMarkdown(text);
  return renderMarkdown(text);
}

async function load(path) {
  const text = await fetchMarkdown(path);
  currentPath = path;
  renderPage(toHtml(text));
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

function mountCampaignEntries(entries) {
  nav.innerHTML = "";
  entries.forEach(({ path, number, label }, index) => {
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.dataset.path = path;
    btn.dataset.navIndex = String(index + 1);
    if (number !== null && number !== undefined) {
      btn.dataset.navIndex = String(number);
    }
    btn.classList.toggle("active", path === currentPath);
    btn.addEventListener("click", () => load(path));
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

async function init() {
  setSidebarCollapsed(localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true");
  sidebarToggle.addEventListener("click", () =>
    setSidebarCollapsed(!document.body.classList.contains("sidebar-collapsed"))
  );
  mountNewPageButton();

  // Renderer options (persisted toggles) + their sidebar controls.
  RendererOptions.apply();
  const optionsEl = document.getElementById("options");
  if (optionsEl) RendererOptions.mount(optionsEl);

  let entries;
  try {
    entries = await loadCampaignEntries();
  } catch {
    showNavError("Campaign files could not be discovered. Start RendScroll with launcher.py.");
    return;
  }

  mountCampaignEntries(entries);

  if (entries.length) load(entries[0].path);
}

init();
