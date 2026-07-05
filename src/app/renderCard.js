/* Pure card-source -> card-element rendering, extracted from app/app.js so tests
   can exercise the REAL renderCardFromSource (not a re-implementation) without
   booting app.js's init(). app.js keeps the orchestration (renderPage /
   renderCardBlock / campaign+scene state); this file owns only the leaf step that
   turns one card's source into its built DOM element.

   Global (non-module) like the other reader files: loaded via a <script> tag in
   index.html BEFORE app.js. Depends on globals already loaded by then:
   RendScrollParser, RendScrollCards, renderMarkdownEls / cardDirective (cards/shared),
   normalizeClosedMarkdown (cards/shared/cardCollapse.js), and the OPTIONAL ItemData /
   RefLibrary (guarded). The CommonJS export guard at the bottom lets Node tests
   reference the surface; in the browser it is a no-op. */

// Card type -> builder(card, headingEl, bodyEls) -> card element (or null to leave
// the bare heading). Builders self-register into RendScrollCards
// (cards/shared/cardRegistry.js); this looks them up by type so there is no
// hand-synced table to keep in step.
function cardBuilder(type) {
  return (typeof RendScrollCards !== "undefined") ? RendScrollCards.builder(type) : null;
}

const CARD_TEXT_SIZE_DEFAULT_PX = 18.24; // current .page p default: 1.14rem at 16px
const CARD_TEXT_SIZE_RE = /^\s*text\s*size\s*:\s*(\d+(?:\.\d+)?)\s*$/i;

function cardTextSize(card) {
  const d = card.directives.find((x) => x.name === "textsize");
  return d && RendScrollParser.validTextSize(d.value) ? Number(d.value) : null;
}

function stripCardTextSize(src) {
  return String(src || "")
    .split(/\r?\n/)
    .filter((line) => {
      const m = line.match(CARD_TEXT_SIZE_RE);
      return !(m && RendScrollParser.validTextSize(m[1]));
    })
    .join("\n");
}

function applyCardTextSize(cardEl, size) {
  if (!cardEl || !cardEl.classList || size == null) return;
  cardEl.style.setProperty("--rs-card-text-scale", String(size / CARD_TEXT_SIZE_DEFAULT_PX));
}

function itemSourceResolver(name) {
  if (typeof RefLibrary === "undefined") return null;
  const entry = RefLibrary.lookup("item", name);
  return entry ? entry.source : null;
}

function prepareCardSourceForRender(type, src) {
  if (typeof ItemData === "undefined") return src;
  if (type === "item") return ItemData.resolveItemSource(src, itemSourceResolver);
  if (type === "sourceitem") return ItemData.sourceItemRenderSource(src);
  return src;
}

// Carry the per-card "Closed:" collapse directive from the AST onto the card
// element (cardCollapse.js reads dataset.ccDirective). The directive is no longer
// rendered as a body <p>, so the builder no longer drops it — we stamp it here.
function stampClosed(cardEl, card) {
  if (!cardEl || !cardEl.dataset || !card) return;
  const v = cardDirective(card, "closed");
  if (/^(t|true)$/i.test(v)) cardEl.dataset.ccDirective = "closed";
  else if (/^(f|false)$/i.test(v)) cardEl.dataset.ccDirective = "open";
}

// Card source (heading + body) -> its built card element. Shared by scene cards
// and library SourceItem views so item rendering stays on one path. The builder
// reads structured directives/checks/body from the parsed AST node, so only the
// heading goes through marked here (no more re-parsing the whole card just to feed
// the builder DOM it re-sniffed). Parsing the PREPARED source means an Item's
// resolved SourceItem merge is reflected in the node the builder sees.
function renderCardFromSource(type, src) {
  const renderSrc = prepareCardSourceForRender(type, stripCardTextSize(src));
  const builder = cardBuilder(type);
  // No builder (e.g. echo): render the whole block straight through marked.
  if (!builder) return { cardEl: null, els: renderMarkdownEls(normalizeClosedMarkdown(renderSrc)) };
  const card = RendScrollParser.firstCardNode(RendScrollParser.parseRendScroll(renderSrc));
  const head = renderMarkdownEls(renderSrc.split(/\r?\n/)[0] || "")[0] || null;
  const cardEl = builder(card, head, []);
  if (cardEl) stampClosed(cardEl, card);
  return { cardEl, els: head ? [head] : [] };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    cardBuilder,
    cardTextSize,
    stripCardTextSize,
    applyCardTextSize,
    itemSourceResolver,
    prepareCardSourceForRender,
    stampClosed,
    renderCardFromSource,
    CARD_TEXT_SIZE_DEFAULT_PX,
  };
}
