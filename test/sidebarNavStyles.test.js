"use strict";

/* Guard: the sidebar's nav lists are styled by hand-enumerated ID selector groups
   (#nav, #lore-nav, #library-nav, #enemies-nav). Adding a list to index.html and
   forgetting it in those groups is silent — the buttons simply fall back to the
   browser's default chrome on the dark sidebar, which is exactly how Lore shipped.

   The rule enforced here: every declared sidebar nav is mentioned wherever the
   others are. #nav is exempt as the "selected" side — it has scene-only rules
   (the collapsed-sidebar icon rail) the library lists deliberately do not share. */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const STYLESHEETS = ["src/styles/base.css", "src/styles/responsive.css"];

// The lists the shell declares, minus #nav (see the note above).
const LIBRARY_NAVS = ["#lore-nav", "#library-nav", "#enemies-nav"];

// Selector text of every rule in a stylesheet (comments stripped, blocks dropped).
function selectors(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("}")
    .map((block) => block.split("{")[0])
    .filter((sel) => sel && sel.trim())
    .map((sel) => sel.replace(/\s+/g, " ").trim());
}

test("index.html declares exactly the sidebar navs this guard knows about", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const sidebar = html.slice(html.indexOf("<aside id=\"sidebar\""), html.indexOf("</aside>"));
  const declared = [...sidebar.matchAll(/<nav id="([\w-]+)"/g)].map((m) => "#" + m[1]);
  assert.deepEqual(declared.sort(), ["#nav"].concat(LIBRARY_NAVS).sort(),
    "a sidebar nav was added or removed — extend LIBRARY_NAVS so it is guarded too");
});

STYLESHEETS.forEach((file) => {
  test(file + ": every library nav appears in each nav selector group", () => {
    const css = fs.readFileSync(path.join(ROOT, file), "utf8");
    const missing = [];

    selectors(css).forEach((selector) => {
      const present = LIBRARY_NAVS.filter((nav) => selector.includes(nav));
      if (!present.length) return;
      LIBRARY_NAVS.filter((nav) => !present.includes(nav))
        .forEach((nav) => missing.push(nav + " missing from: " + selector));
    });

    assert.deepEqual(missing, [],
      "sidebar nav lists must be styled alike:\n" + missing.join("\n"));
  });
});

test("the Lore section title is separated like the other library sections", () => {
  const css = fs.readFileSync(path.join(ROOT, "src/styles/base.css"), "utf8");
  const group = selectors(css).find((sel) => sel.includes("#nav-library-title"));
  assert.ok(group, "expected a rule for #nav-library-title");
  assert.ok(group.includes("#nav-lore-title"),
    "#nav-lore-title must share the section separator rule: " + group);
});
