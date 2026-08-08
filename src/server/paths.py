"""User-space path model: constants, safe path resolution, and atomic file IO.

Everything user-owned lives under one root (content/). This module is the single
place that names that root and its child folders, and the only place that decides
whether a client-supplied relative path may be read or written.
"""

import json
import os
import re
import shutil
import time


# Single user-space root. Every user-owned folder (campaigns, library items/enemies,
# images/audio) and options.current.json live under this one directory, so the source
# tree and the updater have exactly one folder to never touch. It is a filesystem
# detail only: the client still addresses content by its bare (lowercase) root names
# — campaigns/…, /images/…, options.current.json — and the server roots them here.
USER_DATA_DIR = "content"
# Multi-campaign root. Each child is a self-contained campaign folder with a
# campaign.json manifest, a required scenes/ subfolder, and optional campaign-local
# resource folders (items/, enemies/, images/, audio/) that override the global roots.
CAMPAIGNS_DIR = "campaigns"
SCENES_SUBDIR = "scenes"
# Campaign-local resource folder -> global root folder it overrides. All lowercase,
# so this is an identity map today; kept as the single place asset-override folders
# are named (matching the existing cardBgUrl/audioSrcUrl helpers).
CAMPAIGN_ASSET_DIRS = {"images": "images", "audio": "audio"}
# File types surfaced by the editor/debug asset manager. The renderer can still
# address any URL manually; the picker/inventory only lists local media files.
ASSET_TYPES = {
    "images": {
        "folder": "images",
        "default_ext": ".png",
        "extensions": {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"},
    },
    "audio": {
        "folder": "audio",
        "default_ext": ".mp3",
        "extensions": {".mp3", ".ogg", ".wav", ".m4a", ".flac"},
    },
}
OPTIONS_DEFAULTS_FILE = os.path.join("src", "Options", "options.defaults.json")
OPTIONS_CURRENT_FILE = "options.current.json"
SYS_DIR = ".sys"
APP_STATE_FILE = "app.json"
RENDERER_OPTIONS_STATE_FILE = "renderer-options.json"
DRAFT_STATE_FILE = "drafts.json"
# Destination root for "Export Campaign Package" zips (under USER_DATA_DIR).
# Gitignored (the `*` rule).
EXPORTS_DIR = "exports"
# Reusable reference libraries: a ref type -> the folder its files live in. Items
# and enemies today; npc/monster/location can be added here without touching the
# endpoints.
LIBRARY_DIRS = {"item": "items", "enemy": "enemies"}
# Campaign-ONLY libraries: a ref type -> the folder inside campaigns/<name>/.
# Deliberately NOT in LIBRARY_DIRS, which would open a global content/<folder>
# writable root (resolve_writable) and a /<folder>/… URL root
# (USER_SPACE_URL_ROOTS). Lore has no global counterpart; its files already sit
# under campaigns/, so they are writable and servable without either.
CAMPAIGN_LIBRARY_DIRS = {"lore": "lore"}
# Top URL segments whose files live under content/ on disk (served by translate_path).
USER_SPACE_URL_ROOTS = frozenset(
    {CAMPAIGNS_DIR} | set(LIBRARY_DIRS.values()) | set(CAMPAIGN_ASSET_DIRS.values()))


def library_folder(ref_type):
    """The folder a ref type's .md files live in, global or campaign-only."""
    return LIBRARY_DIRS.get(ref_type) or CAMPAIGN_LIBRARY_DIRS.get(ref_type)


def is_campaign_only_library(ref_type):
    """True when this ref type exists only inside a campaign (no global root)."""
    return ref_type in CAMPAIGN_LIBRARY_DIRS


def user_root(base_dir):
    """The user-space root (base_dir/content). Every user-owned folder and
    options.current.json live under it; nothing else does."""
    return os.path.join(base_dir, USER_DATA_DIR)


def campaign_dir_path(base_dir, name):
    return os.path.join(user_root(base_dir), CAMPAIGNS_DIR, name)


def campaign_scenes_root(base_dir, name):
    return os.path.join(campaign_dir_path(base_dir, name), SCENES_SUBDIR)


def context_sys_path(base_dir, filename):
    """Path to an install/context-level .sys file under content/.sys."""
    return os.path.join(user_root(base_dir), SYS_DIR, filename)


def active_campaign_state_path(base_dir):
    return context_sys_path(base_dir, APP_STATE_FILE)


def renderer_options_state_path(base_dir):
    return context_sys_path(base_dir, RENDERER_OPTIONS_STATE_FILE)


def draft_state_path(base_dir, campaign):
    return os.path.join(campaign_dir_path(base_dir, campaign), SYS_DIR, DRAFT_STATE_FILE)


def clean_campaign_name(value):
    """Sanitize a client-supplied campaign id into a folder-safe name.

    Rejects path separators, parent refs, and empties so it can never escape the
    campaigns/ root. Mirrors clean_library_name."""
    if not isinstance(value, str):
        return None
    name = re.sub(r"\s+", " ", value).strip()
    if not name or name in (".", ".."):
        return None
    if "/" in name or "\\" in name or "\x00" in name:
        return None
    return name[:120]


def clean_library_name(value):
    """Sanitize a client-supplied library file name into a safe stem.

    Rejects anything with path separators, parent refs, or that is empty after
    collapsing whitespace, so it can never escape the library folder."""
    if not isinstance(value, str):
        return None
    name = re.sub(r"\s+", " ", value).strip()
    if not name or name in (".", ".."):
        return None
    if "/" in name or "\\" in name or "\x00" in name:
        return None
    return name[:120]


def clean_campaign_title(value):
    if not isinstance(value, str):
        return "Untitled"
    title = re.sub(r"\s+", " ", value).strip()
    return title[:120] if title else "Untitled"


def safe_trash_label(value):
    label = re.sub(r"[^A-Za-z0-9._ -]+", "-", str(value or "").strip())
    label = re.sub(r"\s+", "-", label).strip(".- ")
    return label[:80] or "item"


def atomic_write_text(path, content):
    directory = os.path.dirname(path)
    os.makedirs(directory, exist_ok=True)
    tmp = path + ".tmp"
    try:
        with open(tmp, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(str(content))
        os.replace(tmp, path)
    except OSError:
        try:
            if os.path.exists(tmp):
                os.remove(tmp)
        except OSError:
            pass
        raise


def atomic_write_json(path, data):
    text = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    atomic_write_text(path, text)


def read_json_file(path):
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def trash_user_path(base_dir, target, label=None):
    """Move a user-owned file/folder into content/.trash and return its content-relative path."""
    root = os.path.realpath(user_root(base_dir))
    target_real = os.path.realpath(target)
    try:
        if os.path.commonpath([root, target_real]) != root:
            raise ValueError("target outside content/")
    except ValueError:
        raise ValueError("target outside content/")

    trash_root = os.path.join(root, ".trash")
    timestamp = time.strftime("%Y%m%d-%H%M%S", time.gmtime())
    stem = f"{timestamp}-{safe_trash_label(label or os.path.basename(target_real))}"
    dest_dir = os.path.join(trash_root, stem)
    i = 2
    while os.path.exists(dest_dir):
        dest_dir = os.path.join(trash_root, f"{stem}-{i}")
        i += 1

    os.makedirs(dest_dir, exist_ok=False)
    dest = os.path.join(dest_dir, os.path.basename(target_real))
    try:
        shutil.move(target_real, dest)
    except OSError:
        try:
            os.rmdir(dest_dir)
        except OSError:
            pass
        raise
    return os.path.relpath(dest, root).replace("\\", "/")


def resolve_writable(base_dir, rel_path):
    """Resolve `rel_path` (a user-space path like campaigns/…/scenes/x.md) to
    an absolute path under content/ only if it stays inside one of the writable
    roots (campaigns/ + every global library folder). Returns the path or None
    when it escapes them. Shared by save, delete, and library move."""
    base = os.path.realpath(user_root(base_dir))
    target = os.path.realpath(os.path.join(base, rel_path))
    roots = [CAMPAIGNS_DIR] + list(LIBRARY_DIRS.values())
    for root in roots:
        root_real = os.path.realpath(os.path.join(base, root))
        try:
            if os.path.commonpath([root_real, target]) == root_real:
                return target
        except ValueError:
            continue  # different drive on Windows
    return None


def resolve_readable(base_dir, rel_path):
    """Resolve `rel_path` (a user-space path) to an absolute path under content/
    only if it stays inside one of the readable export roots (campaigns/, the
    library folders, images/, audio/) or is exactly options.current.json.
    Returns the path or None. Used by the package exporter, which only copies
    content out."""
    base = os.path.realpath(user_root(base_dir))
    if not isinstance(rel_path, str) or not rel_path.strip():
        return None
    target = os.path.realpath(os.path.join(base, rel_path))
    if target == os.path.realpath(os.path.join(base, OPTIONS_CURRENT_FILE)):
        return target
    roots = [CAMPAIGNS_DIR] + list(LIBRARY_DIRS.values()) + ["images", "audio"]
    for root in roots:
        root_real = os.path.realpath(os.path.join(base, root))
        try:
            if os.path.commonpath([root_real, target]) == root_real:
                return target
        except ValueError:
            continue  # different drive on Windows
    return None
