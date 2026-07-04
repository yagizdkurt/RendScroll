"""Options persistence endpoint."""

import os

from src.server.paths import OPTIONS_CURRENT_FILE, atomic_write_json, user_root
from src.server.term import GREEN, paint


def save_options(ctx, query, body):
    # The renderer persists the user's customization choices via
    # POST /__save_options. The target is a fixed file under content/
    # (options.current.json) — no client-supplied path, so there is no
    # traversal surface. The file is gitignored (the .gitignore `*` rule),
    # so personal preferences never land in commits.
    if not isinstance(body, dict):
        return 400, {"ok": False, "error": "expected a JSON object"}

    target = os.path.join(user_root(ctx.base_dir), OPTIONS_CURRENT_FILE)
    try:
        atomic_write_json(target, body)
    except OSError as exc:
        return 500, {"ok": False, "error": str(exc)}

    print(paint(f"Saved: {OPTIONS_CURRENT_FILE}", GREEN), flush=True)
    return 200, {"ok": True}
