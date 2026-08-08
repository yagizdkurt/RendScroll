/* Lore page model — parse / serialize / mutate, with no DOM and no I/O.

   A lore page is one campaign-scoped markdown file, campaigns/<Name>/lore/<Page>.md:

     # Lore: Page Name
     Keywords: ancient history, lost city

     ## Entry: Entry Name
     Keywords: deity, Ancient God

     Entry Markdown content...

   SOURCE FIDELITY. Unlike a scene, a lore page is *fully* modelled — page name,
   page keywords, and per-entry name/keywords/body is everything the file can
   hold. So this does not need the parser's line-range/splice machinery. Instead:
   each entry's BODY is kept verbatim (it is arbitrary markdown and must never be
   reflowed), while the STRUCTURE (headings, "Keywords:" lines, one blank line
   between blocks) serializes canonically. parse -> serialize of a canonical file
   is an identity; a hand-written file with unusual blank-line runs normalizes on
   its first save, bodies untouched.

   Mutations return a NEW page object (the editor's undo stack snapshots them),
   and entries are addressed BY INDEX — no minted ids, so nothing can go stale
   across a re-parse.

   A file that does not satisfy the contract is reported as a parse error and is
   never silently rewritten. */

const LoreModel = (() => {
  const PAGE_HEADING = /^#\s+lore\s*:\s*(.*)$/i;
  const ENTRY_HEADING = /^##\s+entry\s*:\s*(.*)$/i;
  const ANY_H1 = /^#\s+(?!#)/;
  const ANY_H2 = /^##\s+(?!#)/;
  const KEYWORDS_LINE = /^keywords\s*:\s*(.*)$/i;
  // "/" and "\" are the lore address separator, so they can never be in a name.
  const ILLEGAL_NAME = /[/\\]/;

  const _rsLower = (typeof rsLower !== "undefined")
    ? rsLower
    : require("../utils/text.js").rsLower;

  /* The one comparison key for keywords AND for the "key:" search: lowercase and
     drop ALL whitespace, so "Ancient God", "ancient  god" and "AncientGod" are
     the same keyword. Matching is exact equality on this key — never a prefix or
     substring. */
  function keywordKey(text) {
    return _rsLower(String(text == null ? "" : text)).replace(/\s+/g, "");
  }

  // Names compare case-insensitively with surrounding whitespace ignored.
  function nameKey(text) {
    return _rsLower(String(text == null ? "" : text).trim());
  }

  /* "a, b ,, A B" -> ["a", "b"]: split on commas, trim, drop blanks, then dedupe
     on keywordKey. The FIRST spelling wins, so the author's capitalisation is
     what gets displayed. */
  function normalizeKeywords(raw) {
    const list = Array.isArray(raw) ? raw : String(raw == null ? "" : raw).split(",");
    const seen = new Set();
    const out = [];
    list.forEach((item) => {
      const text = String(item == null ? "" : item).trim();
      if (!text) return;
      const key = keywordKey(text);
      if (!key || seen.has(key)) return;
      seen.add(key);
      out.push(text);
    });
    return out;
  }

  function emptyPage(name) {
    return { name: String(name || "").trim(), keywords: [], entries: [] };
  }

  function makeEntry(name, keywords, body) {
    return {
      name: String(name || "").trim(),
      keywords: normalizeKeywords(keywords),
      body: String(body == null ? "" : body),
    };
  }

  // Trim leading/trailing blank lines from a body while leaving its interior —
  // indentation, code fences, blank lines inside — byte-identical.
  function trimBlankEdges(lines) {
    let a = 0;
    let b = lines.length;
    while (a < b && !lines[a].trim()) a++;
    while (b > a && !lines[b - 1].trim()) b--;
    return lines.slice(a, b);
  }

  /* Parse a lore file. Always returns a page object (possibly empty) so callers
     can render something; `ok` is false and `errors` non-empty when the file
     breaks the contract. Callers must not save a page parsed with ok:false. */
  function parse(text) {
    const raw = String(text == null ? "" : text).replace(/\r\n/g, "\n");
    const lines = raw.split("\n");
    const errors = [];
    const push = (line, message) => errors.push({ line: line + 1, message });

    let page = null;
    let current = null;      // entry being collected
    let bodyLines = [];
    let sawKeywordSlot = false; // Keywords: is only meaningful right under a heading

    const closeEntry = () => {
      if (!current) return;
      current.body = trimBlankEdges(bodyLines).join("\n");
      page.entries.push(current);
      current = null;
      bodyLines = [];
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      const pageMatch = trimmed.match(PAGE_HEADING);
      if (pageMatch) {
        if (page) { push(i, "duplicate \"# Lore:\" heading"); continue; }
        const name = pageMatch[1].trim();
        if (!name) push(i, "lore page has no name");
        else if (ILLEGAL_NAME.test(name)) push(i, "page name may not contain / or \\");
        page = emptyPage(name);
        sawKeywordSlot = true;
        continue;
      }

      if (!page) {
        if (trimmed) push(i, "content before the \"# Lore: Name\" heading");
        continue;
      }

      const entryMatch = trimmed.match(ENTRY_HEADING);
      if (entryMatch) {
        closeEntry();
        const name = entryMatch[1].trim();
        if (!name) push(i, "entry has no name");
        else if (ILLEGAL_NAME.test(name)) push(i, "entry name may not contain / or \\");
        current = makeEntry(name, "", "");
        sawKeywordSlot = true;
        continue;
      }

      // A second H1, or an H2 that is not "## Entry:", is not part of the contract.
      if (ANY_H1.test(trimmed)) { push(i, "unexpected heading (only \"# Lore:\" is allowed)"); continue; }
      if (ANY_H2.test(trimmed)) { push(i, "unexpected heading (only \"## Entry:\" is allowed)"); continue; }

      const kw = sawKeywordSlot && trimmed ? trimmed.match(KEYWORDS_LINE) : null;
      if (kw) {
        const target = current || page;
        target.keywords = normalizeKeywords(kw[1]);
        sawKeywordSlot = false;
        continue;
      }
      // The keyword slot closes at the first non-blank line after the heading.
      if (trimmed) sawKeywordSlot = false;

      if (current) bodyLines.push(line);
      else if (trimmed) push(i, "page-level text must live inside an \"## Entry:\"");
    }
    closeEntry();

    if (!page) {
      push(Math.max(0, lines.length - 1), "missing \"# Lore: Name\" heading");
      page = emptyPage("");
    }

    // Entry names must be unique within the page (case/edge-space insensitive).
    const byName = new Map();
    page.entries.forEach((entry) => {
      const key = nameKey(entry.name);
      if (!key) return;
      if (byName.has(key)) errors.push({ line: 0, message: "duplicate entry name: " + entry.name });
      else byName.set(key, true);
    });

    return { ok: errors.length === 0, page, errors };
  }

  // Canonical markdown for a page. One blank line separates every block.
  function serialize(page) {
    const p = page || emptyPage("");
    const blocks = [];

    let head = "# Lore: " + String(p.name || "").trim();
    const pageKeywords = normalizeKeywords(p.keywords);
    if (pageKeywords.length) head += "\nKeywords: " + pageKeywords.join(", ");
    blocks.push(head);

    (p.entries || []).forEach((entry) => {
      let block = "## Entry: " + String(entry.name || "").trim();
      const kw = normalizeKeywords(entry.keywords);
      if (kw.length) block += "\nKeywords: " + kw.join(", ");
      const body = String(entry.body == null ? "" : entry.body);
      if (body.trim()) block += "\n\n" + trimBlankEdges(body.split("\n")).join("\n");
      blocks.push(block);
    });

    return blocks.join("\n\n") + "\n";
  }

  // --- mutations (each returns a NEW page; entries are addressed by index) ---

  function clonePage(page) {
    const p = page || emptyPage("");
    return {
      name: p.name,
      keywords: (p.keywords || []).slice(),
      entries: (p.entries || []).map((e) => ({
        name: e.name, keywords: (e.keywords || []).slice(), body: e.body,
      })),
    };
  }

  function inRange(page, index) {
    return Number.isInteger(index) && index >= 0 && index < (page.entries || []).length;
  }

  // Would `name` collide with an existing entry? `skipIndex` exempts the entry
  // being renamed.
  function entryNameTaken(page, name, skipIndex) {
    const key = nameKey(name);
    if (!key) return false;
    return (page.entries || []).some((e, i) => i !== skipIndex && nameKey(e.name) === key);
  }

  function setPageMeta(page, values) {
    const next = clonePage(page);
    if (values && values.name != null) next.name = String(values.name).trim();
    if (values && values.keywords != null) next.keywords = normalizeKeywords(values.keywords);
    return next;
  }

  function addEntry(page, values) {
    const next = clonePage(page);
    next.entries.push(makeEntry(
      values && values.name, values && values.keywords, values && values.body));
    return next;
  }

  function updateEntry(page, index, values) {
    const next = clonePage(page);
    if (!inRange(next, index)) return next;
    const entry = next.entries[index];
    if (values && values.name != null) entry.name = String(values.name).trim();
    if (values && values.keywords != null) entry.keywords = normalizeKeywords(values.keywords);
    if (values && values.body != null) entry.body = String(values.body);
    return next;
  }

  function removeEntry(page, index) {
    const next = clonePage(page);
    if (inRange(next, index)) next.entries.splice(index, 1);
    return next;
  }

  // dir < 0 moves the entry earlier, dir > 0 later. A move off either end is a
  // no-op (the UI disables the button there).
  function moveEntry(page, index, dir) {
    const next = clonePage(page);
    const to = index + (dir < 0 ? -1 : 1);
    if (!inRange(next, index) || !inRange(next, to)) return next;
    const [entry] = next.entries.splice(index, 1);
    next.entries.splice(to, 0, entry);
    return next;
  }

  function findEntryIndex(page, name) {
    const key = nameKey(name);
    if (!key) return -1;
    return (page && page.entries ? page.entries : []).findIndex((e) => nameKey(e.name) === key);
  }

  /* "lore:Page" / "lore:Page/Entry" -> { page, entry }, or null when the value is
     not a lore address. Case is preserved here; callers compare with nameKey. */
  function parseAddress(value) {
    const raw = String(value == null ? "" : value).trim();
    const m = raw.match(/^lore\s*:\s*(.+)$/i);
    if (!m) return null;
    const rest = m[1].replace(/\\/g, "/");
    const at = rest.indexOf("/");
    const page = (at < 0 ? rest : rest.slice(0, at)).trim();
    const entry = at < 0 ? "" : rest.slice(at + 1).trim();
    if (!page) return null;
    return { page, entry };
  }

  // Does this page (or one of its entries) carry `keyword`? Page keywords do NOT
  // propagate to entries — a page match and an entry match are separate results.
  function matchKeyword(page, keyword) {
    const key = keywordKey(keyword);
    const out = [];
    if (!key || !page) return out;
    if ((page.keywords || []).some((k) => keywordKey(k) === key)) {
      out.push({ kind: "page", entryIndex: -1, entryName: "" });
    }
    (page.entries || []).forEach((entry, index) => {
      if ((entry.keywords || []).some((k) => keywordKey(k) === key)) {
        out.push({ kind: "entry", entryIndex: index, entryName: entry.name });
      }
    });
    return out;
  }

  // Starter content for a newly created page (optionally with keywords).
  function newPageContent(name, keywords) {
    return serialize(setPageMeta(emptyPage(name), { keywords }));
  }

  return {
    parse, serialize,
    keywordKey, nameKey, normalizeKeywords,
    emptyPage, clonePage,
    setPageMeta, addEntry, updateEntry, removeEntry, moveEntry,
    entryNameTaken, findEntryIndex,
    parseAddress, matchKeyword, newPageContent,
    ILLEGAL_NAME,
  };
})();

if (typeof window !== "undefined") window.LoreModel = LoreModel;
if (typeof module !== "undefined" && module.exports) module.exports = LoreModel;
