"""Reference library endpoints: list/bundle, create, save/rename, move.

Every endpoint here is generic over the ref type (`LIBRARY_DIRS` +
`CAMPAIGN_LIBRARY_DIRS` via `library_folder`), so adding a library kind stays a
registry line rather than a new endpoint. Campaign-only kinds (lore) have no
global root: `_scope_target` refuses to write one.
"""

import os
import shutil

from src.server import discovery
from src.server.paths import (
    CAMPAIGNS_DIR,
    atomic_write_text,
    campaign_dir_path,
    clean_library_name,
    is_campaign_only_library,
    library_folder,
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


def _origin(rel_prefix):
    """Where an entry ended up, derived from the path we actually wrote."""
    return "campaign" if rel_prefix.startswith(f"{CAMPAIGNS_DIR}/") else "global"


def _scope_target(ctx, ref_type, folder, scope):
    """Destination folder + client-visible path prefix for a library scope.

    scope "campaign" targets the request campaign's folder; anything else (the
    default) the shared root. A campaign-only ref type (lore) has no shared root:
    an unspecified scope means campaign, and an EXPLICIT "global" is an error, so
    no global folder is ever created for it. Returns (target_dir, rel_prefix) or
    an (status, payload) error tuple flagged by target_dir=None."""
    if is_campaign_only_library(ref_type):
        if scope == "global":
            return None, (400, {
                "ok": False, "error": f"{ref_type} is campaign-only; no global library"})
        scope = "campaign"
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
        scope = str(body.get("scope") or "")
        content = body["content"]
    except (AttributeError, KeyError, TypeError) as exc:
        return 400, {"ok": False, "error": f"bad request: {exc}"}

    folder = library_folder(ref_type)
    if not folder:
        return 400, {"ok": False, "error": f"unknown library type: {ref_type}"}
    if not name:
        return 400, {"ok": False, "error": "invalid name"}

    target_dir, rel_prefix = _scope_target(ctx, ref_type, folder, scope)
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
    return 200, {"ok": True, "entry": {
        "name": name, "path": f"{rel_prefix}/{filename}", "origin": _origin(rel_prefix)}}


def save_library_file(ctx, query, body):
    """Write a library .md, optionally renaming it in the same operation.

    Takes no client path: the destination is always
    <library folder for `type` and `scope`>/<clean_library_name(name)>.md, so a
    crafted name can never escape the folder.

    `renameFrom` is the entry's CURRENT name. A rename is one operation on
    purpose — the editor's Save is also the rename — and it is ordered so a
    collision changes nothing on disk: the destination is checked FIRST, and only
    then is the content written and the old file removed. A caller whose rename
    is rejected (409) still holds its unsaved model."""
    try:
        ref_type = str(body.get("type") or "item")
        name = clean_library_name(body.get("name"))
        scope = str(body.get("scope") or "")
        content = body["content"]
        rename_from = body.get("renameFrom")
    except (AttributeError, KeyError, TypeError) as exc:
        return 400, {"ok": False, "error": f"bad request: {exc}"}

    folder = library_folder(ref_type)
    if not folder:
        return 400, {"ok": False, "error": f"unknown library type: {ref_type}"}
    if not name:
        return 400, {"ok": False, "error": "invalid name"}

    target_dir, rel_prefix = _scope_target(ctx, ref_type, folder, scope)
    if target_dir is None:
        return rel_prefix
    filename = f"{name}.md"
    target = os.path.realpath(os.path.join(target_dir, filename))

    previous = None
    if rename_from is not None:
        old_name = clean_library_name(rename_from)
        if not old_name:
            return 400, {"ok": False, "error": "invalid renameFrom"}
        previous = os.path.realpath(os.path.join(target_dir, f"{old_name}.md"))
        if previous == target:
            previous = None  # same name after cleaning: a plain save
        elif os.path.exists(target):
            # Reject BEFORE writing anything, so the client keeps its model.
            return 409, {"ok": False, "error": "a page with that name already exists"}

    try:
        os.makedirs(target_dir, exist_ok=True)
        atomic_write_text(target, content)
        if previous and os.path.isfile(previous):
            os.remove(previous)
    except OSError as exc:
        return 500, {"ok": False, "error": str(exc)}

    action = "Renamed" if previous else "Saved"
    print(paint(f"{action}: {os.path.relpath(target, ctx.base_dir)}", GREEN), flush=True)
    return 200, {"ok": True, "entry": {
        "name": name, "path": f"{rel_prefix}/{filename}", "origin": _origin(rel_prefix)}}


def move_library_file(ctx, query, body):
    """Relocate a library .md between the campaign-local and global folders.
    Source is the entry's current `path` (writable-roots + .md guarded);
    destination is derived from `scope` exactly like create_library_file."""
    try:
        ref_type = str(body.get("type") or "item")
        name = clean_library_name(body.get("name"))
        src_rel = body["path"]
        scope = str(body.get("scope") or "")
    except (AttributeError, KeyError, TypeError) as exc:
        return 400, {"ok": False, "error": f"bad request: {exc}"}

    folder = library_folder(ref_type)
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

    target_dir, rel_prefix = _scope_target(ctx, ref_type, folder, scope)
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
    return 200, {"ok": True, "entry": {
        "name": name, "path": f"{rel_prefix}/{filename}", "origin": _origin(rel_prefix)}}
