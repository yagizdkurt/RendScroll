/* Shared asset discovery rules for export and debug tooling.

   The renderer owns URL construction (cardBgUrl/audioSrcUrl); this module owns
   the repo-relative asset inventory shape used by package export and diagnostics.
   It is pure so Node tests and browser code can consume the same rules. */

const RendScrollAssetInventory = (() => {
  const TYPE_DEFS = {
    images: { folder: "images", defaultExt: ".png" },
    audio: { folder: "audio", defaultExt: ".mp3" },
  };

  function normPath(p) {
    return String(p == null ? "" : p).replace(/\\/g, "/").replace(/^\/+/, "");
  }

  function hasScheme(value) {
    return /^[a-z]+:\/\//i.test(String(value || ""));
  }

  function assetRefPath(type, raw) {
    const def = TYPE_DEFS[type];
    if (!def) return null;
    let file = String(raw == null ? "" : raw).trim();
    if (!file) return null;
    if (!/\.[a-z0-9]+$/i.test(file)) file += def.defaultExt;
    if (hasScheme(file)) return null;
    if (file.startsWith("/")) return normPath(file);
    return /[\/\\]/.test(file) ? normPath(file) : def.folder + "/" + file;
  }

  function imageRefPath(raw) {
    return assetRefPath("images", raw);
  }

  function audioRefPath(raw) {
    return assetRefPath("audio", raw);
  }

  const IMAGE_LINE = /^\s*(image|bg)\s*:\s*(.+?)\s*$/i;
  const FILE_LINE = /^\s*file\s*:\s*(.+?)\s*$/i;
  const AUDIO_HEAD = /^#{1,6}\s*audio\s*:/i;
  const HEADING = /^#{1,6}\s/;
  const SOURCE_ITEM_LINE = /^\s*source\s*item\s*:\s*(.+?)\s*$/i;
  const ENEMY_RE = /\[enemy=([^\]\r\n]+)\]/ig;
  const ITEM_RE = /\[item=([^\]\r\n]+)\]/ig;
  const LINK_RE = /\[link=([^\]\r\n]+)\]/ig;

  function scanAssets(text, sourcePath) {
    const refs = [];
    let inAudio = false;
    String(text == null ? "" : text).split(/\r?\n/).forEach((line, idx) => {
      if (HEADING.test(line)) inAudio = AUDIO_HEAD.test(line);
      const img = line.match(IMAGE_LINE);
      if (img) {
        const path = imageRefPath(img[2]);
        if (path) {
          refs.push({
            type: "images",
            directive: img[1].toLowerCase(),
            raw: img[2].trim(),
            path,
            source: sourcePath || "",
            line: idx + 1,
          });
        }
        return;
      }
      if (inAudio) {
        const f = line.match(FILE_LINE);
        if (f) {
          const path = audioRefPath(f[1]);
          if (path) {
            refs.push({
              type: "audio",
              directive: "file",
              raw: f[1].trim(),
              path,
              source: sourcePath || "",
              line: idx + 1,
            });
          }
        }
      }
    });
    return refs;
  }

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

  function collectPackageReferences(scenes, refLib) {
    const files = new Set();
    const assetCandidates = new Set();
    const assetRefs = [];
    const missingRefs = [];
    const visited = new Set();
    const queue = [];

    (scenes || []).forEach((s) => {
      if (s && s.path) files.add(normPath(s.path));
      queue.push({ text: String(s && s.text || ""), source: s && s.path || "" });
    });

    while (queue.length) {
      const item = queue.shift();
      scanAssets(item.text, item.source).forEach((ref) => {
        assetRefs.push(ref);
        assetCandidates.add(ref.path);
      });

      collectRefNames(item.text).forEach(({ type, name }) => {
        if (!name) return;
        const normName = refLib && refLib.norm ? refLib.norm(name) : name;
        const key = type + ":" + normName;
        if (visited.has(key)) return;
        visited.add(key);
        const entry = resolveRef(refLib, type, name);
        if (entry && entry.path) {
          files.add(normPath(entry.path));
          queue.push({ text: String(entry.source || ""), source: entry.path });
        } else {
          missingRefs.push({ type, name });
        }
      });
    }

    return {
      files: [...files],
      assetCandidates: [...assetCandidates],
      assetRefs,
      missingRefs,
    };
  }

  function logicalAssetPath(path) {
    const p = normPath(path);
    const direct = p.match(/^(images|audio)\/(.+)$/i);
    if (direct) return direct[1].toLowerCase() + "/" + direct[2];
    const campaign = p.match(/^campaigns\/[^\/]+\/(images|audio)\/(.+)$/i);
    if (campaign) return campaign[1].toLowerCase() + "/" + campaign[2];
    return p;
  }

  function analyzeAssets(scenes, refLib, assetsByType) {
    const collected = collectPackageReferences(scenes, refLib);
    const byLogicalPath = new Map();
    ["images", "audio"].forEach((type) => {
      (assetsByType && assetsByType[type] || []).forEach((asset) => {
        byLogicalPath.set(logicalAssetPath(asset.path).toLowerCase(), Object.assign({ type }, asset));
      });
    });

    const used = new Set();
    const refs = collected.assetRefs.map((ref) => {
      const key = logicalAssetPath(ref.path).toLowerCase();
      const asset = byLogicalPath.get(key) || null;
      if (asset) used.add(key);
      return Object.assign({}, ref, { asset, missing: !asset });
    });

    const unused = [];
    byLogicalPath.forEach((asset, key) => {
      if (!used.has(key)) unused.push(asset);
    });
    unused.sort((a, b) => String(a.path).localeCompare(String(b.path), undefined, { sensitivity: "base" }));

    return {
      refs,
      missingAssets: refs.filter((r) => r.missing),
      unused,
      missingRefs: collected.missingRefs,
      files: collected.files,
      assetCandidates: collected.assetCandidates,
    };
  }

  return {
    TYPE_DEFS,
    normPath,
    assetRefPath,
    imageRefPath,
    audioRefPath,
    scanAssets,
    collectRefNames,
    collectPackageReferences,
    logicalAssetPath,
    analyzeAssets,
  };
})();

if (typeof window !== "undefined") window.RendScrollAssetInventory = RendScrollAssetInventory;
if (typeof module !== "undefined" && module.exports) module.exports = RendScrollAssetInventory;
