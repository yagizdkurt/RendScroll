#!/usr/bin/env python3
"""RendScroll launcher.

Runs diagnostics, starts a local HTTP server, opens the renderer, and keeps
the console alive for logs until the user stops it.

The server itself lives in src/server/: paths.py (user-space path model),
state.py (process state), discovery.py (filesystem discovery), endpoints_*.py
(the JSON endpoints as plain functions), and routes.py (route table + request
handler). This file owns only boot: console UI, lint preflight, server/browser
startup, and process lifecycle.
"""

import ctypes
import importlib.util
import json
import os
import shutil
import socketserver
import subprocess
import sys
import tempfile
import threading
import time
import webbrowser

from src.server import endpoints_updates, state, term
from src.server.paths import OPTIONS_CURRENT_FILE, renderer_options_state_path, user_root
from src.server.routes import NoCacheHTTPRequestHandler
from src.server.term import CYAN, DIM, GREEN, RED, YELLOW, paint


HOST = "127.0.0.1"
PORT_START = 8000
PORT_END = 8010


def configure_console():
    os.system("")
    # sys.stdout is None when launched without std handles (e.g. a detached
    # process); degrade to no color instead of crashing before the heartbeat.
    term.set_color_enabled(
        sys.stdout is not None
        and sys.stdout.isatty()
        and os.environ.get("NO_COLOR") is None
    )


def get_base_dir():
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
                print(f"        {paint(f'{icon} L{line:<4} {msg}', color)}", flush=True)
    else:
        print_indented("No issues found.", GREEN)

    print_indented()
    result_color = RED if errors else (YELLOW if warnings else GREEN)
    print_indented(f"Result: {errors} errors, {warnings} warnings", result_color)


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


def _windows_program_candidates(env_names, subpath):
    paths = []
    for env_name in env_names:
        base = os.environ.get(env_name)
        if base:
            paths.append(os.path.join(base, *subpath))
    return paths


def chrome_candidates():
    return _windows_program_candidates(
        ("ProgramFiles", "ProgramFiles(x86)", "LocalAppData"),
        ("Google", "Chrome", "Application", "chrome.exe"))


def edge_candidates():
    return _windows_program_candidates(
        ("ProgramFiles", "ProgramFiles(x86)", "LocalAppData"),
        ("Microsoft", "Edge", "Application", "msedge.exe"))


def firefox_candidates():
    return _windows_program_candidates(
        ("ProgramFiles", "ProgramFiles(x86)"),
        ("Mozilla Firefox", "firefox.exe"))


def configure_chromium_preferences(profile_dir):
    """Seed a temporary Chromium-family profile (Chrome, Edge) with
    app-specific defaults — both browsers use the same Preferences format."""
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


def chromium_launch_args(exe_path, url, profile_dir, screen_size):
    args = [
        exe_path,
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
    if screen_size:
        args.append(f"--window-size={screen_size[0]},{screen_size[1]}")
    return args


def firefox_launch_args(exe_path, url, profile_dir, screen_size):
    # Firefox has no Chromium-style --app mode; it opens a normal window with
    # a throwaway profile. -no-remote keeps it a separate, trackable process
    # even when another Firefox instance is already running.
    return [exe_path, "-profile", profile_dir, "-no-remote", "-new-window", url]


# Managed browsers: launched as a tracked child process with an isolated
# temporary profile so closing the window stops the server. Anything else
# (or none installed) falls back to the untracked system default browser.
BROWSER_SPECS = {
    "chrome": {
        "display_name": "Google Chrome",
        "candidates": chrome_candidates,
        "launch_args": chromium_launch_args,
        "configure_profile": configure_chromium_preferences,
        "profile_prefix": "rendscroll-chrome-",
    },
    "edge": {
        "display_name": "Microsoft Edge",
        "candidates": edge_candidates,
        "launch_args": chromium_launch_args,
        "configure_profile": configure_chromium_preferences,
        "profile_prefix": "rendscroll-edge-",
    },
    "firefox": {
        "display_name": "Mozilla Firefox",
        "candidates": firefox_candidates,
        "launch_args": firefox_launch_args,
        "configure_profile": None,
        "profile_prefix": "rendscroll-firefox-",
    },
}

BROWSER_AUTO_ORDER = ["chrome", "edge", "firefox"]

BROWSER_CHOICES = ("auto", "default") + tuple(BROWSER_SPECS)


def find_browser_executable(spec_id):
    for path in BROWSER_SPECS[spec_id]["candidates"]():
        if os.path.exists(path):
            return path
    return None


def read_browser_choice(base_dir):
    """The Options UI persists a `browser` key in content/.sys. Legacy
    content/options.current.json remains a read fallback during migration."""
    data = None
    for path in (
            renderer_options_state_path(base_dir),
            os.path.join(user_root(base_dir), OPTIONS_CURRENT_FILE)):
        try:
            with open(path, "r", encoding="utf-8") as fh:
                data = json.load(fh)
            break
        except (OSError, ValueError):
            data = None
    choice = data.get("browser") if isinstance(data, dict) else None
    return choice if choice in BROWSER_CHOICES else "auto"


def launch_managed_browser(spec_id, exe_path, url):
    spec = BROWSER_SPECS[spec_id]
    profile_dir = tempfile.mkdtemp(prefix=spec["profile_prefix"])
    if spec["configure_profile"]:
        spec["configure_profile"](profile_dir)
    args = spec["launch_args"](exe_path, url, profile_dir, get_primary_screen_size())
    process = subprocess.Popen(args)
    return process, profile_dir


def open_browser(url, choice="auto"):
    """Open RendScroll in the requested browser.
    Returns (process, profile_dir, display_name); process/profile_dir are None
    for the untracked default-browser fallback."""
    if choice in BROWSER_SPECS:
        exe_path = find_browser_executable(choice)
        if exe_path:
            process, profile_dir = launch_managed_browser(choice, exe_path, url)
            return process, profile_dir, BROWSER_SPECS[choice]["display_name"]
        print_indented(
            f"{BROWSER_SPECS[choice]['display_name']} was not found; "
            "falling back to the default browser.", YELLOW)
    elif choice != "default":  # "auto" (or anything unexpected)
        for spec_id in BROWSER_AUTO_ORDER:
            exe_path = find_browser_executable(spec_id)
            if exe_path:
                process, profile_dir = launch_managed_browser(spec_id, exe_path, url)
                return process, profile_dir, BROWSER_SPECS[spec_id]["display_name"]

    webbrowser.open(url)
    return None, None, "default browser"


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


def cleanup_browser_profile(profile_dir):
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
    browser_process = None
    browser_profile_dir = None
    browser_closed = False
    try:
        print_section(2, "Starting local server")
        server, port = start_server()
        endpoints_updates.write_launch_heartbeat(os.getcwd())
        endpoints_updates.start_update_check(os.getcwd())
        url = f"http://{HOST}:{port}"
        print_indented("URL: " + paint(url, CYAN))
        print()

        print_section(3, "Opening RendScroll")
        browser_choice = read_browser_choice(os.getcwd())
        browser_process, browser_profile_dir, browser_name = open_browser(url, browser_choice)
        if browser_process is not None:
            print_indented(f"{browser_name} window opened.", GREEN)
        else:
            print_indented("Opened the default browser.", YELLOW)
            print_indented("Default browser windows cannot be tracked. Use Ctrl+C to stop.", YELLOW)

        print()
        print("RendScroll is running.")
        if browser_process is None:
            print("Close this console window or press Ctrl+C to stop the server.")
        else:
            print("Close the browser window or press Ctrl+C to stop.")
        print_divider()

        while True:
            if state.EXIT_REQUESTED.is_set():
                print("Exit requested from RendScroll.")
                if browser_process is not None and browser_process.poll() is None:
                    browser_process.terminate()
                    try:
                        browser_process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        browser_process.kill()
                browser_closed = browser_process is not None
                break
            if browser_process is not None and browser_process.poll() is not None:
                browser_closed = True
                print("Browser window closed.")
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
        cleanup_browser_profile(browser_profile_dir)

    if browser_closed and not state.UPDATE_HANDOFF.is_set():
        pause_goodbye()

    return 0


if __name__ == "__main__":
    sys.exit(main())
