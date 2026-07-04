/* Firefox (Gecko) print overrides — minimal support, not parity.

   printer.js builds its dynamic print CSS for the Chromium engine (the
   default, fully supported printer) and, when BrowserEnv reports another
   engine, passes it through PrinterEngineOverrides[engine] registered here.
   The Chromium path itself is never touched by this file. */

(function () {
  "use strict";

  const registry = (window.PrinterEngineOverrides = window.PrinterEngineOverrides || {});

  registry.firefox = function (chromiumCss) {
    // Gecko does not support @page margin boxes (@top-center/@bottom-center)
    // and an unknown at-rule inside @page can invalidate the whole @page rule,
    // losing size/margins with it — strip the margin boxes, keep the rest.
    // The `zoom` rule is left in: Firefox >= 126 honors it, older versions
    // ignore the single property harmlessly.
    return chromiumCss
      .replace(/@top-center\{[^{}]*\}/g, "")
      .replace(/@bottom-center\{[^{}]*\}/g, "");
  };
})();
