/* Renderer options: persisted design knobs, all in one place.

   Three kinds of options:
     - type "toggle": boolean -> a class on <body>            (present when true)
     - type "choice": one value -> data-opt-<attr> on <body>  (CSS keys off it)
     - type "image":  a data-URL  -> CSS var on <body>        (custom page BG)

   Persistence is two files (see launcher.py):
     - src/Options/options.defaults.json  -> committed default values ("Back to defaults")
     - options.current.json       -> gitignored, the user's saved choices

   Save model is "live preview, commit on Save": the Options modal edits a
   working copy that previews instantly; only Save writes options.current.json
   (and a localStorage mirror as an offline fallback). Closing without Save
   reverts the preview to the last committed state.

   To add a new design knob later: add one SCHEMA entry + the matching CSS
   (a `body.<bodyClass>` rule for a toggle, or `body[data-opt-<attr>="..."]`
   rules for a choice) and a default in options.defaults.json. */
const RendererOptions = (() => {
  const STORAGE_KEY = "rendererOptions"; // localStorage mirror / offline fallback
  const DEFAULTS_URL = "src/Options/options.defaults.json";
  const CURRENT_URL = "options.current.json";
  const SAVE_ENDPOINT = "/__save_options";
  const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // ~2 MB guard for uploaded PNGs
  const PARCHIMENT_IMAGE_URL = "src/STDImages/parchiment.png";

  const SCHEMA = {
    // ---- Reader ----
    textSize: {
      section: "Reader", type: "choice", attr: "textsize", default: "md",
      label: "Reader Text Scale",
      choices: [
        { value: "sm", label: "Small" },
        { value: "md", label: "Normal" },
        { value: "lg", label: "Large" },
      ],
    },
    readerLineHeight: {
      section: "Reader", type: "choice", attr: "leading", default: "normal",
      label: "Line Spacing",
      choices: [
        { value: "compact", label: "Compact" },
        { value: "normal", label: "Normal" },
        { value: "relaxed", label: "Relaxed" },
      ],
    },
    readerFont: {
      section: "Reader", type: "choice", attr: "font", default: "garamond",
      label: "Reader Font",
      choices: [
        { value: "garamond", label: "Garamond" },
        { value: "serif", label: "Serif" },
        { value: "sans", label: "Sans" },
      ],
    },
    defaultCardTextSize: {
      section: "Reader", type: "choice", default: "16", label: "Default Card Text Size",
      choices: [
        { value: "10", label: "10" },
        { value: "12", label: "12" },
        { value: "14", label: "14" },
        { value: "16", label: "16" },
        { value: "18", label: "18" },
        { value: "20", label: "20" },
      ],
    },
    italicReadAloud: {
      section: "Reader", type: "toggle", bodyClass: "opt-italic-readaloud", default: false,
      label: "Italic Narration",
    },
    readAloudAccent: {
      section: "Reader", type: "toggle", bodyClass: "opt-readaloud-accent", default: true,
      label: "Narration Border Accent",
    },
    startClosed: {
      section: "Reader", type: "toggle", bodyClass: "opt-start-closed", default: false,
      label: "Start Cards Closed",
    },

    // ---- Layout ----
    pageWidth: {
      section: "Layout", type: "choice", attr: "pagewidth", default: "md", label: "Page Width",
      choices: [
        { value: "narrow", label: "Narrow" },
        { value: "md", label: "Normal" },
        { value: "wide", label: "Wide" },
      ],
    },

    // ---- Theme ----
    uiTheme: {
      section: "Theme", type: "choice", attr: "theme", default: "dark", label: "UI Theme",
      choices: [
        { value: "dark", label: "Dark" },
        { value: "light", label: "Light" },
      ],
    },
    pageBackground: {
      section: "Theme", type: "choice", attr: "pagebg", default: "parchiment", label: "Page Background",
      choices: [
        { value: "parchiment", label: "Parchiment" },
        { value: "parchment", label: "Parchment" },
        { value: "aged", label: "Aged" },
        { value: "slate", label: "Slate" },
        { value: "plain", label: "Plain" },
        { value: "custom", label: "Custom", hidden: true }, // set by uploading a PNG
      ],
    },
    pageBackgroundImage: {
      section: "Theme", type: "image", default: "", label: "Custom Background (PNG)",
    },

    // ---- Application ----
    check_for_updates: {
      section: "Application", type: "toggle", default: true,
      label: "Check for Updates",
    },
  };

  // ---- State -------------------------------------------------------------
  let defaults = schemaDefaults(); // overwritten by options.defaults.json at init()
  let committed = { ...defaults };  // last saved / loaded state
  const working = { ...defaults };  // the live copy the modal edits

  function schemaDefaults() {
    const d = {};
    for (const k in SCHEMA) d[k] = SCHEMA[k].default;
    return d;
  }

  // Coerce a single value to something valid for its option, else return the
  // provided fallback. Keeps unknown / corrupt persisted data from leaking in.
  function coerce(k, value, fallback) {
    const opt = SCHEMA[k];
    if (!opt) return fallback;
    if (opt.type === "toggle") return typeof value === "boolean" ? value : fallback;
    if (opt.type === "image") return typeof value === "string" ? value : fallback;
    // choice
    const allowed = opt.choices.map((c) => c.value);
    return allowed.includes(value) ? value : fallback;
  }

  // defaults (already valid) overlaid by a saved blob (validated key by key).
  function mergeState(base, saved) {
    const s = {};
    saved = saved && typeof saved === "object" ? saved : {};
    for (const k in SCHEMA) {
      s[k] = (k in saved) ? coerce(k, saved[k], base[k]) : base[k];
    }
    return s;
  }

  // ---- Init / persistence ------------------------------------------------
  async function fetchJSON(url) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return null;
      return await res.json();
    } catch { return null; }
  }

  function localFallback() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || null; } catch { return null; }
  }

  async function init() {
    const fileDefaults = await fetchJSON(DEFAULTS_URL);
    defaults = mergeState(schemaDefaults(), fileDefaults || {});
    // Prefer the gitignored current file; fall back to a localStorage mirror
    // (e.g. opened as file://), then to defaults.
    const current = (await fetchJSON(CURRENT_URL)) || localFallback() || {};
    committed = mergeState(defaults, current);
    Object.assign(working, committed);
    apply(committed);
    return committed;
  }

  async function persist(state) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* quota */ }
    try {
      const res = await fetch(SAVE_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload || !payload.ok) {
        throw new Error(payload && payload.error ? payload.error : `HTTP ${res.status}`);
      }
      return true;
    } catch {
      return false; // saved to localStorage only (not launched via launcher.py)
    }
  }

  // ---- Apply state to the DOM -------------------------------------------
  function apply(state = committed) {
    for (const k in SCHEMA) {
      const opt = SCHEMA[k];
      if (opt.type === "toggle") {
        if (opt.bodyClass) document.body.classList.toggle(opt.bodyClass, !!state[k]);
      } else if (opt.type === "image") {
        const image = state.pageBackground === "parchiment" ? PARCHIMENT_IMAGE_URL : state[k];
        if (image) document.body.style.setProperty("--page-bg-custom", `url("${image}")`);
        else document.body.style.removeProperty("--page-bg-custom");
      } else if (opt.attr) {
        const value = k === "pageBackground" && state[k] === "parchiment" ? "custom" : state[k];
        document.body.setAttribute("data-opt-" + opt.attr, value);
      }
    }
  }

  function get(k) { return committed[k]; }

  // Legacy direct setter (kept for compatibility): commit + persist one key.
  function set(k, value) {
    const opt = SCHEMA[k];
    if (!opt) return;
    committed[k] = coerce(k, value, committed[k]);
    Object.assign(working, committed);
    apply(committed);
    persist(committed);
    document.dispatchEvent(new CustomEvent("rendereroptionchange", { detail: { key: k } }));
  }

  // ---- Controls (generated from SCHEMA) ----------------------------------
  const syncFns = [];
  function syncAll() { syncFns.forEach((f) => f()); }
  function preview() { apply(working); syncAll(); } // live preview, no persist

  function buildToggle(k, opt) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "opt-toggle";
    const render = () => {
      btn.classList.toggle("on", !!working[k]);
      btn.setAttribute("aria-pressed", String(!!working[k]));
      btn.textContent = (working[k] ? "☑ " : "☐ ") + opt.label;
    };
    btn.addEventListener("click", () => { working[k] = !working[k]; preview(); });
    syncFns.push(render);
    return wrapControl(opt.label, btn, true);
  }

  function buildChoice(k, opt) {
    const row = document.createElement("div");
    row.className = "opt-choices";
    const btns = opt.choices.filter((c) => !c.hidden).map((c) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "opt-choice";
      b.textContent = c.label;
      b.dataset.value = c.value;
      b.addEventListener("click", () => { working[k] = c.value; preview(); });
      row.appendChild(b);
      return b;
    });
    syncFns.push(() => btns.forEach((b) => b.classList.toggle("on", b.dataset.value === working[k])));
    return wrapControl(opt.label, row);
  }

  function buildImage(k, opt) {
    const row = document.createElement("div");
    row.className = "opt-image";

    const thumb = document.createElement("div");
    thumb.className = "opt-image-thumb";

    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/webp";
    input.className = "opt-image-input";

    const upload = document.createElement("button");
    upload.type = "button";
    upload.className = "opt-choice opt-image-upload";
    upload.textContent = "Upload PNG…";
    upload.addEventListener("click", () => input.click());

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "opt-choice opt-image-remove";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      working[k] = "";
      if (working.pageBackground === "custom") working.pageBackground = "parchment";
      preview();
    });

    input.addEventListener("change", () => {
      const file = input.files && input.files[0];
      input.value = ""; // allow re-selecting the same file later
      if (!file) return;
      if (file.size > MAX_IMAGE_BYTES) {
        notify("Image is too large (max 2 MB). Pick a smaller PNG.");
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        working[k] = String(reader.result || "");
        working.pageBackground = "custom"; // selecting a PNG switches the page to it
        preview();
      };
      reader.onerror = () => notify("Could not read that image.");
      reader.readAsDataURL(file);
    });

    const buttons = document.createElement("div");
    buttons.className = "opt-choices";
    buttons.appendChild(upload);
    buttons.appendChild(remove);
    row.appendChild(thumb);
    row.appendChild(buttons);
    row.appendChild(input);

    syncFns.push(() => {
      const has = !!working[k];
      thumb.style.backgroundImage = has ? `url("${working[k]}")` : "";
      thumb.classList.toggle("is-empty", !has);
      remove.disabled = !has;
    });
    return wrapControl(opt.label, row);
  }

  function wrapControl(label, control, labelInline) {
    const group = document.createElement("div");
    group.className = "opt-group";
    if (!labelInline) {
      const caption = document.createElement("div");
      caption.className = "opt-caption";
      caption.textContent = label;
      group.appendChild(caption);
    }
    group.appendChild(control);
    return group;
  }

  function buildControl(k, opt) {
    if (opt.type === "toggle") return buildToggle(k, opt);
    if (opt.type === "image") return buildImage(k, opt);
    return buildChoice(k, opt);
  }

  // ---- Modal -------------------------------------------------------------
  let modalEl = null;

  function ensureModal() {
    if (modalEl) return modalEl;

    const backdrop = document.createElement("div");
    backdrop.className = "opt-modal-backdrop print-hide";

    const modal = document.createElement("div");
    modal.className = "opt-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-label", "Options");

    // Header
    const header = document.createElement("div");
    header.className = "opt-modal-header";
    const title = document.createElement("span");
    title.className = "opt-modal-title";
    title.textContent = "Options";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "opt-modal-close";
    close.setAttribute("aria-label", "Close");
    close.textContent = "✕";
    close.addEventListener("click", () => closeModal());
    header.appendChild(title);
    header.appendChild(close);

    // Body: controls grouped by section
    const body = document.createElement("div");
    body.className = "opt-modal-body";
    const sections = {};
    for (const k in SCHEMA) {
      const opt = SCHEMA[k];
      const name = opt.section || "Options";
      if (!sections[name]) {
        const sec = document.createElement("section");
        sec.className = "opt-section";
        const h = document.createElement("h3");
        h.className = "opt-section-title";
        h.textContent = name;
        sec.appendChild(h);
        body.appendChild(sec);
        sections[name] = sec;
      }
      sections[name].appendChild(buildControl(k, opt));
    }

    // Footer
    const footer = document.createElement("div");
    footer.className = "opt-modal-footer";
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "opt-btn opt-btn-secondary";
    reset.textContent = "Back to Defaults";
    reset.addEventListener("click", () => { Object.assign(working, defaults); preview(); });
    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "opt-btn opt-btn-primary";
    saveBtn.textContent = "Save";
    saveBtn.addEventListener("click", () => saveAndClose(saveBtn));
    footer.appendChild(reset);
    footer.appendChild(saveBtn);

    modal.appendChild(header);
    modal.appendChild(body);
    modal.appendChild(footer);
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    // Dismissal: backdrop click (outside the dialog) and Escape both cancel.
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) closeModal(); });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && backdrop.classList.contains("is-open")) closeModal();
    });

    modalEl = backdrop;
    return modalEl;
  }

  function openModal() {
    ensureModal();
    Object.assign(working, committed); // start fresh from the last saved state
    preview();
    modalEl.classList.add("is-open");
    document.body.classList.add("opt-modal-open");
  }

  function closeModal() {
    if (!modalEl) return;
    modalEl.classList.remove("is-open");
    document.body.classList.remove("opt-modal-open");
    apply(committed); // discard the preview; revert to last saved
  }

  async function saveAndClose(btn) {
    committed = { ...working };
    apply(committed);
    document.dispatchEvent(new CustomEvent("rendereroptionchange", { detail: { key: "*" } }));
    const prev = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Saving…";
    const ok = await persist(committed);
    btn.disabled = false;
    btn.textContent = prev;
    if (!ok) notify("Saved locally. Start RendScroll with launcher.py to save to disk.");
    modalEl.classList.remove("is-open");
    document.body.classList.remove("opt-modal-open");
  }

  // ---- Small transient toast (decoupled from the editor's toast) ---------
  let toastEl = null, toastTimer = null;
  function notify(message) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "opt-toast print-hide";
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = message;
    toastEl.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("is-on"), 3200);
  }

  // ---- Launcher button ---------------------------------------------------
  function mount(container) {
    if (!container || container.querySelector(".opt-launcher")) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "opt-launcher renderer-options-toggle print-hide";
    btn.textContent = "Options ▾";
    btn.addEventListener("click", (e) => { e.stopPropagation(); openModal(); });
    const debugToggle = container.querySelector("#rs-debug-toggle");
    if (debugToggle) container.insertBefore(btn, debugToggle);
    else container.appendChild(btn);
  }

  return { SCHEMA, init, get, set, apply, mount };
})();
