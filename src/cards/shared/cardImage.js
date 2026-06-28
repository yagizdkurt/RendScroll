/* Shared card image helpers.
   Every card builder (NPC, Item, Ability, Obje, Combat, Std, Unexpected) uses
   these so "Image:" and "BG:" resolve identically and portraits all look alike.
   Global (non-module) like the other renderer files; defines no state and never
   fetches files or touches the sidebar. */

/* Resolve a "BG: name" / "Image: name" value into a usable url. A bare name with
   no extension defaults to ".png", and a name without a path is looked up under
   images/. So "kale", "kale.png" and "images/kale.png" all work, and absolute
   urls / rooted paths are left untouched. */
function cardBgUrl(raw) {
  let file = raw.trim();
  if (!/\.[a-z0-9]+$/i.test(file)) file += ".png";
  if (/^[a-z]+:\/\//i.test(file) || file.startsWith("/")) return file;
  return /[\/\\]/.test(file) ? "/" + file.replace(/\\/g, "/").replace(/^\/+/, "") : "/images/" + file;
}

// A whole line that is just "Image: name". The value capture may be empty.
const CARD_IMAGE_LINE = /^image\s*:\s*(.*)$/i;

/* Column placement: a "Side: R" / "Side: L" line. Cards render in the LEFT
   column by default; "Side: R" moves a card to the right column (the layout
   step keys off the .card-right class). Case-insensitive, first letter wins, so
   "R", "Right", "r" all mean right and anything else means left. */
const CARD_SIDE_LINE = /^side\s*:\s*(.+)$/i;
function cardSideIsRight(value) {
  return /^r/i.test(String(value).trim());
}

/* Build the portrait frame for a card. The image is applied via the
   --card-portrait CSS variable so style.css owns the look (cover fit, gradient
   fallback, border). Returns null for an empty value so callers never create an
   empty frame. */
function cardPortrait(raw) {
  if (!raw || !raw.trim()) return null;
  const frame = document.createElement("div");
  frame.className = "card-portrait";
  frame.style.setProperty("--card-portrait", 'url("' + cardBgUrl(raw) + '")');
  return frame;
}

/* Wrap header element(s) + a portrait into a top-of-card flex row: the header
   content sits on the left (.card-figure-main) and the portrait top-right. Only
   call this when a portrait exists — otherwise append the header elements
   directly so no empty portrait space is reserved.
   `mainEls` may be a single node or an array of nodes.

   NOTE: the class is .card-figure, NOT .card-head — .card-head is owned by the
   card-collapse system (it marks the element that stays visible when collapsed).
   cardCollapse.js recognizes .card-figure and uses it as that visible head. */
function cardFigure(mainEls, portrait) {
  const figure = document.createElement("div");
  figure.className = "card-figure";

  const main = document.createElement("div");
  main.className = "card-figure-main";
  (Array.isArray(mainEls) ? mainEls : [mainEls]).forEach((el) => {
    if (el) main.appendChild(el);
  });

  figure.appendChild(main);
  figure.appendChild(portrait);
  return figure;
}
