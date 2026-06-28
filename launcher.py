#!/usr/bin/env python3
"""RendScroll launcher.

Runs diagnostics, starts a local HTTP server, opens the renderer, and keeps
the console alive for logs until the user stops it.
"""

import ctypes
import http.server
import importlib.util
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


HOST = "127.0.0.1"
PORT_START = 8000
PORT_END = 8010
CAMPAIGN_DIR = "Campaign"
OPTIONS_CURRENT_FILE = "options.current.json"
# Reusable reference libraries: a ref type -> the folder its files live in. Items
# today; npc/monster/location can be added here without touching the endpoints.
LIBRARY_DIRS = {"item": "Items"}

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


def campaign_entry_from_filename(filename, full_path):
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
        "path": f"{CAMPAIGN_DIR}/{filename}",
        "number": number,
        "label": label,
    }


def discover_campaign_files(base_dir):
    campaign_root = os.path.join(base_dir, CAMPAIGN_DIR)
    entries = []
    try:
        names = os.listdir(campaign_root)
    except OSError:
        return entries

    for name in names:
        if name.startswith(".") or not name.lower().endswith(".md"):
            continue
        full_path = os.path.join(campaign_root, name)
        if not os.path.isfile(full_path):
            continue
        entries.append(campaign_entry_from_filename(name, full_path))

    entries.sort(key=lambda entry: (
        entry["number"] is None,
        entry["number"] if entry["number"] is not None else 0,
        entry["file"].casefold(),
    ))
    return entries


def library_entry_from_filename(folder, filename):
    stem, _ = os.path.splitext(filename)
    return {"name": stem, "path": f"{folder}/{filename}"}


def discover_library_files(base_dir, ref_type, with_content=False):
    """List (and optionally read) the .md files of a library folder.

    Returns [{name, path[, content]}] sorted by name. Unknown ref types and a
    missing folder both return an empty list — the library is simply empty."""
    folder = LIBRARY_DIRS.get(ref_type)
    if not folder:
        return []
    root = os.path.join(base_dir, folder)
    entries = []
    try:
        names = os.listdir(root)
    except OSError:
        return entries

    for name in names:
        if name.startswith(".") or not name.lower().endswith(".md"):
            continue
        full_path = os.path.join(root, name)
        if not os.path.isfile(full_path):
            continue
        entry = library_entry_from_filename(folder, name)
        if with_content:
            try:
                with open(full_path, encoding="utf-8") as fh:
                    entry["content"] = fh.read()
            except OSError:
                entry["content"] = ""
        entries.append(entry)

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


def next_campaign_filename(base_dir):
    campaign_root = os.path.join(base_dir, CAMPAIGN_DIR)
    os.makedirs(campaign_root, exist_ok=True)

    next_number = 1
    try:
        names = os.listdir(campaign_root)
    except OSError:
        names = []

    for name in names:
        match = re.match(r"^(\d+)(?:[_\-\s].*)?\.md$", name, re.IGNORECASE)
        if match:
            next_number = max(next_number, int(match.group(1)) + 1)

    while True:
        filename = f"{next_number}.md"
        if not os.path.exists(os.path.join(campaign_root, filename)):
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

    def do_GET(self):
        path = self.path.split("?", 1)[0]
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

        self._send_json(404, {"ok": False, "error": "unknown endpoint"})

    def _create_campaign_file(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            data = json.loads(self.rfile.read(length).decode("utf-8"))
            title = clean_campaign_title(data.get("title"))
        except (ValueError, AttributeError, TypeError) as exc:
            self._send_json(400, {"ok": False, "error": f"bad request: {exc}"})
            return

        base = os.path.realpath(os.getcwd())
        filename = next_campaign_filename(base)
        target = os.path.realpath(os.path.join(base, CAMPAIGN_DIR, filename))
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
                "entry": campaign_entry_from_filename(filename, target),
            },
        )

    def _create_library_file(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            data = json.loads(self.rfile.read(length).decode("utf-8"))
            ref_type = str(data.get("type") or "item")
            name = clean_library_name(data.get("name"))
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
        os.makedirs(os.path.join(base, folder), exist_ok=True)
        filename = f"{name}.md"
        target = os.path.realpath(os.path.join(base, folder, filename))

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
        self._send_json(200, {"ok": True, "entry": library_entry_from_filename(folder, filename)})

    def _resolve_writable(self, rel_path):
        """Resolve `rel_path` to an absolute path only if it stays inside one of
        the writable roots (Campaign/ + every library folder). Returns the path
        or None when it escapes them. Shared by save and delete."""
        base = os.path.realpath(os.getcwd())
        target = os.path.realpath(os.path.join(base, rel_path))
        roots = [CAMPAIGN_DIR] + list(LIBRARY_DIRS.values())
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
        # live inside a writable root (Campaign/ or a library folder). Rejects
        # "..", absolute paths, and anything escaping the project. CWD is
        # base_dir (see main()).
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
                "--start-maximized",
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
