"""Detached update-apply helper for RendScroll (Stage 2).

`launcher.py` downloads + extracts the update, writes a small ``job.json``, spawns
this script **detached**, and exits so no target file is in use. This helper then:

  wait for the parent to exit -> back up -> replace -> relaunch -> validate ->
  roll back on any failure.

Run as:  python update_apply.py <path-to-job.json>
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from src.updates import update_installer as installer  # noqa: E402


PARENT_WAIT_SECONDS = 30
HEARTBEAT_WAIT_SECONDS = 40
POLL_SECONDS = 0.5


class _Logger:
    """Plain-text, timestamped, user-readable step log (also echoed to stdout)."""

    def __init__(self, path):
        self.path = path
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        self._fh = open(path, "a", encoding="utf-8")

    def line(self, step, status, detail=""):
        stamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        text = f"{stamp}  {step:<9} {status:<5} {detail}".rstrip()
        self._fh.write(text + "\n")
        self._fh.flush()
        print(text, flush=True)

    def close(self):
        try:
            self._fh.close()
        except OSError:
            pass


def _process_alive(pid):
    """Best-effort 'is this pid still running' across Windows and POSIX."""
    if not pid or pid <= 0:
        return False
    if os.name == "nt":
        import ctypes

        SYNCHRONIZE = 0x00100000
        handle = ctypes.windll.kernel32.OpenProcess(SYNCHRONIZE, False, int(pid))
        if not handle:
            return False
        # WAIT_TIMEOUT (0x102) => still running; anything else => gone/signaled.
        result = ctypes.windll.kernel32.WaitForSingleObject(handle, 0)
        ctypes.windll.kernel32.CloseHandle(handle)
        return result == 0x102
    try:
        os.kill(int(pid), 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def _wait_for_parent(pid, log):
    log.line("WAIT", "start", f"parent pid {pid}")
    deadline = time.time() + PARENT_WAIT_SECONDS
    while time.time() < deadline:
        if not _process_alive(pid):
            log.line("WAIT", "ok", "parent exited")
            return
        time.sleep(POLL_SECONDS)
    log.line("WAIT", "warn", "parent still alive after timeout; continuing")


def _relaunch(command, cwd):
    """Start the launcher in its own console and return the Popen handle.

    The launcher is an interactive console app and its startup touches
    sys.stdout; a DETACHED_PROCESS child has no std handles (sys.stdout is
    None), which crashes it before the heartbeat is written. CREATE_NEW_CONSOLE
    gives it the fresh visible console a normal launch has."""
    kwargs = {"cwd": cwd, "close_fds": True}
    if os.name == "nt":
        kwargs["creationflags"] = 0x00000010  # CREATE_NEW_CONSOLE
    else:
        kwargs["start_new_session"] = True
    return subprocess.Popen(command, **kwargs)


def _wait_for_heartbeat(heartbeat_path, since, expected_version, log,
                        timeout=HEARTBEAT_WAIT_SECONDS):
    """Return True once the relaunched launcher writes a fresh heartbeat whose
    version matches `expected_version`.

    The heartbeat file holds one line: the running app's APP_VERSION (derived
    from the shipped update_manifest.json), so a matching version proves the
    *updated* code relaunched, not a half-applied old install. Empty/mismatched
    content keeps polling (covers the writer's open-then-write race); a falsy
    `expected_version` (job written by an older app) falls back to mtime-only."""
    if not expected_version:
        log.line("VALIDATE", "warn", "job has no target_version; accepting any fresh heartbeat")
    deadline = time.time() + timeout
    last_seen = None
    while time.time() < deadline:
        try:
            if os.path.getmtime(heartbeat_path) >= since:
                with open(heartbeat_path, encoding="utf-8") as fh:
                    last_seen = fh.read().strip()
                if not expected_version or last_seen == expected_version:
                    return True
        except OSError:
            pass
        time.sleep(POLL_SECONDS)
    if last_seen is not None:
        log.line(
            "VALIDATE", "warn",
            f"heartbeat version {last_seen!r} does not match target {expected_version!r}",
        )
    return False


def _prune_old_backups(backup_dir):
    """Keep only the latest backup: remove sibling timestamp folders."""
    parent = os.path.dirname(backup_dir)
    keep = os.path.basename(backup_dir)
    if not os.path.isdir(parent):
        return
    for name in os.listdir(parent):
        if name == keep:
            continue
        path = os.path.join(parent, name)
        if os.path.isdir(path):
            import shutil

            shutil.rmtree(path, ignore_errors=True)


def _cleanup_temp(job):
    import shutil

    for key in ("extract_root", "download_zip"):
        target = job.get(key)
        if not target or not os.path.exists(target):
            continue
        if os.path.isdir(target):
            shutil.rmtree(target, ignore_errors=True)
        else:
            os.remove(target)


def _attempt_rollback(job, log, failed_step):
    backup_dir = job["backup_dir"]
    install_root = job["install_root"]
    log.line("ROLLBACK", "start", f"after {failed_step} failure")
    try:
        installer.rollback(backup_dir, install_root)
        log.line("ROLLBACK", "ok", f"restored from {backup_dir}")
    except Exception as exc:  # noqa: BLE001
        log.line("ROLLBACK", "fail", f"{exc} | backup preserved at {backup_dir}")
        return False
    # Bring the restored (working) app back up so the user is not left with nothing.
    try:
        _relaunch(job["relaunch"], install_root)
        log.line("RELAUNCH", "ok", "restored app relaunched")
    except Exception as exc:  # noqa: BLE001
        log.line("RELAUNCH", "fail", str(exc))
    return True


def run(job_path):
    with open(job_path, encoding="utf-8") as fh:
        job = json.load(fh)

    log = _Logger(job["logs_path"])
    log.line("APPLY", "start", f"target {job.get('target_version', '?')}")

    install_root = job["install_root"]
    extract_root = job["extract_root"]
    backup_dir = job["backup_dir"]
    heartbeat_path = job["heartbeat_path"]

    _wait_for_parent(job.get("parent_pid"), log)

    # Plans are recomputed here from the extract so the job file stays small.
    replacements = installer.plan_replacements(extract_root, install_root)
    deletions = installer.plan_deletions(extract_root, install_root)
    log.line("PLAN", "ok", f"{len(replacements)} files, {len(deletions)} deletions")

    try:
        installer.backup_targets(replacements, backup_dir, deletions=deletions)
        log.line("BACKUP", "ok", f"-> {backup_dir}")
    except Exception as exc:  # noqa: BLE001
        log.line("BACKUP", "fail", str(exc))
        log.close()
        return 1  # nothing replaced yet; safe to stop without rollback

    try:
        # Clear any stale heartbeat so we only accept a fresh one.
        if os.path.exists(heartbeat_path):
            os.remove(heartbeat_path)
    except OSError:
        pass

    try:
        # Copy first, delete second: a failure mid-delete still rolls back both
        # via the backup manifest.
        installer.apply_replacements(replacements)
        installer.apply_deletions(deletions, install_root)
        log.line("REPLACE", "ok", f"{len(replacements)} files, {len(deletions)} deleted")
    except Exception as exc:  # noqa: BLE001
        log.line("REPLACE", "fail", str(exc))
        _attempt_rollback(job, log, "replace")
        log.close()
        return 1

    since = time.time()
    try:
        _relaunch(job["relaunch"], install_root)
        log.line("RELAUNCH", "start", "launching updated app")
    except Exception as exc:  # noqa: BLE001
        log.line("RELAUNCH", "fail", str(exc))
        _attempt_rollback(job, log, "relaunch")
        log.close()
        return 1

    if not _wait_for_heartbeat(heartbeat_path, since, job.get("target_version") or "", log):
        log.line("VALIDATE", "fail", "no matching launch heartbeat")
        _attempt_rollback(job, log, "validate")
        log.close()
        return 1

    log.line("VALIDATE", "ok", "updated app is running")
    _prune_old_backups(backup_dir)
    _cleanup_temp(job)
    log.line("APPLY", "ok", "update complete")
    log.close()
    return 0


def main(argv):
    if len(argv) < 2:
        print("usage: update_apply.py <job.json>", file=sys.stderr)
        return 2
    try:
        return run(argv[1])
    except Exception as exc:  # noqa: BLE001
        print(f"update_apply fatal: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
