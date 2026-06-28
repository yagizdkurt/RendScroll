/* Shared standard-icon helper.
   Wraps the default icon PNGs in src/STDImages/ so any card builder or the
   editor can drop in an icon by kind + value without repeating path strings.
   `url()` is pure (node-testable); `icon()` builds an <img> and is browser-only.

   Icons are grouped into "kinds" (dice, damage, …); add a new category by
   adding an entry to KINDS. Each kind maps a flexible input value to a
   canonical key, then to a filename in src/STDImages/.

   Loaded as a browser global (`StdIcons`) like the rest of the app, and
   `module.exports` for Node tests. */

const StdIcons = (() => {
  const BASE = "src/STDImages/";

  // Registry of icon kinds. Each kind has:
  //   keys      canonical keys, in display order (handy for pickers)
  //   file(k)   filename in src/STDImages/ for a canonical key
  //   alt(k)    default alt text for a canonical key
  //   normalize(v) flexible input -> canonical key, or null when unsupported
  const KINDS = {
    // Polyhedral dice -> src/STDImages/dNNdef.png
    dice: {
      keys: [4, 6, 8, 10, 12, 20],
      file: (k) => "d" + k + "def.png",
      alt: (k) => "d" + k,
      normalize(v) {
        if (typeof v === "number") return this.keys.includes(v) ? v : null;
        const m = /^\s*d?(\d+)\s*$/i.exec(String(v));
        if (!m) return null;
        const n = parseInt(m[1], 10);
        return this.keys.includes(n) ? n : null;
      },
    },
    // D&D damage types -> src/STDImages/<type>def.png
    damage: {
      keys: [
        "acid", "bludgeoning", "cold", "fire", "force", "lightning",
        "necrotic", "piercing", "poison", "psychic", "radiant",
        "slashing", "thunder",
      ],
      file: (k) => k + "def.png",
      alt: (k) => k,
      normalize(v) {
        const k = String(v == null ? "" : v).trim().toLowerCase();
        return this.keys.includes(k) ? k : null;
      },
    },
  };

  function kind(name) {
    return Object.prototype.hasOwnProperty.call(KINDS, name) ? KINDS[name] : null;
  }

  /* Canonical keys for a kind, in display order, or [] for an unknown kind. */
  function types(name) {
    const k = kind(name);
    return k ? k.keys.slice() : [];
  }

  /* Canonical key for a value within a kind, or null when unknown/unsupported.
     Pure, no DOM. */
  function key(name, value) {
    const k = kind(name);
    return k ? k.normalize(value) : null;
  }

  /* Resolve a kind + value to its image path ("src/STDImages/d20def.png"), or
     null for an unsupported value/kind. Pure, no DOM. */
  function url(name, value) {
    const k = kind(name);
    if (!k) return null;
    const ck = k.normalize(value);
    return ck === null ? null : BASE + k.file(ck);
  }

  /* Build an <img> icon for a kind + value (browser only). Returns null for an
     unsupported value/kind so callers never get a broken image. opts:
       size      number  → width/height in px
       alt       string  → alt text (default per kind)
       className string  → class (default "std-icon")
       title     string  → tooltip */
  function icon(name, value, opts) {
    const o = opts || {};
    const k = kind(name);
    if (!k) return null;
    const ck = k.normalize(value);
    if (ck === null) return null;
    const img = document.createElement("img");
    img.src = BASE + k.file(ck);
    img.alt = o.alt != null ? o.alt : k.alt(ck);
    img.className = o.className != null ? o.className : "std-icon";
    img.decoding = "async";
    img.loading = "lazy";
    if (o.title != null) img.title = o.title;
    if (o.size != null) {
      img.width = o.size;
      img.height = o.size;
    }
    return img;
  }

  return { KINDS, types, key, url, icon };
})();

if (typeof module !== "undefined" && module.exports) module.exports = StdIcons;
