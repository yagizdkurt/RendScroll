"""Campaign lifecycle endpoints: list, select, create, import (.zip), delete."""

import io
import os
import shutil
import zipfile

from src.server import discovery, state
from src.server.paths import (
    active_campaign_state_path,
    atomic_write_json,
    CAMPAIGNS_DIR,
    SCENES_SUBDIR,
    campaign_dir_path,
    campaign_scenes_root,
    clean_campaign_name,
    clean_campaign_title,
    read_json_file,
    trash_user_path,
    user_root,
)
from src.server.term import GREEN, YELLOW, paint


def _persist_active_campaign(base_dir, name):
    atomic_write_json(active_campaign_state_path(base_dir), {
        "version": 1,
        "activeCampaign": name or None,
    })


def active_campaign(ctx, query, body):
    target = active_campaign_state_path(ctx.base_dir)
    persisted = None
    try:
        data = read_json_file(target)
        if data.get("version") == 1:
            name = clean_campaign_name(data.get("activeCampaign"))
            if name and os.path.isdir(campaign_scenes_root(ctx.base_dir, name)):
                persisted = name
            elif data.get("activeCampaign") is None:
                persisted = None
    except OSError:
        persisted = None

    if persisted is not None:
        state.set_active_campaign(persisted)
        return 200, {"ok": True, "name": persisted}
    return 200, {"ok": True, "name": None}


def list_campaigns(ctx, query, body):
    return 200, discovery.discover_campaigns(ctx.base_dir)


def select_campaign(ctx, query, body):
    """Set and persist the default campaign. A null/empty name deselects."""
    try:
        name = clean_campaign_name(body.get("name"))
    except AttributeError as exc:
        return 400, {"ok": False, "error": f"bad request: {exc}"}

    if name is None:
        state.set_active_campaign(None)
        try:
            _persist_active_campaign(ctx.base_dir, None)
        except OSError as exc:
            return 500, {"ok": False, "error": str(exc)}
        return 200, {"ok": True, "name": None}

    if not os.path.isdir(campaign_scenes_root(ctx.base_dir, name)):
        return 404, {"ok": False, "error": "campaign not found"}
    state.set_active_campaign(name)
    try:
        _persist_active_campaign(ctx.base_dir, name)
    except OSError as exc:
        return 500, {"ok": False, "error": str(exc)}
    return 200, {"ok": True, "name": name}


def create_campaign(ctx, query, body):
    """Create an empty campaign: campaigns/<name>/scenes/ + campaign.json."""
    try:
        name = clean_campaign_name(body.get("name"))
        label = clean_campaign_title(body.get("label") or body.get("name"))
    except AttributeError as exc:
        return 400, {"ok": False, "error": f"bad request: {exc}"}
    if not name:
        return 400, {"ok": False, "error": "invalid name"}

    cdir = campaign_dir_path(ctx.base_dir, name)
    if os.path.isdir(cdir):
        return 409, {"ok": False, "error": "campaign already exists"}
    try:
        os.makedirs(campaign_scenes_root(ctx.base_dir, name), exist_ok=False)
        discovery.write_campaign_manifest(ctx.base_dir, name, label)
    except OSError as exc:
        return 500, {"ok": False, "error": str(exc)}

    print(paint(f"Created campaign: {CAMPAIGNS_DIR}/{name}", GREEN), flush=True)
    return 200, {"ok": True, "campaign": {"name": name, "label": label}}


def import_campaign(ctx, query, body):
    """Unpack an exported campaign .zip (single top-level campaign folder) into
    campaigns/<name>/. Guards against zip-slip and requires a scenes/ folder."""
    try:
        zf = zipfile.ZipFile(io.BytesIO(body))
    except (zipfile.BadZipFile, ValueError, TypeError):
        return 400, {"ok": False, "error": "not a valid zip"}

    tops = set()
    for n in zf.namelist():
        norm = n.replace("\\", "/").lstrip("/")
        if norm:
            tops.add(norm.split("/")[0])
    if len(tops) != 1:
        return 400, {"ok": False, "error": "zip must contain one campaign folder"}
    raw_top = next(iter(tops))
    name = clean_campaign_name(raw_top)
    if not name:
        return 400, {"ok": False, "error": "invalid campaign name in zip"}

    base = ctx.base_dir
    # Avoid clobbering an existing campaign — suffix the name.
    if os.path.exists(campaign_dir_path(base, name)):
        i = 2
        while os.path.exists(campaign_dir_path(base, f"{name} ({i})")):
            i += 1
        name = f"{name} ({i})"
    dest_real = os.path.realpath(campaign_dir_path(base, name))
    os.makedirs(os.path.join(user_root(base), CAMPAIGNS_DIR), exist_ok=True)

    try:
        for member in zf.infolist():
            nm = member.filename.replace("\\", "/")
            if nm.endswith("/"):
                continue
            rel = nm.split("/", 1)[1] if "/" in nm else ""  # strip top folder
            if not rel:
                continue
            out_path = os.path.realpath(os.path.join(dest_real, rel))
            try:
                if os.path.commonpath([dest_real, out_path]) != dest_real:
                    continue  # zip-slip — skip
            except ValueError:
                continue
            os.makedirs(os.path.dirname(out_path), exist_ok=True)
            with zf.open(member) as src, open(out_path, "wb") as dst:
                shutil.copyfileobj(src, dst)
    except OSError as exc:
        shutil.rmtree(dest_real, ignore_errors=True)
        return 500, {"ok": False, "error": str(exc)}

    if not os.path.isdir(os.path.join(dest_real, SCENES_SUBDIR)):
        shutil.rmtree(dest_real, ignore_errors=True)
        return 400, {"ok": False, "error": "zip is missing a scenes/ folder"}
    manifest = discovery.read_campaign_manifest(base, name)
    label = manifest.get("label") or manifest.get("name") or name
    if not os.path.isfile(os.path.join(dest_real, "campaign.json")):
        discovery.write_campaign_manifest(base, name, label)

    print(paint(f"Imported campaign: {CAMPAIGNS_DIR}/{name}", GREEN), flush=True)
    return 200, {"ok": True, "campaign": {"name": name, "label": label}}


def delete_campaign(ctx, query, body):
    """Move a whole campaign folder to content/.trash. Guarded to stay inside campaigns/."""
    try:
        name = clean_campaign_name(body.get("name"))
    except AttributeError as exc:
        return 400, {"ok": False, "error": f"bad request: {exc}"}
    if not name:
        return 400, {"ok": False, "error": "invalid name"}

    base = ctx.base_dir
    target = os.path.realpath(campaign_dir_path(base, name))
    parent = os.path.realpath(os.path.join(user_root(base), CAMPAIGNS_DIR))
    try:
        if target == parent or os.path.commonpath([parent, target]) != parent:
            return 403, {"ok": False, "error": "outside campaigns/"}
    except ValueError:
        return 403, {"ok": False, "error": "outside campaigns/"}
    if not os.path.isdir(target):
        return 404, {"ok": False, "error": "campaign not found"}
    try:
        trashed = trash_user_path(base, target, name)
    except OSError as exc:
        return 500, {"ok": False, "error": str(exc)}
    except ValueError as exc:
        return 403, {"ok": False, "error": str(exc)}
    state.clear_active_campaign_if(name)
    try:
        current = None
        data = read_json_file(active_campaign_state_path(base))
        if data.get("version") == 1:
            current = clean_campaign_name(data.get("activeCampaign"))
        if current == name:
            _persist_active_campaign(base, None)
    except OSError as exc:
        return 500, {"ok": False, "error": str(exc)}
    print(paint(f"Moved campaign to trash: {CAMPAIGNS_DIR}/{name} -> {trashed}", YELLOW), flush=True)
    return 200, {"ok": True, "trashed": trashed}
