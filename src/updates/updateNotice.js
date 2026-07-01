/* In-app update notice + Stage 2 installer trigger.

   Reads the launcher's structured /__update_status payload and renders a
   dismissible, non-blocking banner only when a newer repository version exists.
   The "Update Now" button POSTs /__begin_update and then polls /__update_progress
   to show step status; the launcher owns all download/replace/relaunch logic.
*/
const RendScrollUpdateNotice = (() => {
  const STATUS_URL = "/__update_status";
  const BEGIN_URL = "/__begin_update";
  const PROGRESS_URL = "/__update_progress";
  const MAX_ATTEMPTS = 16;
  const POLL_MS = 750;
  const PROGRESS_POLL_MS = 600;
  const PHASE_LABELS = {
    starting: "Starting update…",
    downloading: "Downloading update…",
    extracting: "Extracting update…",
    preparing: "Preparing update…",
    relaunching: "Applying update and relaunching. This window will close…",
  };
  let dismissed = false;
  let banner = null;
  let installing = false;

  function stringField(data, key) {
    const value = data && data[key];
    return typeof value === "string" && value.trim() ? value.trim() : "";
  }

  async function fetchStatus() {
    const res = await fetch(STATUS_URL, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }

  function removeBanner() {
    if (banner) banner.remove();
    banner = null;
  }

  function button(text, className) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = className;
    btn.textContent = text;
    return btn;
  }

  function render(status) {
    if (dismissed || !status || status.state !== "update_available") return;

    removeBanner();

    const current = stringField(status, "current_version");
    const latest = stringField(status, "latest_version");
    const title = stringField(status, "title");
    const changes = stringField(status, "changes");
    const url = stringField(status, "url");

    const wrap = document.createElement("section");
    wrap.className = "update-notice print-hide";
    wrap.setAttribute("role", "status");
    wrap.setAttribute("aria-live", "polite");

    const content = document.createElement("div");
    content.className = "update-notice-content";

    const heading = document.createElement("div");
    heading.className = "update-notice-title";
    heading.textContent = title || "RendScroll update available";
    content.appendChild(heading);

    const versions = document.createElement("div");
    versions.className = "update-notice-version";
    versions.textContent = "Current " + (current || "unknown") + " -> Latest " + (latest || "unknown");
    content.appendChild(versions);

    if (changes) {
      const body = document.createElement("div");
      body.className = "update-notice-changes";
      body.textContent = changes;
      content.appendChild(body);
    }

    const progress = document.createElement("div");
    progress.className = "update-notice-progress";
    progress.hidden = true;
    content.appendChild(progress);

    const actions = document.createElement("div");
    actions.className = "update-notice-actions";

    const update = button("Update Now", "update-notice-update");
    actions.appendChild(update);

    if (url) {
      const view = document.createElement("a");
      view.className = "update-notice-view";
      view.href = url;
      view.target = "_blank";
      view.rel = "noopener noreferrer";
      view.textContent = "View Update";
      actions.appendChild(view);
    }

    const dismiss = button("Dismiss", "update-notice-dismiss");
    dismiss.addEventListener("click", () => {
      if (installing) return;
      dismissed = true;
      removeBanner();
    });
    actions.appendChild(dismiss);

    update.addEventListener("click", () => beginUpdate(update, dismiss, progress));

    wrap.appendChild(content);
    wrap.appendChild(actions);

    const topbar = document.getElementById("topbar");
    if (topbar && topbar.parentNode) {
      topbar.parentNode.insertBefore(wrap, topbar.nextSibling);
    } else {
      document.body.appendChild(wrap);
    }
    banner = wrap;
  }

  function showProgress(progress, text, isError) {
    progress.hidden = false;
    progress.textContent = text;
    progress.classList.toggle("is-error", !!isError);
  }

  function phaseText(status) {
    const message = stringField(status, "message");
    const phase = stringField(status, "phase");
    return message || PHASE_LABELS[phase] || "Working…";
  }

  async function beginUpdate(update, dismiss, progress) {
    if (installing) return;
    installing = true;
    update.disabled = true;
    dismiss.disabled = true;
    showProgress(progress, "Starting update…", false);

    try {
      const res = await fetch(BEGIN_URL, { method: "POST", cache: "no-store" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "HTTP " + res.status);
      }
    } catch (err) {
      installing = false;
      update.disabled = false;
      dismiss.disabled = false;
      showProgress(progress, "Could not start update: " + err.message, true);
      return;
    }

    pollProgress(update, dismiss, progress);
  }

  async function pollProgress(update, dismiss, progress) {
    let status = null;
    try {
      const res = await fetch(PROGRESS_URL, { cache: "no-store" });
      if (res.ok) status = await res.json();
    } catch (_) {
      // Server is likely restarting (relaunch phase); keep the last message.
    }

    if (status && status.ok === false) {
      installing = false;
      update.disabled = false;
      dismiss.disabled = false;
      showProgress(progress, phaseText(status), true);
      return;
    }

    if (status) showProgress(progress, phaseText(status), false);

    // "relaunching" means the server is about to close; stop polling and wait for
    // the updated app to reopen in a fresh window.
    if (status && stringField(status, "phase") === "relaunching") return;

    setTimeout(() => pollProgress(update, dismiss, progress), PROGRESS_POLL_MS);
  }

  function init() {
    let attempts = 0;

    async function tick() {
      if (dismissed) return;
      attempts += 1;
      try {
        const status = await fetchStatus();
        if (status && status.pending && attempts < MAX_ATTEMPTS) {
          setTimeout(tick, POLL_MS);
          return;
        }
        if (status && status.state === "update_available") render(status);
      } catch (_) {
        if (attempts < MAX_ATTEMPTS) setTimeout(tick, POLL_MS);
      }
    }

    tick();
  }

  return { init };
})();
