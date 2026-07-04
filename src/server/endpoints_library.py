"""Reference library endpoints: list/bundle, create, and move library .md files."""

import os
import shutil

from src.server import discovery
from src.server.paths import (
    CAMPAIGNS_DIR,
    LIBRARY_DIRS,
    atomic_write_text,
    campaign_dir_path,
    clean_library_name,
    resolve_writable,
    user_root,
)
from src.server.term import GREEN, paint


def library_files(ctx, query, body):
    ref_type = query.get("type", "item")
    return 200, discovery.discover_library_files(ctx.base_dir, ref_type, ctx.campaign)


def library_bundle(ctx, query, body):
    ref_type = query.get("type", "item")
    return 200, discovery.discover_library_files(
        ctx.base_dir, ref_type, ctx.campaign, with_content=True)


def _scope_target(ctx, folder, scope):
    """Destination folder + client-visible path prefix for a library scope.

    scope "campaign" targets the request campaign's folder; "global" (the
    default) the shared root. Returns (target_dir, rel_prefix) or an
    (status, payload) error tuple flagged by target_dir=None."""
    if scope == "campaign":
        if not ctx.campaign:
            return None, (400, {"ok": False, "error": "no active campaign"})
        target_dir = os.path.join(campaign_dir_path(ctx.base_dir, ctx.campaign), folder)
        rel_prefix = f"{CAMPAIGNS_DIR}/{ctx.campaign}/{folder}"
    else:
        target_dir = os.path.join(user_root(ctx.base_dir), folder)
        rel_prefix = folder
    return target_dir, rel_prefix


def create_library_file(ctx, query, body):
    try:
        ref_type = str(body.get("type") or "item")
        name = clean_library_name(body.get("name"))
        scope = str(body.get("scope") or "global")
        content = body["content"]
    except (AttributeError, KeyError, TypeError) as exc:
        return 400, {"ok": False, "error": f"bad request: {exc}"}

    folder = LIBRARY_DIRS.get(ref_type)
    if not folder:
        return 400, {"ok": False, "error": f"unknown library type: {ref_type}"}
    if not name:
        return 400, {"ok": False, "error": "invalid name"}

    target_dir, rel_prefix = _scope_target(ctx, folder, scope)
    if target_dir is None:
        return rel_prefix
    os.makedirs(target_dir, exist_ok=True)
    filename = f"{name}.md"
    target = os.path.realpath(os.path.join(target_dir, filename))

    try:
        if os.path.exists(target):
            raise FileExistsError("item already exists")
        atomic_write_text(target, content)
    except FileExistsError:
        return 409, {"ok": False, "error": "item already exists"}
    except OSError as exc:
        return 500, {"ok": False, "error": str(exc)}

    print(paint(f"Created: {os.path.relpath(target, ctx.base_dir)}", GREEN), flush=True)
    origin = "campaign" if scope == "campaign" else "global"
    return 200, {"ok": True, "entry": {
        "name": name, "path": f"{rel_prefix}/{filename}", "origin": origin}}


def move_library_file(ctx, query, body):
    """Relocate a library .md between the campaign-local and global folders.
    Source is the entry's current `path` (writable-roots + .md guarded);
    destination is derived from `scope` exactly like create_library_file."""
    try:
        ref_type = str(body.get("type") or "item")
        name = clean_library_name(body.get("name"))
        src_rel = body["path"]
        scope = str(body.get("scope") or "global")
    except (AttributeError, KeyError, TypeError) as exc:
        return 400, {"ok": False, "error": f"bad request: {exc}"}

    folder = LIBRARY_DIRS.get(ref_type)
    if not folder:
        return 400, {"ok": False, "error": f"unknown library type: {ref_type}"}
    if not name:
        return 400, {"ok": False, "error": "invalid name"}

    src = resolve_writable(ctx.base_dir, src_rel)
    if not src:
        return 403, {"ok": False, "error": "path outside writable roots"}
    if not src.lower().endswith(".md"):
        return 403, {"ok": False, "error": "only .md files"}
    if not os.path.isfile(src):
        return 404, {"ok": False, "error": "file not found"}

    target_dir, rel_prefix = _scope_target(ctx, folder, scope)
    if target_dir is None:
        return rel_prefix
    os.makedirs(target_dir, exist_ok=True)
    filename = f"{name}.md"
    dest = os.path.realpath(os.path.join(target_dir, filename))

    if dest == src:
        return 400, {"ok": False, "error": "already in target library"}
    if os.path.exists(dest):
        return 409, {"ok": False, "error": "item already exists in target"}

    try:
        shutil.move(src, dest)
    except OSError as exc:
        return 500, {"ok": False, "error": str(exc)}

    print(paint(
        f"Moved: {os.path.relpath(src, ctx.base_dir)} -> {os.path.relpath(dest, ctx.base_dir)}",
        GREEN), flush=True)
    origin = "campaign" if scope == "campaign" else "global"
    return 200, {"ok": True, "entry": {
        "name": name, "path": f"{rel_prefix}/{filename}", "origin": origin}}
