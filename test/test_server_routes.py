"""Tests for the route table and the dispatcher's campaign resolution.

The headline stateless-campaign fix: an explicit `campaign` query/body param
must win over the server-default active campaign, so two windows on different
campaigns can no longer read each other's data.
"""

import json
import os
import shutil
import tempfile
import unittest

from src.server import routes, state


def write(path, content=""):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(content)


class RouteTableTests(unittest.TestCase):
    def test_every_route_is_well_formed(self):
        for (method, path), route in routes.ROUTES.items():
            self.assertIn(method, ("GET", "POST"), path)
            self.assertTrue(path.startswith("/__"), path)
            self.assertTrue(callable(route.fn), path)
            self.assertIn(route.body, ("none", "json", "raw"), path)
            self.assertIsInstance(route.campaign, bool, path)

    def test_unknown_path_returns_none(self):
        self.assertIsNone(routes.dispatch("GET", "/__nope", {}, b""))
        self.assertIsNone(routes.dispatch("POST", "/__nope", {}, b""))


class DispatchTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="rs-routes-")
        self.saved_campaign = state.get_active_campaign()
        state.set_active_campaign(None)
        write(os.path.join(self.tmp, "content", "campaigns", "Alpha", "scenes", "1.md"), "# A\n")
        write(os.path.join(self.tmp, "content", "campaigns", "Beta", "scenes", "1.md"), "# B\n")

    def tearDown(self):
        state.set_active_campaign(self.saved_campaign)
        shutil.rmtree(self.tmp, ignore_errors=True)

    def dispatch(self, method, path, query=None, raw_body=b""):
        return routes.dispatch(method, path, query or {}, raw_body, base_dir=self.tmp)

    def test_bad_json_body_is_a_400(self):
        status, payload = self.dispatch("POST", "/__save", raw_body=b"not json")
        self.assertEqual(status, 400)
        self.assertTrue(payload["error"].startswith("bad request:"))

    def test_invalid_explicit_campaign_is_a_400(self):
        for bad in ("..", "a/b", "a\\b"):
            status, payload = self.dispatch(
                "GET", "/__campaign_files", query={"campaign": bad})
            self.assertEqual(status, 400, bad)
            self.assertEqual(payload["error"], "invalid campaign")

    def test_explicit_campaign_overrides_server_default(self):
        state.set_active_campaign("Alpha")

        status, payload = self.dispatch(
            "GET", "/__campaign_files", query={"campaign": "Beta"})

        self.assertEqual(status, 200)
        self.assertEqual([e["path"] for e in payload], ["campaigns/Beta/scenes/1.md"])

    def test_scene_bundle_includes_saved_scene_content(self):
        status, payload = self.dispatch(
            "GET", "/__scene_bundle", query={"campaign": "Beta"})

        self.assertEqual(status, 200)
        self.assertEqual(len(payload), 1)
        self.assertEqual(payload[0]["path"], "campaigns/Beta/scenes/1.md")
        self.assertEqual(payload[0]["content"], "# B\n")

    def test_scene_bundle_missing_campaign_is_empty(self):
        status, payload = self.dispatch("GET", "/__scene_bundle")

        self.assertEqual(status, 200)
        self.assertEqual(payload, [])

    def test_missing_param_falls_back_to_server_default(self):
        state.set_active_campaign("Alpha")

        status, payload = self.dispatch("GET", "/__campaign_files")

        self.assertEqual(status, 200)
        self.assertEqual([e["path"] for e in payload], ["campaigns/Alpha/scenes/1.md"])

    def test_no_param_and_no_default_means_start_screen(self):
        status, payload = self.dispatch("GET", "/__campaign_files")
        self.assertEqual(status, 200)
        self.assertEqual(payload, [])

    def test_body_campaign_param_is_consumed_not_persisted(self):
        # The transport-level campaign field must not leak into the saved graph.
        body = {"version": 1, "nodes": [], "edges": [], "campaign": "Alpha"}
        status, payload = self.dispatch(
            "POST", "/__save_scene_graph", raw_body=json.dumps(body).encode("utf-8"))

        self.assertEqual(status, 200, payload)
        graph_path = os.path.join(self.tmp, "content", "campaigns", "Alpha", "graph.json")
        with open(graph_path, encoding="utf-8") as fh:
            saved = json.load(fh)
        self.assertNotIn("campaign", saved)
        self.assertEqual(saved["version"], 1)

    def test_scene_graph_requires_a_campaign(self):
        status, payload = self.dispatch("GET", "/__scene_graph")
        self.assertEqual(status, 400)
        self.assertEqual(payload["error"], "no active campaign")


if __name__ == "__main__":
    unittest.main()
