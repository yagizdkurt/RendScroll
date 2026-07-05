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
        write(os.path.join(self.tmp, "content", "campaigns", "Legacy", "scenes", "01.md"), "scene")
        write(os.path.join(self.tmp, "content", "items", "Sword.md"), "item")
        write(os.path.join(self.tmp, "content", "options.current.json"), "{}")
        write(os.path.join(self.tmp, "content", "campaigns", ".gitkeep"), "")

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
        self.assertFalse(
            any(rel.split("/", 1)[0] == "content" for rel in rels),
            "content/ (all user-owned data) should never be in the replace set",
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

    def test_validate_extract_accepts_tree_with_manifest(self):
        tmp = tempfile.mkdtemp(prefix="rs-ok-")
        try:
            write(os.path.join(tmp, "index.html"), "x")
            write(os.path.join(tmp, "src", "app", "app.js"), "y")
            write(os.path.join(tmp, "update_manifest.json"), '{"latest": "1.6.0"}')
            self.assertTrue(installer.validate_extract(tmp))
        finally:
            import shutil

            shutil.rmtree(tmp, ignore_errors=True)

    def test_validate_extract_rejects_missing_or_invalid_manifest(self):
        """The shipped manifest is the relaunched app's version source; an
        extract without a valid one must fail before anything is touched."""
        cases = {
            "missing": None,
            "bad-json": "{not json",
            "bad-latest": '{"latest": "1.6"}',
            "no-latest": "{}",
        }
        for label, manifest_content in cases.items():
            with self.subTest(case=label):
                tmp = tempfile.mkdtemp(prefix="rs-man-")
                try:
                    write(os.path.join(tmp, "index.html"), "x")
                    write(os.path.join(tmp, "src", "app", "app.js"), "y")
                    if manifest_content is not None:
                        write(os.path.join(tmp, "update_manifest.json"), manifest_content)
                    with self.assertRaises(installer.UpdateInstallError):
                        installer.validate_extract(tmp)
                finally:
                    import shutil

                    shutil.rmtree(tmp, ignore_errors=True)


class PlanDeletionsTests(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="rs-del-")
        self.extract = os.path.join(self.root, "extract")
        self.install = os.path.join(self.root, "install")
        # Incoming update ships src/ and a root file.
        write(os.path.join(self.extract, "index.html"), "new")
        write(os.path.join(self.extract, "src", "app", "app.js"), "new")
        # Install: current app files plus things deletion must leave alone.
        write(os.path.join(self.install, "index.html"), "old")
        write(os.path.join(self.install, "src", "app", "app.js"), "old")
        write(os.path.join(self.install, "src", "app", "retired.js"), "stale")
        write(os.path.join(self.install, "OLD_NOTES.md"), "stale root file")
        write(os.path.join(self.install, ".env"), "user root dotfile")
        write(os.path.join(self.install, "node_modules", "pkg", "x.js"), "tooling")
        write(os.path.join(self.install, "content", "items", "Sword.md"), "user")
        write(os.path.join(self.install, ".rendscroll-update", "job.json"), "{}")

    def tearDown(self):
        import shutil

        shutil.rmtree(self.root, ignore_errors=True)

    def _rels(self):
        return {item["rel"] for item in installer.plan_deletions(self.extract, self.install)}

    def test_stale_file_in_shipped_dir_is_planned(self):
        self.assertIn("src/app/retired.js", self._rels())

    def test_stale_root_file_is_planned(self):
        self.assertIn("OLD_NOTES.md", self._rels())

    def test_files_present_in_extract_are_not_planned(self):
        rels = self._rels()
        self.assertNotIn("index.html", rels)
        self.assertNotIn("src/app/app.js", rels)

    def test_unknown_top_level_dirs_are_skipped(self):
        self.assertFalse(any(rel.startswith("node_modules/") for rel in self._rels()))

    def test_protected_roots_are_skipped(self):
        rels = self._rels()
        self.assertFalse(any(rel.split("/", 1)[0] == "content" for rel in rels))
        self.assertFalse(any(rel.split("/", 1)[0] == ".rendscroll-update" for rel in rels))

    def test_root_dotfiles_are_skipped(self):
        self.assertNotIn(".env", self._rels())


class BackupRollbackTests(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="rs-bk-")
        self.install = os.path.join(self.root, "install")
        self.extract = os.path.join(self.root, "extract")
        self.backup = os.path.join(self.root, "backup")
        # Current install: an existing app file + protected user content.
        write(os.path.join(self.install, "index.html"), "OLD-index")
        write(os.path.join(self.install, "content", "campaigns", "C", "scenes", "01.md"), "USER")
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
            read(os.path.join(self.install, "content", "campaigns", "C", "scenes", "01.md")),
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
        self.assertEqual(data["deleted"], [])

    def test_backup_records_and_copies_deletions(self):
        write(os.path.join(self.install, "src", "retired.js"), "STALE")
        deletions = installer.plan_deletions(self.extract, self.install)
        replacements = installer.plan_replacements(self.extract, self.install)
        manifest = installer.backup_targets(replacements, self.backup, deletions=deletions)
        self.assertIn("src/retired.js", manifest["deleted"])
        self.assertEqual(read(os.path.join(self.backup, "src", "retired.js")), "STALE")

    def test_apply_deletions_removes_files_and_prunes_empty_dirs(self):
        write(os.path.join(self.install, "src", "old", "gone.js"), "STALE")
        deletions = installer.plan_deletions(self.extract, self.install)
        installer.apply_deletions(deletions, self.install)
        self.assertFalse(os.path.exists(os.path.join(self.install, "src", "old", "gone.js")))
        # Emptied directory pruned; install root itself intact.
        self.assertFalse(os.path.isdir(os.path.join(self.install, "src", "old")))
        self.assertTrue(os.path.isdir(self.install))

    def test_full_cycle_rollback_restores_deleted_files(self):
        write(os.path.join(self.install, "src", "old", "gone.js"), "STALE")
        replacements = installer.plan_replacements(self.extract, self.install)
        deletions = installer.plan_deletions(self.extract, self.install)
        installer.backup_targets(replacements, self.backup, deletions=deletions)

        installer.apply_replacements(replacements)
        installer.apply_deletions(deletions, self.install)
        self.assertFalse(os.path.exists(os.path.join(self.install, "src", "old", "gone.js")))

        installer.rollback(self.backup, self.install)
        # Deleted file restored, overwritten file restored, added file removed
        # and its emptied directory pruned.
        self.assertEqual(read(os.path.join(self.install, "src", "old", "gone.js")), "STALE")
        self.assertEqual(read(os.path.join(self.install, "index.html")), "OLD-index")
        self.assertFalse(os.path.exists(os.path.join(self.install, "src", "new.js")))

    def test_rollback_tolerates_backup_manifest_without_deleted_key(self):
        """Backups written before deletion support have no `deleted` list."""
        replacements = installer.plan_replacements(self.extract, self.install)
        installer.backup_targets(replacements, self.backup)
        manifest_path = os.path.join(self.backup, "backup_manifest.json")
        data = json.loads(read(manifest_path))
        del data["deleted"]
        write(manifest_path, json.dumps(data))
        installer.rollback(self.backup, self.install)
        self.assertEqual(read(os.path.join(self.install, "index.html")), "OLD-index")


if __name__ == "__main__":
    unittest.main()
