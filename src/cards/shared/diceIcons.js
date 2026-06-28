/* Shared dice-icon helper.
   Wraps the default dice PNGs in src/STDImages/ (d4def.png … d20def.png) so any
   card builder or the editor can drop in a die icon by type without repeating
   path strings. `url()` is pure (node-testable); `icon()` builds an <img> and is
   browser-only.

   Loaded as a browser global (`DiceIcons`) like the rest of the app, and
   `module.exports` for Node tests. */

const DiceIcons = (() => {
  const BASE = "src/STDImages/";

  // Supported die sides → filename in src/STDImages/.
  const FILES = {
    4: "d4def.png",
    6: "d6def.png",
    8: "d8def.png",
    10: "d10def.png",
    12: "d12def.png",
    20: "d20def.png",
  };

  // Sides in canonical ascending order; handy for building a dice picker.
  const TYPES = [4, 6, 8, 10, 12, 20];

  /* Normalize flexible die input to a supported side count. Accepts a number
     (20), a numeric string ("20"), or "dNN" form ("d20", "D20"). Returns the
     integer or null when the die is unknown/unsupported. */
  function sides(die) {
    if (typeof die === "number") return FILES[die] ? die : null;
    const m = /^\s*d?(\d+)\s*$/i.exec(String(die));
    if (!m) return null;
    const n = parseInt(m[1], 10);
    return FILES[n] ? n : null;
  }

  /* Resolve a die to its image path ("src/STDImages/d20def.png"), or null for an
     unsupported die. Pure, no DOM. */
  function url(die) {
    const n = sides(die);
    return n === null ? null : BASE + FILES[n];
  }

  /* Build an <img> icon for a die (browser only). Returns null for an
     unsupported die so callers never get a broken image. opts:
       size      number  → width/height in px
       alt       string  → alt text (default "dNN")
       className string  → class (default "dice-icon")
       title     string  → tooltip */
  function icon(die, opts) {
    const o = opts || {};
    const n = sides(die);
    if (n === null) return null;
    const img = document.createElement("img");
    img.src = BASE + FILES[n];
    img.alt = o.alt != null ? o.alt : "d" + n;
    img.className = o.className != null ? o.className : "dice-icon";
    img.decoding = "async";
    img.loading = "lazy";
    if (o.title != null) img.title = o.title;
    if (o.size != null) {
      img.width = o.size;
      img.height = o.size;
    }
    return img;
  }

  return { TYPES, sides, url, icon };
})();

if (typeof module !== "undefined" && module.exports) module.exports = DiceIcons;
