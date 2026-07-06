"""Renderer options persistence endpoints."""

import os

from src.server.paths import (
    OPTIONS_CURRENT_FILE,
    atomic_write_json,
    read_json_file,
    renderer_options_state_path,
    user_root,
)
from src.server.term import GREEN, paint


def renderer_options(ctx, query, body):
    # Preferred store is content/.sys/renderer-options.json. The legacy
    # content/options.current.json file remains a read fallback for migration.
    target = renderer_options_state_path(ctx.base_dir)
    if os.path.isfile(target):
        return 200, {"ok": True, "options": read_json_file(target), "source": "sys"}

    legacy = os.path.join(user_root(ctx.base_dir), OPTIONS_CURRENT_FILE)
    if os.path.isfile(legacy):
        return 200, {"ok": True, "options": read_json_file(legacy), "source": "legacy"}

    return 200, {"ok": True, "options": {}, "source": "missing"}


def save_options(ctx, query, body):
    # The renderer persists the user's customization choices via
    # POST /__save_options. The target is a fixed file under content/.sys/ —
    # no client-supplied path, so there is no traversal surface.
    if not isinstance(body, dict):
        return 400, {"ok": False, "error": "expected a JSON object"}

    target = renderer_options_state_path(ctx.base_dir)
    try:
        atomic_write_json(target, body)
    except OSError as exc:
        return 500, {"ok": False, "error": str(exc)}

    print(paint("Saved: .sys/renderer-options.json", GREEN), flush=True)
    return 200, {"ok": True}
