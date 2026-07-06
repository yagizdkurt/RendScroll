"""Filesystem discovery for campaigns, scenes, libraries, and assets.

Stateless by design: every campaign-scoped function takes the campaign name as an
explicit parameter (the request layer resolves it from the query/body param or the
server default). This module must not import src.server.state.
"""

import json
import os
import re
import time

from src.server.paths import (
    ASSET_TYPES,
    CAMPAIGNS_DIR,
    LIBRARY_DIRS,
    SCENES_SUBDIR,
    atomic_write_json,
    campaign_dir_path,
    campaign_scenes_root,
    user_root,
)


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
    atomic_write_json(path, manifest)
    return manifest


def discover_campaigns(base_dir):
    """List every campaign folder (must contain a scenes/ subfolder) as
    [{name, label}], sorted by label."""
    root = os.path.join(user_root(base_dir), CAMPAIGNS_DIR)
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


def campaign_scenes_root_if_exists(base_dir, campaign):
    """Absolute scenes/ folder of the given campaign, or None when no campaign is
    given or its folder is missing."""
    if not campaign:
        return None
    root = campaign_scenes_root(base_dir, campaign)
    return root if os.path.isdir(root) else None


def export_dest_subpath(rel):
    """Map a user-space-relative source path (relative to content/) to its place
    inside an exported campaign folder. Campaign-prefixed paths drop the
    campaigns/<name>/ prefix; global library/asset folders keep their (lowercase)
    names, matching the campaign-folder layout an import expects."""
    parts = rel.replace("\\", "/").strip("/").split("/")
    if not parts:
        return rel
    if parts[0].lower() == CAMPAIGNS_DIR and len(parts) >= 3:
        return "/".join(parts[2:])  # campaigns/<name>/scenes/x -> scenes/x
    return "/".join(parts)


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


def discover_campaign_files(base_dir, campaign, with_content=False):
    """List the given campaign's scenes/ .md files. Empty when no campaign is
    given — the front end then shows the start screen. When with_content is
    true, include the raw markdown content for each scene."""
    scenes_root = campaign_scenes_root_if_exists(base_dir, campaign)
    if not scenes_root:
        return []
    rel_prefix = f"{CAMPAIGNS_DIR}/{campaign}/{SCENES_SUBDIR}"
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
        entry = campaign_entry_from_filename(name, full_path, rel_prefix)
        if with_content:
            try:
                with open(full_path, encoding="utf-8") as fh:
                    entry["content"] = fh.read()
            except OSError:
                entry["content"] = ""
        entries.append(entry)

    entries.sort(key=lambda entry: (
        entry["number"] is None,
        entry["number"] if entry["number"] is not None else 0,
        entry["file"].casefold(),
    ))
    return entries


def _library_sources(base_dir, folder, campaign):
    """Resolution order for a library folder: the given campaign first (wins on a
    filename collision), then the global root. -> [(origin, abs_root, rel_prefix)]."""
    sources = []
    if campaign and os.path.isdir(campaign_dir_path(base_dir, campaign)):
        sources.append((
            "campaign",
            os.path.join(campaign_dir_path(base_dir, campaign), folder),
            f"{CAMPAIGNS_DIR}/{campaign}/{folder}",
        ))
    sources.append(("global", os.path.join(user_root(base_dir), folder), folder))
    return sources


def discover_library_files(base_dir, ref_type, campaign, with_content=False):
    """List (and optionally read) the .md files of a library folder, merging the
    given campaign's folder over the global root.

    Returns [{name, path, origin[, content, shadows]}] sorted by name. A campaign
    file with the same filename as a global one wins; the hidden global path is
    recorded in `shadows` so the debug panel can warn about the override. Unknown
    ref types and missing folders simply contribute nothing."""
    folder = LIBRARY_DIRS.get(ref_type)
    if not folder:
        return []

    seen = {}  # casefolded filename -> entry (first source wins)
    for origin, root, rel_prefix in _library_sources(base_dir, folder, campaign):
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


def _asset_sources(base_dir, asset_type, campaign, scope=None):
    """Resolution order for asset folders. Default is campaign first, then global;
    an explicit scope limits discovery/picking to one root."""
    spec = ASSET_TYPES.get(asset_type)
    if not spec:
        return []
    folder = spec["folder"]
    sources = []

    if scope in (None, "campaign") and campaign and os.path.isdir(campaign_dir_path(base_dir, campaign)):
        sources.append((
            "campaign",
            os.path.join(campaign_dir_path(base_dir, campaign), folder),
            f"{CAMPAIGNS_DIR}/{campaign}/{folder}",
        ))
    if scope in (None, "global"):
        sources.append(("global", os.path.join(user_root(base_dir), folder), folder))
    return sources


def _asset_name_from_rel(rel_path):
    stem, _ = os.path.splitext(rel_path.replace("\\", "/"))
    return stem


def discover_asset_files(base_dir, asset_type, campaign, scope=None):
    """List local image/audio files, campaign-first, with same shadow metadata
    shape as discover_library_files(). Recurses so nested asset folders can be
    selected and inventoried."""
    spec = ASSET_TYPES.get(asset_type)
    if not spec:
        return []

    seen = {}  # casefolded relative asset path -> entry (first source wins)
    for origin, root, rel_prefix in _asset_sources(base_dir, asset_type, campaign, scope):
        try:
            root_names = os.listdir(root)
        except OSError:
            continue
        if not root_names and not os.path.isdir(root):
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if not d.startswith(".")]
            for filename in filenames:
                if filename.startswith("."):
                    continue
                ext = os.path.splitext(filename)[1].lower()
                if ext not in spec["extensions"]:
                    continue
                full_path = os.path.join(dirpath, filename)
                if not os.path.isfile(full_path):
                    continue
                rel = os.path.relpath(full_path, root).replace("\\", "/")
                key = rel.casefold()
                path = f"{rel_prefix}/{rel}"
                if key in seen:
                    seen[key].setdefault("shadows", []).append(path)
                    continue
                seen[key] = {
                    "name": _asset_name_from_rel(rel),
                    "path": path,
                    "origin": origin,
                }

    entries = list(seen.values())
    entries.sort(key=lambda e: e["name"].casefold())
    return entries


def asset_scope_root(base_dir, asset_type, scope, campaign):
    spec = ASSET_TYPES.get(asset_type)
    if not spec:
        return None
    folder = spec["folder"]
    if scope == "campaign":
        if not campaign:
            return None
        root = os.path.join(campaign_dir_path(base_dir, campaign), folder)
    else:
        root = os.path.join(user_root(base_dir), folder)
    root = os.path.realpath(root)
    return root if os.path.isdir(root) else None


def asset_value_from_path(base_dir, asset_type, scope, selected_path, campaign):
    """Convert an absolute selected asset path into the value written into an
    Image/BG/File field. Rejects paths outside the intended asset root."""
    spec = ASSET_TYPES.get(asset_type)
    root = asset_scope_root(base_dir, asset_type, scope, campaign)
    if not spec or not root or not selected_path:
        return None

    selected = os.path.realpath(selected_path)
    try:
        if os.path.commonpath([root, selected]) != root:
            return None
    except ValueError:
        return None
    if not os.path.isfile(selected):
        return None
    ext = os.path.splitext(selected)[1].lower()
    if ext not in spec["extensions"]:
        return None

    rel = os.path.relpath(selected, root).replace("\\", "/")
    folder = spec["folder"]
    default_ext = spec["default_ext"]
    if "/" not in rel:
        stem, rel_ext = os.path.splitext(rel)
        value = stem if rel_ext.lower() == default_ext else rel
    else:
        value = f"/{folder}/{rel}"

    if scope == "campaign" and campaign:
        path = f"{CAMPAIGNS_DIR}/{campaign}/{folder}/{rel}"
        origin = "campaign"
    else:
        path = f"{folder}/{rel}"
        origin = "global"
    return {"value": value, "path": path, "origin": origin}


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


def scene_graph_path(base_dir, name):
    """Per-campaign scene progression graph (nodes/edges the map panel edits)."""
    return os.path.join(campaign_dir_path(base_dir, name), "graph.json")


def session_state_path(base_dir, name):
    """Per-campaign live table state (combat runner, v1)."""
    return os.path.join(campaign_dir_path(base_dir, name), "session.json")


def _scene_graph_ref_ok(value):
    """Scene refs in graph.json are campaign-relative ('scenes/…'). The server
    never opens them as paths, but reject traversal-shaped strings anyway so
    the file stays clean."""
    if not isinstance(value, str) or not value.strip():
        return False
    norm = value.replace("\\", "/")
    return not norm.startswith("/") and ".." not in norm.split("/")


def validate_scene_graph(data):
    """Validate a graph.json payload (version 1). Returns an error string, or
    None when the payload is acceptable to write."""
    if not isinstance(data, dict):
        return "expected a JSON object"
    if data.get("version") != 1:
        return "unsupported graph version"
    nodes = data.get("nodes")
    edges = data.get("edges")
    if not isinstance(nodes, list) or not isinstance(edges, list):
        return "nodes and edges must be lists"
    for node in nodes:
        if not isinstance(node, dict) or not _scene_graph_ref_ok(node.get("scene")):
            return "malformed node entry"
        if not isinstance(node.get("x"), (int, float)) or not isinstance(node.get("y"), (int, float)):
            return "node position must be numeric"
        if isinstance(node.get("x"), bool) or isinstance(node.get("y"), bool):
            return "node position must be numeric"
    for edge in edges:
        if not isinstance(edge, dict):
            return "malformed edge entry"
        if not _scene_graph_ref_ok(edge.get("from")) or not _scene_graph_ref_ok(edge.get("to")):
            return "malformed edge entry"
        if "label" in edge and not isinstance(edge["label"], str):
            return "edge label must be a string"
    return None


def _session_scene_ref_ok(value):
    """Session scene refs are campaign-relative ('scenes/…'). Reject traversal
    shapes so session.json cannot become a path-like dumping ground."""
    if not isinstance(value, str) or not value.strip():
        return False
    norm = value.replace("\\", "/")
    return (
        norm.startswith(f"{SCENES_SUBDIR}/")
        and not norm.startswith("/")
        and ".." not in norm.split("/")
    )


def _session_card_ref_ok(value):
    """Card ids are render-time identifiers like 'combat:ambush' or
    'combat:ambush-2'. They are not paths, so separators and parent refs are
    rejected."""
    if not isinstance(value, str) or not value.strip():
        return False
    return "/" not in value and "\\" not in value and "\x00" not in value and value not in (".", "..")


def validate_session_state(data):
    """Validate a session.json payload (version 1). Returns an error string, or
    None when the payload is acceptable to write. Per-card payloads are mostly
    client-owned; the server only validates the durable envelope and ids."""
    if not isinstance(data, dict):
        return "expected a JSON object"
    if data.get("version") != 1:
        return "unsupported session version"
    scenes = data.get("scenes")
    if not isinstance(scenes, dict):
        return "scenes must be an object"
    for scene, scene_state in scenes.items():
        if not _session_scene_ref_ok(scene):
            return "malformed scene key"
        if not isinstance(scene_state, dict):
            return "malformed scene state"
        cards = scene_state.get("cards")
        if not isinstance(cards, dict):
            return "scene cards must be an object"
        for card_id, card_state in cards.items():
            if not _session_card_ref_ok(card_id):
                return "malformed card key"
            if not isinstance(card_state, dict):
                return "malformed card state"
            if card_state.get("kind") != "combat":
                return "unsupported session card kind"
            if card_state.get("phase") not in ("setup", "active"):
                return "unsupported combat phase"
    return None
