"""Stage 2 update *installer* helpers for RendScroll.

Pure(ish), side-effect-scoped functions shared by ``launcher.py`` (which prepares
an update) and ``update_apply.py`` (the detached helper that applies it) and by the
tests. This module owns the **hardcoded folder-ownership rules** — the update
manifest never gets to decide which folders are user-owned (see
``UPDATE_STAGE_2_PLAN.md``, "Manifest Authority Decision").

Responsibilities:
- download the source zip over HTTPS,
- extract it and strip GitHub's single wrapper directory,
- structurally validate the extract,
- plan which files get replaced and which stale files get deleted (denylist of
  protected roots; deletion is conservative — see ``plan_deletions``),
- back up the current app files that will be overwritten or deleted, and roll
  back from that backup on failure.

Integrity is trusted to HTTPS + GitHub; there is intentionally no hash check.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import time
import urllib.request
import zipfile


# Top-level path segments that are user-owned or update-internal. Replacement,
# deletion, and app-file backup MUST skip anything under these. This list is the
# single source of truth for "safe to overwrite" — do not let the manifest change it.
# All user-owned content now lives under the single content/ root (campaigns, library
# items/enemies, images/audio, exports, options.current.json), so protecting that one
# segment covers everything the app writes.
PROTECTED_ROOTS = frozenset({
    "content",
    ".git",
    ".rendscroll-update",
})


class UpdateInstallError(RuntimeError):
    """Raised when an install step cannot proceed safely."""


# Kept local (not imported from update_checker) so the installer stays
# independent of the checker module.
_SEMVER_RE = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")


def _utc_stamp():
    return time.strftime("%Y-%m-%dT%H-%M-%SZ", time.gmtime())


def _top_segment(rel_path):
    """Return the first path segment of a repo-relative path (posix or native)."""
    normalized = rel_path.replace("\\", "/").lstrip("/")
    return normalized.split("/", 1)[0]


def is_protected(rel_path):
    """True when rel_path lives under (or is) a protected root."""
    return _top_segment(rel_path) in PROTECTED_ROOTS


# --------------------------------------------------------------------------- #
# Download + extract
# --------------------------------------------------------------------------- #

def download_zip(url, dest_path, timeout=60.0, opener=None):
    """Download `url` to `dest_path` over HTTPS. `opener(url, timeout)` may be
    injected in tests and should return the archive bytes."""
    os.makedirs(os.path.dirname(dest_path) or ".", exist_ok=True)

    if opener is not None:
        data = opener(url, timeout)
        with open(dest_path, "wb") as fh:
            fh.write(data)
        return dest_path

    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/zip",
            "User-Agent": "RendScroll-update-installer",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response, open(dest_path, "wb") as fh:
        shutil.copyfileobj(response, fh)
    return dest_path


def extract_zip(zip_path, dest_dir):
    """Extract `zip_path` into `dest_dir` and return the extracted app root.

    GitHub source zips wrap everything in a single top directory (e.g.
    ``RendScroll-main/``); when that is the only top-level entry we descend into it
    so callers see the app tree directly.
    """
    if os.path.isdir(dest_dir):
        shutil.rmtree(dest_dir)
    os.makedirs(dest_dir, exist_ok=True)

    with zipfile.ZipFile(zip_path) as archive:
        archive.extractall(dest_dir)

    entries = [name for name in os.listdir(dest_dir) if not name.startswith("__MACOSX")]
    if len(entries) == 1:
        only = os.path.join(dest_dir, entries[0])
        if os.path.isdir(only):
            return only
    return dest_dir


def validate_extract(extract_root):
    """Confirm the extract looks like a RendScroll tree before anything is touched.

    Structural sanity is the only integrity gate (integrity otherwise trusted to
    HTTPS + GitHub). Raises UpdateInstallError when the shape is wrong.
    """
    index_ok = os.path.isfile(os.path.join(extract_root, "index.html"))
    src_ok = os.path.isdir(os.path.join(extract_root, "src"))
    if not (index_ok and src_ok):
        raise UpdateInstallError(
            "downloaded update does not look like RendScroll "
            "(missing index.html or src/)"
        )

    # The shipped manifest is the app's version source (update_checker derives
    # APP_VERSION from it at import); an extract without a valid one would break
    # the relaunched app, so catch it here before anything is touched.
    manifest_path = os.path.join(extract_root, "update_manifest.json")
    try:
        with open(manifest_path, encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, json.JSONDecodeError) as exc:
        raise UpdateInstallError(
            f"downloaded update has no readable update_manifest.json: {exc}"
        ) from exc
    latest = data.get("latest") if isinstance(data, dict) else None
    if not isinstance(latest, str) or not _SEMVER_RE.match(latest.strip()):
        raise UpdateInstallError(
            "downloaded update's update_manifest.json has no valid latest version"
        )
    return True


# --------------------------------------------------------------------------- #
# Replace + deletion planning
# --------------------------------------------------------------------------- #

def _walk_rel_files(root, prune_top_dirs_not_in=None):
    """Yield posix-style rel paths of every file under `root`, never descending
    into protected roots. When `prune_top_dirs_not_in` is a set, top-level
    directories absent from it are skipped entirely."""
    for dirpath, dirnames, filenames in os.walk(root):
        rel_dir = os.path.relpath(dirpath, root)
        rel_dir = "" if rel_dir == "." else rel_dir.replace("\\", "/")

        kept = []
        for name in dirnames:
            rel = name if not rel_dir else f"{rel_dir}/{name}"
            if is_protected(rel):
                continue
            if (prune_top_dirs_not_in is not None and not rel_dir
                    and name not in prune_top_dirs_not_in):
                continue
            kept.append(name)
        dirnames[:] = kept

        for name in filenames:
            rel = name if not rel_dir else f"{rel_dir}/{name}"
            if is_protected(rel):
                continue
            yield rel


def plan_replacements(extract_root, install_root):
    """Return the list of files to copy from `extract_root` onto `install_root`.

    Each item is a dict: {"rel", "src", "dest"} using native paths. Protected roots
    are always skipped. Deletion of stale files is planned separately by
    `plan_deletions`.
    """
    replacements = []
    for rel in _walk_rel_files(extract_root):
        replacements.append({
            "rel": rel,
            "src": os.path.join(extract_root, rel.replace("/", os.sep)),
            "dest": os.path.join(install_root, rel.replace("/", os.sep)),
        })
    replacements.sort(key=lambda item: item["rel"])
    return replacements


def plan_deletions(extract_root, install_root):
    """Return stale install files the update should remove: present in
    `install_root` but absent from `extract_root`. Each item is {"rel", "path"}.

    Deliberately conservative:
    - never anything under PROTECTED_ROOTS;
    - whole top-level directories the extract does not ship are skipped
      (user/tooling folders like node_modules, editor dirs, notes);
    - root-level dotfiles are skipped (user/tooling config convention);
    - only files are planned — emptied directories are pruned after deletion.
    """
    extract_rels = set(_walk_rel_files(extract_root))
    extract_top_dirs = {
        name for name in os.listdir(extract_root)
        if os.path.isdir(os.path.join(extract_root, name))
    }

    deletions = []
    for rel in _walk_rel_files(install_root, prune_top_dirs_not_in=extract_top_dirs):
        if rel in extract_rels:
            continue
        if "/" not in rel and rel.startswith("."):
            continue
        deletions.append({
            "rel": rel,
            "path": os.path.join(install_root, rel.replace("/", os.sep)),
        })
    deletions.sort(key=lambda item: item["rel"])
    return deletions


# --------------------------------------------------------------------------- #
# Backup + apply + rollback
# --------------------------------------------------------------------------- #

def backup_targets(replacements, backup_dir, deletions=None):
    """Back up every existing file the update will overwrite or delete.

    Writes ``backup_manifest.json`` recording which files were preserved
    (``restored``), which are brand new (``added``, deleted on rollback), and
    which the update deletes (``deleted``, restored on rollback), then verifies
    the backup exists. Returns the manifest dict.
    """
    os.makedirs(backup_dir, exist_ok=True)
    restored = []
    added = []
    deleted = []

    for item in replacements:
        if os.path.exists(item["dest"]):
            backup_path = os.path.join(backup_dir, item["rel"].replace("/", os.sep))
            os.makedirs(os.path.dirname(backup_path) or ".", exist_ok=True)
            shutil.copy2(item["dest"], backup_path)
            restored.append(item["rel"])
        else:
            added.append(item["rel"])

    for item in deletions or []:
        if os.path.exists(item["path"]):
            backup_path = os.path.join(backup_dir, item["rel"].replace("/", os.sep))
            os.makedirs(os.path.dirname(backup_path) or ".", exist_ok=True)
            shutil.copy2(item["path"], backup_path)
            deleted.append(item["rel"])

    manifest = {
        "created": _utc_stamp(),
        "restored": restored,
        "added": added,
        "deleted": deleted,
    }
    manifest_path = os.path.join(backup_dir, "backup_manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2)

    # Verify the backup landed before the caller touches any current file.
    for rel in restored + deleted:
        if not os.path.exists(os.path.join(backup_dir, rel.replace("/", os.sep))):
            raise UpdateInstallError(f"backup verification failed for {rel}")
    return manifest


def apply_replacements(replacements):
    """Copy each planned file from its extract source onto the install tree."""
    for item in replacements:
        os.makedirs(os.path.dirname(item["dest"]) or ".", exist_ok=True)
        shutil.copy2(item["src"], item["dest"])


def apply_deletions(deletions, install_root):
    """Delete each planned stale file, then prune the directories that emptied."""
    for item in deletions:
        if os.path.exists(item["path"]):
            os.remove(item["path"])
    _prune_empty_dirs({os.path.dirname(item["path"]) for item in deletions}, install_root)


def _prune_empty_dirs(dir_paths, stop_root):
    """Remove now-empty directories, walking upward, never past `stop_root`."""
    stop = os.path.abspath(stop_root)
    for path in dir_paths:
        current = os.path.abspath(path)
        while current != stop:
            if os.path.relpath(current, stop).startswith(".."):
                break  # outside stop_root; never prune here
            try:
                os.rmdir(current)
            except OSError:
                break  # not empty (or already gone with a non-empty parent)
            current = os.path.dirname(current)


def rollback(backup_dir, install_root):
    """Restore the app files recorded in `backup_dir`'s manifest.

    Files that existed before are copied back; files the update added are removed.
    Raises UpdateInstallError if the manifest is missing or a restore fails — the
    caller must surface the exact backup path for manual recovery.
    """
    manifest_path = os.path.join(backup_dir, "backup_manifest.json")
    if not os.path.isfile(manifest_path):
        raise UpdateInstallError(f"no backup manifest at {manifest_path}")
    with open(manifest_path, encoding="utf-8") as fh:
        manifest = json.load(fh)

    # `deleted` files (missing key = pre-deletion backup) are restored the same
    # way as overwritten ones.
    for rel in manifest.get("restored", []) + manifest.get("deleted", []):
        backup_path = os.path.join(backup_dir, rel.replace("/", os.sep))
        dest_path = os.path.join(install_root, rel.replace("/", os.sep))
        if not os.path.exists(backup_path):
            raise UpdateInstallError(f"backup missing {rel} at {backup_path}")
        os.makedirs(os.path.dirname(dest_path) or ".", exist_ok=True)
        shutil.copy2(backup_path, dest_path)

    added_parents = set()
    for rel in manifest.get("added", []):
        dest_path = os.path.join(install_root, rel.replace("/", os.sep))
        if os.path.exists(dest_path):
            os.remove(dest_path)
        added_parents.add(os.path.dirname(dest_path))
    _prune_empty_dirs(added_parents, install_root)
    return manifest


__all__ = [
    "PROTECTED_ROOTS",
    "UpdateInstallError",
    "apply_deletions",
    "apply_replacements",
    "backup_targets",
    "download_zip",
    "extract_zip",
    "is_protected",
    "plan_deletions",
    "plan_replacements",
    "rollback",
    "validate_extract",
]
