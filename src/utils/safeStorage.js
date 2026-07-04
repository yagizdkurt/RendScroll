/* Guarded localStorage access.
   Browser-global like the rest of the app scripts.

   localStorage can throw in private browsing, strict privacy modes, enterprise
   policies, or on quota exhaustion. SafeStorage is the ONE wrapper the app
   uses for plain get/set/remove so those environments degrade to "no
   persistence" instead of breaking startup. Reads return null on failure;
   writes/removes are silent no-ops. */

const SafeStorage = (() => {
  function getItem(key) {
    try {
      return localStorage.getItem(key);
    } catch (_) {
      return null;
    }
  }

  function setItem(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (_) { /* storage unavailable — skip persistence */ }
  }

  function removeItem(key) {
    try {
      localStorage.removeItem(key);
    } catch (_) { /* ignore */ }
  }

  return { getItem, setItem, removeItem };
})();

if (typeof module !== "undefined" && module.exports) module.exports = SafeStorage;
