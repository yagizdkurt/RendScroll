/* Reusable reference library.

   A campaign-wide cache of standalone reference files (Items today; NPCs,
   monsters, locations later). Each file is a normal RendScroll card block living
   in its own folder, referenced from scenes with `[item=Name]` (a block) or
   `[link=Name]…[/link]` (inline). This module is the ONE place that loads those
   files and resolves a name to its source.

   It knows nothing about the DOM or rendering: it loads files (via the launcher's
   bundle endpoint, falling back to per-file fetch), caches them by normalized
   name, and exposes a SYNCHRONOUS resolve() so the existing synchronous render
   pipeline (renderPage) can expand references without becoming async.

   Generality lives in REF_TYPES: add a line there to support a new ref kind. */

const RefLibrary = (() => {
  // type -> { folder, cardType }. cardType is the existing renderer/parser card
  // type the resolved source renders as (see CARD_BUILDERS in src/app.js).
  const REF_TYPES = {
    item: { folder: "Items", cardType: "item" },
    // future: npc / monster / location — add a line, nothing else changes.
  };

  const MAX_DEPTH = 8; // nested-reference expansion guard

  // Standalone reference line, e.g. "[item=Gümüş Anahtar]". ASCII type keyword,
  // free-form name. Mirrors the parser's REF_LINE_RE (kept in sync by shape).
  const REF_LINE_RE = /^\[([a-z][a-z0-9-]*)=([^\]\r\n]+)\]$/i;

  // type -> Map(normalizedName -> { name, path, source })
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
    map.set(key, { name: entry.name, path: entry.path, source });
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

  // Recursively inline standalone `[type=name]` lines found inside a source,
  // guarding against cycles (visited set) and runaway depth.
  function expandSource(source, visited, depth) {
    if (depth > MAX_DEPTH) return source;
    const lines = String(source).split(/\r?\n/);
    let changed = false;
    const out = lines.map((line) => {
      const m = line.trim().match(REF_LINE_RE);
      if (!m) return line;
      const t = m[1].toLowerCase();
      const entry = lookup(t, m[2]);
      if (!entry) return line; // unresolved nested ref: leave literal
      const key = t + "::" + norm(m[2]);
      if (visited.has(key)) return line; // cycle: stop expanding, leave literal
      changed = true;
      visited.add(key);
      const expanded = expandSource(entry.source, visited, depth + 1);
      visited.delete(key);
      return expanded;
    });
    return changed ? out.join("\n") : source;
  }

  // Resolve a block reference to renderable source.
  // -> { ok:true, source, cardType, entry } | { ok:false, reason }
  function resolve(type, name) {
    const def = REF_TYPES[type];
    if (!def) return { ok: false, reason: "unknown-ref-type" };
    const entry = lookup(type, name);
    if (!entry) return { ok: false, reason: "missing-ref" };
    const visited = new Set([type + "::" + norm(name)]);
    return { ok: true, source: expandSource(entry.source, visited, 0), cardType: def.cardType, entry };
  }

  // Create a new library file, then update the cache so the new entry resolves
  // immediately without a full reload.
  async function createFile(type, name, content) {
    const res = await fetch("/__create_library_file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, name, content }),
    });
    let payload = null;
    try { payload = await res.json(); } catch (_) { /* non-JSON */ }
    if (!res.ok || !payload || !payload.ok || !payload.entry) {
      const detail = payload && payload.error ? payload.error : "HTTP " + res.status;
      throw new Error("Item create failed: " + detail);
    }
    put(type, { name: payload.entry.name, path: payload.entry.path, source: content });
    return payload.entry;
  }

  // Re-read one file from disk into the cache (after an editor save).
  async function refresh(type, name) {
    const def = REF_TYPES[type];
    if (!def) return;
    const path = def.folder + "/" + encodeURIComponent(name) + ".md";
    try {
      const res = await fetch(path, { cache: "no-store" });
      const source = res.ok ? await res.text() : "";
      typeMap(type).set(norm(name), { name, path: def.folder + "/" + name + ".md", source });
    } catch (_) { /* leave stale entry */ }
  }

  // Delete a library file, then drop it from the cache. The launcher's delete
  // guard already allows library folders (Items/, …).
  async function deleteFile(type, name) {
    const def = REF_TYPES[type];
    if (!def) throw new Error("unknown library type: " + type);
    const path = def.folder + "/" + name + ".md";
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

  // Build a ref graph from every library file's standalone ref lines and report
  // names that participate in a cycle. Used by diagnostics.
  function detectCycles() {
    const edges = {}; // "type::name" -> [neighbor keys]
    const labels = {}; // key -> display "type=name"
    Object.keys(cache).forEach((type) => {
      cache[type].forEach((entry, key) => {
        const full = type + "::" + key;
        labels[full] = type + "=" + entry.name;
        edges[full] = [];
        String(entry.source).split(/\r?\n/).forEach((line) => {
          const m = line.trim().match(REF_LINE_RE);
          if (!m) return;
          edges[full].push(m[1].toLowerCase() + "::" + norm(m[2]));
        });
      });
    });

    const state = {}; // 0 unvisited, 1 in-stack, 2 done
    const cycles = [];
    function dfs(node, stack) {
      state[node] = 1;
      stack.push(node);
      (edges[node] || []).forEach((next) => {
        if (state[next] === 1) {
          const at = stack.indexOf(next);
          const ring = stack.slice(at).map((k) => labels[k] || k);
          cycles.push(ring);
        } else if (!state[next] && edges[next]) {
          dfs(next, stack);
        }
      });
      stack.pop();
      state[node] = 2;
    }
    Object.keys(edges).forEach((node) => { if (!state[node]) dfs(node, []); });
    return cycles;
  }

  return {
    REF_TYPES,
    REF_LINE_RE,
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
    detectCycles,
    norm,
    entries: (type) => (cache[type] ? [...cache[type].values()] : []),
  };
})();

if (typeof window !== "undefined") window.RefLibrary = RefLibrary;
if (typeof module !== "undefined" && module.exports) module.exports = RefLibrary;
