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
- plan which files get replaced (denylist of protected roots),
- back up the current app files that will be overwritten, and roll back from that
  backup on failure.

Integrity is trusted to HTTPS + GitHub; there is intentionally no hash check.
"""

from __future__ import annotations

import json
import os
import shutil
import time
import urllib.request
import zipfile


# Top-level path segments that are user-owned or update-internal. Replacement,
# deletion, and app-file backup MUST skip anything under these. This list is the
# single source of truth for "safe to overwrite" — do not let the manifest change it.
PROTECTED_ROOTS = frozenset({
    "Campaigns",
    "Items",
    "Enemies",
    "images",
    "audio",
    "Exports",
    "options.current.json",
    ".git",
    ".rendscroll-update",
})


class UpdateInstallError(RuntimeError):
    """Raised when an install step cannot proceed safely."""


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
    return True


# --------------------------------------------------------------------------- #
# Replace planning
# --------------------------------------------------------------------------- #

def plan_replacements(extract_root, install_root):
    """Return the list of files to copy from `extract_root` onto `install_root`.

    Each item is a dict: {"rel", "src", "dest"} using native paths. Protected roots
    are always skipped. Stage 2 never deletes existing app files absent from the
    extract (add/overwrite only).
    """
    replacements = []
    for dirpath, dirnames, filenames in os.walk(extract_root):
        rel_dir = os.path.relpath(dirpath, extract_root)
        rel_dir = "" if rel_dir == "." else rel_dir

        # Prune protected directories so we never descend into them.
        kept = []
        for name in dirnames:
            rel = name if not rel_dir else f"{rel_dir}/{name}".replace("\\", "/")
            if is_protected(rel):
                continue
            kept.append(name)
        dirnames[:] = kept

        for name in filenames:
            rel = name if not rel_dir else f"{rel_dir}/{name}".replace("\\", "/")
            if is_protected(rel):
                continue
            replacements.append({
                "rel": rel,
                "src": os.path.join(extract_root, rel.replace("/", os.sep)),
                "dest": os.path.join(install_root, rel.replace("/", os.sep)),
            })
    replacements.sort(key=lambda item: item["rel"])
    return replacements


# --------------------------------------------------------------------------- #
# Backup + apply + rollback
# --------------------------------------------------------------------------- #

def backup_targets(replacements, backup_dir):
    """Back up every existing destination file that a replacement will overwrite.

    Writes ``backup_manifest.json`` recording which files were preserved
    (``restored``) and which are brand new (``added``, deleted on rollback), then
    verifies the backup exists. Returns the manifest dict.
    """
    os.makedirs(backup_dir, exist_ok=True)
    restored = []
    added = []

    for item in replacements:
        if os.path.exists(item["dest"]):
            backup_path = os.path.join(backup_dir, item["rel"].replace("/", os.sep))
            os.makedirs(os.path.dirname(backup_path) or ".", exist_ok=True)
            shutil.copy2(item["dest"], backup_path)
            restored.append(item["rel"])
        else:
            added.append(item["rel"])

    manifest = {
        "created": _utc_stamp(),
        "restored": restored,
        "added": added,
    }
    manifest_path = os.path.join(backup_dir, "backup_manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2)

    # Verify the backup landed before the caller touches any current file.
    for rel in restored:
        if not os.path.exists(os.path.join(backup_dir, rel.replace("/", os.sep))):
            raise UpdateInstallError(f"backup verification failed for {rel}")
    return manifest


def apply_replacements(replacements):
    """Copy each planned file from its extract source onto the install tree."""
    for item in replacements:
        os.makedirs(os.path.dirname(item["dest"]) or ".", exist_ok=True)
        shutil.copy2(item["src"], item["dest"])


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

    for rel in manifest.get("restored", []):
        backup_path = os.path.join(backup_dir, rel.replace("/", os.sep))
        dest_path = os.path.join(install_root, rel.replace("/", os.sep))
        if not os.path.exists(backup_path):
            raise UpdateInstallError(f"backup missing {rel} at {backup_path}")
        os.makedirs(os.path.dirname(dest_path) or ".", exist_ok=True)
        shutil.copy2(backup_path, dest_path)

    for rel in manifest.get("added", []):
        dest_path = os.path.join(install_root, rel.replace("/", os.sep))
        if os.path.exists(dest_path):
            os.remove(dest_path)
    return manifest


__all__ = [
    "PROTECTED_ROOTS",
    "UpdateInstallError",
    "apply_replacements",
    "backup_targets",
    "download_zip",
    "extract_zip",
    "is_protected",
    "plan_replacements",
    "rollback",
    "validate_extract",
]
