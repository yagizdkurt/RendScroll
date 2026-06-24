/* Renderer options: persisted design knobs, all in one place.

   Two kinds of options:
     - type "toggle": boolean -> a class on <body>            (present when true)
     - type "choice": one value -> data-opt-<attr> on <body>  (CSS keys off it)

   Flipping an option re-styles the page instantly (no re-render) and the
   choice is remembered in localStorage. Sidebar controls are generated from
   SCHEMA automatically.

   To add a new design knob later: add one SCHEMA entry + the matching CSS
   (a `body.<bodyClass>` rule for a toggle, or `body[data-opt-<attr>="..."]`
   rules for a choice). Nothing else to wire up. */
const RendererOptions = (() => {
  const STORAGE_KEY = "rendererOptions";

  const SCHEMA = {
    textSize: {
      type: "choice", attr: "textsize", default: "md", label: "Text Size",
      choices: [
        { value: "sm", label: "Small" },
        { value: "md", label: "Normal" },
        { value: "lg", label: "Large" },
      ],
    },
    pageWidth: {
      type: "choice", attr: "pagewidth", default: "md", label: "Page Width",
      choices: [
        { value: "narrow", label: "Narrow" },
        { value: "md", label: "Normal" },
        { value: "wide", label: "Wide" },
      ],
    },
    italicReadAloud: {
      type: "toggle", bodyClass: "opt-italic-readaloud", default: true,
      label: "Italic Narration",
    },
    boldReadAloud: {
      type: "toggle", bodyClass: "opt-bold-readaloud", default: true,
      label: "Bold Narration",
    },
    readAloudAccent: {
      type: "toggle", bodyClass: "opt-readaloud-accent", default: true,
      label: "Narration Border Accent",
    },
    startClosed: {
      type: "toggle", bodyClass: "opt-start-closed", default: false,
      label: "Start Closed",
    },
  };

  const state = load();

  function load() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch { saved = {}; }
    const s = {};
    for (const k in SCHEMA) {
      const opt = SCHEMA[k];
      if (opt.type === "toggle") {
        s[k] = (k in saved) ? !!saved[k] : opt.default;
      } else {
        const allowed = opt.choices.map((c) => c.value);
        s[k] = (k in saved && allowed.includes(saved[k])) ? saved[k] : opt.default;
      }
    }
    return s;
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  // Reflect every option onto <body> (class for toggles, attribute for choices).
  function apply() {
    for (const k in SCHEMA) {
      const opt = SCHEMA[k];
      if (opt.type === "toggle") {
        document.body.classList.toggle(opt.bodyClass, state[k]);
      } else {
        document.body.setAttribute("data-opt-" + opt.attr, state[k]);
      }
    }
  }

  function get(k) { return state[k]; }

  function set(k, value) {
    const opt = SCHEMA[k];
    if (!opt) return;
    if (opt.type === "toggle") {
      state[k] = !!value;
    } else if (opt.choices.some((c) => c.value === value)) {
      state[k] = value;
    } else {
      return;
    }
    save();
    apply();
    // Let feature renderers react to live changes (e.g. card collapse defaults).
    document.dispatchEvent(new CustomEvent("rendereroptionchange", { detail: { key: k } }));
  }

  function toggle(k) {
    if (SCHEMA[k] && SCHEMA[k].type === "toggle") set(k, !state[k]);
    return state[k];
  }

  // ---- Sidebar controls (generated from SCHEMA) ----
  function buildToggle(k, opt) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "opt-toggle";
    const render = () => {
      btn.classList.toggle("on", state[k]);
      btn.setAttribute("aria-pressed", String(state[k]));
      btn.textContent = (state[k] ? "☑ " : "☐ ") + opt.label;
    };
    btn.addEventListener("click", () => { toggle(k); render(); });
    render();
    return btn;
  }

  function buildChoice(k, opt) {
    const group = document.createElement("div");
    group.className = "opt-group";

    const caption = document.createElement("div");
    caption.className = "opt-caption";
    caption.textContent = opt.label;
    group.appendChild(caption);

    const row = document.createElement("div");
    row.className = "opt-choices";
    const btns = opt.choices.map((c) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "opt-choice";
      b.textContent = c.label;
      b.dataset.value = c.value;
      b.addEventListener("click", () => { set(k, c.value); sync(); });
      row.appendChild(b);
      return b;
    });
    const sync = () => btns.forEach((b) => b.classList.toggle("on", b.dataset.value === state[k]));
    sync();

    group.appendChild(row);
    return group;
  }

  function mount(container) {
    for (const k in SCHEMA) {
      const opt = SCHEMA[k];
      container.appendChild(opt.type === "toggle" ? buildToggle(k, opt) : buildChoice(k, opt));
    }
  }

  return { SCHEMA, get, set, toggle, apply, mount };
})();
