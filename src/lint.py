#!/usr/bin/env python3
"""RendScroll launch preflight.

Run by launcher.py before the local server starts. This module intentionally
checks only filesystem and launch-time preflight conditions:

  - Campaign/ exists and contains discoverable Markdown files.
  - Campaign Markdown files can be opened.
  - local Image:/BG: references point to existing files.
  - empty Image:/BG: values are reported because they cannot be checked.

Parser and semantic Markdown diagnostics live in src/debug/diagnostics.js, where
they use RendScrollParser as the canonical structural source.
"""

import os
import re
import sys


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CAMPAIGN_DIR = "Campaign"
CAMPAIGN_LABEL = "(campaign)"

os.system("")  # enable ANSI color handling in cmd/conhost
GREEN, YELLOW, RED, DIM, RESET = "\033[92m", "\033[93m", "\033[91m", "\033[90m", "\033[0m"
COLOR_ENABLED = sys.stdout.isatty() and os.environ.get("NO_COLOR") is None

EMPTY_IMAGE = re.compile(r"^\s*(image|bg)\s*:\s*$", re.I)
IMAGE_VALUE = re.compile(r"^\s*(image|bg)\s*:\s*(\S.*)$", re.I)


def paint(text, color):
    if not COLOR_ENABLED:
        return text
    return f"{color}{text}{RESET}"


def card_bg_path(raw):
    """Resolve an Image:/BG: value to a project-root-relative filesystem path.

    External URLs and server-rooted paths are intentionally skipped here. The
    browser debug panel can still probe them, but launch preflight only performs
    authoritative checks for local relative paths.
    """
    f = raw.strip()
    if not re.search(r"\.[a-z0-9]+$", f, re.I):
        f += ".png"
    if re.match(r"^[a-z]+://", f, re.I) or f.startswith("/"):
        return None
    if re.search(r"[\\/]", f):
        return f.replace("\\", "/")
    return "images/" + f


def campaign_sort_key(filename):
    stem, _ = os.path.splitext(filename)
    match = re.match(r"^(\d+)(?:[_\-\s]+.+)?$", stem)
    number = int(match.group(1)) if match else None
    return (
        number is None,
        number if number is not None else 0,
        filename.casefold(),
    )


def load_file_list(issues):
    """Discover top-level Campaign/*.md files for launch preflight."""
    campaign_root = os.path.join(ROOT, CAMPAIGN_DIR)
    if not os.path.isdir(campaign_root):
        issues.append(("error", CAMPAIGN_LABEL, 1, f"Campaign folder not found: {CAMPAIGN_DIR}"))
        return [], CAMPAIGN_DIR

    try:
        names = os.listdir(campaign_root)
    except OSError as exc:
        issues.append(("error", CAMPAIGN_LABEL, 1, f"Campaign folder unreadable: {exc}"))
        return [], CAMPAIGN_DIR

    files = [
        name for name in names
        if not name.startswith(".")
        and name.lower().endswith(".md")
        and os.path.isfile(os.path.join(campaign_root, name))
    ]
    files = sorted(files, key=campaign_sort_key)
    if not files:
        issues.append(("error", CAMPAIGN_LABEL, 1, f"no {CAMPAIGN_DIR}/*.md files found"))
    return files, CAMPAIGN_DIR


def collect_asset_refs(name, text, issues, image_refs):
    for i, raw in enumerate(text.split("\n")):
        line = i + 1

        if EMPTY_IMAGE.match(raw):
            issues.append(("error", name, line, "empty image path"))
            continue

        img = IMAGE_VALUE.match(raw)
        if not img:
            continue

        value = img.group(2).strip()
        path = card_bg_path(value)
        if path is not None:
            image_refs.setdefault(path, []).append((name, line, value))


def check_images(image_refs, issues):
    for path, refs in image_refs.items():
        if os.path.exists(os.path.join(ROOT, path)):
            continue
        for fname, line, value in refs:
            issues.append(("error", fname, line, f"image not found: {value} ({path})"))


def collect_diagnostics():
    issues = []
    files, campaign_dir = load_file_list(issues)

    image_refs = {}
    for f in files:
        fpath = os.path.join(ROOT, campaign_dir, f)
        try:
            with open(fpath, encoding="utf-8") as fh:
                collect_asset_refs(f, fh.read(), issues, image_refs)
        except OSError as exc:
            issues.append(("error", f, 1, f"failed to load: {exc}"))

    check_images(image_refs, issues)

    errors = sum(1 for x in issues if x[0] == "error")
    warns = sum(1 for x in issues if x[0] == "warn")
    return {
        "files": files,
        "campaign_dir": campaign_dir,
        "issues": issues,
        "errors": errors,
        "warnings": warns,
    }


def ordered_issue_files(files, issues):
    ordered = list(files)
    for _, filename, _, _ in issues:
        if filename not in ordered:
            ordered.append(filename)
    return ordered


def format_issue_message(msg):
    return msg


def print_diagnostics(result, show_banner=True):
    files = result["files"]
    issues = result["issues"]
    errors = result["errors"]
    warns = result["warnings"]

    if show_banner:
        print(paint("=== RendScroll preflight ===", GREEN))
    print(paint(f"launch preflight — scanning {len(files)} files...", DIM))

    if not issues:
        print(paint(f"✓ All good — {len(files)} files, 0 warnings, 0 errors", GREEN))
        return

    for f in ordered_issue_files(files, issues):
        mine = sorted((x for x in issues if x[1] == f), key=lambda x: x[2])
        if not mine:
            continue
        print(paint(f, "\033[97m"))
        for level, _, line, msg in mine:
            icon, color = ("✖", RED) if level == "error" else ("⚠", YELLOW)
            print(paint(f"  {icon} L{line}  {format_issue_message(msg)}", color))

    print(paint(f"{errors} error(s)", RED) + paint(" · ", DIM) + paint(f"{warns} warning(s)", YELLOW))


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    show_banner = "--no-banner" not in argv
    result = collect_diagnostics()
    print_diagnostics(result, show_banner=show_banner)
    return 1 if result["errors"] else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001
        print(paint(f"RendScroll preflight skipped: {exc}", DIM), file=sys.stderr)
        sys.exit(0)
