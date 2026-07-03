import io
import json
import os
import shutil
import tempfile
import unittest

import launcher


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
        self.cwd = os.getcwd()
        self.active_campaign = launcher.ACTIVE_CAMPAIGN
        os.chdir(self.tmp)
        launcher.ACTIVE_CAMPAIGN = None

    def tearDown(self):
        launcher.ACTIVE_CAMPAIGN = self.active_campaign
        os.chdir(self.cwd)
        shutil.rmtree(self.tmp, ignore_errors=True)

    def handler(self, path, payload):
        h = object.__new__(launcher.NoCacheHTTPRequestHandler)
        raw = json.dumps(payload).encode("utf-8")
        h.path = path
        h.headers = {"Content-Length": str(len(raw))}
        h.rfile = io.BytesIO(raw)
        h.responses = []

        def send_json(status, body):
            h.responses.append((status, body))

        h._send_json = send_json
        return h

    def get_handler(self, path):
        h = object.__new__(launcher.NoCacheHTTPRequestHandler)
        h.path = path
        h.responses = []

        def send_json(status, body):
            h.responses.append((status, body))

        h._send_json = send_json
        return h

    def test_atomic_write_preserves_old_file_when_replace_fails(self):
        target = os.path.join(self.tmp, "content", "items", "Scene.md")
        write(target, "old")
        original_replace = launcher.os.replace

        def fail_replace(src, dst):
            raise OSError("replace failed")

        try:
            launcher.os.replace = fail_replace
            with self.assertRaises(OSError):
                launcher.atomic_write_text(target, "new")
        finally:
            launcher.os.replace = original_replace

        self.assertEqual(read(target), "old")
        self.assertFalse(os.path.exists(target + ".tmp"))

    def test_save_options_writes_valid_json(self):
        h = self.handler("/__save_options", {"theme": "dark", "size": 14})
        h._save_options()

        self.assertEqual(h.responses[-1][0], 200)
        target = os.path.join(self.tmp, "content", "options.current.json")
        self.assertEqual(json.loads(read(target)), {"theme": "dark", "size": 14})

    def test_campaign_file_delete_moves_markdown_to_trash(self):
        target = os.path.join(self.tmp, "content", "items", "Fresh.md")
        write(target, "### Item: Fresh\n")

        h = self.handler("/__delete_campaign_file", {"path": "items/Fresh.md"})
        h._delete_campaign_file()

        status, payload = h.responses[-1]
        self.assertEqual(status, 200)
        self.assertTrue(payload["ok"])
        self.assertTrue(payload["trashed"].startswith(".trash/"))
        self.assertFalse(os.path.exists(target))
        self.assertEqual(read(os.path.join(self.tmp, "content", payload["trashed"])), "### Item: Fresh\n")

    def test_campaign_delete_moves_folder_to_trash_and_clears_active_campaign(self):
        campaign = os.path.join(self.tmp, "content", "campaigns", "Legacy")
        write(os.path.join(campaign, "scenes", "1.md"), "# One\n")
        write(os.path.join(campaign, "campaign.json"), "{}\n")
        launcher.ACTIVE_CAMPAIGN = "Legacy"

        h = self.handler("/__delete_campaign", {"name": "Legacy"})
        h._delete_campaign()

        status, payload = h.responses[-1]
        self.assertEqual(status, 200)
        self.assertTrue(payload["ok"])
        self.assertIsNone(launcher.ACTIVE_CAMPAIGN)
        self.assertFalse(os.path.exists(campaign))
        self.assertTrue(os.path.isdir(os.path.join(self.tmp, "content", payload["trashed"])))
        self.assertTrue(os.path.isfile(os.path.join(self.tmp, "content", payload["trashed"], "scenes", "1.md")))

    def test_trash_path_collision_gets_unique_destination(self):
        target = os.path.join(self.tmp, "content", "items", "A.md")
        write(target, "new")
        write(os.path.join(self.tmp, "content", ".trash", "20200101-000000-A", "A.md"), "old")
        original_strftime = launcher.time.strftime

        try:
            launcher.time.strftime = lambda fmt, when=None: "20200101-000000"
            trashed = launcher.trash_user_path(self.tmp, target, "A")
        finally:
            launcher.time.strftime = original_strftime

        self.assertEqual(trashed, ".trash/20200101-000000-A-2/A.md")
        self.assertEqual(read(os.path.join(self.tmp, "content", trashed)), "new")

    def test_begin_update_rejects_manual_update_required(self):
        original_status = launcher.update_status_snapshot()
        original_progress = launcher.update_progress_snapshot()

        try:
            launcher.set_update_status({
                "state": "update_available",
                "current_version": "1.4.0",
                "latest_version": "1.4.1",
                "manual_update_required": True,
            })

            error = launcher.begin_update(self.tmp)

            self.assertEqual(error, "automatic updates are not supported for this version")
            self.assertFalse(launcher.update_progress_snapshot()["active"])
        finally:
            launcher.set_update_status(original_status)
            with launcher.UPDATE_PROGRESS_LOCK:
                launcher.UPDATE_PROGRESS.clear()
                launcher.UPDATE_PROGRESS.update(original_progress)

    def test_assets_endpoint_merges_campaign_first_and_reports_shadows(self):
        write(os.path.join(self.tmp, "content", "images", "shared.png"), "global")
        write(os.path.join(self.tmp, "content", "images", "global.jpg"), "global")
        write(os.path.join(self.tmp, "content", "images", "notes.txt"), "ignored")
        write(os.path.join(self.tmp, "content", "campaigns", "Legacy", "scenes", "1.md"), "# One\n")
        write(os.path.join(self.tmp, "content", "campaigns", "Legacy", "images", "shared.png"), "campaign")
        write(os.path.join(self.tmp, "content", "campaigns", "Legacy", "images", "nested", "map.webp"), "campaign")
        launcher.ACTIVE_CAMPAIGN = "Legacy"

        h = self.get_handler("/__assets?type=images")
        h._assets()

        status, payload = h.responses[-1]
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
        launcher.ACTIVE_CAMPAIGN = "Legacy"

        h = self.get_handler("/__assets?type=audio&scope=campaign")
        h._assets()

        self.assertEqual(h.responses[-1][0], 404)

    def test_pick_asset_converts_root_and_nested_values(self):
        write(os.path.join(self.tmp, "content", "audio", "theme.mp3"), "audio")
        write(os.path.join(self.tmp, "content", "audio", "nested", "hit.ogg"), "audio")

        self.assertEqual(
            launcher.asset_value_from_path(
                self.tmp,
                "audio",
                "global",
                os.path.join(self.tmp, "content", "audio", "theme.mp3"),
            )["value"],
            "theme",
        )
        self.assertEqual(
            launcher.asset_value_from_path(
                self.tmp,
                "audio",
                "global",
                os.path.join(self.tmp, "content", "audio", "nested", "hit.ogg"),
            )["value"],
            "/audio/nested/hit.ogg",
        )

    def test_pick_asset_endpoint_uses_stubbed_picker_and_rejects_outside_root(self):
        write(os.path.join(self.tmp, "content", "images", "portrait.png"), "image")
        write(os.path.join(self.tmp, "outside.png"), "image")
        original_picker = launcher.native_pick_asset_file

        try:
            launcher.native_pick_asset_file = lambda root, asset_type: os.path.join(root, "portrait.png")
            h = self.handler("/__pick_asset", {"type": "images", "scope": "global"})
            h._pick_asset()
            self.assertEqual(h.responses[-1][0], 200)
            self.assertEqual(h.responses[-1][1]["value"], "portrait")
            self.assertEqual(h.responses[-1][1]["path"], "images/portrait.png")

            launcher.native_pick_asset_file = lambda root, asset_type: os.path.join(self.tmp, "outside.png")
            h = self.handler("/__pick_asset", {"type": "images", "scope": "global"})
            h._pick_asset()
            self.assertEqual(h.responses[-1][0], 403)
        finally:
            launcher.native_pick_asset_file = original_picker


if __name__ == "__main__":
    unittest.main()
