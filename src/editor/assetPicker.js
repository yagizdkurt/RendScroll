/* Editor asset picker field.

   Browser file inputs cannot be forced to open in content/images or campaign
   folders, so Browse calls the local launcher endpoint that opens a native file
   picker at the requested root. */

const EditorAssetPicker = (() => {
  const campaignAvailability = {};
  let shiftDown = false;
  const hoveredButtons = new Set();

  function warn(message, detail) {
    const log = (typeof globalThis !== "undefined") ? globalThis.RSLog : null;
    if (log && typeof log.warn === "function") log.warn("asset-picker", message, detail);
  }

  function assetTypeLabel(type) {
    return type === "audio" ? "audio" : "image";
  }

  async function campaignScopeAvailable(type) {
    try {
      const res = await fetch("/__assets?type=" + encodeURIComponent(type) + "&scope=campaign", { cache: "no-store" });
      campaignAvailability[type] = res.ok;
    } catch (err) {
      campaignAvailability[type] = false;
      warn("Campaign asset folder check failed.", err);
    }
    return campaignAvailability[type];
  }

  function refreshButton(button) {
    const hovered = button.classList.contains("is-hovered");
    const type = button.dataset.assetType;
    if (!hovered) {
      button.textContent = "Browse";
      button.disabled = false;
      return;
    }
    if (!type || !shiftDown) {
      button.textContent = "Shift For Campaign";
      button.disabled = false;
      return;
    }
    if (campaignAvailability[type] === false) {
      button.textContent = "Missing Campaign Folder";
      button.disabled = true;
    } else {
      button.textContent = "Shift For Campaign";
      button.disabled = false;
    }
    campaignScopeAvailable(type).then((available) => {
      if (!button.isConnected) return;
      button.disabled = shiftDown && button.classList.contains("is-hovered") && !available;
      button.textContent = button.disabled ? "Missing Campaign Folder" : "Shift For Campaign";
      button.title = available
        ? "Browse campaign " + assetTypeLabel(type) + " assets"
        : "Current campaign has no " + assetTypeLabel(type) + " folder";
    });
  }

  function refreshHoveredButtons() {
    hoveredButtons.forEach(refreshButton);
  }

  if (typeof document !== "undefined") {
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Shift") return;
      if (shiftDown) return;
      shiftDown = true;
      refreshHoveredButtons();
    });
    document.addEventListener("keyup", (e) => {
      if (e.key !== "Shift") return;
      shiftDown = false;
      refreshHoveredButtons();
    });
  }

  async function pick(type, scope) {
    const res = await fetch("/__pick_asset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, scope }),
    });
    let payload = null;
    try { payload = await res.json(); } catch (_) { /* non-JSON */ }
    if (!res.ok || !payload) {
      throw new Error(payload && payload.error ? payload.error : "HTTP " + res.status);
    }
    if (!payload.ok) return null;
    return payload;
  }

  function renderField(value, field, helpers) {
    const el = helpers.el;
    const button = helpers.button;
    const type = field.assetType;
    const wrap = el("div", "editor-asset-input");
    const input = el("input");
    input.type = "text";
    input.value = value || "";
    if (field.inputMode) input.inputMode = field.inputMode;
    if (field.hint) input.placeholder = field.hint;

    const browse = button("editor-mini editor-asset-browse", "Browse", "Browse global " + assetTypeLabel(type) + " assets");
    browse.dataset.assetType = type;
    browse.addEventListener("mouseenter", () => {
      browse.classList.add("is-hovered");
      hoveredButtons.add(browse);
      refreshButton(browse);
    });
    browse.addEventListener("mouseleave", () => {
      browse.classList.remove("is-hovered");
      hoveredButtons.delete(browse);
      browse.disabled = false;
      browse.title = "Browse global " + assetTypeLabel(type) + " assets";
      refreshButton(browse);
    });
    browse.addEventListener("click", async (e) => {
      const scope = e.shiftKey ? "campaign" : "global";
      if (scope === "campaign" && !(await campaignScopeAvailable(type))) return;
      browse.disabled = true;
      const oldText = browse.textContent;
      browse.textContent = "Opening...";
      try {
        const picked = await pick(type, scope);
        if (picked && picked.value != null) {
          input.value = picked.value;
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }
      } catch (err) {
        warn("Asset picker failed.", err);
        window.alert("Asset picker failed: " + (err.message || err));
      } finally {
        browse.disabled = false;
        browse.textContent = oldText;
        refreshButton(browse);
        input.focus();
      }
    });

    wrap.appendChild(input);
    wrap.appendChild(browse);
    return { wrap, getValue: () => input.value };
  }

  return {
    renderField,
    campaignScopeAvailable,
  };
})();

if (typeof window !== "undefined") window.EditorAssetPicker = EditorAssetPicker;
if (typeof module !== "undefined" && module.exports) module.exports = EditorAssetPicker;
