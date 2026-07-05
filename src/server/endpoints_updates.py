"""Update state machine + its endpoints, and the app-exit endpoint.

Owns the whole stage-2 install flow: check preference, background check thread,
download/extract/validate, and hand-off to the detached apply helper. Progress
and status live in src.server.state; process lifecycle is signalled through
state.EXIT_REQUESTED / state.UPDATE_HANDOFF, which launcher.main() polls.
"""

import json
import os
import subprocess
import sys
import threading
import time

from src.server import state
from src.server.term import YELLOW, paint
from src.server.paths import (
    OPTIONS_CURRENT_FILE,
    OPTIONS_DEFAULTS_FILE,
    read_json_file,
    user_root,
)
from src.updates import update_installer
from src.updates.update_checker import APP_VERSION, check_for_updates
from src.updates.update_config import (
    DEFAULT_DOWNLOAD_URL,
    DOWNLOAD_TIMEOUT_SECONDS,
    UPDATE_BACKUP_DIR,
    UPDATE_CHECK_TIMEOUT_SECONDS,
    UPDATE_DOWNLOAD_ZIP,
    UPDATE_EXTRACT_DIR,
    UPDATE_HEARTBEAT_FILE,
    UPDATE_JOB_FILE,
    UPDATE_LOGS_DIR,
    UPDATE_MANIFEST_URL,
)


def check_for_updates_enabled(base_dir):
    """Read the user's update-check preference from the existing options model."""
    enabled = True
    # Defaults ship under src/; the user's current choices live under content/.
    for path in (os.path.join(base_dir, OPTIONS_DEFAULTS_FILE),
                 os.path.join(user_root(base_dir), OPTIONS_CURRENT_FILE)):
        data = read_json_file(path)
        value = data.get("check_for_updates")
        if isinstance(value, bool):
            enabled = value
        elif value is not None:
            print(paint(
                f'Ignoring invalid "check_for_updates" value {value!r} in {path} '
                "(expected true or false)",
                YELLOW,
            ), flush=True)
    return enabled


def start_update_check(base_dir):
    enabled = check_for_updates_enabled(base_dir)
    if not enabled:
        state.set_update_status({
            "state": "disabled",
            "current_version": APP_VERSION,
        })
        return None

    with state.UPDATE_STATUS_LOCK:
        state.UPDATE_STATUS.clear()
        state.UPDATE_STATUS.update({
            "state": "check_failed",
            "current_version": APP_VERSION,
            "pending": True,
        })

    def worker():
        result = check_for_updates(
            current_version=APP_VERSION,
            manifest_url=UPDATE_MANIFEST_URL,
            enabled=True,
            timeout=UPDATE_CHECK_TIMEOUT_SECONDS,
        )
        state.set_update_status(result)

    thread = threading.Thread(target=worker, name="RendScrollUpdateCheck", daemon=True)
    thread.start()
    return thread


def write_launch_heartbeat(base_dir):
    """Write the launch heartbeat the update-apply helper polls for. Harmless on a
    normal launch; on an updated launch it is the signal that relaunch succeeded."""
    try:
        path = os.path.join(base_dir, UPDATE_HEARTBEAT_FILE)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(APP_VERSION + "\n")
    except OSError:
        pass


def _manifest_download_url():
    """Prefer the checked manifest's download_url; fall back to the default zip."""
    status = state.update_status_snapshot()
    url = status.get("download_url")
    if isinstance(url, str) and url.strip():
        return url.strip()
    return DEFAULT_DOWNLOAD_URL


def begin_update(base_dir):
    """Guard, then run the install on a background thread. Returns an error string
    when the request is rejected, else None (accepted)."""
    status = state.update_status_snapshot()
    if status.get("state") != "update_available":
        return "no update is available"
    if status.get("manual_update_required"):
        return "automatic updates are not supported for this version"
    with state.UPDATE_PROGRESS_LOCK:
        if state.UPDATE_PROGRESS.get("active"):
            return "an update is already in progress"
        state.UPDATE_PROGRESS.update({
            "phase": "starting", "message": "", "ok": True, "active": True,
        })

    target_version = status.get("latest_version") or ""
    thread = threading.Thread(
        target=run_update_install,
        args=(base_dir, target_version),
        name="RendScrollUpdateInstall",
        daemon=True,
    )
    thread.start()
    return None


def run_update_install(base_dir, target_version):
    """Download + extract + validate, then hand off to the detached apply helper.
    Sets EXIT_REQUESTED on a successful hand-off so the current instance releases
    its files."""
    download_zip = os.path.join(base_dir, UPDATE_DOWNLOAD_ZIP)
    extract_dir = os.path.join(base_dir, UPDATE_EXTRACT_DIR)
    try:
        state.set_update_progress("downloading", "Downloading update…")
        update_installer.download_zip(
            _manifest_download_url(), download_zip, timeout=DOWNLOAD_TIMEOUT_SECONDS
        )

        state.set_update_progress("extracting", "Extracting update…")
        extract_root = update_installer.extract_zip(download_zip, extract_dir)
        update_installer.validate_extract(extract_root)
    except Exception as exc:  # noqa: BLE001
        state.set_update_progress("failed", f"Download failed: {exc}", ok=False, active=False)
        return

    _handoff_to_helper(base_dir, extract_root, target_version)


def _handoff_to_helper(base_dir, extract_root, target_version):
    """Write the apply job, spawn the detached helper, then exit."""
    try:
        state.set_update_progress("preparing", "Preparing update…")
        stamp = time.strftime("%Y-%m-%dT%H-%M-%SZ", time.gmtime())
        backup_dir = os.path.join(base_dir, UPDATE_BACKUP_DIR, stamp)
        logs_path = os.path.join(base_dir, UPDATE_LOGS_DIR, f"apply-{stamp}.log")
        launcher_path = os.path.join(base_dir, "launcher.py")
        job = {
            "mode": "source",
            "install_root": base_dir,
            "extract_root": extract_root,
            "backup_dir": backup_dir,
            "logs_path": logs_path,
            "download_zip": os.path.join(base_dir, UPDATE_DOWNLOAD_ZIP),
            "heartbeat_path": os.path.join(base_dir, UPDATE_HEARTBEAT_FILE),
            "target_version": target_version,
            "parent_pid": os.getpid(),
            "relaunch": [sys.executable, launcher_path],
        }
        job_path = os.path.join(base_dir, UPDATE_JOB_FILE)
        os.makedirs(os.path.dirname(job_path), exist_ok=True)
        with open(job_path, "w", encoding="utf-8") as fh:
            json.dump(job, fh, indent=2)

        apply_script = os.path.join(base_dir, "src", "updates", "update_apply.py")
        _spawn_detached([sys.executable, apply_script, job_path], base_dir)
    except Exception as exc:  # noqa: BLE001
        state.set_update_progress("failed", f"Could not start updater: {exc}", ok=False, active=False)
        return

    state.set_update_progress(
        "relaunching",
        "Applying update and relaunching. This window will close.",
        active=False,
    )
    state.UPDATE_HANDOFF.set()
    state.EXIT_REQUESTED.set()


def _spawn_detached(command, cwd):
    kwargs = {"cwd": cwd, "close_fds": True}
    if os.name == "nt":
        kwargs["creationflags"] = 0x00000008 | 0x00000200  # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
    else:
        kwargs["start_new_session"] = True
    return subprocess.Popen(command, **kwargs)


# --- endpoint functions -----------------------------------------------------

def update_status(ctx, query, body):
    return 200, state.update_status_snapshot()


def update_progress(ctx, query, body):
    return 200, state.update_progress_snapshot()


def begin_update_endpoint(ctx, query, body):
    error = begin_update(ctx.base_dir)
    if error:
        return 409, {"ok": False, "error": error}
    return 202, {"ok": True}


def rendscroll_exit(ctx, query, body):
    state.EXIT_REQUESTED.set()
    return 200, {"ok": True}
