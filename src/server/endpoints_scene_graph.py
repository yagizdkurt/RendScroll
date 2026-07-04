"""Scene-progression graph endpoints (campaigns/<name>/graph.json)."""

import json
import os

from src.server import discovery
from src.server.paths import atomic_write_json, campaign_dir_path
from src.server.term import GREEN, paint


def get_scene_graph(ctx, query, body):
    # GET /__scene_graph — the campaign's progression graph. Like
    # /__save_options, the target is a fixed file (campaigns/<name>/
    # graph.json): no client-supplied path, no traversal surface. A missing
    # file is the normal "no map yet" case; an unreadable one degrades to
    # the empty default with a warning (the client surfaces it and only
    # overwrites after the user's next deliberate edit).
    if not ctx.campaign:
        return 400, {"ok": False, "error": "no active campaign"}

    empty = {"version": 1, "nodes": [], "edges": []}
    target = discovery.scene_graph_path(ctx.base_dir, ctx.campaign)
    if not os.path.isfile(target):
        return 200, {"ok": True, "graph": empty}
    try:
        with open(target, "r", encoding="utf-8") as fh:
            graph = json.load(fh)
    except (OSError, ValueError):
        return 200, {"ok": True, "graph": empty, "warning": "graph.json was unreadable"}
    return 200, {"ok": True, "graph": graph}


def save_scene_graph(ctx, query, body):
    # POST /__save_scene_graph — body is the whole graph object. Writes are
    # confined to the campaign's fixed graph.json (the .md-only
    # resolve_writable guard is deliberately not involved).
    if not ctx.campaign:
        return 400, {"ok": False, "error": "no active campaign"}

    error = discovery.validate_scene_graph(body)
    if error:
        return 400, {"ok": False, "error": error}

    if not os.path.isdir(campaign_dir_path(ctx.base_dir, ctx.campaign)):
        return 404, {"ok": False, "error": "campaign folder not found"}

    target = discovery.scene_graph_path(ctx.base_dir, ctx.campaign)
    try:
        atomic_write_json(target, body)
    except OSError as exc:
        return 500, {"ok": False, "error": str(exc)}

    print(paint(f"Saved: campaigns/{ctx.campaign}/graph.json", GREEN), flush=True)
    return 200, {"ok": True}
