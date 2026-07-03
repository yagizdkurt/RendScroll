"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM, VirtualConsole } = require("jsdom");

const ROOT = path.join(__dirname, "..");

const CARD_SCRIPTS = [
  "src/vendor/marked.min.js",
  "src/utils/text.js",
  "src/utils/dom.js",
  "src/utils/markdown.js",
  "src/parser/rendscrollParser.js",
  "src/cards/shared/skillCheckRules.js",
  "src/inlineFormatting.js",
  "src/markdown.js",
  "src/cards/shared/cardImage.js",
  "src/cards/shared/cardDirectives.js",
  "src/cards/shared/StdIcons.js",
  "src/cards/shared/damageModel.js",
  "src/cards/shared/damageRender.js",
  "src/cards/shared/itemTypes.js",
  "src/cards/shared/cardParts.js",
  "src/cards/shared/cardRegistry.js",
  "src/cards/skillChecks/skillChecks.js",
  "src/cards/npc/npc.js",
  "src/cards/item/item.js",
  "src/cards/ability/ability.js",
  "src/cards/obj/obj.js",
  "src/cards/combat/enemyModel.js",
  "src/cards/combat/combat.js",
  "src/cards/unexpected/unexpected.js",
  "src/cards/narrative/narrative.js",
  "src/cards/std/std.js",
  "src/cards/manifest/manifest.js",
  "src/cards/picture/picture.js",
  "src/cards/audio/audio.js",
];

function addScript(win, file) {
  const el = win.document.createElement("script");
  el.textContent = fs.readFileSync(path.join(ROOT, file), "utf8");
  win.document.body.appendChild(el);
}

function makeWindow(pageHtml) {
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (err) => {
    if (!/Could not parse CSS stylesheet/.test(String(err && err.message))) {
      throw err;
    }
  });
  const dom = new JSDOM(
    "<!DOCTYPE html><html><head></head><body>" +
      "<div id=\"topbar-tools\"></div>" +
      "<article id=\"page\" class=\"page\">" +
      pageHtml +
      "</article>" +
      "</body></html>",
    { runScripts: "dangerously", url: "http://localhost/", virtualConsole }
  );
  const win = dom.window;
  win.print = function () {};
  CARD_SCRIPTS.forEach((file) => addScript(win, file));
  addScript(win, "src/printer/printer.js");
  win.document.dispatchEvent(new win.Event("DOMContentLoaded", { bubbles: true }));
  return win;
}

function styleText(win) {
  const el = win.document.getElementById("printer-dynamic-style");
  assert.ok(el, "printer dynamic style should exist");
  return el.textContent;
}

function buttonByText(win, text) {
  const buttons = [...win.document.querySelectorAll("button")];
  const hit = buttons.find((button) => button.textContent === text);
  assert.ok(hit, "expected button: " + text);
  return hit;
}

test("export popover mounts orientation, zoom, and column controls", () => {
  const win = makeWindow("<div class=\"page-header\"><h1>Scene Title</h1></div>");
  const doc = win.document;

  assert.ok(doc.querySelector(".printer-export-toggle"), "export toggle should mount");
  assert.equal(buttonByText(win, "Portrait").classList.contains("on"), true);
  assert.ok(buttonByText(win, "Landscape"));
  assert.equal(buttonByText(win, "2 Columns").classList.contains("on"), true);
  assert.ok(buttonByText(win, "1 Column"));
  assert.equal(doc.querySelector(".printer-zoom-range").value, "50");

  const captions = [...doc.querySelectorAll(".printer-choice-group .opt-caption")]
    .map((el) => el.textContent);
  assert.deepEqual(captions, ["Orientation", "Columns"]);
});

test("dynamic print style includes page margins, running title, and footer", () => {
  const win = makeWindow("<div class=\"page-header\"><h1></h1></div>");
  win.document.querySelector("h1").textContent = "Dragon \"Gate\" Return";
  win.dispatchEvent(new win.Event("beforeprint"));

  const css = styleText(win);
  assert.ok(css.includes("@page{ size:A4 portrait; margin:14mm 10mm 12mm;"));
  assert.ok(css.includes("@top-center{content:\"Dragon \\\"Gate\\\" Return\";"));
  assert.ok(css.includes("@bottom-center{content:\"RendScroll \" counter(pageNumber);"));
});

test("single-column selection emits stacked print layout overrides", () => {
  const win = makeWindow("<div class=\"page-header\"><h1>Scene Title</h1></div>");
  buttonByText(win, "1 Column").click();

  const css = styleText(win);
  assert.ok(css.includes("#page .print-event{display:block;break-inside:auto;page-break-inside:auto;}"));
  assert.ok(css.includes("#page .print-event>.col-divider{display:none!important;}"));
  assert.ok(css.includes("#page .print-event>.col-main,#page .print-event>.col-aside{display:block;min-width:0;}"));
  assert.equal(buttonByText(win, "1 Column").classList.contains("on"), true);
});

test("beforeprint groups events and afterprint restores the layout DOM", () => {
  const win = makeWindow(
    "<div class=\"page-header\"><h1>Scene Title</h1></div>" +
    "<div class=\"page-grid\">" +
    "<div class=\"grid-full\" id=\"event-a\"><h2>Event A</h2></div>" +
    "<div class=\"col-main\" id=\"main-a\"></div>" +
    "<div class=\"col-divider\" id=\"div-a\"></div>" +
    "<div class=\"col-aside\" id=\"aside-a\"></div>" +
    "<div class=\"grid-full\" id=\"event-b\"><h2>Event B</h2></div>" +
    "<div class=\"col-main\" id=\"main-b\"></div>" +
    "<div class=\"col-divider\" id=\"div-b\"></div>" +
    "<div class=\"col-aside\" id=\"aside-b\"></div>" +
    "</div>"
  );
  const grid = win.document.querySelector(".page-grid");

  win.dispatchEvent(new win.Event("beforeprint"));
  assert.equal(grid.dataset.printGrouped, "1");
  assert.equal(grid.querySelectorAll(":scope > .print-event").length, 2);
  assert.equal(grid.children[1].querySelector(":scope > .col-main").id, "main-a");
  assert.equal(grid.children[3].querySelector(":scope > .col-aside").id, "aside-b");

  win.dispatchEvent(new win.Event("afterprint"));
  assert.equal(grid.dataset.printGrouped, undefined);
  assert.equal(grid.querySelectorAll(":scope > .print-event").length, 0);
  assert.equal(grid.children[1].id, "main-a");
  assert.equal(grid.children[3].id, "aside-a");
});

test("dynamic break selector uses registered card classes", () => {
  const win = makeWindow("<div class=\"page-header\"><h1>Scene Title</h1></div>");
  const css = styleText(win);

  [".manifest-card", ".picture-card", ".audio-card", ".narrative-card"].forEach((cls) => {
    assert.ok(css.includes(cls), "expected dynamic selector to include " + cls);
  });
  assert.ok(css.includes("{break-inside:avoid;page-break-inside:avoid;}"));
});
