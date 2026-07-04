/* WebKit / other-engine print overrides — minimal support, not parity.

   Same contract as printer.firefox.js: printer.js hands the Chromium dynamic
   print CSS to PrinterEngineOverrides[engine]; the returned string replaces
   it. Covers Safari ("webkit") and unrecognized engines ("other"). */

(function () {
  "use strict";

  const registry = (window.PrinterEngineOverrides = window.PrinterEngineOverrides || {});

  function stripPageMarginBoxes(chromiumCss) {
    // WebKit does not support @page margin boxes; strip them so the @page
    // size/margin declarations survive parsing.
    return chromiumCss
      .replace(/@top-center\{[^{}]*\}/g, "")
      .replace(/@bottom-center\{[^{}]*\}/g, "");
  }

  registry.webkit = stripPageMarginBoxes;
  registry.other = stripPageMarginBoxes;
})();
