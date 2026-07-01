#!/usr/bin/env python3
"""RendScroll launch preflight.

Run by launcher.py before the local server starts. This module intentionally
checks only filesystem and launch-time preflight conditions:

  - content/campaigns/*/scenes/ Markdown files can be opened.
  - local Image:/BG: references point to existing files (campaign images/ first,
    then the global images/ root).
  - empty Image:/BG: values are reported because they cannot be checked.

Having no campaigns is a valid state (the app shows a start screen), so it is not
an error here. Parser and semantic Markdown diagnostics live in
src/debug/diagnostics.js, where they use RendScrollParser as the canonical
structural source.
"""

import os
import re
import sys


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Single user-space root; every user folder lives under it (see launcher.USER_DATA_DIR).
USER_DATA_DIR = "content"
CAMPAIGNS_DIR = "campaigns"
SCENES_SUBDIR = "scenes"
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


def card_bg_candidates(raw, campaign_dir):
    """Resolve an Image:/BG: value to candidate root-relative paths to check, in
    precedence order (campaign Images/ first, then the global root).

    External URLs and server-rooted paths are intentionally skipped (empty list).
    `campaign_dir` is the scene's campaign folder relative to ROOT, e.g.
    "content/campaigns/Legacy"."""
    f = raw.strip()
    if not re.search(r"\.[a-z0-9]+$", f, re.I):
        f += ".png"
    if re.match(r"^[a-z]+://", f, re.I) or f.startswith("/"):
        return []
    if re.search(r"[\\/]", f):
        return [f.replace("\\", "/")]
    # Bare name -> campaign images/<name> overrides the global images/<name>.
    return [f"{campaign_dir}/images/{f}", f"{USER_DATA_DIR}/images/{f}"]


def scene_files(issues):
    """Discover every content/campaigns/*/scenes/*.md file for launch preflight.

    Returns [(label, abs_path, campaign_dir)] where label is the repo-relative
    path. No campaigns / no scenes is a valid (empty) state, not an error."""
    root = os.path.join(ROOT, USER_DATA_DIR, CAMPAIGNS_DIR)
    out = []
    try:
        campaigns = sorted(os.listdir(root), key=str.casefold)
    except OSError:
        return out  # content/campaigns/ absent -> nothing to check yet

    for camp in campaigns:
        if camp.startswith("."):
            continue
        scenes_root = os.path.join(root, camp, SCENES_SUBDIR)
        if not os.path.isdir(scenes_root):
            continue
        camp_rel = f"{USER_DATA_DIR}/{CAMPAIGNS_DIR}/{camp}"
        try:
            names = os.listdir(scenes_root)
        except OSError as exc:
            issues.append(("error", CAMPAIGN_LABEL, 1,
                           f"{camp_rel}/{SCENES_SUBDIR} unreadable: {exc}"))
            continue
        files = [n for n in names
                 if not n.startswith(".") and n.lower().endswith(".md")
                 and os.path.isfile(os.path.join(scenes_root, n))]
        for n in sorted(files, key=campaign_sort_key):
            label = f"{camp_rel}/{SCENES_SUBDIR}/{n}"
            out.append((label, os.path.join(scenes_root, n), camp_rel))
    return out


def campaign_sort_key(filename):
    stem, _ = os.path.splitext(filename)
    match = re.match(r"^(\d+)(?:[_\-\s]+.+)?$", stem)
    number = int(match.group(1)) if match else None
    return (
        number is None,
        number if number is not None else 0,
        filename.casefold(),
    )


def collect_asset_refs(name, text, campaign_dir, issues, image_refs):
    for i, raw in enumerate(text.split("\n")):
        line = i + 1

        if EMPTY_IMAGE.match(raw):
            issues.append(("error", name, line, "empty image path"))
            continue

        img = IMAGE_VALUE.match(raw)
        if not img:
            continue

        value = img.group(2).strip()
        candidates = card_bg_candidates(value, campaign_dir)
        if candidates:
            key = tuple(candidates)
            image_refs.setdefault(key, []).append((name, line, value))


def check_images(image_refs, issues):
    for candidates, refs in image_refs.items():
        if any(os.path.exists(os.path.join(ROOT, p)) for p in candidates):
            continue
        shown = candidates[-1]  # the global path is the canonical "missing" target
        for fname, line, value in refs:
            issues.append(("error", fname, line, f"image not found: {value} ({shown})"))


def collect_diagnostics():
    issues = []
    scenes = scene_files(issues)
    files = [label for label, _, _ in scenes]

    image_refs = {}
    for label, fpath, campaign_dir in scenes:
        try:
            with open(fpath, encoding="utf-8") as fh:
                collect_asset_refs(label, fh.read(), campaign_dir, issues, image_refs)
        except OSError as exc:
            issues.append(("error", label, 1, f"failed to load: {exc}"))

    check_images(image_refs, issues)

    errors = sum(1 for x in issues if x[0] == "error")
    warns = sum(1 for x in issues if x[0] == "warn")
    return {
        "files": files,
        "campaign_dir": CAMPAIGNS_DIR,
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
