/* Per-campaign live table session state.

   Session state is not content: it lives in campaigns/<name>/session.json and is
   loaded/saved through fixed server endpoints. V1 persists combat runner state
   only. Browser-global like the rest of RendScroll. */

const SessionState = (() => {
  const EMPTY = () => ({ version: 1, scenes: {} });
  const SAVE_DELAY_MS = 250;

  let state = EMPTY();
  let loadedCampaign = null;
  let readOnly = false;
  let saveTimer = null;

  function warn(message, detail) {
    const log = (typeof globalThis !== "undefined") ? globalThis.RSLog : null;
    if (log && typeof log.warn === "function") log.warn("session", message, detail);
  }

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function normalizeScenePath(path) {
    const p = String(path || "").replace(/\\/g, "/");
    const idx = p.indexOf("/scenes/");
    if (idx >= 0) return p.slice(idx + 1);
    return p.startsWith("scenes/") ? p : "";
  }

  function validState(raw) {
    return raw && typeof raw === "object" && raw.version === 1 &&
      raw.scenes && typeof raw.scenes === "object" && !Array.isArray(raw.scenes);
  }

  async function loadForCampaign(name) {
    loadedCampaign = name || null;
    state = EMPTY();
    readOnly = false;
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (!loadedCampaign) return state;
    try {
      const res = await fetch(ServerApi.withCampaign("/__session_state"), { cache: "no-store" });
      const payload = await res.json();
      if (!res.ok || !payload || !payload.ok) throw new Error((payload && payload.error) || "session load failed");
      state = validState(payload.state) ? payload.state : EMPTY();
      readOnly = !!payload.readOnly;
      if (payload.warning) warn(payload.warning);
    } catch (err) {
      readOnly = true;
      state = EMPTY();
      warn("Session state could not be loaded; combat runner state will be ephemeral.", err);
    }
    return state;
  }

  function scheduleSave() {
    if (!loadedCampaign || readOnly) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, SAVE_DELAY_MS);
  }

  async function saveNow() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (!loadedCampaign || readOnly) return;
    try {
      const res = await fetch("/__save_session_state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ServerApi.withCampaignBody(state)),
      });
      const payload = await res.json();
      if (!res.ok || !payload || !payload.ok) throw new Error((payload && payload.error) || "session save failed");
    } catch (err) {
      warn("Session state could not be saved.", err);
    }
  }

  function sceneBucket(scenePath, create) {
    const key = normalizeScenePath(scenePath);
    if (!key) return null;
    if (!state.scenes[key]) {
      if (!create) return null;
      state.scenes[key] = { cards: {} };
    }
    if (!state.scenes[key].cards || typeof state.scenes[key].cards !== "object") {
      if (!create) return null;
      state.scenes[key].cards = {};
    }
    return state.scenes[key];
  }

  function getCard(scenePath, cardId) {
    const scene = sceneBucket(scenePath, false);
    const card = scene && scene.cards[String(cardId || "")];
    return card ? clone(card) : null;
  }

  function setCard(scenePath, cardId, value) {
    if (!cardId || readOnly) return;
    const scene = sceneBucket(scenePath, true);
    if (!scene) return;
    scene.cards[String(cardId)] = Object.assign({}, clone(value), {
      updatedAt: new Date().toISOString(),
    });
    scheduleSave();
  }

  function clearCard(scenePath, cardId) {
    if (!cardId || readOnly) return;
    const scene = sceneBucket(scenePath, false);
    if (!scene || !scene.cards[String(cardId)]) return;
    delete scene.cards[String(cardId)];
    scheduleSave();
  }

  function getCombat(scenePath, cardId) {
    const card = getCard(scenePath, cardId);
    return card && card.kind === "combat" ? card : null;
  }

  function setCombat(scenePath, cardId, combatState) {
    setCard(scenePath, cardId, Object.assign({ kind: "combat" }, combatState));
  }

  function clearCombat(scenePath, cardId) {
    clearCard(scenePath, cardId);
  }

  return {
    loadForCampaign,
    saveNow,
    normalizeScenePath,
    getCard,
    setCard,
    clearCard,
    getCombat,
    setCombat,
    clearCombat,
    _state: () => state,
    _isReadOnly: () => readOnly,
  };
})();

if (typeof window !== "undefined") window.SessionState = SessionState;
if (typeof module !== "undefined" && module.exports) module.exports = SessionState;
