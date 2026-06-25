/* Shared text helpers.
   Browser-global like the rest of the app scripts. */

function rsLower(value) {
  return String(value).replace(/İ/g, "i").replace(/I/g, "ı").toLowerCase();
}
