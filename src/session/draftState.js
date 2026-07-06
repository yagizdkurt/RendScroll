/* Per-campaign editor drafts.

   Drafts are user state, not scene content. When a campaign is active they live
   in campaigns/<name>/.sys/drafts.json via fixed server endpoints. If the app is
   opened without the launcher, this module falls back to the legacy localStorage
   keys so draft behavior degrades instead of disappearing. */

const DraftState = (() => {
  const EMPTY = () => ({ version: 1, create: {}, editManifest: {} });
  const SAVE_DELAY_MS = 250;
  const CREATE_PREFIX = "rendscroll-draft:";
  const EDIT_MANIFEST_PREFIX = "rendscroll-draft:edit-manifest:";

  let state = EMPTY();
  let loadedCampaign = null;
  let readOnly = false;
  let localFallback = false;
  let saveTimer = null;

  function warn(message, detail) {
    const log = (typeof globalThis !== "undefined") ? globalThis.RSLog : null;
    if (log && typeof log.warn === "function") log.warn("drafts", message, detail);
  }

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function validState(raw) {
    return raw && typeof raw === "object" && raw.version === 1 &&
      raw.create && typeof raw.create === "object" && !Array.isArray(raw.create) &&
      raw.editManifest && typeof raw.editManifest === "object" && !Array.isArray(raw.editManifest);
  }

  function normalizeScenePath(path) {
    const p = String(path || "").replace(/\\/g, "/");
    const idx = p.indexOf("/scenes/");
    if (idx >= 0) return p.slice(idx + 1);
    return p.startsWith("scenes/") ? p : "";
  }

  function localGet(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function localSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
  }

  function localRemove(key) {
    try { localStorage.removeItem(key); } catch (_) {}
  }

  function legacyCreateKey(type) {
    return CREATE_PREFIX + type;
  }

  function legacyEditManifestKey(path) {
    return EDIT_MANIFEST_PREFIX + String(path || "");
  }

  function legacyEditManifestKeys(scenePath) {
    const keys = [legacyEditManifestKey(scenePath)];
    if (loadedCampaign && scenePath) {
      keys.push(legacyEditManifestKey("campaigns/" + loadedCampaign + "/" + scenePath));
    }
    return keys;
  }

  function mergeLegacyDrafts() {
    if (!loadedCampaign) return;
    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith(CREATE_PREFIX) || key.startsWith(EDIT_MANIFEST_PREFIX)) continue;
        const type = key.slice(CREATE_PREFIX.length);
        if (type && !state.create[type]) {
          const value = localGet(key);
          if (value && typeof value === "object" && !Array.isArray(value)) state.create[type] = value;
        }
      }
    } catch (_) {}

    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith(EDIT_MANIFEST_PREFIX)) continue;
        const rawPath = key.slice(EDIT_MANIFEST_PREFIX.length);
        const scenePath = normalizeScenePath(rawPath);
        if (scenePath && !state.editManifest[scenePath]) {
          const value = localGet(key);
          if (value && typeof value === "object" && !Array.isArray(value)) state.editManifest[scenePath] = value;
        }
      }
    } catch (_) {}
  }

  function cleanupLegacy() {
    Object.keys(state.create || {}).forEach((type) => localRemove(legacyCreateKey(type)));
    Object.keys(state.editManifest || {}).forEach((scenePath) => {
      legacyEditManifestKeys(scenePath).forEach(localRemove);
    });
  }

  async function loadForCampaign(name) {
    loadedCampaign = name || null;
    state = EMPTY();
    readOnly = false;
    localFallback = false;
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (!loadedCampaign) {
      localFallback = true;
      return state;
    }
    try {
      const res = await fetch(ServerApi.withCampaign("/__draft_state"), { cache: "no-store" });
      const payload = await res.json();
      if (!res.ok || !payload || !payload.ok) throw new Error((payload && payload.error) || "draft load failed");
      state = validState(payload.state) ? payload.state : EMPTY();
      readOnly = !!payload.readOnly;
      if (payload.warning) warn(payload.warning);
      mergeLegacyDrafts();
      if (!readOnly) scheduleSave();
    } catch (err) {
      readOnly = true;
      localFallback = true;
      state = EMPTY();
      warn("Draft state could not be loaded; drafts will use browser fallback storage.", err);
    }
    return state;
  }

  function scheduleSave() {
    if (!loadedCampaign || readOnly || localFallback) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, SAVE_DELAY_MS);
  }

  async function saveNow() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (!loadedCampaign || readOnly || localFallback) return false;
    try {
      const res = await fetch("/__save_draft_state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ServerApi.withCampaignBody(state)),
      });
      const payload = await res.json();
      if (!res.ok || !payload || !payload.ok) throw new Error((payload && payload.error) || "draft save failed");
      cleanupLegacy();
      return true;
    } catch (err) {
      warn("Draft state could not be saved.", err);
      return false;
    }
  }

  function getCreate(type) {
    const key = String(type || "");
    if (localFallback) return localGet(legacyCreateKey(key));
    return state.create[key] ? clone(state.create[key]) : null;
  }

  function setCreate(type, value) {
    const key = String(type || "");
    if (!key) return;
    if (localFallback) {
      localSet(legacyCreateKey(key), value);
      return;
    }
    state.create[key] = clone(value || {});
    scheduleSave();
  }

  function clearCreate(type) {
    const key = String(type || "");
    if (!key) return;
    delete state.create[key];
    localRemove(legacyCreateKey(key));
    scheduleSave();
  }

  function getEditManifest(path) {
    const scenePath = normalizeScenePath(path);
    if (!scenePath) return null;
    if (localFallback) {
      let found = null;
      legacyEditManifestKeys(scenePath).some((key) => {
        found = localGet(key);
        return !!found;
      });
      return found;
    }
    return state.editManifest[scenePath] ? clone(state.editManifest[scenePath]) : null;
  }

  function setEditManifest(path, value) {
    const scenePath = normalizeScenePath(path);
    if (!scenePath) return;
    if (localFallback) {
      localSet(legacyEditManifestKey(path), value);
      return;
    }
    state.editManifest[scenePath] = clone(value || {});
    scheduleSave();
  }

  function clearEditManifest(path) {
    const scenePath = normalizeScenePath(path);
    if (!scenePath) return;
    delete state.editManifest[scenePath];
    legacyEditManifestKeys(scenePath).forEach(localRemove);
    localRemove(legacyEditManifestKey(path));
    scheduleSave();
  }

  return {
    loadForCampaign,
    saveNow,
    normalizeScenePath,
    getCreate,
    setCreate,
    clearCreate,
    getEditManifest,
    setEditManifest,
    clearEditManifest,
    _state: () => state,
    _isLocalFallback: () => localFallback,
    _isReadOnly: () => readOnly,
  };
})();

if (typeof window !== "undefined") window.DraftState = DraftState;
if (typeof module !== "undefined" && module.exports) module.exports = DraftState;
