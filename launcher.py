#!/usr/bin/env python3
"""RendScroll launcher.

Runs diagnostics, starts a local HTTP server, opens the renderer, and keeps
the console alive for logs until the user stops it.
"""

import ctypes
import http.server
import importlib.util
import io
import json
import os
import re
import shutil
import socketserver
import subprocess
import sys
import tempfile
import threading
import time
import webbrowser
import zipfile


HOST = "127.0.0.1"
PORT_START = 8000
PORT_END = 8010
CAMPAIGN_DIR = "Campaign"  # legacy single-campaign root; migrated into Campaigns/Legacy/
# Multi-campaign root. Each child is a self-contained campaign folder with a
# campaign.json manifest, a required Scenes/ subfolder, and optional campaign-local
# resource folders (Items/, Enemies/, Images/, Audio/) that override the global roots.
CAMPAIGNS_DIR = "Campaigns"
SCENES_SUBDIR = "Scenes"
LEGACY_CAMPAIGN_NAME = "Legacy"
# Campaign-local resource folder (capitalized) -> global root folder it overrides.
# Libraries are capitalized in both; assets are capitalized per-campaign but lower
# at the root (matching the existing cardBgUrl/audioSrcUrl helpers).
CAMPAIGN_ASSET_DIRS = {"Images": "images", "Audio": "audio"}
# The campaign selected by the client (POST /__select_campaign). Resolved per request
# for scene/library discovery and for campaign-first asset serving. None = no campaign.
ACTIVE_CAMPAIGN = None
OPTIONS_CURRENT_FILE = "options.current.json"
# Destination root for "Export Campaign Package" zips. Gitignored (the `*` rule).
EXPORTS_DIR = "Exports"
# Reusable reference libraries: a ref type -> the folder its files live in. Items
# and enemies today; npc/monster/location can be added here without touching the
# endpoints.
LIBRARY_DIRS = {"item": "Items", "enemy": "Enemies"}
EXIT_REQUESTED = threading.Event()

GREEN = "\033[92m"
YELLOW = "\033[93m"
RED = "\033[91m"
CYAN = "\033[96m"
DIM = "\033[90m"
RESET = "\033[0m"
COLOR_ENABLED = True


def paint(text, color):
    if not COLOR_ENABLED:
        return text
    return f"{color}{text}{RESET}"


def configure_console():
    global COLOR_ENABLED

    os.system("")
    COLOR_ENABLED = sys.stdout.isatty() and os.environ.get("NO_COLOR") is None


def get_base_dir():
    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))


def print_banner():
    def banner_line(text="", color=None):
        content = f"  {text:<42}"
        if color:
            content = "  " + paint(f"{text:<42}", color)
        print(f"║{content}║", flush=True)

    print("╔════════════════════════════════════════════╗", flush=True)
    banner_line("RendScroll", YELLOW)
    banner_line("Local Campaign Renderer", DIM)
    banner_line("by yagizdkurt", CYAN)
    banner_line()
    banner_line('"Every page hides a deeper room."', DIM)
    print("╚════════════════════════════════════════════╝", flush=True)
    print(flush=True)


def print_section(step, title):
    print(paint(f"[{step}/3] {title}", GREEN), flush=True)


def print_indented(text="", color=None):
    value = paint(text, color) if color else text
    print(f"      {value}", flush=True)


def print_divider():
    print()
    print(paint("────────────────────────────────────────", DIM), flush=True)
    print()


def load_lint_module():
    lint_path = os.path.join("src", "lint.py")
    spec = importlib.util.spec_from_file_location("rendscroll_lint", lint_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"could not load {lint_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def run_lint():
    print_section(1, "Checking campaign files")
    try:
        lint_module = load_lint_module()
        result = lint_module.collect_diagnostics()
    except Exception as exc:  # noqa: BLE001
        print_indented(f"Diagnostics skipped: {exc}", YELLOW)
        print()
        return 0

    print_diagnostics(result)
    print()
    return 1 if result["errors"] else 0


def format_issue_message(msg):
    return msg


def ordered_issue_files(files, issues):
    ordered = list(files)
    for _, filename, _, _ in issues:
        if filename not in ordered:
            ordered.append(filename)
    return ordered


def print_diagnostics(result):
    files = result["files"]
    issues = result["issues"]
    errors = result["errors"]
    warnings = result["warnings"]

    print_indented(f"Scanning {len(files)} markdown files...", DIM)

    if issues:
        print_indented()
        for filename in ordered_issue_files(files, issues):
            file_issues = sorted((x for x in issues if x[1] == filename), key=lambda x: x[2])
            if not file_issues:
                continue
            print_indented(filename)
            for level, _, line, msg in file_issues:
                icon = "✖" if level == "error" else "⚠"
                color = RED if level == "error" else YELLOW
                print(f"        {paint(f'{icon} L{line:<4} {format_issue_message(msg)}', color)}", flush=True)
    else:
        print_indented("No issues found.", GREEN)

    print_indented()
    result_color = RED if errors else (YELLOW if warnings else GREEN)
    print_indented(f"Result: {errors} errors, {warnings} warnings", result_color)


def clean_campaign_name(value):
    """Sanitize a client-supplied campaign id into a folder-safe name.

    Rejects path separators, parent refs, and empties so it can never escape the
    Campaigns/ root. Mirrors clean_library_name."""
    if not isinstance(value, str):
        return None
    name = re.sub(r"\s+", " ", value).strip()
    if not name or name in (".", ".."):
        return None
    if "/" in name or "\\" in name or "\x00" in name:
        return None
    return name[:120]


def campaign_dir_path(base_dir, name):
    return os.path.join(base_dir, CAMPAIGNS_DIR, name)


def campaign_scenes_root(base_dir, name):
    return os.path.join(base_dir, CAMPAIGNS_DIR, name, SCENES_SUBDIR)


def active_campaign_root(base_dir):
    """Absolute Scenes/ folder of the active campaign, or None when none is
    selected or its folder is missing."""
    name = ACTIVE_CAMPAIGN
    if not name:
        return None
    root = campaign_scenes_root(base_dir, name)
    return root if os.path.isdir(root) else None


def read_campaign_manifest(base_dir, name):
    path = os.path.join(campaign_dir_path(base_dir, name), "campaign.json")
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        if isinstance(data, dict):
            return data
    except (OSError, ValueError):
        pass
    return {}


def write_campaign_manifest(base_dir, name, label=None):
    manifest = {
        "name": name,
        "label": label or name,
        "created": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "schema": 1,
    }
    path = os.path.join(campaign_dir_path(base_dir, name), "campaign.json")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    return manifest


def discover_campaigns(base_dir):
    """List every campaign folder (must contain a Scenes/ subfolder) as
    [{name, label}], sorted by label."""
    root = os.path.join(base_dir, CAMPAIGNS_DIR)
    out = []
    try:
        names = os.listdir(root)
    except OSError:
        return out
    for name in names:
        if name.startswith("."):
            continue
        cdir = os.path.join(root, name)
        if not os.path.isdir(cdir) or not os.path.isdir(os.path.join(cdir, SCENES_SUBDIR)):
            continue
        manifest = read_campaign_manifest(base_dir, name)
        label = manifest.get("label") or manifest.get("name") or name
        out.append({"name": name, "label": label})
    out.sort(key=lambda c: str(c["label"]).casefold())
    return out


def export_dest_subpath(rel):
    """Map a repo-relative source path to its place inside an exported campaign
    folder (the campaign-folder layout). Campaign-prefixed paths drop the
    Campaigns/<name>/ prefix; global library/asset folders are normalized into the
    campaign casing (images -> Images, audio -> Audio)."""
    parts = rel.replace("\\", "/").strip("/").split("/")
    if not parts:
        return rel
    low = [p.lower() for p in parts]
    if low[0] == CAMPAIGNS_DIR.lower() and len(parts) >= 3:
        return "/".join(parts[2:])  # Campaigns/<name>/Scenes/x -> Scenes/x
    mapping = {"items": "Items", "enemies": "Enemies", "images": "Images", "audio": "Audio"}
    if low[0] in mapping and len(parts) >= 2:
        return mapping[low[0]] + "/" + "/".join(parts[1:])
    return "/".join(parts)


def migrate_legacy_campaign(base_dir):
    """One-time, idempotent: move root Campaign/*.md into Campaigns/Legacy/Scenes/
    and write its manifest. Leaves global Items/Enemies/images/audio untouched."""
    legacy_src = os.path.join(base_dir, CAMPAIGN_DIR)
    if not os.path.isdir(legacy_src):
        return
    try:
        md = [n for n in os.listdir(legacy_src)
              if n.lower().endswith(".md") and os.path.isfile(os.path.join(legacy_src, n))]
    except OSError:
        return
    if not md:
        return
    dest = campaign_dir_path(base_dir, LEGACY_CAMPAIGN_NAME)
    if os.path.exists(dest):
        return  # already migrated
    scenes = campaign_scenes_root(base_dir, LEGACY_CAMPAIGN_NAME)
    os.makedirs(scenes, exist_ok=True)
    for n in md:
        shutil.move(os.path.join(legacy_src, n), os.path.join(scenes, n))
    write_campaign_manifest(base_dir, LEGACY_CAMPAIGN_NAME, LEGACY_CAMPAIGN_NAME)
    print(paint(f"Migrated {len(md)} scene(s) into "
                f"{CAMPAIGNS_DIR}/{LEGACY_CAMPAIGN_NAME}/{SCENES_SUBDIR}/", GREEN), flush=True)


def markdown_title(path):
    try:
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                match = re.match(r"^#\s+(.+?)\s*$", line)
                if match:
                    return match.group(1).strip()
    except OSError:
        return None
    return None


def campaign_entry_from_filename(filename, full_path, rel_prefix):
    stem, _ = os.path.splitext(filename)
    match = re.match(r"^(\d+)(?:[_\-\s]+(.+))?$", stem)
    number = int(match.group(1)) if match else None
    label_source = match.group(2) if match and match.group(2) else None
    if match and label_source is None:
        label_source = markdown_title(full_path)
    if label_source is None:
        label_source = stem
    label = re.sub(r"[_\-]+", " ", label_source).strip()
    label = re.sub(r"\s+", " ", label) or stem
    return {
        "file": filename,
        "path": f"{rel_prefix}/{filename}",
        "number": number,
        "label": label,
    }


def discover_campaign_files(base_dir):
    """List the active campaign's Scenes/ .md files. Empty when no campaign is
    selected — the front end then shows the start screen."""
    scenes_root = active_campaign_root(base_dir)
    if not scenes_root:
        return []
    rel_prefix = f"{CAMPAIGNS_DIR}/{ACTIVE_CAMPAIGN}/{SCENES_SUBDIR}"
    entries = []
    try:
        names = os.listdir(scenes_root)
    except OSError:
        return entries

    for name in names:
        if name.startswith(".") or not name.lower().endswith(".md"):
            continue
        full_path = os.path.join(scenes_root, name)
        if not os.path.isfile(full_path):
            continue
        entries.append(campaign_entry_from_filename(name, full_path, rel_prefix))

    entries.sort(key=lambda entry: (
        entry["number"] is None,
        entry["number"] if entry["number"] is not None else 0,
        entry["file"].casefold(),
    ))
    return entries


def library_entry_from_filename(folder, filename, origin="global"):
    stem, _ = os.path.splitext(filename)
    return {"name": stem, "path": f"{folder}/{filename}", "origin": origin}


def _library_sources(base_dir, folder):
    """Resolution order for a library folder: active campaign first (wins on a
    filename collision), then the global root. -> [(origin, abs_root, rel_prefix)]."""
    sources = []
    name = ACTIVE_CAMPAIGN
    if name and os.path.isdir(campaign_dir_path(base_dir, name)):
        sources.append((
            "campaign",
            os.path.join(campaign_dir_path(base_dir, name), folder),
            f"{CAMPAIGNS_DIR}/{name}/{folder}",
        ))
    sources.append(("global", os.path.join(base_dir, folder), folder))
    return sources


def discover_library_files(base_dir, ref_type, with_content=False):
    """List (and optionally read) the .md files of a library folder, merging the
    active campaign's folder over the global root.

    Returns [{name, path, origin[, content, shadows]}] sorted by name. A campaign
    file with the same filename as a global one wins; the hidden global path is
    recorded in `shadows` so the debug panel can warn about the override. Unknown
    ref types and missing folders simply contribute nothing."""
    folder = LIBRARY_DIRS.get(ref_type)
    if not folder:
        return []

    seen = {}  # casefolded filename -> entry (first source wins)
    for origin, root, rel_prefix in _library_sources(base_dir, folder):
        try:
            names = os.listdir(root)
        except OSError:
            continue
        for name in names:
            if name.startswith(".") or not name.lower().endswith(".md"):
                continue
            full_path = os.path.join(root, name)
            if not os.path.isfile(full_path):
                continue
            key = name.casefold()
            path = f"{rel_prefix}/{name}"
            if key in seen:
                # A later (global) source shadowed by an earlier (campaign) winner.
                seen[key].setdefault("shadows", []).append(path)
                continue
            entry = {"name": os.path.splitext(name)[0], "path": path, "origin": origin}
            if with_content:
                try:
                    with open(full_path, encoding="utf-8") as fh:
                        entry["content"] = fh.read()
                except OSError:
                    entry["content"] = ""
            seen[key] = entry

    entries = list(seen.values())
    entries.sort(key=lambda e: e["name"].casefold())
    return entries


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


def next_campaign_filename(scenes_root):
    os.makedirs(scenes_root, exist_ok=True)

    next_number = 1
    try:
        names = os.listdir(scenes_root)
    except OSError:
        names = []

    for name in names:
        match = re.match(r"^(\d+)(?:[_\-\s].*)?\.md$", name, re.IGNORECASE)
        if match:
            next_number = max(next_number, int(match.group(1)) + 1)

    while True:
        filename = f"{next_number}.md"
        if not os.path.exists(os.path.join(scenes_root, filename)):
            return filename
        next_number += 1


class NoCacheHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    def _send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def translate_path(self, path):
        """Serve bare asset URLs (/images/<x>, /audio/<x>) from the active
        campaign's Images/Audio folder first, falling back to the global root.
        Everything else uses the default static mapping."""
        default = super().translate_path(path)
        name = ACTIVE_CAMPAIGN
        if not name:
            return default
        from urllib.parse import unquote, urlparse
        url_path = unquote(urlparse(path).path).replace("\\", "/").lstrip("/")
        for camp_folder, root_folder in CAMPAIGN_ASSET_DIRS.items():
            prefix = root_folder + "/"
            if url_path.lower().startswith(prefix):
                rest = url_path[len(prefix):]
                base = os.path.realpath(os.getcwd())
                camp_root = os.path.realpath(
                    os.path.join(campaign_dir_path(base, name), camp_folder))
                cand = os.path.realpath(os.path.join(camp_root, rest))
                try:
                    if os.path.commonpath([camp_root, cand]) == camp_root and os.path.isfile(cand):
                        return cand
                except ValueError:
                    pass
        return default

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/__campaigns":
            self._send_json(200, discover_campaigns(os.getcwd()))
            return

        if path == "/__campaign_files":
            self._send_json(200, discover_campaign_files(os.getcwd()))
            return

        if path == "/__library_files":
            ref_type = self._query_param("type", "item")
            self._send_json(200, discover_library_files(os.getcwd(), ref_type))
            return

        if path == "/__library_bundle":
            ref_type = self._query_param("type", "item")
            self._send_json(200, discover_library_files(os.getcwd(), ref_type, with_content=True))
            return

        super().do_GET()

    def _query_param(self, key, default=None):
        from urllib.parse import urlparse, parse_qs
        qs = parse_qs(urlparse(self.path).query)
        values = qs.get(key)
        return values[0] if values else default

    def do_POST(self):
        path = self.path.split("?", 1)[0]

        if path == "/__rendscroll_exit":
            self._send_json(200, {"ok": True})
            EXIT_REQUESTED.set()
            return

        if path == "/__select_campaign":
            self._select_campaign()
            return

        if path == "/__create_campaign":
            self._create_campaign()
            return

        if path == "/__import_campaign":
            self._import_campaign()
            return

        if path == "/__delete_campaign":
            self._delete_campaign()
            return

        if path == "/__create_campaign_file":
            self._create_campaign_file()
            return

        if path == "/__create_library_file":
            self._create_library_file()
            return

        if path == "/__delete_campaign_file":
            self._delete_campaign_file()
            return

        if path == "/__save":
            self._save_campaign_file()
            return

        if path == "/__save_options":
            self._save_options()
            return

        if path == "/__export_package":
            self._export_package()
            return

        self._send_json(404, {"ok": False, "error": "unknown endpoint"})

    def _read_json_body(self):
        length = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def _select_campaign(self):
        """Set the active campaign (the client persists the choice in localStorage
        and re-asserts it on load). A null/empty name deselects (start screen)."""
        global ACTIVE_CAMPAIGN
        try:
            data = self._read_json_body()
            name = clean_campaign_name(data.get("name"))
        except (ValueError, TypeError) as exc:
            self._send_json(400, {"ok": False, "error": f"bad request: {exc}"})
            return

        if name is None:
            ACTIVE_CAMPAIGN = None
            self._send_json(200, {"ok": True, "name": None})
            return

        base = os.path.realpath(os.getcwd())
        if not os.path.isdir(campaign_scenes_root(base, name)):
            self._send_json(404, {"ok": False, "error": "campaign not found"})
            return
        ACTIVE_CAMPAIGN = name
        self._send_json(200, {"ok": True, "name": name})

    def _create_campaign(self):
        """Create an empty campaign: Campaigns/<name>/Scenes/ + campaign.json."""
        try:
            data = self._read_json_body()
            name = clean_campaign_name(data.get("name"))
            label = clean_campaign_title(data.get("label") or data.get("name"))
        except (ValueError, TypeError) as exc:
            self._send_json(400, {"ok": False, "error": f"bad request: {exc}"})
            return
        if not name:
            self._send_json(400, {"ok": False, "error": "invalid name"})
            return

        base = os.path.realpath(os.getcwd())
        cdir = campaign_dir_path(base, name)
        if os.path.isdir(cdir):
            self._send_json(409, {"ok": False, "error": "campaign already exists"})
            return
        try:
            os.makedirs(campaign_scenes_root(base, name), exist_ok=False)
            write_campaign_manifest(base, name, label)
        except OSError as exc:
            self._send_json(500, {"ok": False, "error": str(exc)})
            return

        print(paint(f"Created campaign: {CAMPAIGNS_DIR}/{name}", GREEN), flush=True)
        self._send_json(200, {"ok": True, "campaign": {"name": name, "label": label}})

    def _import_campaign(self):
        """Unpack an exported campaign .zip (single top-level campaign folder) into
        Campaigns/<name>/. Guards against zip-slip and requires a Scenes/ folder."""
        try:
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length)
            zf = zipfile.ZipFile(io.BytesIO(raw))
        except (ValueError, TypeError) as exc:
            self._send_json(400, {"ok": False, "error": f"bad request: {exc}"})
            return
        except zipfile.BadZipFile:
            self._send_json(400, {"ok": False, "error": "not a valid zip"})
            return

        tops = set()
        for n in zf.namelist():
            norm = n.replace("\\", "/").lstrip("/")
            if norm:
                tops.add(norm.split("/")[0])
        if len(tops) != 1:
            self._send_json(400, {"ok": False, "error": "zip must contain one campaign folder"})
            return
        raw_top = next(iter(tops))
        name = clean_campaign_name(raw_top)
        if not name:
            self._send_json(400, {"ok": False, "error": "invalid campaign name in zip"})
            return

        base = os.path.realpath(os.getcwd())
        # Avoid clobbering an existing campaign — suffix the name.
        if os.path.exists(campaign_dir_path(base, name)):
            i = 2
            while os.path.exists(campaign_dir_path(base, f"{name} ({i})")):
                i += 1
            name = f"{name} ({i})"
        dest_real = os.path.realpath(campaign_dir_path(base, name))
        os.makedirs(os.path.join(base, CAMPAIGNS_DIR), exist_ok=True)

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
            self._send_json(500, {"ok": False, "error": str(exc)})
            return

        if not os.path.isdir(os.path.join(dest_real, SCENES_SUBDIR)):
            shutil.rmtree(dest_real, ignore_errors=True)
            self._send_json(400, {"ok": False, "error": "zip is missing a Scenes/ folder"})
            return
        manifest = read_campaign_manifest(base, name)
        label = manifest.get("label") or manifest.get("name") or name
        if not os.path.isfile(os.path.join(dest_real, "campaign.json")):
            write_campaign_manifest(base, name, label)

        print(paint(f"Imported campaign: {CAMPAIGNS_DIR}/{name}", GREEN), flush=True)
        self._send_json(200, {"ok": True, "campaign": {"name": name, "label": label}})

    def _delete_campaign(self):
        """Remove a whole campaign folder. Guarded to stay inside Campaigns/."""
        global ACTIVE_CAMPAIGN
        try:
            data = self._read_json_body()
            name = clean_campaign_name(data.get("name"))
        except (ValueError, TypeError) as exc:
            self._send_json(400, {"ok": False, "error": f"bad request: {exc}"})
            return
        if not name:
            self._send_json(400, {"ok": False, "error": "invalid name"})
            return

        base = os.path.realpath(os.getcwd())
        target = os.path.realpath(campaign_dir_path(base, name))
        parent = os.path.realpath(os.path.join(base, CAMPAIGNS_DIR))
        try:
            if target == parent or os.path.commonpath([parent, target]) != parent:
                self._send_json(403, {"ok": False, "error": "outside Campaigns/"})
                return
        except ValueError:
            self._send_json(403, {"ok": False, "error": "outside Campaigns/"})
            return
        if not os.path.isdir(target):
            self._send_json(404, {"ok": False, "error": "campaign not found"})
            return
        try:
            shutil.rmtree(target)
        except OSError as exc:
            self._send_json(500, {"ok": False, "error": str(exc)})
            return
        if ACTIVE_CAMPAIGN == name:
            ACTIVE_CAMPAIGN = None
        print(paint(f"Deleted campaign: {CAMPAIGNS_DIR}/{name}", YELLOW), flush=True)
        self._send_json(200, {"ok": True})

    def _create_campaign_file(self):
        try:
            data = self._read_json_body()
            title = clean_campaign_title(data.get("title"))
        except (ValueError, AttributeError, TypeError) as exc:
            self._send_json(400, {"ok": False, "error": f"bad request: {exc}"})
            return

        base = os.path.realpath(os.getcwd())
        scenes_root = active_campaign_root(base)
        if not scenes_root:
            self._send_json(400, {"ok": False, "error": "no active campaign"})
            return
        filename = next_campaign_filename(scenes_root)
        target = os.path.realpath(os.path.join(scenes_root, filename))
        rel_prefix = f"{CAMPAIGNS_DIR}/{ACTIVE_CAMPAIGN}/{SCENES_SUBDIR}"
        content = f"# {title}\n\n"

        try:
            with open(target, "x", encoding="utf-8", newline="\n") as fh:
                fh.write(content)
        except FileExistsError:
            self._send_json(409, {"ok": False, "error": "file already exists"})
            return
        except OSError as exc:
            self._send_json(500, {"ok": False, "error": str(exc)})
            return

        print(paint(f"Created: {os.path.relpath(target, base)}", GREEN), flush=True)
        self._send_json(
            200,
            {
                "ok": True,
                "entry": campaign_entry_from_filename(filename, target, rel_prefix),
            },
        )

    def _create_library_file(self):
        try:
            data = self._read_json_body()
            ref_type = str(data.get("type") or "item")
            name = clean_library_name(data.get("name"))
            scope = str(data.get("scope") or "global")
            content = data["content"]
        except (ValueError, KeyError, TypeError) as exc:
            self._send_json(400, {"ok": False, "error": f"bad request: {exc}"})
            return

        folder = LIBRARY_DIRS.get(ref_type)
        if not folder:
            self._send_json(400, {"ok": False, "error": f"unknown library type: {ref_type}"})
            return
        if not name:
            self._send_json(400, {"ok": False, "error": "invalid name"})
            return

        base = os.path.realpath(os.getcwd())
        # scope "campaign" writes into the active campaign's folder; "global" (the
        # default) into the shared root. The returned path is what the editor saves
        # back to, so origin precedence stays consistent.
        if scope == "campaign":
            if not ACTIVE_CAMPAIGN:
                self._send_json(400, {"ok": False, "error": "no active campaign"})
                return
            target_dir = os.path.join(campaign_dir_path(base, ACTIVE_CAMPAIGN), folder)
            rel_prefix = f"{CAMPAIGNS_DIR}/{ACTIVE_CAMPAIGN}/{folder}"
        else:
            target_dir = os.path.join(base, folder)
            rel_prefix = folder
        os.makedirs(target_dir, exist_ok=True)
        filename = f"{name}.md"
        target = os.path.realpath(os.path.join(target_dir, filename))

        try:
            with open(target, "x", encoding="utf-8", newline="\n") as fh:
                fh.write(content)
        except FileExistsError:
            self._send_json(409, {"ok": False, "error": "item already exists"})
            return
        except OSError as exc:
            self._send_json(500, {"ok": False, "error": str(exc)})
            return

        print(paint(f"Created: {os.path.relpath(target, base)}", GREEN), flush=True)
        origin = "campaign" if scope == "campaign" else "global"
        self._send_json(200, {"ok": True, "entry": {
            "name": name, "path": f"{rel_prefix}/{filename}", "origin": origin}})

    def _resolve_writable(self, rel_path):
        """Resolve `rel_path` to an absolute path only if it stays inside one of
        the writable roots (Campaigns/, legacy Campaign/, + every global library
        folder). Returns the path or None when it escapes them. Shared by save and
        delete. Campaign-local library/scene files live under Campaigns/."""
        base = os.path.realpath(os.getcwd())
        target = os.path.realpath(os.path.join(base, rel_path))
        roots = [CAMPAIGNS_DIR, CAMPAIGN_DIR] + list(LIBRARY_DIRS.values())
        for root in roots:
            root_real = os.path.realpath(os.path.join(base, root))
            try:
                if os.path.commonpath([root_real, target]) == root_real:
                    return target
            except ValueError:
                continue  # different drive on Windows
        return None

    def _resolve_readable(self, rel_path):
        """Resolve `rel_path` to an absolute path only if it stays inside one of
        the readable export roots (Campaigns/, legacy Campaign/, the library
        folders, images/, audio/) or is exactly options.current.json. Returns the
        path or None. Used by the package exporter, which only copies content out."""
        base = os.path.realpath(os.getcwd())
        if not isinstance(rel_path, str) or not rel_path.strip():
            return None
        target = os.path.realpath(os.path.join(base, rel_path))
        if target == os.path.realpath(os.path.join(base, OPTIONS_CURRENT_FILE)):
            return target
        roots = [CAMPAIGNS_DIR, CAMPAIGN_DIR] + list(LIBRARY_DIRS.values()) + ["images", "audio"]
        for root in roots:
            root_real = os.path.realpath(os.path.join(base, root))
            try:
                if os.path.commonpath([root_real, target]) == root_real:
                    return target
            except ValueError:
                continue  # different drive on Windows
        return None

    def _delete_campaign_file(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            data = json.loads(self.rfile.read(length).decode("utf-8"))
            rel_path = data["path"]
        except (ValueError, KeyError, TypeError) as exc:
            self._send_json(400, {"ok": False, "error": f"bad request: {exc}"})
            return

        base = os.path.realpath(os.getcwd())
        target = self._resolve_writable(rel_path)
        if not target:
            self._send_json(403, {"ok": False, "error": "path outside writable roots"})
            return
        if not target.lower().endswith(".md"):
            self._send_json(403, {"ok": False, "error": "only .md files"})
            return
        if not os.path.isfile(target):
            self._send_json(404, {"ok": False, "error": "file not found"})
            return

        try:
            os.remove(target)
        except OSError as exc:
            self._send_json(500, {"ok": False, "error": str(exc)})
            return

        print(paint(f"Deleted: {os.path.relpath(target, base)}", YELLOW), flush=True)
        self._send_json(200, {"ok": True})

    def _save_campaign_file(self):
        # The editor saves scene markdown back to disk via POST /__save.
        if self.path.split("?", 1)[0] != "/__save":
            self._send_json(404, {"ok": False, "error": "unknown endpoint"})
            return

        try:
            length = int(self.headers.get("Content-Length", 0))
            data = json.loads(self.rfile.read(length).decode("utf-8"))
            rel_path = data["path"]
            content = data["content"]
        except (ValueError, KeyError, TypeError) as exc:
            self._send_json(400, {"ok": False, "error": f"bad request: {exc}"})
            return

        # Path guard: resolve under the served base dir and require the file to
        # live inside a writable root (Campaigns/, legacy Campaign/, or a global
        # library folder). Rejects "..", absolute paths, and anything escaping the
        # project. CWD is base_dir (see main()).
        base = os.path.realpath(os.getcwd())
        target = self._resolve_writable(rel_path)
        if not target:
            self._send_json(403, {"ok": False, "error": "path outside writable roots"})
            return
        if not target.lower().endswith(".md"):
            self._send_json(403, {"ok": False, "error": "only .md files"})
            return

        try:
            with open(target, "w", encoding="utf-8", newline="\n") as fh:
                fh.write(content)
        except OSError as exc:
            self._send_json(500, {"ok": False, "error": str(exc)})
            return

        print(paint(f"Saved: {os.path.relpath(target, base)}", GREEN), flush=True)
        self._send_json(200, {"ok": True})

    def _save_options(self):
        # The renderer persists the user's customization choices via
        # POST /__save_options. The target is a fixed top-level file
        # (options.current.json) — no client-supplied path, so there is no
        # traversal surface. The file is gitignored (the .gitignore `*` rule),
        # so personal preferences never land in commits.
        try:
            length = int(self.headers.get("Content-Length", 0))
            data = json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, TypeError) as exc:
            self._send_json(400, {"ok": False, "error": f"bad request: {exc}"})
            return

        if not isinstance(data, dict):
            self._send_json(400, {"ok": False, "error": "expected a JSON object"})
            return

        base = os.path.realpath(os.getcwd())
        target = os.path.join(base, OPTIONS_CURRENT_FILE)
        try:
            with open(target, "w", encoding="utf-8", newline="\n") as fh:
                json.dump(data, fh, ensure_ascii=False, indent=2)
                fh.write("\n")
        except OSError as exc:
            self._send_json(500, {"ok": False, "error": str(exc)})
            return

        print(paint(f"Saved: {OPTIONS_CURRENT_FILE}", GREEN), flush=True)
        self._send_json(200, {"ok": True})

    def _export_source(self, rel):
        """Resolve an export source path to an existing file, falling back to the
        active campaign's Images/Audio for bare global asset paths (a campaign-local
        image referenced as `kale` resolves to /images/kale.png via translate_path
        but its file lives under Campaigns/<active>/Images/)."""
        direct = self._resolve_readable(rel)
        if direct and os.path.isfile(direct):
            return direct
        parts = rel.replace("\\", "/").strip("/").split("/")
        if ACTIVE_CAMPAIGN and len(parts) >= 2 and parts[0].lower() in ("images", "audio"):
            camp_folder = {"images": "Images", "audio": "Audio"}[parts[0].lower()]
            cand = self._resolve_readable(
                f"{CAMPAIGNS_DIR}/{ACTIVE_CAMPAIGN}/{camp_folder}/" + "/".join(parts[1:]))
            if cand and os.path.isfile(cand):
                return cand
        return None

    def _export_package(self):
        # "Export Campaign Package": the client resolves every scene + referenced
        # library item/enemy + image/audio asset (reusing RefLibrary and the
        # card-image rules) and POSTs the flat path list. We copy each accepted
        # path into Exports/<name>/ under the campaign-folder layout (Scenes/,
        # Items/, Enemies/, Images/, Audio/), add a campaign.json manifest, then zip
        # it so the archive's single top-level folder is the campaign — ready to
        # drop into another user's Campaigns/ (or re-import). Reads are confined to
        # _resolve_readable's roots; writes only ever land under Exports/.
        try:
            length = int(self.headers.get("Content-Length", 0))
            data = json.loads(self.rfile.read(length).decode("utf-8"))
            files = data.get("files")
        except (ValueError, AttributeError, TypeError) as exc:
            self._send_json(400, {"ok": False, "error": f"bad request: {exc}"})
            return

        if not isinstance(files, list):
            self._send_json(400, {"ok": False, "error": "files must be a list"})
            return

        name = clean_library_name(data.get("name")) or time.strftime("Campaign-%Y%m%d-%H%M%S")
        label = clean_campaign_title(data.get("label") or name)
        base = os.path.realpath(os.getcwd())
        dest_root = os.path.join(base, EXPORTS_DIR, name)

        # Start clean so a re-export with the same name doesn't mix stale files.
        if os.path.isdir(dest_root):
            shutil.rmtree(dest_root, ignore_errors=True)

        copied = 0
        try:
            for rel in files:
                source = self._export_source(rel)
                if not source:
                    continue  # skip anything outside the roots or missing
                sub = export_dest_subpath(os.path.relpath(source, base))
                target = os.path.join(dest_root, sub)
                os.makedirs(os.path.dirname(target), exist_ok=True)
                shutil.copy2(source, target)
                copied += 1

            if copied == 0:
                self._send_json(400, {"ok": False, "error": "nothing to export"})
                return

            # Manifest so the exported folder is a valid, self-describing campaign.
            os.makedirs(dest_root, exist_ok=True)
            with open(os.path.join(dest_root, "campaign.json"), "w",
                      encoding="utf-8", newline="\n") as fh:
                json.dump({"name": name, "label": label,
                           "created": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                           "schema": 1}, fh, ensure_ascii=False, indent=2)
                fh.write("\n")

            zip_base = os.path.join(base, EXPORTS_DIR, name)
            archive = shutil.make_archive(zip_base, "zip", root_dir=os.path.join(base, EXPORTS_DIR), base_dir=name)
        except OSError as exc:
            self._send_json(500, {"ok": False, "error": str(exc)})
            return

        zip_rel = os.path.relpath(archive, base).replace("\\", "/")
        print(paint(f"Exported: {zip_rel} ({copied} files)", GREEN), flush=True)
        self._send_json(200, {"ok": True, "name": name, "zip": zip_rel, "copied": copied})

    def log_request(self, code="-", size="-"):
        if self.path == "/favicon.ico":
            return

        try:
            status_code = int(code)
        except (TypeError, ValueError):
            status_code = 0

        if status_code >= 400:
            print(paint(f"HTTP {status_code}: {self.command} {self.path}", YELLOW))

    def log_error(self, format, *args):
        return


class RendScrollTCPServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def start_server():
    last_error = None
    for port in range(PORT_START, PORT_END + 1):
        try:
            server = RendScrollTCPServer((HOST, port), NoCacheHTTPRequestHandler)
        except OSError as exc:
            last_error = exc
            continue

        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        return server, port

    raise RuntimeError(f"Could not bind to ports {PORT_START}-{PORT_END}: {last_error}")


def chrome_candidates():
    paths = []
    for env_name in ("ProgramFiles", "ProgramFiles(x86)", "LocalAppData"):
        base = os.environ.get(env_name)
        if base:
            paths.append(os.path.join(base, "Google", "Chrome", "Application", "chrome.exe"))
    return paths


def configure_chrome_preferences(profile_dir):
    """Seed the temporary Chrome profile with app-specific defaults."""
    default_dir = os.path.join(profile_dir, "Default")
    os.makedirs(default_dir, exist_ok=True)

    app_state = {
        "version": 2,
        "selectedDestinationId": "Save as PDF",
        "recentDestinations": [
            {
                "id": "Save as PDF",
                "origin": "local",
                "account": "",
            }
        ],
        "isHeaderFooterEnabled": False,
        "isCssBackgroundEnabled": True,
    }
    preferences = {
        "intl": {
            "accept_languages": "tr,tr-TR,en-US,en",
        },
        "printing": {
            "print_preview_sticky_settings": {
                "appState": json.dumps(app_state, separators=(",", ":")),
            }
        },
        "translate": {
            "enabled": False,
        }
    }

    preferences_path = os.path.join(default_dir, "Preferences")
    with open(preferences_path, "w", encoding="utf-8") as fh:
        json.dump(preferences, fh, separators=(",", ":"))


def get_primary_screen_size():
    if os.name != "nt":
        return None

    try:
        user32 = ctypes.windll.user32
        user32.SetProcessDPIAware()
        width = user32.GetSystemMetrics(0)
        height = user32.GetSystemMetrics(1)
    except (AttributeError, OSError, ValueError):
        return None

    if width <= 0 or height <= 0:
        return None
    return width, height


def open_browser(url):
    for chrome_path in chrome_candidates():
        if os.path.exists(chrome_path):
            profile_dir = tempfile.mkdtemp(prefix="rendscroll-chrome-")
            configure_chrome_preferences(profile_dir)
            chrome_args = [
                chrome_path,
                f"--app={url}",
                f"--user-data-dir={profile_dir}",
                "--no-first-run",
                "--disable-first-run-ui",
                "--disable-translate",
                "--disable-features=Translate",
                "--lang=tr",
                "--start-fullscreen",
                "--window-position=0,0",
            ]
            screen_size = get_primary_screen_size()
            if screen_size:
                chrome_args.append(f"--window-size={screen_size[0]},{screen_size[1]}")

            process = subprocess.Popen(chrome_args)
            return process, profile_dir, "chrome"

    webbrowser.open(url)
    return None, None, "default"


def pause_before_exit():
    try:
        input("Press Enter to exit...")
    except EOFError:
        pass


def pause_goodbye():
    message = "Goodbye. Press any key to close this terminal..."
    if os.name == "nt":
        try:
            import msvcrt

            print(message)
            msvcrt.getch()
            return
        except (ImportError, OSError):
            pass

    try:
        input(message)
    except EOFError:
        pass


def cleanup_chrome_profile(profile_dir):
    if not profile_dir:
        return
    shutil.rmtree(profile_dir, ignore_errors=True)


def shutdown_server(server):
    if server is None:
        return
    server.shutdown()
    server.server_close()
    print(paint("Server stopped.", GREEN))


def main():
    configure_console()
    os.chdir(get_base_dir())
    print_banner()

    migrate_legacy_campaign(os.getcwd())

    lint_code = run_lint()
    if lint_code != 0:
        print(paint("Launch stopped.", RED))
        print("Fix the errors above and run RendScroll again.")
        pause_before_exit()
        return 1

    server = None
    chrome_process = None
    chrome_profile_dir = None
    chrome_closed = False
    try:
        print_section(2, "Starting local server")
        server, port = start_server()
        url = f"http://{HOST}:{port}"
        print_indented("URL: " + paint(url, CYAN))
        print()

        print_section(3, "Opening RendScroll in Chrome")
        chrome_process, chrome_profile_dir, browser_kind = open_browser(url)
        if browser_kind == "chrome":
            print_indented("Chrome app window opened.", GREEN)
        else:
            print_indented("Chrome not found; opened default browser.", YELLOW)
            print_indented("Default browser windows cannot be tracked. Use Ctrl+C to stop.", YELLOW)

        print()
        print("RendScroll is running.")
        if chrome_process is None:
            print("Close this console window or press Ctrl+C to stop the server.")
        else:
            print("Close the Chrome window or press Ctrl+C to stop.")
        print_divider()

        while True:
            if EXIT_REQUESTED.is_set():
                print("Exit requested from RendScroll.")
                if chrome_process is not None and chrome_process.poll() is None:
                    chrome_process.terminate()
                    try:
                        chrome_process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        chrome_process.kill()
                chrome_closed = chrome_process is not None
                break
            if chrome_process is not None and chrome_process.poll() is not None:
                chrome_closed = True
                print("Chrome window closed.")
                break
            time.sleep(1)
    except KeyboardInterrupt:
        print("Stopping RendScroll...")
    except Exception as exc:  # noqa: BLE001
        print(paint(f"RendScroll launcher failed: {exc}", RED))
        pause_before_exit()
        return 1
    finally:
        shutdown_server(server)
        cleanup_chrome_profile(chrome_profile_dir)

    if chrome_closed:
        pause_goodbye()

    return 0


if __name__ == "__main__":
    sys.exit(main())
