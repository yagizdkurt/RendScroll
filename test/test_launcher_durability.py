"""Durability tests for the server's write paths and endpoint functions.

Endpoints are plain functions (src/server/endpoints_*) called with an explicit
Ctx(base_dir, campaign) — no HTTP handler or chdir needed. Patches of os.replace
and time.strftime hit the real modules (process-global); each test restores them
in a finally block, and unittest runs serially, so this is safe.
"""

import json
import os
import shutil
import tempfile
import time
import unittest

from src.server import (
    endpoints_assets,
    endpoints_campaigns,
    endpoints_files,
    endpoints_options,
    endpoints_updates,
    discovery,
    paths,
    state,
)
from src.server.routes import Ctx


def write(path, content=""):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(content)


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


class LauncherDurabilityTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="rs-durability-")
        self.saved_campaign = state.get_active_campaign()
        state.set_active_campaign(None)

    def tearDown(self):
        state.set_active_campaign(self.saved_campaign)
        shutil.rmtree(self.tmp, ignore_errors=True)

    def ctx(self, campaign=None):
        return Ctx(base_dir=self.tmp, campaign=campaign)

    def test_atomic_write_preserves_old_file_when_replace_fails(self):
        target = os.path.join(self.tmp, "content", "items", "Scene.md")
        write(target, "old")
        original_replace = os.replace

        def fail_replace(src, dst):
            raise OSError("replace failed")

        try:
            os.replace = fail_replace
            with self.assertRaises(OSError):
                paths.atomic_write_text(target, "new")
        finally:
            os.replace = original_replace

        self.assertEqual(read(target), "old")
        self.assertFalse(os.path.exists(target + ".tmp"))

    def test_save_options_writes_valid_json(self):
        status, payload = endpoints_options.save_options(
            self.ctx(), {}, {"theme": "dark", "size": 14})

        self.assertEqual(status, 200)
        target = os.path.join(self.tmp, "content", ".sys", "renderer-options.json")
        self.assertEqual(json.loads(read(target)), {"theme": "dark", "size": 14})

    def test_campaign_file_delete_moves_markdown_to_trash(self):
        target = os.path.join(self.tmp, "content", "items", "Fresh.md")
        write(target, "### Item: Fresh\n")

        status, payload = endpoints_files.delete_campaign_file(
            self.ctx(), {}, {"path": "items/Fresh.md"})

        self.assertEqual(status, 200)
        self.assertTrue(payload["ok"])
        self.assertTrue(payload["trashed"].startswith(".trash/"))
        self.assertFalse(os.path.exists(target))
        self.assertEqual(read(os.path.join(self.tmp, "content", payload["trashed"])), "### Item: Fresh\n")

    def test_campaign_delete_moves_folder_to_trash_and_clears_active_campaign(self):
        campaign = os.path.join(self.tmp, "content", "campaigns", "Legacy")
        write(os.path.join(campaign, "scenes", "1.md"), "# One\n")
        write(os.path.join(campaign, "campaign.json"), "{}\n")
        state.set_active_campaign("Legacy")

        status, payload = endpoints_campaigns.delete_campaign(
            self.ctx(), {}, {"name": "Legacy"})

        self.assertEqual(status, 200)
        self.assertTrue(payload["ok"])
        self.assertIsNone(state.get_active_campaign())
        self.assertFalse(os.path.exists(campaign))
        self.assertTrue(os.path.isdir(os.path.join(self.tmp, "content", payload["trashed"])))
        self.assertTrue(os.path.isfile(os.path.join(self.tmp, "content", payload["trashed"], "scenes", "1.md")))

    def test_trash_path_collision_gets_unique_destination(self):
        target = os.path.join(self.tmp, "content", "items", "A.md")
        write(target, "new")
        write(os.path.join(self.tmp, "content", ".trash", "20200101-000000-A", "A.md"), "old")
        original_strftime = time.strftime

        try:
            time.strftime = lambda fmt, when=None: "20200101-000000"
            trashed = paths.trash_user_path(self.tmp, target, "A")
        finally:
            time.strftime = original_strftime

        self.assertEqual(trashed, ".trash/20200101-000000-A-2/A.md")
        self.assertEqual(read(os.path.join(self.tmp, "content", trashed)), "new")

    def test_begin_update_rejects_manual_update_required(self):
        original_status = state.update_status_snapshot()
        original_progress = state.update_progress_snapshot()

        try:
            state.set_update_status({
                "state": "update_available",
                "current_version": "1.4.0",
                "latest_version": "1.4.1",
                "manual_update_required": True,
            })

            error = endpoints_updates.begin_update(self.tmp)

            self.assertEqual(error, "automatic updates are not supported for this version")
            self.assertFalse(state.update_progress_snapshot()["active"])
        finally:
            state.set_update_status(original_status)
            with state.UPDATE_PROGRESS_LOCK:
                state.UPDATE_PROGRESS.clear()
                state.UPDATE_PROGRESS.update(original_progress)

    def test_assets_endpoint_merges_campaign_first_and_reports_shadows(self):
        write(os.path.join(self.tmp, "content", "images", "shared.png"), "global")
        write(os.path.join(self.tmp, "content", "images", "global.jpg"), "global")
        write(os.path.join(self.tmp, "content", "images", "notes.txt"), "ignored")
        write(os.path.join(self.tmp, "content", "campaigns", "Legacy", "scenes", "1.md"), "# One\n")
        write(os.path.join(self.tmp, "content", "campaigns", "Legacy", "images", "shared.png"), "campaign")
        write(os.path.join(self.tmp, "content", "campaigns", "Legacy", "images", "nested", "map.webp"), "campaign")

        status, payload = endpoints_assets.list_assets(
            self.ctx("Legacy"), {"type": "images"}, None)

        self.assertEqual(status, 200)
        names = [entry["name"] for entry in payload]
        self.assertEqual(names, ["global", "nested/map", "shared"])
        shared = next(entry for entry in payload if entry["name"] == "shared")
        self.assertEqual(shared["origin"], "campaign")
        self.assertEqual(shared["path"], "campaigns/Legacy/images/shared.png")
        self.assertEqual(shared["shadows"], ["images/shared.png"])
        self.assertNotIn("notes", names)

    def test_assets_campaign_scope_requires_existing_folder(self):
        write(os.path.join(self.tmp, "content", "campaigns", "Legacy", "scenes", "1.md"), "# One\n")

        status, _ = endpoints_assets.list_assets(
            self.ctx("Legacy"), {"type": "audio", "scope": "campaign"}, None)

        self.assertEqual(status, 404)

    def test_pick_asset_converts_root_and_nested_values(self):
        write(os.path.join(self.tmp, "content", "audio", "theme.mp3"), "audio")
        write(os.path.join(self.tmp, "content", "audio", "nested", "hit.ogg"), "audio")

        self.assertEqual(
            discovery.asset_value_from_path(
                self.tmp,
                "audio",
                "global",
                os.path.join(self.tmp, "content", "audio", "theme.mp3"),
                campaign=None,
            )["value"],
            "theme",
        )
        self.assertEqual(
            discovery.asset_value_from_path(
                self.tmp,
                "audio",
                "global",
                os.path.join(self.tmp, "content", "audio", "nested", "hit.ogg"),
                campaign=None,
            )["value"],
            "/audio/nested/hit.ogg",
        )

    def test_pick_asset_endpoint_uses_stubbed_picker_and_rejects_outside_root(self):
        write(os.path.join(self.tmp, "content", "images", "portrait.png"), "image")
        write(os.path.join(self.tmp, "outside.png"), "image")
        original_picker = endpoints_assets.native_pick_asset_file

        try:
            endpoints_assets.native_pick_asset_file = (
                lambda root, asset_type: os.path.join(root, "portrait.png"))
            status, payload = endpoints_assets.pick_asset(
                self.ctx(), {}, {"type": "images", "scope": "global"})
            self.assertEqual(status, 200)
            self.assertEqual(payload["value"], "portrait")
            self.assertEqual(payload["path"], "images/portrait.png")

            endpoints_assets.native_pick_asset_file = (
                lambda root, asset_type: os.path.join(self.tmp, "outside.png"))
            status, _ = endpoints_assets.pick_asset(
                self.ctx(), {}, {"type": "images", "scope": "global"})
            self.assertEqual(status, 403)
        finally:
            endpoints_assets.native_pick_asset_file = original_picker


if __name__ == "__main__":
    unittest.main()
