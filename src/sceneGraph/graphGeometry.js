/* Scene Progression Map — pure geometry and label math.

   Split out of sceneGraph.js (the view/controller), which is a single closure
   over ~25 mutable variables. These functions were the part that never touched
   any of it: given a node rectangle, a box, or a string, they return a number,
   a point, or a path. Isolating them makes the math unit-testable — it had no
   coverage at all inside the panel — and keeps the panel file to the stateful
   work.

   All transform math is plain arithmetic (no SVG matrix APIs) so it runs under
   jsdom, same as the panel's render path.

   A "node" here is the graph model's { scene, x, y }; only x/y are read. */

const SceneGraphGeometry = (() => {
  const NODE_W = 160;
  const NODE_H = 56;
  const CLICK_DRAG_THRESHOLD = 4; // px of pointer travel that turns a click into a drag
  const ZOOM_MIN = 0.3;
  const ZOOM_MAX = 2.5;
  const EDGE_LABEL_GLYPH_W = 6.4;
  const EDGE_LABEL_BG_H = 20;
  const NODE_TITLE_LINE_H = 17;    // px between the two title tspans
  const NODE_TITLE_MAX_CHARS = 16; // fits NODE_W minus badge at the 14px title size
  const REVERSE_EDGE_OFFSET = 24;  // px a two-way pair is bowed apart by

  // Where a line aimed at (tx, ty) leaves the node's rectangle.
  function rectExitPoint(node, tx, ty) {
    const cx = node.x + NODE_W / 2;
    const cy = node.y + NODE_H / 2;
    const dx = tx - cx;
    const dy = ty - cy;
    if (!dx && !dy) return { x: cx, y: cy };
    const sx = dx !== 0 ? (NODE_W / 2) / Math.abs(dx) : Infinity;
    const sy = dy !== 0 ? (NODE_H / 2) / Math.abs(dy) : Infinity;
    const s = Math.min(sx, sy);
    return { x: cx + dx * s, y: cy + dy * s };
  }

  /* The quadratic curve from node `a` to node `b`, plus the point its label sits
     at. Returns null when either endpoint is missing (an edge pointing at a scene
     that is not on the map).

     `hasReverse` — is the b->a edge also displayed? The caller knows; it lives in
     panel state. When true the curve is bowed sideways so A->B and B->A do not
     collapse into one double-headed line. */
  function edgePath(a, b, hasReverse) {
    if (!a || !b) return null;
    const acx = a.x + NODE_W / 2, acy = a.y + NODE_H / 2;
    const bcx = b.x + NODE_W / 2, bcy = b.y + NODE_H / 2;
    const p1 = rectExitPoint(a, bcx, bcy);
    const p2 = rectExitPoint(b, acx, acy);
    let mx = (p1.x + p2.x) / 2;
    let my = (p1.y + p2.y) / 2;
    if (hasReverse) {
      const dx = p2.x - p1.x, dy = p2.y - p1.y;
      const len = Math.hypot(dx, dy) || 1;
      mx += (-dy / len) * REVERSE_EDGE_OFFSET;
      my += (dx / len) * REVERSE_EDGE_OFFSET;
    }
    return {
      d: "M " + p1.x + " " + p1.y + " Q " + mx + " " + my + " " + p2.x + " " + p2.y,
      labelX: (p1.x + 2 * mx + p2.x) / 4, // quadratic midpoint
      labelY: (p1.y + 2 * my + p2.y) / 4,
    };
  }

  // Marquee hit test: does the node's rectangle overlap the selection box?
  function nodeIntersectsBox(node, box) {
    return node.x <= box.maxX &&
      node.x + NODE_W >= box.minX &&
      node.y <= box.maxY &&
      node.y + NODE_H >= box.minY;
  }

  // Point hit test in world coordinates.
  function nodeContainsPoint(node, point) {
    return point.x >= node.x && point.x <= node.x + NODE_W &&
      point.y >= node.y && point.y <= node.y + NODE_H;
  }

  function clampZoom(k) {
    return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, k));
  }

  function truncateTitle(text, max) {
    return text.length > max ? text.slice(0, max - 1) + "…" : text;
  }

  /* Word-wrap a node title onto at most two lines of ~maxChars each, ellipsizing
     what doesn't fit. Character counts, not text metrics — jsdom has no layout
     and the rebuild loop shouldn't measure anyway. */
  function wrapTitle(text, maxChars) {
    const words = String(text).trim().split(/\s+/).filter(Boolean);
    const lines = [];
    let current = "";
    let overflow = false;
    for (const word of words) {
      const joined = current ? current + " " + word : word;
      if (joined.length <= maxChars || !current) {
        current = joined;
      } else if (lines.length < 1) {
        lines.push(current);
        current = word;
      } else {
        overflow = true;
        break;
      }
    }
    if (current) lines.push(current);
    if (!lines.length) lines.push("");
    if (overflow) lines[lines.length - 1] += "…";
    return lines.map((line) => truncateTitle(line, maxChars));
  }

  // An edge's from->to identity. NOT unique on its own: a manual and a derived
  // (Transition-card) edge can share it, so callers that need to tell those apart
  // compare `locked` too.
  function edgeIdentity(edge) {
    return edge.from + "|" + edge.to;
  }

  return {
    NODE_W, NODE_H,
    CLICK_DRAG_THRESHOLD, ZOOM_MIN, ZOOM_MAX,
    EDGE_LABEL_GLYPH_W, EDGE_LABEL_BG_H,
    NODE_TITLE_LINE_H, NODE_TITLE_MAX_CHARS,
    REVERSE_EDGE_OFFSET,
    rectExitPoint, edgePath,
    nodeIntersectsBox, nodeContainsPoint, clampZoom,
    truncateTitle, wrapTitle, edgeIdentity,
  };
})();

if (typeof window !== "undefined") window.SceneGraphGeometry = SceneGraphGeometry;
if (typeof module !== "undefined" && module.exports) module.exports = SceneGraphGeometry;
