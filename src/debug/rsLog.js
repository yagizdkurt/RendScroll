/* Runtime warning log.

   Small shared sink for recoverable failures that should not change user-facing
   behavior but should be visible in the debug panel. */
const RSLog = (() => {
  const MAX_ENTRIES = 200;
  const entries = [];

  function errorDetail(value) {
    if (value == null) return "";
    if (value && value.stack) return String(value.stack);
    if (value && value.message) return String(value.message);
    return String(value);
  }

  function emit(entry) {
    if (typeof console !== "undefined" && console.warn) {
      if (entry.detail) console.warn("[RendScroll][" + entry.area + "] " + entry.message, entry.detail);
      else console.warn("[RendScroll][" + entry.area + "] " + entry.message);
    }
    if (typeof document !== "undefined" && typeof CustomEvent !== "undefined") {
      document.dispatchEvent(new CustomEvent("rslog:entry", { detail: entry }));
    }
  }

  function warn(area, message, detail) {
    const entry = {
      level: "warn",
      area: String(area || "app"),
      message: String(message || ""),
      detail: errorDetail(detail),
      time: new Date().toISOString(),
    };
    entries.push(entry);
    if (entries.length > MAX_ENTRIES) entries.shift();
    emit(entry);
    return entry;
  }

  function list() {
    return entries.slice();
  }

  function clear() {
    entries.length = 0;
    if (typeof document !== "undefined" && typeof CustomEvent !== "undefined") {
      document.dispatchEvent(new CustomEvent("rslog:clear"));
    }
  }

  return { warn, entries: list, warnings: list, clear };
})();

if (typeof window !== "undefined") window.RSLog = RSLog;
if (typeof module !== "undefined" && module.exports) module.exports = RSLog;
