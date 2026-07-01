/* Shared text helpers.
   Browser-global like the rest of the app scripts.

   This is the ONE owner of the Turkish-aware lowercaser (İ->i, I->ı). The parser
   (rendscrollParser.js `lower`) and ItemData delegate here so the rule lives in a
   single place. Node tests require it via the export guard below. */

function rsLower(value) {
  return String(value).replace(/İ/g, "i").replace(/I/g, "ı").toLowerCase();
}

if (typeof module !== "undefined" && module.exports) module.exports = { rsLower };
