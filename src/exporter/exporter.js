/* Campaign package exporter.

   "Export Campaign Package": gather the whole active campaign's scenes plus
   the library items/enemies and image/audio assets they reference into a flat
   list of repo-relative paths, and POST it to /__export_package, which copies
   the files into Exports/<name>/ under the campaign-folder layout and zips
   them. The recipient imports it into Campaigns/ and every reference resolves.

   Reference + asset resolution lives in the browser (the one place that already
   owns it): RefLibrary maps item/enemy names to their files, and the asset rules
   here mirror cardBgUrl (cards/shared/cardImage.js) and audioSrcUrl
   (cards/audio/audio.js). The server only copies and zips — it never re-derives
   what a card or asset is.

   Pure collection (collect / scanAssets / collectRefNames) is exported for tests
   via the CommonJS guard at the bottom; the async fetch/POST layer wraps it. */

const CampaignExporter = (() => {
  // Normalize a path to repo-relative, forward-slashed, no leading slash.
  function normPath(p) {
    return String(p == null ? "" : p).replace(/\\/g, "/").replace(/^\/+/, "");
  }

  // Resolve an "Image:"/"BG:" value to a repo-relative path, mirroring
  // cardBgUrl(): bare name -> images/<name>.png; a path is kept; external
  // (scheme://) values are skipped (returns null — nothing to bundle).
  function imageRefPath(raw) {
    let file = String(raw == null ? "" : raw).trim();
    if (!file) return null;
    if (!/\.[a-z0-9]+$/i.test(file)) file += ".png";
    if (/^[a-z]+:\/\//i.test(file)) return null;
    if (file.startsWith("/")) return normPath(file);
    return /[\/\\]/.test(file) ? normPath(file) : "images/" + file;
  }

  // Resolve an Audio "File:" value, mirroring audioSrcUrl(): bare name ->
  // audio/<name>.mp3. External values are skipped.
  function audioRefPath(raw) {
    let file = String(raw == null ? "" : raw).trim();
    if (!file) return null;
    if (!/\.[a-z0-9]+$/i.test(file)) file += ".mp3";
    if (/^[a-z]+:\/\//i.test(file)) return null;
    if (file.startsWith("/")) return normPath(file);
    return /[\/\\]/.test(file) ? normPath(file) : "audio/" + file;
  }

  const IMAGE_LINE = /^\s*(?:image|bg)\s*:\s*(.+?)\s*$/i;
  const FILE_LINE = /^\s*file\s*:\s*(.+?)\s*$/i;
  const AUDIO_HEAD = /^#{1,6}\s*audio\s*:/i;
  const HEADING = /^#{1,6}\s/;
  const SOURCE_ITEM_LINE = /^\s*source\s*item\s*:\s*(.+?)\s*$/i;
  // Mirror the inline-reference patterns used by diagnostics.js / inlineFormatting.
  const ENEMY_RE = /\[enemy=([^\]\r\n]+)\]/ig;
  const ITEM_RE = /\[item=([^\]\r\n]+)\]/ig;
  const LINK_RE = /\[link=([^\]\r\n]+)\]/ig;

  // Collect every image/audio asset path referenced by one text. "File:" lines
  // count as audio only inside an "### Audio:" section (matching the renderer),
  // so a stray File: elsewhere isn't mistaken for a missing sound.
  function scanAssets(text) {
    const out = [];
    let inAudio = false;
    String(text == null ? "" : text).split(/\r?\n/).forEach((line) => {
      if (HEADING.test(line)) inAudio = AUDIO_HEAD.test(line);
      const img = line.match(IMAGE_LINE);
      if (img) {
        const p = imageRefPath(img[1]);
        if (p) out.push(p);
        return;
      }
      if (inAudio) {
        const f = line.match(FILE_LINE);
        if (f) {
          const p = audioRefPath(f[1]);
          if (p) out.push(p);
        }
      }
    });
    return out;
  }

  // Collect every library reference in one text as { type, name } records.
  // type is "item", "enemy", or "any" (an inline [link=] that could be either).
  function collectRefNames(text) {
    const src = String(text == null ? "" : text);
    const refs = [];
    src.split(/\r?\n/).forEach((line) => {
      const si = line.match(SOURCE_ITEM_LINE);
      if (si) refs.push({ type: "item", name: si[1].trim() });
    });
    let m;
    for (const [re, type] of [[ENEMY_RE, "enemy"], [ITEM_RE, "item"], [LINK_RE, "any"]]) {
      re.lastIndex = 0;
      while ((m = re.exec(src))) refs.push({ type, name: m[1].trim() });
    }
    return refs;
  }

  function resolveRef(refLib, type, name) {
    if (!refLib) return null;
    if (type === "any") {
      const hit = refLib.lookupAny ? refLib.lookupAny(name) : null;
      return hit ? hit.entry : null;
    }
    return refLib.lookup ? refLib.lookup(type, name) : null;
  }

  // Pure core: walk scenes + (recursively) their referenced items/enemies, and
  // gather every source .md path and asset candidate. Asset existence is NOT
  // checked here (that's a network call) — the caller filters assetCandidates.
  // -> { files: [paths], assetCandidates: [paths], missingRefs: [{type,name}] }
  function collect(scenes, refLib) {
    const files = new Set();
    const assetCandidates = new Set();
    const missingRefs = [];
    const visited = new Set();
    const queue = [];

    (scenes || []).forEach((s) => {
      if (s && s.path) files.add(normPath(s.path));
      queue.push(String(s && s.text || ""));
    });

    while (queue.length) {
      const text = queue.shift();
      scanAssets(text).forEach((p) => assetCandidates.add(p));

      collectRefNames(text).forEach(({ type, name }) => {
        if (!name) return;
        const normName = refLib && refLib.norm ? refLib.norm(name) : name;
        const key = type + ":" + normName;
        if (visited.has(key)) return;
        visited.add(key);
        const entry = resolveRef(refLib, type, name);
        if (entry && entry.path) {
          files.add(normPath(entry.path));
          queue.push(String(entry.source || ""));
        } else {
          missingRefs.push({ type, name });
        }
      });
    }

    return { files: [...files], assetCandidates: [...assetCandidates], missingRefs };
  }

  // ---- Async fetch / POST layer (browser only) --------------------------

  function defaultName() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return "Campaign-" + d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  async function fetchJSON(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }

  async function loadScenes() {
    const entries = await fetchJSON("/__campaign_files");
    const scenes = [];
    for (const e of entries) {
      let text = "";
      try {
        const res = await fetch(e.path, { cache: "no-store" });
        text = res.ok ? await res.text() : "";
      } catch (_) { text = ""; }
      scenes.push({ path: e.path, text });
    }
    return scenes;
  }

  async function assetExists(path) {
    try {
      const res = await fetch("/" + path, { method: "HEAD", cache: "no-store" });
      return res.ok;
    } catch (_) {
      return false;
    }
  }

  // Gather everything, verify assets exist, and POST the package request.
  // -> { ok, zip, copied, missing } | throws on transport/server error.
  async function exportPackage(opts) {
    const refLib = (typeof window !== "undefined" && window.RefLibrary) || null;
    if (refLib && refLib.isReady && !refLib.isReady() && refLib.init) {
      try { await refLib.init(); } catch (_) { /* resolve what we can */ }
    }

    const scenes = await loadScenes();
    const { files, assetCandidates, missingRefs } = collect(scenes, refLib);

    const fileSet = new Set(files);
    const missing = missingRefs.map((r) => r.type + ": " + r.name);
    for (const asset of assetCandidates) {
      if (await assetExists(asset)) fileSet.add(asset);
      else missing.push("asset: " + asset);
    }
    // Renderer options stay global (not per-campaign), so they are not bundled —
    // the server restructures the rest into a Campaigns/<name>/ layout + manifest.

    const name = (opts && opts.name) || defaultName();
    const label = (opts && opts.label) || name;
    const res = await fetch("/__export_package", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, label, files: [...fileSet] }),
    });
    let payload = null;
    try { payload = await res.json(); } catch (_) { /* non-JSON */ }
    if (!res.ok || !payload || !payload.ok) {
      const detail = payload && payload.error ? payload.error : "HTTP " + res.status;
      throw new Error("Export failed: " + detail);
    }
    return { ok: true, zip: payload.zip, copied: payload.copied, missing };
  }

  return {
    exportPackage,
    collect,
    scanAssets,
    collectRefNames,
    imageRefPath,
    audioRefPath,
  };
})();

if (typeof window !== "undefined") window.CampaignExporter = CampaignExporter;
if (typeof module !== "undefined" && module.exports) module.exports = CampaignExporter;
