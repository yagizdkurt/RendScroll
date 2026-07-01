/* In-app Stage 1 update notice.

   Reads the launcher's structured /__update_status payload and renders a
   dismissible, non-blocking banner only when a newer repository version exists.
   No update download or installation logic belongs here.
*/
const RendScrollUpdateNotice = (() => {
  const STATUS_URL = "/__update_status";
  const MAX_ATTEMPTS = 16;
  const POLL_MS = 750;
  let dismissed = false;
  let banner = null;

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

    const actions = document.createElement("div");
    actions.className = "update-notice-actions";

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
      dismissed = true;
      removeBanner();
    });
    actions.appendChild(dismiss);

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
