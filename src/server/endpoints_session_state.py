"""Per-campaign live session state endpoints (campaigns/<name>/.sys/session.json)."""

import json
import os

from src.server import discovery
from src.server.paths import atomic_write_json, campaign_dir_path
from src.server.term import GREEN, paint


def empty_session_state():
    return {"version": 1, "scenes": {}}


def get_session_state(ctx, query, body):
    # GET /__session_state — fixed target under the active campaign. Missing file
    # is normal; invalid/future files are returned as read-only so the client can
    # avoid overwriting data it does not understand.
    if not ctx.campaign:
        return 400, {"ok": False, "error": "no active campaign"}

    target = discovery.session_state_path(ctx.base_dir, ctx.campaign)
    if not os.path.isfile(target):
        return 200, {"ok": True, "state": empty_session_state(), "readOnly": False}
    try:
        with open(target, "r", encoding="utf-8") as fh:
            state = json.load(fh)
    except (OSError, ValueError):
        return 200, {
            "ok": True,
            "state": empty_session_state(),
            "readOnly": True,
            "warning": "session.json was unreadable",
        }

    error = discovery.validate_session_state(state)
    if error:
        return 200, {
            "ok": True,
            "state": empty_session_state(),
            "readOnly": True,
            "warning": "session.json is not a supported v1 session file: " + error,
        }
    return 200, {"ok": True, "state": state, "readOnly": False}


def save_session_state(ctx, query, body):
    # POST /__save_session_state — body is the whole session state. Writes are
    # confined to campaigns/<name>/.sys/session.json; no client-supplied path is used.
    if not ctx.campaign:
        return 400, {"ok": False, "error": "no active campaign"}

    error = discovery.validate_session_state(body)
    if error:
        return 400, {"ok": False, "error": error}

    if not os.path.isdir(campaign_dir_path(ctx.base_dir, ctx.campaign)):
        return 404, {"ok": False, "error": "campaign folder not found"}

    target = discovery.session_state_path(ctx.base_dir, ctx.campaign)
    try:
        atomic_write_json(target, body)
    except OSError as exc:
        return 500, {"ok": False, "error": str(exc)}

    print(paint(f"Saved: campaigns/{ctx.campaign}/.sys/session.json", GREEN), flush=True)
    return 200, {"ok": True}
