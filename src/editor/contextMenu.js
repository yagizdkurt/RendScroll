/* Right-click context menu for editor mode. Two flavours:
     - insert menu (empty space / insert zone): pick a card type to create
     - card menu (on a card): Edit / Move up / Move down / Delete
   A single floating menu element; closes on outside click, Escape, or scroll. */

const EditorContextMenu = (() => {
  let menu = null;

  function close() {
    if (menu) {
      menu.remove();
      menu = null;
      document.removeEventListener("mousedown", onDocDown, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", close, true);
    }
  }

  function onDocDown(e) {
    if (menu && !menu.contains(e.target)) close();
  }
  function onKey(e) {
    if (e.key === "Escape") close();
  }

  function item(label, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "editor-menu-item";
    b.textContent = label;
    b.addEventListener("click", () => {
      close();
      onClick();
    });
    return b;
  }

  function sep() {
    const d = document.createElement("div");
    d.className = "editor-menu-sep";
    return d;
  }
  function group(text) {
    const d = document.createElement("div");
    d.className = "editor-menu-label";
    d.textContent = text;
    return d;
  }

  function show(x, y, nodes) {
    close();
    menu = document.createElement("div");
    menu.className = "editor-menu";
    nodes.forEach((n) => menu.appendChild(n));
    document.body.appendChild(menu);

    // keep on-screen
    const r = menu.getBoundingClientRect();
    const px = Math.min(x, window.innerWidth - r.width - 8);
    const py = Math.min(y, window.innerHeight - r.height - 8);
    menu.style.left = Math.max(4, px) + "px";
    menu.style.top = Math.max(4, py) + "px";

    document.addEventListener("mousedown", onDocDown, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", close, true);
  }

  return {
    openInsert(target, x, y, handlers) {
      const nodes = [group("Insert")];
      if (handlers.pickNarrative) {
        nodes.push(item("Narrative", () => handlers.pickNarrative(target)));
        nodes.push(sep());
      }
      EditorSchemas.list().forEach((schema) => {
        nodes.push(item(schema.label, () => handlers.pickInsert(schema.type, target)));
      });
      show(x, y, nodes);
    },

    openCard(id, x, y, handlers) {
      show(x, y, [
        item("Edit…", () => handlers.editCard(id)),
        item("Insert after…", () =>
          handlers.insertMenu({ afterCardId: id }, x, y)
        ),
        sep(),
        item("Move up", () => handlers.moveCard(id, -1)),
        item("Move down", () => handlers.moveCard(id, 1)),
        sep(),
        item("Delete", () => handlers.deleteCard(id)),
      ]);
    },
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = EditorContextMenu;
