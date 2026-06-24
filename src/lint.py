#!/usr/bin/env python3
"""RendScroll — render-system diagnostics (PC-console version).

Run by launcher.py at launch. Scans the campaign markdown the same way the app
does and prints colored diagnostics to the terminal, then launcher.py opens the
browser and runs the server. This is a faithful port of the old src/debug.js;
the JS files remain the source of truth for the rules:

  src/renderers/skillChecks.js -> standard skill / ability / spell tables
  src/renderers/cardImage.js   -> Image:/BG: path resolution
  src/files.js                 -> the campaign file list the app loads

Stdlib only. Errors are red, warnings are yellow, all-clear is green.
"""

import os
import re
import sys

# This script lives in src/, so the project root is its parent directory.
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# --- console color (enable ANSI on the Windows console, then define helpers) --
os.system("")  # turns on VT processing so the escape codes render in cmd/conhost
GREEN, YELLOW, RED, DIM, RESET = "\033[92m", "\033[93m", "\033[91m", "\033[90m", "\033[0m"
COLOR_ENABLED = sys.stdout.isatty() and os.environ.get("NO_COLOR") is None


def paint(text, color):
    if not COLOR_ENABLED:
        return text
    return f"{color}{text}{RESET}"


# --- standard-check tables, mirrored from skillChecks.js -----------------------
SC_ABILITY_ALIAS = {
    "str", "strength", "dex", "dexterity", "con", "constitution",
    "int", "intelligence", "wis", "wisdom", "cha", "charisma",
}
SC_SKILLS = {
    "athletics", "acrobatics", "sleight of hand", "stealth", "arcana", "history",
    "investigation", "nature", "religion", "animal handling", "insight", "medicine",
    "perception", "survival", "deception", "intimidation", "performance", "persuasion",
}
SC_SPELL = [
    re.compile(r"^(swd|speak with dead)$"),
    re.compile(r"^(dt|detect thoughts?)$"),
    re.compile(r"^(swa|speak with animals?)$"),
    re.compile(r"detect magic"),
]
SC_PASSIVE = re.compile(r"passive|ilk bak")


def sc_lower(s):
    """Turkish-aware lowercase (İ/I), matching scLower in skillChecks.js."""
    return s.replace("İ", "i").replace("I", "ı").lower()


def is_standard_check(name):
    lname = sc_lower(name)
    key = lname.replace("ı", "i")  # normalize dotless-i back for English lookups
    if any(rx.search(key) for rx in SC_SPELL):
        return True
    if SC_PASSIVE.search(lname):
        return True
    return key in SC_ABILITY_ALIAS or key in SC_SKILLS


# --- image path resolution, mirrored from cardBgUrl in cardImage.js ------------
def card_bg_path(raw):
    """Resolve an Image:/BG: value to a project-root-relative filesystem path,
    or None for absolute urls / rooted paths we don't check on disk."""
    f = raw.strip()
    if not re.search(r"\.[a-z0-9]+$", f, re.I):
        f += ".png"
    if re.match(r"^[a-z]+://", f, re.I) or f.startswith("/"):
        return None  # external url or server-rooted path — skip existence check
    if re.search(r"[\\/]", f):
        return f.replace("\\", "/")
    return "images/" + f


# --- line patterns, mirrored from debug.js -------------------------------------
SECTION_MATCHERS = [
    re.compile(r"npc", re.I),
    re.compile(r"skill check", re.I),
    re.compile(r"^(obje|object|poi)\s*:", re.I),
    re.compile(r"^item\s*:", re.I),
    re.compile(r"^(skill|spell|passive|effect)\s*:", re.I),
    re.compile(r"^sava[şs]\s*:", re.I),
    re.compile(r"^(beklenmedik|unexpected)\s*:", re.I),
    re.compile(r"^std\s*:", re.I),
]
SKILL_ITEM = re.compile(r"^\s*-\s*([^:]+?)\s*:")
DC_LINE = re.compile(r"^\s*>\s*(\d+|F)\b", re.I)
EMPTY_IMAGE = re.compile(r"^\s*(image|bg)\s*:\s*$", re.I)
IMAGE_VALUE = re.compile(r"^\s*(image|bg)\s*:\s*(\S.*)$", re.I)
HEADING = re.compile(r"^###\s+(.+?)\s*$")


def lint_file(name, text, issues, image_refs):
    lines = text.split("\n")

    # 4. Missing "# title".
    if not re.search(r"^#\s+.+$", text, re.M):
        issues.append(("warn", name, 1, "no '# title' — sidebar uses the filename"))

    for i, raw in enumerate(lines):
        line = i + 1

        # 1. Empty image path -> ERROR.
        if EMPTY_IMAGE.match(raw):
            issues.append(("error", name, line, "empty image path"))
            continue

        # 2. Non-empty Image:/BG: -> queue an existence check (skip externals).
        img = IMAGE_VALUE.match(raw)
        if img:
            value = img.group(2).strip()
            path = card_bg_path(value)
            if path is not None:
                image_refs.setdefault(path, []).append((name, line, value))
            continue

        # 3 & 5. Check list items: non-standard name + DC order.
        item = SKILL_ITEM.match(raw)
        if item:
            k = i + 1
            while k < len(lines) and lines[k].strip() == "":
                k += 1
            if k >= len(lines) or not DC_LINE.match(lines[k]):
                continue  # next non-blank line isn't a DC -> not a check

            check = item.group(1).strip()
            if not is_standard_check(check):
                issues.append(("warn", name, line,
                               f'non-standard check "{check}" (misspell or custom?)'))

            prev_dc = None
            for j in range(k, len(lines)):
                if not lines[j].strip().startswith(">"):
                    break
                m = re.match(r"^\s*>\s*(\d+):", lines[j])
                if not m:
                    continue
                dc = int(m.group(1))
                if prev_dc is not None and dc < prev_dc:
                    issues.append(("warn", name, j + 1,
                                   f'"{check}": DC out of order ({prev_dc} -> {dc})'))
                prev_dc = dc
            continue

        # 6. Unknown "### ...:" section type.
        head = HEADING.match(raw)
        if head:
            t = re.sub(r"^_\s*", "", head.group(1))
            if not any(rx.search(t) for rx in SECTION_MATCHERS) and ":" in t:
                issues.append(("warn", name, line, f'unknown section type "### {head.group(1)}"'))


def check_images(image_refs, issues):
    for path, refs in image_refs.items():
        if not os.path.exists(os.path.join(ROOT, path)):
            for fname, line, value in refs:
                issues.append(("error", fname, line, f"image not found: {value} ({path})"))


def load_file_list():
    """Read CAMPAIGN_FILES / CAMPAIGN_DIR from src/files.js so we lint exactly
    what the app loads (showcase.md etc. are skipped if not listed)."""
    src = open(os.path.join(ROOT, "src", "files.js"), encoding="utf-8").read()
    dir_m = re.search(r'CAMPAIGN_DIR\s*=\s*"([^"]+)"', src)
    campaign_dir = dir_m.group(1) if dir_m else "Campaign/"
    block = re.search(r"CAMPAIGN_FILES\s*=\s*\[(.*?)\]", src, re.S)
    files = re.findall(r'"([^"]+\.md)"', block.group(1)) if block else []
    return files, campaign_dir


def collect_diagnostics():
    files, campaign_dir = load_file_list()

    issues = []
    image_refs = {}
    for f in files:
        fpath = os.path.join(ROOT, campaign_dir, f)
        try:
            with open(fpath, encoding="utf-8") as fh:
                lint_file(f, fh.read(), issues, image_refs)
        except OSError as e:
                issues.append(("error", f, 1, f"failed to load: {e}"))
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


def format_issue_message(msg):
    match = re.match(r'non-standard check "(.+)" \(misspell or custom\?\)$', msg)
    if match:
        return f"non-standard check: {match.group(1)}"
    return msg


def print_diagnostics(result, show_banner=True):
    files = result["files"]
    issues = result["issues"]
    errors = result["errors"]
    warns = result["warnings"]

    if show_banner:
        print(paint("=== RendScroll diagnostics ===", GREEN))
    print(paint(f"render diagnostics — scanning {len(files)} files…", DIM))

    if not issues:
        print(paint(f"✓ All good — {len(files)} files, 0 warnings, 0 errors", GREEN))
        return

    for f in files:
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
    return 1 if errors else 0


if __name__ == "__main__":
    # Never let a diagnostics hiccup block the server from starting.
    try:
        sys.exit(main())
    except Exception as e:  # noqa: BLE001
        print(paint(f"RendScroll diagnostics skipped: {e}", DIM), file=sys.stderr)
        sys.exit(0)
