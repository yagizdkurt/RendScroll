"""Scene/library file endpoints: list scenes, create scene, delete file, save file."""

import os

from src.server import discovery
from src.server.paths import (
    CAMPAIGNS_DIR,
    SCENES_SUBDIR,
    atomic_write_text,
    clean_campaign_title,
    resolve_writable,
    trash_user_path,
)
from src.server.term import GREEN, YELLOW, paint


def campaign_files(ctx, query, body):
    return 200, discovery.discover_campaign_files(ctx.base_dir, ctx.campaign)


def scene_bundle(ctx, query, body):
    return 200, discovery.discover_campaign_files(
        ctx.base_dir, ctx.campaign, with_content=True)


def create_campaign_file(ctx, query, body):
    try:
        title = clean_campaign_title(body.get("title"))
        manifest = str(body.get("manifest") or "").strip()
    except AttributeError as exc:
        return 400, {"ok": False, "error": f"bad request: {exc}"}

    scenes_root = discovery.campaign_scenes_root_if_exists(ctx.base_dir, ctx.campaign)
    if not scenes_root:
        return 400, {"ok": False, "error": "no active campaign"}
    filename = discovery.next_campaign_filename(scenes_root)
    target = os.path.realpath(os.path.join(scenes_root, filename))
    rel_prefix = f"{CAMPAIGNS_DIR}/{ctx.campaign}/{SCENES_SUBDIR}"
    # Optional Scene Manifest block (a "### Manifest" card) sits directly under the
    # title header, so it renders pinned at the top of the scene.
    content = f"# {title}\n\n"
    if manifest:
        content += manifest.rstrip("\n") + "\n"

    try:
        if os.path.exists(target):
            raise FileExistsError("file already exists")
        atomic_write_text(target, content)
    except FileExistsError:
        return 409, {"ok": False, "error": "file already exists"}
    except OSError as exc:
        return 500, {"ok": False, "error": str(exc)}

    print(paint(f"Created: {os.path.relpath(target, ctx.base_dir)}", GREEN), flush=True)
    return 200, {
        "ok": True,
        "entry": discovery.campaign_entry_from_filename(filename, target, rel_prefix),
    }


def delete_campaign_file(ctx, query, body):
    try:
        rel_path = body["path"]
    except (KeyError, TypeError) as exc:
        return 400, {"ok": False, "error": f"bad request: {exc}"}

    target = resolve_writable(ctx.base_dir, rel_path)
    if not target:
        return 403, {"ok": False, "error": "path outside writable roots"}
    if not target.lower().endswith(".md"):
        return 403, {"ok": False, "error": "only .md files"}
    if not os.path.isfile(target):
        return 404, {"ok": False, "error": "file not found"}

    try:
        trashed = trash_user_path(
            ctx.base_dir, target, os.path.splitext(os.path.basename(target))[0])
    except OSError as exc:
        return 500, {"ok": False, "error": str(exc)}
    except ValueError as exc:
        return 403, {"ok": False, "error": str(exc)}

    print(paint(f"Moved to trash: {os.path.relpath(target, ctx.base_dir)} -> {trashed}", YELLOW), flush=True)
    return 200, {"ok": True, "trashed": trashed}


def save_file(ctx, query, body):
    # The editor saves scene markdown back to disk via POST /__save.
    try:
        rel_path = body["path"]
        content = body["content"]
    except (KeyError, TypeError) as exc:
        return 400, {"ok": False, "error": f"bad request: {exc}"}

    # Path guard: resolve under the served base dir and require the file to
    # live inside a writable root (campaigns/ or a global library folder, all
    # under content/). Rejects "..", absolute paths, and anything escaping the
    # project.
    target = resolve_writable(ctx.base_dir, rel_path)
    if not target:
        return 403, {"ok": False, "error": "path outside writable roots"}
    if not target.lower().endswith(".md"):
        return 403, {"ok": False, "error": "only .md files"}

    try:
        atomic_write_text(target, content)
    except OSError as exc:
        return 500, {"ok": False, "error": str(exc)}

    print(paint(f"Saved: {os.path.relpath(target, ctx.base_dir)}", GREEN), flush=True)
    return 200, {"ok": True}
