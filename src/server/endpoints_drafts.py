"""Per-campaign editor draft endpoints (campaigns/<name>/.sys/drafts.json)."""

import json
import os

from src.server import discovery
from src.server.paths import atomic_write_json, campaign_dir_path, draft_state_path
from src.server.term import GREEN, paint


def empty_draft_state():
    return {"version": 1, "create": {}, "editManifest": {}}


def get_draft_state(ctx, query, body):
    if not ctx.campaign:
        return 400, {"ok": False, "error": "no active campaign"}

    target = draft_state_path(ctx.base_dir, ctx.campaign)
    if not os.path.isfile(target):
        return 200, {"ok": True, "state": empty_draft_state(), "readOnly": False}
    try:
        with open(target, "r", encoding="utf-8") as fh:
            state = json.load(fh)
    except (OSError, ValueError):
        return 200, {
            "ok": True,
            "state": empty_draft_state(),
            "readOnly": True,
            "warning": "drafts.json was unreadable",
        }

    error = discovery.validate_draft_state(state)
    if error:
        return 200, {
            "ok": True,
            "state": empty_draft_state(),
            "readOnly": True,
            "warning": "drafts.json is not a supported v1 draft file: " + error,
        }
    return 200, {"ok": True, "state": state, "readOnly": False}


def save_draft_state(ctx, query, body):
    if not ctx.campaign:
        return 400, {"ok": False, "error": "no active campaign"}

    error = discovery.validate_draft_state(body)
    if error:
        return 400, {"ok": False, "error": error}

    if not os.path.isdir(campaign_dir_path(ctx.base_dir, ctx.campaign)):
        return 404, {"ok": False, "error": "campaign folder not found"}

    target = draft_state_path(ctx.base_dir, ctx.campaign)
    try:
        atomic_write_json(target, body)
    except OSError as exc:
        return 500, {"ok": False, "error": str(exc)}

    print(paint(f"Saved: campaigns/{ctx.campaign}/.sys/drafts.json", GREEN), flush=True)
    return 200, {"ok": True}
