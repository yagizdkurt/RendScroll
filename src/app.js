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

/* Known label lines from the template that should stand out. */
const FIELD_LABELS = new Set([
  "kişilik:", "ilk diyalog:", "sorarsa:", "bildikleri:", "bilmedikleri:",
  "stat:", "taktik:", "genel:", "cesetler:", "köpek:", "sandıklar:",
  "amaç:", "öz:", "kültist:", "cult hunter:",
]);

/* Turkish-aware lowercase (İ/I). */
function lower(s) {
  return s.replace(/İ/g, "i").replace(/I/g, "ı").toLowerCase();
}

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
    const t = lower(h.textContent);
    if (t.includes("skill check")) h.classList.add("skill-section");
    else if (t.includes("npc")) h.classList.add("npc-section");
    else if (t.includes("savaş")) h.classList.add("combat-section");
    else if (t.includes("beklenmedik")) h.classList.add("contingency-section");
    else if (t.includes("yankı")) h.classList.add("echo-section");
  });

  // Short "Label:" paragraphs become emphasized field labels.
  root.querySelectorAll("p").forEach((p) => {
    const t = p.textContent.trim();
    const isKnown = FIELD_LABELS.has(lower(t));
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

async function init() {
  setSidebarCollapsed(localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true");
  sidebarToggle.addEventListener("click", () =>
    setSidebarCollapsed(!document.body.classList.contains("sidebar-collapsed"))
  );

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

  entries.forEach(({ path, number, label }, index) => {
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.dataset.path = path;
    btn.dataset.navIndex = String(index + 1);
    if (number !== null && number !== undefined) {
      btn.dataset.navIndex = String(number);
    }
    btn.addEventListener("click", () => load(path));
    nav.appendChild(btn);
  });

  if (entries.length) load(entries[0].path);
}

init();
