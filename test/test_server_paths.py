"""Guard tests for the user-space path resolvers that protect user data.

resolve_writable/resolve_readable are the single gate every client-supplied
path passes through before a write (save/delete/move) or an export read.
"""

import os
import shutil
import tempfile
import unittest

from src.server import endpoints_files, paths
from src.server.routes import Ctx


def write(path, content=""):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(content)


class ResolveWritableTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="rs-paths-")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def assert_inside_content(self, resolved):
        content = os.path.realpath(os.path.join(self.tmp, "content"))
        self.assertEqual(os.path.commonpath([content, resolved]), content)

    def test_accepts_campaign_scene_and_library_paths(self):
        for rel in ("campaigns/Legacy/scenes/1.md", "items/Sword.md", "enemies/Goblin.md"):
            resolved = paths.resolve_writable(self.tmp, rel)
            self.assertIsNotNone(resolved, rel)
            self.assert_inside_content(resolved)

    def test_rejects_parent_traversal(self):
        for rel in ("../outside.md", "campaigns/../../outside.md",
                    "items/../../secrets.md", "..\\outside.md"):
            self.assertIsNone(paths.resolve_writable(self.tmp, rel), rel)

    def test_rejects_absolute_paths(self):
        outside = os.path.join(self.tmp, "elsewhere", "x.md")
        self.assertIsNone(paths.resolve_writable(self.tmp, outside))

    def test_rejects_non_writable_roots(self):
        for rel in ("exports/x.md", "images/pic.md", "options.current.json", ""):
            self.assertIsNone(paths.resolve_writable(self.tmp, rel), rel)

    def test_traversal_between_writable_roots_stays_confined(self):
        # campaigns/../items/A.md lands in items/ — still a writable root.
        resolved = paths.resolve_writable(self.tmp, "campaigns/../items/A.md")
        self.assertIsNotNone(resolved)
        self.assert_inside_content(resolved)
        self.assertTrue(resolved.endswith(os.path.join("content", "items", "A.md")))


class ResolveReadableTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="rs-paths-")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_accepts_asset_and_library_roots_and_options_file(self):
        for rel in ("images/pic.png", "audio/theme.mp3", "items/Sword.md",
                    "campaigns/Legacy/scenes/1.md", "options.current.json"):
            self.assertIsNotNone(paths.resolve_readable(self.tmp, rel), rel)

    def test_rejects_traversal_and_junk(self):
        for rel in ("../launcher.py", "exports/x.zip", "", "   ", None, 42):
            self.assertIsNone(paths.resolve_readable(self.tmp, rel), repr(rel))


class WriteEndpointGuardTests(unittest.TestCase):
    """The .md-only and writable-roots guards as the endpoints enforce them."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="rs-paths-")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def ctx(self):
        return Ctx(base_dir=self.tmp, campaign=None)

    def test_save_rejects_non_markdown_inside_writable_root(self):
        status, payload = endpoints_files.save_file(
            self.ctx(), {}, {"path": "items/evil.py", "content": "x"})
        self.assertEqual(status, 403)
        self.assertEqual(payload["error"], "only .md files")

    def test_save_rejects_escaping_path(self):
        status, payload = endpoints_files.save_file(
            self.ctx(), {}, {"path": "../evil.md", "content": "x"})
        self.assertEqual(status, 403)
        self.assertEqual(payload["error"], "path outside writable roots")
        self.assertFalse(os.path.exists(os.path.join(self.tmp, "evil.md")))

    def test_save_rejects_missing_fields(self):
        status, payload = endpoints_files.save_file(self.ctx(), {}, {"path": "items/A.md"})
        self.assertEqual(status, 400)
        self.assertTrue(payload["error"].startswith("bad request:"))

    def test_delete_rejects_non_markdown_and_escapes(self):
        write(os.path.join(self.tmp, "content", "items", "keep.txt"), "x")
        status, _ = endpoints_files.delete_campaign_file(
            self.ctx(), {}, {"path": "items/keep.txt"})
        self.assertEqual(status, 403)

        status, _ = endpoints_files.delete_campaign_file(
            self.ctx(), {}, {"path": "../launcher.py"})
        self.assertEqual(status, 403)


if __name__ == "__main__":
    unittest.main()
