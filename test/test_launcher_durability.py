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


if __name__ == "__main__":
    unittest.main()
