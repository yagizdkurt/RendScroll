"""HTTP routing: the endpoint table, the dispatcher, and the request handler.

Endpoints are plain functions `(ctx, query, body) -> (status, payload)` living in
the endpoints_* modules; `dispatch` is a pure function (no sockets) so the whole
request surface is unit-testable. The handler only parses HTTP, decodes bodies,
serves static files, and writes JSON back.
"""

import http.server
import json
import os
from collections import namedtuple
from urllib.parse import parse_qs, unquote, urlparse

from src.server import (
    endpoints_assets,
    endpoints_campaigns,
    endpoints_export,
    endpoints_files,
    endpoints_library,
    endpoints_options,
    endpoints_scene_graph,
    endpoints_updates,
    state,
)
from src.server.paths import (
    CAMPAIGN_ASSET_DIRS,
    OPTIONS_CURRENT_FILE,
    USER_SPACE_URL_ROOTS,
    campaign_dir_path,
    clean_campaign_name,
    user_root,
)
from src.server.term import DIM, YELLOW, paint

# ctx handed to every endpoint: the app root (launcher chdirs there) and the
# campaign resolved for this request (explicit param, else the server default).
Ctx = namedtuple("Ctx", ["base_dir", "campaign"])

# body: how the request body is decoded before the endpoint sees it —
#   "none" (not read), "json" (parsed object), or "raw" (bytes, e.g. a .zip).
# campaign: whether the route is campaign-scoped, i.e. dispatch resolves
#   ctx.campaign from the explicit `campaign` query/body param with the
#   server default as fallback.
Route = namedtuple("Route", ["fn", "body", "campaign"])

ROUTES = {
    ("GET", "/__update_status"): Route(endpoints_updates.update_status, "none", False),
    ("GET", "/__update_progress"): Route(endpoints_updates.update_progress, "none", False),
    ("GET", "/__campaigns"): Route(endpoints_campaigns.list_campaigns, "none", False),
    ("GET", "/__campaign_files"): Route(endpoints_files.campaign_files, "none", True),
    ("GET", "/__scene_bundle"): Route(endpoints_files.scene_bundle, "none", True),
    ("GET", "/__library_files"): Route(endpoints_library.library_files, "none", True),
    ("GET", "/__library_bundle"): Route(endpoints_library.library_bundle, "none", True),
    ("GET", "/__assets"): Route(endpoints_assets.list_assets, "none", True),
    ("GET", "/__scene_graph"): Route(endpoints_scene_graph.get_scene_graph, "none", True),
    ("POST", "/__rendscroll_exit"): Route(endpoints_updates.rendscroll_exit, "none", False),
    ("POST", "/__begin_update"): Route(endpoints_updates.begin_update_endpoint, "none", False),
    ("POST", "/__select_campaign"): Route(endpoints_campaigns.select_campaign, "json", False),
    ("POST", "/__create_campaign"): Route(endpoints_campaigns.create_campaign, "json", False),
    ("POST", "/__import_campaign"): Route(endpoints_campaigns.import_campaign, "raw", False),
    ("POST", "/__delete_campaign"): Route(endpoints_campaigns.delete_campaign, "json", False),
    ("POST", "/__create_campaign_file"): Route(endpoints_files.create_campaign_file, "json", True),
    ("POST", "/__delete_campaign_file"): Route(endpoints_files.delete_campaign_file, "json", False),
    ("POST", "/__save"): Route(endpoints_files.save_file, "json", False),
    ("POST", "/__create_library_file"): Route(endpoints_library.create_library_file, "json", True),
    ("POST", "/__move_library_file"): Route(endpoints_library.move_library_file, "json", True),
    ("POST", "/__save_options"): Route(endpoints_options.save_options, "json", False),
    ("POST", "/__save_scene_graph"): Route(endpoints_scene_graph.save_scene_graph, "json", True),
    ("POST", "/__pick_asset"): Route(endpoints_assets.pick_asset, "json", True),
    ("POST", "/__export_package"): Route(endpoints_export.export_package, "json", True),
}

# Routes we already warned about relying on the server-default campaign; after the
# stateless refactor a missing param on a campaign-scoped route is a client bug.
_WARNED_DEFAULT_FALLBACK = set()


def _resolve_campaign(method, path, query, body):
    """Resolve the request campaign: explicit `campaign` query/body param wins,
    else the server default. Returns (campaign, error) where error is a ready
    (status, payload) response for an invalid explicit value."""
    explicit = query.get("campaign")
    if explicit is None and isinstance(body, dict):
        explicit = body.pop("campaign", None)
    if explicit is not None and str(explicit).strip():
        cleaned = clean_campaign_name(explicit)
        if cleaned is None:
            return None, (400, {"ok": False, "error": "invalid campaign"})
        return cleaned, None

    fallback = state.get_active_campaign()
    if fallback and (method, path) not in _WARNED_DEFAULT_FALLBACK:
        _WARNED_DEFAULT_FALLBACK.add((method, path))
        print(paint(
            f"campaign param missing on {method} {path}; using server default", DIM),
            flush=True)
    return fallback, None


def dispatch(method, path, query, raw_body, base_dir=None):
    """Route a request to its endpoint function.

    Returns (status, payload) or None when no endpoint owns the path (the handler
    then falls through to static file serving / a 404)."""
    route = ROUTES.get((method, path))
    if route is None:
        return None

    if base_dir is None:
        base_dir = os.getcwd()
    base_dir = os.path.realpath(base_dir)

    if route.body == "json":
        try:
            body = json.loads((raw_body or b"").decode("utf-8"))
        except (ValueError, TypeError, UnicodeDecodeError) as exc:
            return 400, {"ok": False, "error": f"bad request: {exc}"}
    elif route.body == "raw":
        body = raw_body
    else:
        body = None

    campaign = None
    if route.campaign:
        campaign, error = _resolve_campaign(method, path, query, body)
        if error:
            return error

    return route.fn(Ctx(base_dir, campaign), query, body)


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
        """Serve the user-space URL namespace (campaigns/, items/, enemies/,
        images/, audio/, and options.current.json) from under content/ on disk —
        keeping the client URLs stable while the files live in one user-data root.
        Bare /images/<x> and /audio/<x> resolve to the default campaign's local
        folder first, then the global content root (asset URLs come from rendered
        markdown and cannot carry a campaign param, so the server default stays
        authoritative here). Everything else (src/, index.html, …) uses the
        default static mapping off the CWD."""
        default = super().translate_path(path)
        url_path = unquote(urlparse(path).path).replace("\\", "/").lstrip("/")
        if not url_path:
            return default
        top = url_path.split("/", 1)[0].lower()
        base = os.path.realpath(os.getcwd())

        # Assets: the default campaign's local folder wins over the global root.
        name = state.get_active_campaign()
        if name and top in CAMPAIGN_ASSET_DIRS:
            rest = url_path[len(top) + 1:] if "/" in url_path else ""
            camp_root = os.path.realpath(
                os.path.join(campaign_dir_path(base, name), CAMPAIGN_ASSET_DIRS[top]))
            cand = os.path.realpath(os.path.join(camp_root, rest))
            try:
                if os.path.commonpath([camp_root, cand]) == camp_root and os.path.isfile(cand):
                    return cand
            except ValueError:
                pass

        # Any user-space root, or the options file, lives under content/ on disk.
        if top in USER_SPACE_URL_ROOTS or url_path == OPTIONS_CURRENT_FILE:
            uroot = os.path.realpath(user_root(base))
            cand = os.path.realpath(os.path.join(uroot, url_path))
            try:
                if os.path.commonpath([uroot, cand]) == uroot:
                    return cand
            except ValueError:
                pass
        return default

    def _query_dict(self):
        qs = parse_qs(urlparse(self.path).query)
        return {key: values[0] for key, values in qs.items() if values}

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        result = dispatch("GET", path, self._query_dict(), b"")
        if result is None:
            super().do_GET()
            return
        self._send_json(*result)

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        route = ROUTES.get(("POST", path))
        if route is None:
            self._send_json(404, {"ok": False, "error": "unknown endpoint"})
            return

        raw = b""
        if route.body != "none":
            try:
                length = int(self.headers.get("Content-Length", 0))
                raw = self.rfile.read(length)
            except (ValueError, TypeError) as exc:
                self._send_json(400, {"ok": False, "error": f"bad request: {exc}"})
                return

        result = dispatch("POST", path, self._query_dict(), raw)
        self._send_json(*result)

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
