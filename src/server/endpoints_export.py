"""Export Campaign Package endpoint: copy referenced files into exports/ and zip."""

import json
import os
import shutil
import time

from src.server import discovery
from src.server.paths import (
    CAMPAIGN_ASSET_DIRS,
    CAMPAIGNS_DIR,
    EXPORTS_DIR,
    clean_campaign_title,
    clean_library_name,
    resolve_readable,
    user_root,
)
from src.server.term import GREEN, paint


def _export_source(base_dir, rel, campaign):
    """Resolve an export source path to an existing file, falling back to the
    request campaign's images/audio for bare global asset paths (a campaign-local
    image referenced as `kale` resolves to /images/kale.png via translate_path
    but its file lives under campaigns/<name>/images/)."""
    direct = resolve_readable(base_dir, rel)
    if direct and os.path.isfile(direct):
        return direct
    parts = rel.replace("\\", "/").strip("/").split("/")
    if campaign and len(parts) >= 2 and parts[0].lower() in CAMPAIGN_ASSET_DIRS:
        cand = resolve_readable(
            base_dir,
            f"{CAMPAIGNS_DIR}/{campaign}/{parts[0].lower()}/" + "/".join(parts[1:]))
        if cand and os.path.isfile(cand):
            return cand
    return None


def export_package(ctx, query, body):
    # "Export Campaign Package": the client resolves every scene + referenced
    # library item/enemy + image/audio asset (reusing RefLibrary and the
    # card-image rules) and POSTs the flat path list. We copy each accepted
    # path into content/exports/<name>/ under the campaign-folder layout
    # (scenes/, items/, enemies/, images/, audio/), add a campaign.json manifest,
    # then zip it so the archive's single top-level folder is the campaign —
    # ready to drop into another user's campaigns/ (or re-import). Reads are
    # confined to resolve_readable's roots; writes only land under exports/.
    try:
        files = body.get("files")
    except AttributeError as exc:
        return 400, {"ok": False, "error": f"bad request: {exc}"}

    if not isinstance(files, list):
        return 400, {"ok": False, "error": "files must be a list"}

    name = clean_library_name(body.get("name")) or time.strftime("Campaign-%Y%m%d-%H%M%S")
    label = clean_campaign_title(body.get("label") or name)
    base = ctx.base_dir
    uroot = os.path.realpath(user_root(base))
    dest_root = os.path.join(uroot, EXPORTS_DIR, name)

    # Start clean so a re-export with the same name doesn't mix stale files.
    if os.path.isdir(dest_root):
        shutil.rmtree(dest_root, ignore_errors=True)

    copied = 0
    try:
        for rel in files:
            source = _export_source(base, rel, ctx.campaign)
            if not source:
                continue  # skip anything outside the roots or missing
            sub = discovery.export_dest_subpath(os.path.relpath(source, uroot))
            target = os.path.join(dest_root, sub)
            os.makedirs(os.path.dirname(target), exist_ok=True)
            shutil.copy2(source, target)
            copied += 1

        if copied == 0:
            return 400, {"ok": False, "error": "nothing to export"}

        # Manifest so the exported folder is a valid, self-describing campaign.
        os.makedirs(dest_root, exist_ok=True)
        with open(os.path.join(dest_root, "campaign.json"), "w",
                  encoding="utf-8", newline="\n") as fh:
            json.dump({"name": name, "label": label,
                       "created": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                       "schema": 1}, fh, ensure_ascii=False, indent=2)
            fh.write("\n")

        zip_base = os.path.join(uroot, EXPORTS_DIR, name)
        archive = shutil.make_archive(
            zip_base, "zip", root_dir=os.path.join(uroot, EXPORTS_DIR), base_dir=name)
    except OSError as exc:
        return 500, {"ok": False, "error": str(exc)}

    zip_rel = os.path.relpath(archive, base).replace("\\", "/")
    print(paint(f"Exported: {zip_rel} ({copied} files)", GREEN), flush=True)
    return 200, {"ok": True, "name": name, "zip": zip_rel, "copied": copied}
