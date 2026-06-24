/* Printer module — PDF export trigger.

   Responsibility: export the PDF of the already-rendered document, nothing more.
   It injects one "Export PDF" button and calls window.print(); the browser's
   native engine produces a vector (selectable-text) PDF via "Save as PDF".

   Design notes:
   - Read-only: it never mutates #page, source files, or saved content. All the
     visual transformation lives declaratively in printer.css (@media print),
     so there is no DOM state to change and restore.
   - Renderer-independent: it knows nothing about NPC/item/skill-check cards. It
     prints whatever currently lives in #page, so it survives renderer rewrites.
   - Make-and-forget: ~1 button + window.print(). No upkeep as the app grows. */

(function () {
  "use strict";

  // --- Print-time pagination regroup -------------------------------------
  // layout.js renders ONE .page-grid with one implicit row per H2 event, which
  // Chromium slices straight through when printing. Around printing we wrap each
  // event's col-main/col-divider/col-aside triple into its own .print-event grid
  // (see printer.css) so breaks fall between events and short events stay whole.
  // This reads only the generic layout DOM, so it stays renderer-agnostic, and
  // it fully reverts on afterprint — the live DOM is unchanged the rest of time.

  function groupEvents() {
    const grid = document.querySelector("#page .page-grid");
    if (!grid || grid.dataset.printGrouped) return;

    const kids = [...grid.children];
    for (let n = 0; n < kids.length; ) {
      const node = kids[n];
      if (node.classList && node.classList.contains("col-main")) {
        const group = [node];
        let m = n + 1;
        while (
          m < kids.length &&
          kids[m].classList &&
          (kids[m].classList.contains("col-divider") ||
            kids[m].classList.contains("col-aside"))
        ) {
          group.push(kids[m]);
          m++;
        }
        const wrap = document.createElement("div");
        wrap.className = "print-event";
        grid.insertBefore(wrap, node); // keep position; order preserved
        group.forEach((g) => wrap.appendChild(g));
        n = m;
      } else {
        n++; // .grid-full (headings / separators) stay as direct children
      }
    }
    grid.dataset.printGrouped = "1";
  }

  function ungroupEvents() {
    const grid = document.querySelector("#page .page-grid");
    if (!grid || !grid.dataset.printGrouped) return;

    grid.querySelectorAll(":scope > .print-event").forEach((wrap) => {
      while (wrap.firstChild) grid.insertBefore(wrap.firstChild, wrap);
      wrap.remove();
    });
    delete grid.dataset.printGrouped;
  }

  window.addEventListener("beforeprint", groupEvents);
  window.addEventListener("afterprint", ungroupEvents);

  // --- Print settings (orientation + zoom) -------------------------------
  // Chromium's print dialog hides the orientation control when @page pins an
  // orientation, and ignores zoom entirely. So we own both here: the sidebar
  // subsection writes the current choices into a dynamic <style> element that
  // overrides printer.css. It lives in @media print, so the screen is untouched.
  const settings = { orientation: "portrait", zoom: 50 };

  function ensureDynamicStyle() {
    let el = document.getElementById("printer-dynamic-style");
    if (!el) {
      el = document.createElement("style");
      el.id = "printer-dynamic-style";
      document.head.appendChild(el); // appended last → wins over printer.css
    }
    return el;
  }

  function applySettings() {
    ensureDynamicStyle().textContent =
      "@media print{" +
      "@page{ size:A4 " +
      settings.orientation +
      "; margin:6mm; }" +
      "#page{ zoom:" +
      settings.zoom / 100 +
      "; }" +
      "}";
  }

  function mountButton() {
    // Sit alongside the other sidebar options, matching the editor's pattern.
    const host =
      document.getElementById("options") || document.getElementById("sidebar");
    if (!host || host.querySelector(".printer-export-group")) return;

    // Subsection wrapper — reuses the sidebar's .opt-* option styling.
    const group = document.createElement("div");
    group.className = "opt-group printer-export-group print-hide";

    const caption = document.createElement("span");
    caption.className = "opt-caption";
    caption.textContent = "Export";
    group.appendChild(caption);

    // --- Orientation: Portrait / Landscape ---
    const choices = document.createElement("div");
    choices.className = "opt-choices";
    [
      ["portrait", "Portrait"],
      ["landscape", "Landscape"],
    ].forEach(function (pair) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "opt-choice" + (settings.orientation === pair[0] ? " on" : "");
      b.textContent = pair[1];
      b.addEventListener("click", function () {
        settings.orientation = pair[0];
        choices
          .querySelectorAll(".opt-choice")
          .forEach((c) => c.classList.remove("on"));
        b.classList.add("on");
        applySettings();
      });
      choices.appendChild(b);
    });
    group.appendChild(choices);

    // --- Zoom % ---
    const zoomRow = document.createElement("label");
    zoomRow.className = "printer-zoom-row";

    const zoomLabel = document.createElement("span");
    zoomLabel.className = "printer-zoom-label";
    const setZoomLabel = () => (zoomLabel.textContent = "Zoom " + settings.zoom + "%");
    setZoomLabel();

    const zoom = document.createElement("input");
    zoom.type = "range";
    zoom.className = "printer-zoom-range";
    zoom.min = "25";
    zoom.max = "100";
    zoom.step = "5";
    zoom.value = String(settings.zoom);
    zoom.addEventListener("input", function () {
      settings.zoom = Number(zoom.value);
      setZoomLabel();
      applySettings();
    });
    zoomRow.appendChild(zoomLabel);
    zoomRow.appendChild(zoom);
    group.appendChild(zoomRow);

    // --- Export PDF button ---
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "printer-export-btn";
    btn.textContent = "⎙ Export PDF";
    // The launcher pre-seeds Chrome with clean PDF defaults; this fallback title
    // helps when the page is opened in a normal browser profile.
    btn.title = "Print to PDF - disable 'Headers and footers' for a clean export";
    btn.addEventListener("click", function () {
      console.info(
        "[printer] Opening print dialog. For a clean PDF, choose 'Save as PDF', " +
          "disable 'Headers and footers', and enable 'Background graphics'."
      );
      window.print();
    });
    group.appendChild(btn);

    host.appendChild(group);
    applySettings(); // seed the dynamic style with defaults
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountButton);
  } else {
    mountButton();
  }
})();
