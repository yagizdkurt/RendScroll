/* DnD 5e item-type vocabulary — the ONE place that defines the standard item
   types an Item card can declare (rendered as a category-colored pill, and
   offered as a grouped picker in the editor).

   Each type belongs to a coloring `category` (weapon / armor / gear). `find()`
   matches case-insensitively (Turkish-safe), so a card written "scimitar" still
   resolves to the canonical "Scimitar" + weapon color. An unknown value is left
   as-is (custom items keep working, neutral color).

   Loaded as a browser global (`ItemTypes`) and `module.exports` for Node tests. */

const ItemTypes = (() => {
  const GROUPS = [
    { label: "Armor", category: "armor",
      types: ["Light Armor", "Medium Armor", "Heavy Armor", "Shield"] },
    { label: "Simple Melee Weapons", category: "weapon",
      types: ["Club", "Dagger", "Greatclub", "Handaxe", "Javelin", "Light Hammer",
        "Mace", "Quarterstaff", "Sickle", "Spear"] },
    { label: "Simple Ranged Weapons", category: "weapon",
      types: ["Light Crossbow", "Dart", "Shortbow", "Sling"] },
    { label: "Martial Melee Weapons", category: "weapon",
      types: ["Battleaxe", "Flail", "Glaive", "Greataxe", "Greatsword", "Halberd",
        "Lance", "Longsword", "Maul", "Morningstar", "Pike", "Rapier", "Scimitar",
        "Shortsword", "Trident", "War Pick", "Warhammer", "Whip"] },
    { label: "Martial Ranged Weapons", category: "weapon",
      types: ["Blowgun", "Hand Crossbow", "Heavy Crossbow", "Longbow", "Net"] },
    { label: "Gear & Magic", category: "gear",
      types: ["Potion", "Scroll", "Wand", "Rod", "Staff", "Ring", "Wondrous Item",
        "Ammunition", "Adventuring Gear", "Tool"] },
  ];

  // Keyword-style folding: both İ and I -> plain "i" (these are English D&D type
  // names, so we want "SLING"/"RİNG" to fold to "sling"/"ring", not the dotless ı).
  function lower(value) {
    return String(value == null ? "" : value).replace(/[İI]/g, "i").toLowerCase();
  }

  const byKey = new Map();
  GROUPS.forEach((g) => g.types.forEach((t) => byKey.set(lower(t), { label: t, category: g.category })));

  // Canonical { label, category } for a value, or null when not a standard type.
  function find(value) {
    return byKey.get(lower(String(value || "").trim())) || null;
  }
  // Coloring category ("weapon"/"armor"/"gear") or "" for an unknown/custom type.
  function category(value) {
    const e = find(value);
    return e ? e.category : "";
  }
  // Canonical display label, or the trimmed input for a custom type.
  function label(value) {
    const e = find(value);
    return e ? e.label : String(value || "").trim();
  }
  // Grouped options for a picker: [{ label, options: [type, …] }, …].
  function options() {
    return GROUPS.map((g) => ({ label: g.label, options: g.types.slice() }));
  }
  // Flat list of every canonical type (display order).
  function types() {
    const all = [];
    GROUPS.forEach((g) => g.types.forEach((t) => all.push(t)));
    return all;
  }

  return { GROUPS, find, category, label, options, types };
})();

if (typeof window !== "undefined") window.ItemTypes = ItemTypes;
if (typeof module !== "undefined" && module.exports) module.exports = ItemTypes;
