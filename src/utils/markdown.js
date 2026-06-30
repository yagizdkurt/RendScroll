/* Shared markdown pre-normalization helpers.
   These only isolate directive lines before marked.js parses the text. */

function appendIsolatedDirective(out, line) {
  if (out.length && out[out.length - 1].trim() !== "") out.push("");
  out.push(line);
  out.push("");
}

function normalizeStandaloneDirectives(text, predicate) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    if (predicate(line)) {
      appendIsolatedDirective(out, line);
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}
