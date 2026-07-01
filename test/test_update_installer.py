import json
import os
import tempfile
import unittest
import zipfile

from src.updates import update_installer as installer


def write(path, content=""):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(content)


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


class PlanReplacementsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="rs-extract-")
        # A minimal extracted app tree plus user-owned content that must be ignored.
        write(os.path.join(self.tmp, "index.html"), "new-index")
        write(os.path.join(self.tmp, "launcher.py"), "new-launcher")
        write(os.path.join(self.tmp, "src", "app", "app.js"), "new-app")
        write(os.path.join(self.tmp, "Documentation", "guide.md"), "doc")
        write(os.path.join(self.tmp, "Campaigns", "Legacy", "Scenes", "01.md"), "scene")
        write(os.path.join(self.tmp, "Items", "Sword.md"), "item")
        write(os.path.join(self.tmp, "options.current.json"), "{}")
        write(os.path.join(self.tmp, "Campaigns", ".gitkeep"), "")

    def tearDown(self):
        import shutil

        shutil.rmtree(self.tmp, ignore_errors=True)

    def _rels(self, replacements):
        return {item["rel"] for item in replacements}

    def test_protected_roots_are_excluded(self):
        rels = self._rels(installer.plan_replacements(self.tmp, "/install"))
        self.assertIn("index.html", rels)
        self.assertIn("launcher.py", rels)
        self.assertIn("src/app/app.js", rels)
        for protected in ("Campaigns", "Items", "options.current.json"):
            self.assertFalse(
                any(rel.split("/", 1)[0] == protected for rel in rels),
                f"{protected} should never be in the replace set",
            )

class ExtractTests(unittest.TestCase):
    def test_extract_strips_single_wrapper_dir(self):
        tmp = tempfile.mkdtemp(prefix="rs-zip-")
        try:
            zip_path = os.path.join(tmp, "source.zip")
            with zipfile.ZipFile(zip_path, "w") as archive:
                archive.writestr("RendScroll-main/index.html", "x")
                archive.writestr("RendScroll-main/src/app/app.js", "y")
            root = installer.extract_zip(zip_path, os.path.join(tmp, "extract"))
            self.assertTrue(os.path.isfile(os.path.join(root, "index.html")))
            self.assertTrue(os.path.isdir(os.path.join(root, "src")))
            self.assertEqual(os.path.basename(root), "RendScroll-main")
        finally:
            import shutil

            shutil.rmtree(tmp, ignore_errors=True)

    def test_validate_extract_rejects_non_rendscroll_tree(self):
        tmp = tempfile.mkdtemp(prefix="rs-bad-")
        try:
            write(os.path.join(tmp, "README.md"), "not an app")
            with self.assertRaises(installer.UpdateInstallError):
                installer.validate_extract(tmp)
        finally:
            import shutil

            shutil.rmtree(tmp, ignore_errors=True)


class BackupRollbackTests(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="rs-bk-")
        self.install = os.path.join(self.root, "install")
        self.extract = os.path.join(self.root, "extract")
        self.backup = os.path.join(self.root, "backup")
        # Current install: an existing app file + protected user content.
        write(os.path.join(self.install, "index.html"), "OLD-index")
        write(os.path.join(self.install, "Campaigns", "C", "Scenes", "01.md"), "USER")
        # Incoming update: overwrites index.html, adds src/new.js.
        write(os.path.join(self.extract, "index.html"), "NEW-index")
        write(os.path.join(self.extract, "src", "new.js"), "NEW-src")

    def tearDown(self):
        import shutil

        shutil.rmtree(self.root, ignore_errors=True)

    def test_backup_then_rollback_restores_and_removes_added(self):
        replacements = installer.plan_replacements(self.extract, self.install)
        manifest = installer.backup_targets(replacements, self.backup)
        self.assertIn("index.html", manifest["restored"])
        self.assertIn("src/new.js", manifest["added"])

        installer.apply_replacements(replacements)
        self.assertEqual(read(os.path.join(self.install, "index.html")), "NEW-index")
        self.assertTrue(os.path.isfile(os.path.join(self.install, "src", "new.js")))

        installer.rollback(self.backup, self.install)
        # Overwritten file restored, added file removed.
        self.assertEqual(read(os.path.join(self.install, "index.html")), "OLD-index")
        self.assertFalse(os.path.exists(os.path.join(self.install, "src", "new.js")))
        # User content never touched.
        self.assertEqual(
            read(os.path.join(self.install, "Campaigns", "C", "Scenes", "01.md")),
            "USER",
        )

    def test_backup_writes_manifest(self):
        replacements = installer.plan_replacements(self.extract, self.install)
        installer.backup_targets(replacements, self.backup)
        manifest_path = os.path.join(self.backup, "backup_manifest.json")
        self.assertTrue(os.path.isfile(manifest_path))
        data = json.loads(read(manifest_path))
        self.assertIn("restored", data)
        self.assertIn("added", data)


if __name__ == "__main__":
    unittest.main()
