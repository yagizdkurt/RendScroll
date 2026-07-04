/* Browser engine detection.
   Browser-global like the rest of the app scripts.

   The ONE owner of "which print engine is this?" — the per-engine print files
   (src/printer/printer.<engine>.css/.js) and printer.js key off it. Values:
     "chromium" (Chrome, Edge, Brave, ...), "firefox" (Gecko),
     "webkit" (Safari), "other" (anything unrecognized, incl. jsdom in tests).

   On load it stamps data-print-engine on <html> (and <body> once it exists)
   so the scoped per-engine print CSS can apply. Node tests require the pure
   detectEngine() via the export guard below. */

const BrowserEnv = (() => {
  function detectEngine(userAgent, hasWindowChrome) {
    const ua = String(userAgent || "");
    if (/\bFirefox\//.test(ua)) return "firefox";
    // Chromium must be tested before WebKit: Chromium UAs also contain
    // "AppleWebKit" and "Safari".
    if (/\b(Chrome|Chromium|Edg|CriOS)\//.test(ua) || hasWindowChrome) return "chromium";
    if (/\bAppleWebKit\//.test(ua)) return "webkit";
    return "other";
  }

  let cached = null;
  function engine() {
    if (cached === null) {
      if (typeof navigator === "undefined") return "other";
      cached = detectEngine(
        navigator.userAgent,
        typeof window !== "undefined" && !!window.chrome
      );
    }
    return cached;
  }

  function stamp() {
    if (typeof document === "undefined") return;
    const value = engine();
    document.documentElement.setAttribute("data-print-engine", value);
    const stampBody = () => {
      if (document.body) document.body.setAttribute("data-print-engine", value);
    };
    if (document.body) stampBody();
    else document.addEventListener("DOMContentLoaded", stampBody);
  }
  stamp();

  return { engine, detectEngine };
})();

if (typeof module !== "undefined" && module.exports) module.exports = BrowserEnv;
