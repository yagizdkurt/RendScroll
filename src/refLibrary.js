/* Reusable reference library.

   A campaign-wide cache of standalone reference files (Items today; NPCs,
   monsters, locations later). Each file is a normal RendScroll card block living
   in its own folder, referenced from scene Items with `SourceItem: Name` or
   inline text with `[link=Name]…[/link]`. This module is the ONE place that loads
   those files and resolves a name to its source.

   It knows nothing about the DOM or rendering: it loads files (via the launcher's
   bundle endpoint, falling back to per-file fetch), caches them by normalized
   name, and exposes a SYNCHRONOUS resolve() so the existing synchronous render
   pipeline (renderPage) can use library entries without becoming async.

   Generality lives in REF_TYPES: add a line there to support a new ref kind. */

const RefLibrary = (() => {
  // type -> { folder, cardType }. cardType is the existing renderer/parser card
  // type the resolved source renders as (see the RendScrollCards registry,
  // src/cards/shared/cardRegistry.js).
  const REF_TYPES = {
    item: { folder: "Items", cardType: "sourceitem" },
    enemy: { folder: "Enemies", cardType: "sourceenemy" },
    // future: npc / monster / location — add a line, nothing else changes.
  };

  // type -> Map(normalizedName -> { name, path, source, origin, shadows })
  // origin is "campaign" | "global"; shadows lists global paths a campaign file
  // overrides (the server merges campaign-over-global and reports the hidden ones).
  const cache = {};
  // [{ type, name, paths: [...] }] — same normalized name in two files.
  let duplicates = [];
  let ready = false;

  function norm(name) {
    // Turkish-safe lowercase (İ/I), matching the card builders' rsLower().
    return String(name == null ? "" : name).trim().replace(/İ/g, "i").replace(/I/g, "ı").toLowerCase();
  }

  function typeMap(type) {
    if (!cache[type]) cache[type] = new Map();
    return cache[type];
  }

  // Insert one entry, recording a duplicate when the normalized name collides.
  function put(type, entry) {
    const map = typeMap(type);
    const key = norm(entry.name);
    if (map.has(key)) {
      const existing = map.get(key);
      let dup = duplicates.find((d) => d.type === type && norm(d.name) === key);
      if (!dup) {
        dup = { type, name: existing.name, paths: [existing.path] };
        duplicates.push(dup);
      }
      if (dup.paths.indexOf(entry.path) < 0) dup.paths.push(entry.path);
      return; // keep the first file as the winner
    }
    // Bundle entries carry `content`; per-file fetch sets `source` — accept both.
    const source = entry.source != null ? entry.source : (entry.content || "");
    map.set(key, {
      name: entry.name,
      path: entry.path,
      source,
      origin: entry.origin || "global",
      shadows: Array.isArray(entry.shadows) ? entry.shadows.slice() : [],
    });
  }

  async function fetchJSON(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }

  async function loadType(type) {
    const def = REF_TYPES[type];
    if (!def) return;
    // Prefer the one-request bundle; fall back to listing + per-file fetch.
    try {
      const bundle = await fetchJSON("/__library_bundle?type=" + encodeURIComponent(type));
      if (Array.isArray(bundle)) {
        bundle.forEach((e) => put(type, e));
        return;
      }
    } catch (_) { /* fall through to per-file */ }

    try {
      const list = await fetchJSON("/__library_files?type=" + encodeURIComponent(type));
      if (!Array.isArray(list)) return;
      for (const e of list) {
        try {
          const res = await fetch(e.path, { cache: "no-store" });
          e.source = res.ok ? await res.text() : "";
        } catch (_) { e.source = ""; }
        put(type, e);
      }
    } catch (_) { /* library folder absent / not launched via launcher.py */ }
  }

  // Load every registered library once. Safe to call multiple times; the cache
  // is rebuilt each call so it can double as a full refresh.
  async function init() {
    Object.keys(cache).forEach((k) => delete cache[k]);
    duplicates = [];
    await Promise.all(Object.keys(REF_TYPES).map(loadType));
    ready = true;
  }

  function lookup(type, name) {
    const map = cache[type];
    if (!map) return null;
    return map.get(norm(name)) || null;
  }

  // Search every registered type for a name (used by inline `[link=]`, which is
  // type-agnostic). Returns { type, entry } or null.
  function lookupAny(name) {
    const key = norm(name);
    for (const type of Object.keys(REF_TYPES)) {
      const map = cache[type];
      if (map && map.has(key)) return { type, entry: map.get(key) };
    }
    return null;
  }

  // Resolve a library entry to its renderable source.
  // -> { ok:true, source, cardType, entry } | { ok:false, reason }
  function resolve(type, name) {
    const def = REF_TYPES[type];
    if (!def) return { ok: false, reason: "unknown-ref-type" };
    const entry = lookup(type, name);
    if (!entry) return { ok: false, reason: "missing-ref" };
    return { ok: true, source: entry.source, cardType: def.cardType, entry };
  }

  // Create a new library file, then update the cache so the new entry resolves
  // immediately without a full reload. `scope` is "campaign" (active campaign's
  // folder) or "global" (the shared root) — the server routes accordingly.
  async function createFile(type, name, content, scope) {
    const res = await fetch("/__create_library_file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, name, content, scope: scope || "global" }),
    });
    let payload = null;
    try { payload = await res.json(); } catch (_) { /* non-JSON */ }
    if (!res.ok || !payload || !payload.ok || !payload.entry) {
      const detail = payload && payload.error ? payload.error : "HTTP " + res.status;
      throw new Error("Item create failed: " + detail);
    }
    put(type, {
      name: payload.entry.name,
      path: payload.entry.path,
      origin: payload.entry.origin,
      source: content,
    });
    return payload.entry;
  }

  // Re-read one file from disk into the cache (after an editor save). Uses the
  // existing entry's real path so a campaign-local file refreshes from its own
  // folder, not the global root.
  async function refresh(type, name) {
    const def = REF_TYPES[type];
    if (!def) return;
    const existing = lookup(type, name);
    const path = existing ? existing.path : def.folder + "/" + name + ".md";
    try {
      const res = await fetch(encodeURI(path), { cache: "no-store" });
      const source = res.ok ? await res.text() : "";
      typeMap(type).set(norm(name), {
        name,
        path,
        source,
        origin: existing ? existing.origin : "global",
        shadows: existing ? existing.shadows : [],
      });
    } catch (_) { /* leave stale entry */ }
  }

  // Delete a library file, then drop it from the cache. The launcher's delete
  // guard allows library folders and campaign folders. Uses the entry's real path.
  async function deleteFile(type, name) {
    const def = REF_TYPES[type];
    if (!def) throw new Error("unknown library type: " + type);
    const existing = lookup(type, name);
    const path = existing ? existing.path : def.folder + "/" + name + ".md";
    const res = await fetch("/__delete_campaign_file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    let payload = null;
    try { payload = await res.json(); } catch (_) { /* non-JSON */ }
    if (!res.ok || !payload || !payload.ok) {
      const detail = payload && payload.error ? payload.error : "HTTP " + res.status;
      throw new Error("Item delete failed: " + detail);
    }
    const map = cache[type];
    if (map) map.delete(norm(name));
  }

  // Campaign-over-global overrides for the debug panel:
  // [{ type, name, using, hidden: [paths] }].
  function overrides() {
    const out = [];
    for (const type of Object.keys(cache)) {
      for (const e of cache[type].values()) {
        if (e.shadows && e.shadows.length) {
          out.push({ type, name: e.name, using: e.path, hidden: e.shadows.slice() });
        }
      }
    }
    return out;
  }

  function detectCycles() {
    return [];
  }

  function itemInstanceContent(name) {
    const n = String(name || "").trim();
    return "### Item: " + n + "\nSourceItem: " + n + "\n";
  }

  function sourceItemContent(name, content) {
    const n = String(name || "").trim();
    let src = String(content || "").replace(/\r?\n/g, "\n");
    const lines = src.split("\n");
    const heading = lines.findIndex((line) => /^\s*###\s+(source\s*item|sourceitem|item)\s*:/i.test(line));
    if (heading >= 0) {
      lines[heading] = lines[heading].replace(
        /^\s*###\s+(source\s*item|sourceitem|item)\s*:\s*(.*)$/i,
        (_, _kind, title) => "### SourceItem: " + (String(title || "").trim() || n)
      );
    } else {
      lines.unshift("### SourceItem: " + n);
    }
    return lines.filter((line) => !/^\s*(source\s*item|sourceitem|side|text\s*size|yapışık|connect|combine|closed)\s*:/i.test(line.trim())).join("\n");
  }

  // Normalize a created/edited enemy block into a SourceEnemy library file:
  // ensure a "### SourceEnemy: Name" heading and drop scene-only directive lines.
  function sourceEnemyContent(name, content) {
    const n = String(name || "").trim();
    let src = String(content || "").replace(/\r?\n/g, "\n");
    const lines = src.split("\n");
    const heading = lines.findIndex((line) => /^\s*###\s+(source\s*enemy|sourceenemy|sava[şs]|enemy)\s*:/i.test(line));
    if (heading >= 0) {
      lines[heading] = lines[heading].replace(
        /^\s*###\s+(source\s*enemy|sourceenemy|sava[şs]|enemy)\s*:\s*(.*)$/i,
        (_, _kind, title) => "### SourceEnemy: " + (String(title || "").trim() || n)
      );
    } else {
      lines.unshift("### SourceEnemy: " + n);
    }
    return lines.filter((line) => !/^\s*(side|text\s*size|yapışık|connect|combine|closed|enemies)\s*:/i.test(line.trim())).join("\n");
  }

  return {
    REF_TYPES,
    init,
    isReady: () => ready,
    def: (type) => REF_TYPES[type] || null,
    lookup,
    lookupAny,
    has: (type, name) => !!lookup(type, name),
    resolve,
    createFile,
    refresh,
    deleteFile,
    duplicates: () => duplicates.slice(),
    overrides,
    detectCycles,
    itemInstanceContent,
    sourceItemContent,
    sourceEnemyContent,
    norm,
    entries: (type) => (cache[type] ? [...cache[type].values()] : []),
  };
})();

if (typeof window !== "undefined") window.RefLibrary = RefLibrary;
if (typeof module !== "undefined" && module.exports) module.exports = RefLibrary;
