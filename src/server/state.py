"""Mutable server-process state, behind accessors.

The active campaign is only a *default*: request handlers resolve an explicit
`campaign` query/body param first and fall back to this value (it remains
authoritative solely for static /images and /audio serving, whose URLs come from
rendered markdown and cannot carry a param). Always go through the accessor
functions — importing the underlying variable would freeze a stale binding.
"""

import threading

from src.updates.update_checker import APP_VERSION


EXIT_REQUESTED = threading.Event()
# Set when we exit specifically to hand off to the updater/relaunch, so the console
# closes cleanly instead of waiting on the goodbye keypress.
UPDATE_HANDOFF = threading.Event()

# The campaign selected by the client (POST /__select_campaign). None = no campaign.
_ACTIVE_CAMPAIGN = None

UPDATE_STATUS_LOCK = threading.Lock()
UPDATE_STATUS = {
    "state": "check_failed",
    "current_version": APP_VERSION,
    "pending": False,
}

# Stage 2 install progress, surfaced at GET /__update_progress. `phase` is idle until
# the user clicks Update Now; `active` guards against overlapping installs.
UPDATE_PROGRESS_LOCK = threading.Lock()
UPDATE_PROGRESS = {
    "phase": "idle",
    "message": "",
    "active": False,
    "ok": True,
}


def get_active_campaign():
    return _ACTIVE_CAMPAIGN


def set_active_campaign(name):
    global _ACTIVE_CAMPAIGN
    _ACTIVE_CAMPAIGN = name or None


def clear_active_campaign_if(name):
    """Clear the default when the named campaign stops existing (delete)."""
    global _ACTIVE_CAMPAIGN
    if _ACTIVE_CAMPAIGN == name:
        _ACTIVE_CAMPAIGN = None


def update_status_snapshot():
    with UPDATE_STATUS_LOCK:
        return dict(UPDATE_STATUS)


def set_update_status(status):
    global UPDATE_STATUS
    payload = dict(status)
    payload["pending"] = False
    with UPDATE_STATUS_LOCK:
        UPDATE_STATUS = payload


def update_progress_snapshot():
    with UPDATE_PROGRESS_LOCK:
        return dict(UPDATE_PROGRESS)


def set_update_progress(phase, message="", ok=True, active=True):
    with UPDATE_PROGRESS_LOCK:
        UPDATE_PROGRESS.update({
            "phase": phase,
            "message": message,
            "ok": ok,
            "active": active,
        })
