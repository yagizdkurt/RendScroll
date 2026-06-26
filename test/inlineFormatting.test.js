"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

global.marked = require("../src/vendor/marked.min.js").marked;
global.RendScrollInlineFormatting = require("../src/inlineFormatting.js");
const { renderMarkdown } = require("../src/markdown.js");

test("inline size tag renders a sanitized span", () => {
  const html = renderMarkdown("[size=10]small[/size]");
  assert.match(html, /<span class="rs-inline-size" style="font-size:10px">small<\/span>/);
});

test("inline size tag preserves Markdown inside", () => {
  const html = renderMarkdown("[size=10]**small**[/size]");
  assert.match(html, /<span class="rs-inline-size" style="font-size:10px"><strong>small<\/strong><\/span>/);
});

test("unknown, invalid, and unclosed tags stay literal", () => {
  assert.match(renderMarkdown("[color=#8b0000]red[/color]"), /\[color=#8b0000\]red\[\/color\]/);
  assert.match(renderMarkdown("[size=99]huge[/size]"), /\[size=99\]huge\[\/size\]/);
  assert.match(renderMarkdown("[size=10]open"), /\[size=10\]open/);
});

test("nested size tags render as nested spans", () => {
  const html = renderMarkdown("[size=18]big [size=10]small[/size][/size]");
  assert.match(html, /font-size:18px">big <span class="rs-inline-size" style="font-size:10px">small<\/span><\/span>/);
});

test("code spans and code blocks do not parse inline tags", () => {
  const code = "`[size=10]code[/size]`";
  const block = "```\n[size=10]code[/size]\n```";
  assert.match(renderMarkdown(code), /<code>\[size=10\]code\[\/size\]<\/code>/);
  assert.doesNotMatch(renderMarkdown(code), /rs-inline-size/);
  assert.match(renderMarkdown(block), /<pre><code>\[size=10\]code\[\/size\]\n<\/code><\/pre>/);
  assert.doesNotMatch(renderMarkdown(block), /rs-inline-size/);
});

test("asterisk task-list markers render as disabled checkboxes", () => {
  const html = renderMarkdown("* [ ] one\n* [x] two");

  assert.match(html, /<input disabled="" type="checkbox"> one/);
  assert.match(html, /<input checked="" disabled="" type="checkbox"> two/);
});
