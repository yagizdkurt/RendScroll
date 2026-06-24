/* Shared markdown pre-normalization helpers.
   These only isolate directive lines before marked.js parses the text. */

function appendIsolatedDirective(out, line) {
  if (out.length && out[out.length - 1].trim() !== "") out.push("");
  out.push(line);
  out.push("");
}

function normalizeSectionDirectives(text, options) {
  const out = [];
  let inSection = false;
  const startsSection = options.startsSection;
  const endsSection = options.endsSection;
  const shouldIsolate = options.shouldIsolate;

  for (const line of text.split(/\r?\n/)) {
    if (startsSection(line)) {
      inSection = true;
      out.push(line);
      continue;
    }
    if (endsSection(line)) {
      inSection = false;
      out.push(line);
      continue;
    }
    if (inSection && shouldIsolate(line)) {
      appendIsolatedDirective(out, line);
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
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
