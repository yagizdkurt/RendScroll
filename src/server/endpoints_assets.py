"""Asset endpoints: list local images/audio and run the native file picker."""

import subprocess
import sys

from src.server import discovery
from src.server.paths import ASSET_TYPES


def native_pick_asset_file(initial_dir, asset_type):
    """Open a platform native file picker at initial_dir. Tests stub this; errors
    are reported by the endpoint instead of falling back to a wrong folder.

    The HTTP server handles requests on worker threads; Tk is much more reliable
    when the dialog runs in the main thread of a short child process."""
    spec = ASSET_TYPES.get(asset_type)
    if not spec:
        return None
    script = (
        "import sys, tkinter as tk\n"
        "from tkinter import filedialog\n"
        "initialdir, title, patterns = sys.argv[1], sys.argv[2], sys.argv[3]\n"
        "root = tk.Tk()\n"
        "root.withdraw()\n"
        "root.attributes('-topmost', True)\n"
        "try:\n"
        "    path = filedialog.askopenfilename(initialdir=initialdir, title=title, "
        "filetypes=[('Supported assets', patterns), ('All files', '*.*')])\n"
        "    sys.stdout.write(path or '')\n"
        "finally:\n"
        "    root.destroy()\n"
    )
    title = "Choose " + ("image" if asset_type == "images" else "audio")
    patterns = " ".join("*" + ext for ext in sorted(spec["extensions"]))
    result = subprocess.run(
        [sys.executable, "-c", script, initial_dir, title, patterns],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError((result.stderr or result.stdout or "dialog process failed").strip())
    return result.stdout.strip()


def list_assets(ctx, query, body):
    asset_type = query.get("type", "images")
    scope = query.get("scope")
    if asset_type not in ASSET_TYPES:
        return 400, {"ok": False, "error": "unknown asset type"}
    if scope not in (None, "campaign", "global"):
        return 400, {"ok": False, "error": "unknown asset scope"}
    if scope == "campaign" and not discovery.asset_scope_root(
            ctx.base_dir, asset_type, "campaign", ctx.campaign):
        return 404, {"ok": False, "error": "campaign asset folder not found"}
    return 200, discovery.discover_asset_files(ctx.base_dir, asset_type, ctx.campaign, scope)


def pick_asset(ctx, query, body):
    try:
        asset_type = body.get("type", "images")
        scope = body.get("scope", "global")
    except AttributeError as exc:
        return 400, {"ok": False, "error": f"bad request: {exc}"}

    if asset_type not in ASSET_TYPES:
        return 400, {"ok": False, "error": "unknown asset type"}
    if scope not in ("campaign", "global"):
        return 400, {"ok": False, "error": "unknown asset scope"}

    root = discovery.asset_scope_root(ctx.base_dir, asset_type, scope, ctx.campaign)
    if not root:
        return 404, {"ok": False, "error": "asset folder not found"}

    try:
        selected = native_pick_asset_file(root, asset_type)
    except Exception as exc:  # noqa: BLE001 — picker failures must reach the client
        return 500, {"ok": False, "error": "native file picker failed: " + str(exc)}
    if not selected:
        return 200, {"ok": False, "cancelled": True}

    picked = discovery.asset_value_from_path(ctx.base_dir, asset_type, scope, selected, ctx.campaign)
    if not picked:
        return 403, {"ok": False, "error": "selected file is outside the asset folder"}
    picked["ok"] = True
    return 200, picked
