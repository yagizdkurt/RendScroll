/* Shared DOM helpers for renderer-owned card elements. */

const RENDERED_CARD_CLASSES = [
  "sc-card",
  "npc-card",
  "obj-card",
  "item-card",
  "ability-card",
  "combat-card",
  "unexpected-card",
  "std-card",
];

const RENDERED_CARD_SELECTOR = RENDERED_CARD_CLASSES.map((name) => "." + name).join(",");

function isRenderedCard(node) {
  return !!(
    node &&
    node.classList &&
    RENDERED_CARD_CLASSES.some((name) => node.classList.contains(name))
  );
}
