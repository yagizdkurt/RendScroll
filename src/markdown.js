/* Markdown loading and rendering only. Knows nothing about Skill Checks, the sidebar, or any renderer. */

// Fetch a markdown file's raw text. `cache: "no-store"` bypasses the browser
// HTTP cache entirely, so edits to the .md always show up on reload.
async function fetchMarkdown(path) {
  const res = await fetch(path, { cache: "no-store" });
  return res.text();
}

// Raw markdown -> HTML string, via marked.js.
function renderMarkdown(text) {
  return marked.parse(text);
}
