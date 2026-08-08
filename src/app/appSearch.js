/* Campaign-wide search.

   Searches saved scene markdown plus loaded reference-library sources. The
   search itself is intentionally simple: literal, case-insensitive line
   matching over raw markdown. Navigation reuses the reader's guardedLoad() and
   the render-time source stamps that already connect source lines to cards. */

const CampaignSearch = (() => {
  const DEFAULT_LIMIT = 30;
  const SNIPPET_MAX = 120;
  const HIGHLIGHT_MS = 5000;

  let mounted = false;
  let inputEl = null;
  let popoverEl = null;
  let rootEl = null;
  let sceneCache = [];
  let cacheReady = false;
  let cachePromise = null;
  let activeIndex = -1;
  let currentResults = [];
  let currentOverflow = 0;

  const _rsLower = (typeof rsLower !== "undefined")
    ? rsLower
    : ((value) => String(value).toLowerCase());

  function lineText(line) {
    if (typeof RendScrollParser !== "undefined" && RendScrollParser.lineText) {
      return RendScrollParser.lineText(line);
    }
    return String(line || "").replace(/\r?\n$/, "");
  }

  function splitLines(text) {
    if (typeof RendScrollParser !== "undefined" && RendScrollParser.splitLines) {
      return RendScrollParser.splitLines(String(text || ""));
    }
    const raw = String(text || "");
    if (!raw) return [];
    return raw.match(/[^\n]*\n|[^\n]+$/g) || [];
  }

  function sourceContent(entry) {
    return String(entry && (entry.content != null ? entry.content : entry.source != null ? entry.source : "") || "");
  }

  function sceneSources(entries) {
    return (entries || []).map((entry) => ({
      kind: "scene",
      label: entry.label || entry.file || entry.path || "Scene",
      path: entry.path || "",
      content: sourceContent(entry),
    })).filter((entry) => entry.path);
  }

  function librarySources(kind, entries) {
    return (entries || []).map((entry) => ({
      kind,
      label: entry.name || entry.path || kind,
      name: entry.name || "",
      path: entry.path || "",
      content: sourceContent(entry),
    })).filter((entry) => entry.name || entry.path);
  }

  function resultTypeLabel(kind) {
    if (kind === "scene") return "Scene";
    if (kind === "enemy") return "Enemy";
    return "Item";
  }

  function makeSnippet(line, query, maxLen) {
    const raw = String(line || "").replace(/\s+/g, " ").trim();
    if (!raw) return "";
    const max = maxLen || SNIPPET_MAX;
    if (raw.length <= max) return raw;

    const at = _rsLower(raw).indexOf(_rsLower(query));
    let start = at >= 0 ? at - Math.floor((max - String(query).length) / 2) : 0;
    start = Math.max(0, Math.min(start, raw.length - max));
    let out = raw.slice(start, start + max).trim();
    if (start > 0) out = "..." + out;
    if (start + max < raw.length) out += "...";
    return out;
  }

  function searchSources(sources, query, opts) {
    const q = String(query || "").trim();
    const limit = opts && opts.limit != null ? Number(opts.limit) : DEFAULT_LIMIT;
    const results = [];
    let overflow = 0;
    if (!q) return { results, overflow };

    const needle = _rsLower(q);
    (sources || []).forEach((source) => {
      splitLines(source.content).forEach((line, lineIndex) => {
        const text = lineText(line);
        if (_rsLower(text).indexOf(needle) < 0) return;
        const result = {
          kind: source.kind,
          label: source.label,
          name: source.name || source.label,
          path: source.path,
          lineIndex,
          lineNumber: lineIndex + 1,
          query: q,
          snippet: makeSnippet(text, q),
        };
        if (results.length < limit) results.push(result);
        else overflow++;
      });
    });
    return { results, overflow };
  }

  async function fetchJSON(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }

  function apiUrl(url) {
    const api = typeof globalThis !== "undefined" ? globalThis.ServerApi : null;
    return api ? api.withCampaign(url) : url;
  }

  async function refreshScenes() {
    cachePromise = fetchJSON(apiUrl("/__scene_bundle"))
      .then((data) => {
        sceneCache = Array.isArray(data) ? data : [];
        cacheReady = true;
        return sceneCache;
      })
      .catch((err) => {
        sceneCache = [];
        cacheReady = true;
        const log = typeof globalThis !== "undefined" ? globalThis.RSLog : null;
        if (log && log.warn) log.warn("search", "Scene bundle load failed.", err);
        return sceneCache;
      })
      .then((data) => {
        cachePromise = null;
        return data;
      });
    return cachePromise;
  }

  function invalidateScenes() {
    sceneCache = [];
    cacheReady = false;
    cachePromise = null;
  }

  function librarySearchSources() {
    if (typeof RefLibrary === "undefined" || !RefLibrary.entries) return [];
    return librarySources("item", RefLibrary.entries("item"))
      .concat(librarySources("enemy", RefLibrary.entries("enemy")));
  }

  function allSources() {
    return sceneSources(sceneCache).concat(librarySearchSources());
  }

  function setActiveIndex(next) {
    const buttons = popoverEl ? [...popoverEl.querySelectorAll(".campaign-search-result")] : [];
    if (!buttons.length) {
      activeIndex = -1;
      return;
    }
    activeIndex = (next + buttons.length) % buttons.length;
    buttons.forEach((button, index) => {
      button.classList.toggle("is-active", index === activeIndex);
      button.setAttribute("aria-selected", String(index === activeIndex));
    });
    buttons[activeIndex].scrollIntoView({ block: "nearest" });
  }

  function closePopover() {
    if (!popoverEl) return;
    popoverEl.hidden = true;
    activeIndex = -1;
  }

  function openPopover() {
    if (!popoverEl) return;
    popoverEl.hidden = false;
  }

  function renderMessage(message) {
    currentResults = [];
    currentOverflow = 0;
    popoverEl.innerHTML = "";
    const row = document.createElement("div");
    row.className = "campaign-search-empty";
    row.textContent = message;
    popoverEl.appendChild(row);
    openPopover();
  }

  function resultButton(result, index) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "campaign-search-result";
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", "false");
    button.dataset.index = String(index);

    const meta = document.createElement("span");
    meta.className = "campaign-search-meta";

    const badge = document.createElement("span");
    badge.className = "campaign-search-badge campaign-search-badge-" + result.kind;
    badge.textContent = resultTypeLabel(result.kind);
    meta.appendChild(badge);

    const label = document.createElement("span");
    label.className = "campaign-search-label";
    label.textContent = result.label;
    meta.appendChild(label);

    const line = document.createElement("span");
    line.className = "campaign-search-line";
    line.textContent = "L" + result.lineNumber;
    meta.appendChild(line);

    const snippet = document.createElement("span");
    snippet.className = "campaign-search-snippet";
    snippet.textContent = result.snippet || "(blank line)";

    button.appendChild(meta);
    button.appendChild(snippet);
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => openResult(result));
    return button;
  }

  function renderResults(query) {
    if (!String(query || "").trim()) {
      closePopover();
      return;
    }
    if (!cacheReady) {
      renderMessage("Loading campaign search...");
      if (!cachePromise) refreshScenes().then(() => renderResults(inputEl ? inputEl.value : ""));
      return;
    }

    const found = searchSources(allSources(), query, { limit: DEFAULT_LIMIT });
    currentResults = found.results;
    currentOverflow = found.overflow;
    popoverEl.innerHTML = "";

    if (!currentResults.length) {
      renderMessage("No results.");
      return;
    }

    currentResults.forEach((result, index) => {
      popoverEl.appendChild(resultButton(result, index));
    });
    if (currentOverflow > 0) {
      const more = document.createElement("div");
      more.className = "campaign-search-more";
      more.textContent = currentOverflow + " more result" + (currentOverflow === 1 ? "" : "s") + ". Refine the search.";
      popoverEl.appendChild(more);
    }
    openPopover();
    setActiveIndex(0);
  }

  function flashTarget(el) {
    if (!el || !el.classList) return;
    if (typeof flashCard === "function") {
      flashCard(el);
      return;
    }
    el.classList.add("ref-flash");
    setTimeout(() => el.classList.remove("ref-flash"), 1200);
  }

  function clearHighlights() {
    if (typeof document === "undefined") return;
    document.querySelectorAll(".campaign-search-hit").forEach((mark) => {
      const parent = mark.parentNode;
      if (!parent) return;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      mark.remove();
      parent.normalize();
    });
  }

  function textSearchRoot(root, startEl) {
    const doc = root && root.ownerDocument;
    if (!root || !doc) return [];
    const NF = (doc.defaultView && doc.defaultView.NodeFilter) || globalThis.NodeFilter;
    const walker = doc.createTreeWalker(root, NF.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || !node.nodeValue || !node.nodeValue.trim()) return NF.FILTER_REJECT;
        const tag = parent.tagName ? parent.tagName.toLowerCase() : "";
        if (tag === "script" || tag === "style" || tag === "textarea" || tag === "input") {
          return NF.FILTER_REJECT;
        }
        if (parent.closest && parent.closest(".campaign-search")) return NF.FILTER_REJECT;
        return NF.FILTER_ACCEPT;
      },
    });
    const nodes = [];
    let started = !startEl;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!started) {
        const rel = startEl.compareDocumentPosition(node);
        started = startEl.contains(node) || !!(rel & Node.DOCUMENT_POSITION_FOLLOWING);
      }
      if (started) nodes.push(node);
    }
    return nodes;
  }

  function highlightRenderedMatch(root, query, startEl) {
    clearHighlights();
    const q = String(query || "").trim();
    if (!root || !q || typeof document === "undefined") return null;
    const needle = _rsLower(q);
    const doc = root.ownerDocument || document;
    for (const node of textSearchRoot(root, startEl)) {
      const at = _rsLower(node.nodeValue).indexOf(needle);
      if (at < 0) continue;
      const range = doc.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + q.length);
      const mark = doc.createElement("mark");
      mark.className = "campaign-search-hit";
      range.surroundContents(mark);
      const timer = setTimeout(clearHighlights, HIGHLIGHT_MS);
      if (timer && typeof timer.unref === "function") timer.unref();
      return mark;
    }
    return null;
  }

  function containsLine(el, lineIndex) {
    const start = Number(el.dataset.srcStart);
    const end = Number(el.dataset.srcEnd);
    return Number.isFinite(start) && Number.isFinite(end) && lineIndex >= start && lineIndex < end;
  }

  function findSceneTarget(pageEl, lineIndex) {
    if (!pageEl) return null;
    const card = [...pageEl.querySelectorAll("[data-src-start][data-src-end]")]
      .find((el) => containsLine(el, lineIndex));
    if (card) return card;

    let target = null;
    [...pageEl.querySelectorAll("[data-section-start]")].forEach((el) => {
      const start = Number(el.dataset.sectionStart);
      if (Number.isFinite(start) && start <= lineIndex) target = el;
    });
    return target || pageEl;
  }

  function revealAndFlash(target, result, root) {
    if (!target) return;
    if (typeof revealElement === "function") revealElement(target);
    const hit = highlightRenderedMatch(root || target, result && result.query, target);
    const scrollTarget = hit || target;
    if (scrollTarget.scrollIntoView) scrollTarget.scrollIntoView({ behavior: "smooth", block: "center" });
    flashTarget(target);
  }

  async function openSceneResult(result) {
    const app = typeof globalThis !== "undefined" ? globalThis.RendScrollApp : null;
    if (!app || !app.guardedLoad) return;
    const loaded = await app.guardedLoad(result.path);
    if (!loaded) return;
    const pageEl = document.getElementById("page");
    revealAndFlash(findSceneTarget(pageEl, result.lineIndex), result, pageEl);
  }

  async function openLibraryResult(result) {
    if (typeof openLibrary !== "function") return;
    const opened = await openLibrary(result.kind, result.name);
    if (opened === false) return;
    const pageEl = document.getElementById("page");
    if (!pageEl) return;
    const selector = RendScrollCards.cardSelector();
    const target = pageEl.querySelector(".library-view " + selector) ||
      pageEl.querySelector(".library-view") ||
      pageEl;
    revealAndFlash(target, result, target);
  }

  async function openResult(result) {
    closePopover();
    if (result.kind === "scene") await openSceneResult(result);
    else await openLibraryResult(result);
  }

  function onInput() {
    renderResults(inputEl.value);
  }

  function onKeydown(event) {
    if (event.key === "Escape") {
      closePopover();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex(activeIndex + 1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex(activeIndex - 1);
      return;
    }
    if (event.key === "Enter" && currentResults.length) {
      event.preventDefault();
      openResult(currentResults[Math.max(activeIndex, 0)]);
    }
  }

  function onGlobalKeydown(event) {
    if (!(event.ctrlKey || event.metaKey) || String(event.key).toLowerCase() !== "f") return;
    const target = event.target;
    const tag = target && target.tagName ? target.tagName.toLowerCase() : "";
    if (tag === "input" && target !== inputEl) return;
    if (tag === "textarea" || tag === "select" || (target && target.isContentEditable)) return;
    event.preventDefault();
    if (inputEl) {
      inputEl.focus();
      inputEl.select();
      if (inputEl.value) renderResults(inputEl.value);
    }
  }

  function mount(container) {
    if (!container || mounted) return;
    mounted = true;
    rootEl = document.createElement("div");
    rootEl.className = "campaign-search";

    inputEl = document.createElement("input");
    inputEl.type = "search";
    inputEl.className = "campaign-search-input";
    inputEl.placeholder = "Search campaign";
    inputEl.autocomplete = "off";
    inputEl.spellcheck = false;
    inputEl.setAttribute("aria-label", "Search campaign scenes and libraries");
    inputEl.setAttribute("aria-controls", "campaign-search-results");
    inputEl.addEventListener("input", onInput);
    inputEl.addEventListener("focus", () => {
      if (!cacheReady && !cachePromise) refreshScenes().then(() => {
        if (inputEl && inputEl.value) renderResults(inputEl.value);
      });
      if (inputEl.value) renderResults(inputEl.value);
    });
    inputEl.addEventListener("keydown", onKeydown);

    popoverEl = document.createElement("div");
    popoverEl.id = "campaign-search-results";
    popoverEl.className = "campaign-search-popover";
    popoverEl.setAttribute("role", "listbox");
    popoverEl.hidden = true;

    rootEl.appendChild(inputEl);
    rootEl.appendChild(popoverEl);
    container.appendChild(rootEl);

    document.addEventListener("keydown", onGlobalKeydown);
    document.addEventListener("mousedown", (event) => {
      if (rootEl && !rootEl.contains(event.target)) closePopover();
    }, true);
    document.addEventListener("campaign:activated", () => {
      invalidateScenes();
      if (inputEl && inputEl.value) refreshScenes().then(() => renderResults(inputEl.value));
    });
    document.addEventListener("library:changed", () => {
      if (inputEl && inputEl.value) renderResults(inputEl.value);
    });
  }

  return {
    mount,
    refreshScenes,
    invalidateScenes,
    searchSources,
    sceneSources,
    librarySources,
    makeSnippet,
    findSceneTarget,
    highlightRenderedMatch,
    clearHighlights,
    _state: () => ({ sceneCache: sceneCache.slice(), cacheReady, currentResults: currentResults.slice(), currentOverflow }),
  };
})();

if (typeof globalThis !== "undefined") globalThis.CampaignSearch = CampaignSearch;
if (typeof module !== "undefined" && module.exports) module.exports = CampaignSearch;
