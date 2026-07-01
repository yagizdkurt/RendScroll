/* Persistence: send edited scene markdown back to disk via the launcher's
   POST /__save endpoint. Knows nothing about the outline model or the DOM —
   it just ships {path, content} and reports success/failure. */

const EditorSave = (() => {
  // POST the markdown for `path` (e.g. "Campaigns/Legacy/Scenes/1_1.md"). Resolves to
  // { ok: true } or throws an Error carrying the server message.
  async function save(path, content) {
    let res;
    try {
      res = await fetch("/__save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, content }),
      });
    } catch (err) {
      // Network-level failure: almost always "not launched via launcher.py".
      throw new Error(
        "Could not reach the save endpoint. Start the app with launcher.py."
      );
    }

    let payload = null;
    try {
      payload = await res.json();
    } catch {
      /* non-JSON body */
    }

    if (!res.ok || !payload || !payload.ok) {
      const detail = payload && payload.error ? payload.error : `HTTP ${res.status}`;
      throw new Error("Save failed: " + detail);
    }
    return payload;
  }

  return { save };
})();
