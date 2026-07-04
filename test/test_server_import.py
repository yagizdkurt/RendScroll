"""Guard tests for campaign .zip import: zip-slip, structure validation, naming."""

import io
import json
import os
import shutil
import tempfile
import unittest
import zipfile

from src.server import endpoints_campaigns
from src.server.routes import Ctx


def make_zip(members):
    """Build an in-memory zip from {archive_name: content} (dirs end with /)."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, content in members.items():
            zf.writestr(name, content)
    return buf.getvalue()


class ImportCampaignTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="rs-import-")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def ctx(self):
        return Ctx(base_dir=self.tmp, campaign=None)

    def import_zip(self, members):
        return endpoints_campaigns.import_campaign(self.ctx(), {}, make_zip(members))

    def campaign_dir(self, name):
        return os.path.join(self.tmp, "content", "campaigns", name)

    def test_valid_zip_imports_and_synthesizes_manifest(self):
        status, payload = self.import_zip({"Camp/scenes/1.md": "# One\n"})

        self.assertEqual(status, 200)
        self.assertEqual(payload["campaign"]["name"], "Camp")
        self.assertEqual(
            open(os.path.join(self.campaign_dir("Camp"), "scenes", "1.md"), encoding="utf-8").read(),
            "# One\n")
        manifest_path = os.path.join(self.campaign_dir("Camp"), "campaign.json")
        self.assertTrue(os.path.isfile(manifest_path))
        with open(manifest_path, encoding="utf-8") as fh:
            self.assertEqual(json.load(fh)["name"], "Camp")

    def test_zip_slip_member_is_skipped(self):
        status, _ = self.import_zip({
            "Camp/scenes/1.md": "# One\n",
            "Camp/../../evil.md": "pwned",
        })

        self.assertEqual(status, 200)
        # Nothing may land outside campaigns/Camp/.
        self.assertFalse(os.path.exists(os.path.join(self.tmp, "evil.md")))
        self.assertFalse(os.path.exists(os.path.join(self.tmp, "content", "evil.md")))
        self.assertFalse(os.path.exists(os.path.join(self.tmp, "content", "campaigns", "evil.md")))

    def test_multiple_top_level_folders_rejected(self):
        status, payload = self.import_zip({
            "Camp/scenes/1.md": "# One\n",
            "Other/scenes/1.md": "# Two\n",
        })
        self.assertEqual(status, 400)
        self.assertIn("one campaign folder", payload["error"])

    def test_missing_scenes_folder_rejected_and_cleaned_up(self):
        status, payload = self.import_zip({"Camp/notes.md": "# Notes\n"})
        self.assertEqual(status, 400)
        self.assertIn("scenes/", payload["error"])
        self.assertFalse(os.path.exists(self.campaign_dir("Camp")))

    def test_name_collision_gets_numeric_suffix(self):
        os.makedirs(os.path.join(self.campaign_dir("Camp"), "scenes"))

        status, payload = self.import_zip({"Camp/scenes/1.md": "# One\n"})

        self.assertEqual(status, 200)
        self.assertEqual(payload["campaign"]["name"], "Camp (2)")
        self.assertTrue(os.path.isdir(self.campaign_dir("Camp (2)")))

    def test_existing_manifest_is_kept(self):
        status, payload = self.import_zip({
            "Camp/scenes/1.md": "# One\n",
            "Camp/campaign.json": json.dumps({"name": "Camp", "label": "My Camp", "schema": 1}),
        })
        self.assertEqual(status, 200)
        self.assertEqual(payload["campaign"]["label"], "My Camp")

    def test_garbage_bytes_rejected(self):
        status, payload = endpoints_campaigns.import_campaign(self.ctx(), {}, b"not a zip")
        self.assertEqual(status, 400)
        self.assertEqual(payload["error"], "not a valid zip")


if __name__ == "__main__":
    unittest.main()
