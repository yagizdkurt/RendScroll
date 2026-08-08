"""Server guards for the campaign-only Lore library.

Lore differs from items/enemies in exactly one way that the server has to
enforce: it has NO global root. It is deliberately absent from LIBRARY_DIRS (so
resolve_writable never opens a content/lore writable root and translate_path
never serves a /lore/ URL root) and lives in CAMPAIGN_LIBRARY_DIRS instead.
These tests pin that, plus the save/rename endpoint's collision ordering.
"""

import os
import shutil
import tempfile
import unittest

from src.server import discovery, endpoints_files, endpoints_library, paths
from src.server.routes import Ctx

CAMPAIGN = "Legacy"


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


class LoreServerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="rs-lore-")
        # A campaign must exist for campaign-scoped discovery to see anything.
        os.makedirs(paths.campaign_scenes_root(self.tmp, CAMPAIGN), exist_ok=True)
        self.ctx = Ctx(base_dir=self.tmp, campaign=CAMPAIGN)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def lore_dir(self, campaign=CAMPAIGN):
        return os.path.join(paths.campaign_dir_path(self.tmp, campaign), "lore")

    def create(self, name, content="# Lore: X\n", scope="campaign", ctx=None):
        return endpoints_library.create_library_file(
            ctx or self.ctx, {},
            {"type": "lore", "name": name, "content": content, "scope": scope})

    # --- registry shape ---------------------------------------------------

    def test_lore_is_campaign_only_and_absent_from_the_global_registry(self):
        self.assertNotIn("lore", paths.LIBRARY_DIRS)
        self.assertIn("lore", paths.CAMPAIGN_LIBRARY_DIRS)
        self.assertEqual(paths.library_folder("lore"), "lore")
        self.assertTrue(paths.is_campaign_only_library("lore"))
        self.assertFalse(paths.is_campaign_only_library("item"))

    def test_lore_never_becomes_a_global_writable_or_url_root(self):
        # A global content/lore path must not resolve as writable...
        self.assertIsNone(paths.resolve_writable(self.tmp, "lore/Page.md"))
        # ...and /lore/ must not be a user-space URL root.
        self.assertNotIn("lore", paths.USER_SPACE_URL_ROOTS)
        # ...while the campaign-local path stays writable (it is under campaigns/).
        self.assertIsNotNone(
            paths.resolve_writable(self.tmp, f"campaigns/{CAMPAIGN}/lore/Page.md"))

    # --- create -----------------------------------------------------------

    def test_create_writes_into_the_campaign_lore_folder(self):
        status, payload = self.create("Ancient Gate", "# Lore: Ancient Gate\n")
        self.assertEqual(status, 200, payload)
        self.assertEqual(payload["entry"]["path"], f"campaigns/{CAMPAIGN}/lore/Ancient Gate.md")
        self.assertEqual(payload["entry"]["origin"], "campaign")
        self.assertEqual(read(os.path.join(self.lore_dir(), "Ancient Gate.md")),
                         "# Lore: Ancient Gate\n")

    def test_create_makes_the_lore_folder_on_first_page_only(self):
        self.assertFalse(os.path.isdir(self.lore_dir()))
        self.create("First")
        self.assertTrue(os.path.isdir(self.lore_dir()))

    def test_create_defaults_to_campaign_scope_even_without_an_explicit_one(self):
        status, payload = self.create("Implicit", scope="")
        self.assertEqual(status, 200, payload)
        self.assertTrue(payload["entry"]["path"].startswith(f"campaigns/{CAMPAIGN}/lore/"))

    def test_create_rejects_an_explicit_global_scope(self):
        status, payload = self.create("Nope", scope="global")
        self.assertEqual(status, 400)
        self.assertIn("campaign-only", payload["error"])
        self.assertFalse(os.path.exists(os.path.join(paths.user_root(self.tmp), "lore")))

    def test_create_rejects_a_name_with_path_separators(self):
        for bad in ("../escape", "sub/Page", "sub\\Page"):
            status, _ = self.create(bad)
            self.assertEqual(status, 400, bad)

    def test_create_without_an_active_campaign_fails(self):
        status, payload = self.create("Nope", ctx=Ctx(base_dir=self.tmp, campaign=None))
        self.assertEqual(status, 400)
        self.assertIn("no active campaign", payload["error"])

    def test_create_rejects_a_duplicate_name(self):
        self.create("Dup")
        status, _ = self.create("Dup")
        self.assertEqual(status, 409)

    # --- discovery --------------------------------------------------------

    def test_discovery_lists_campaign_lore_alphabetically(self):
        for name in ("Zenith", "alpha", "Middle"):
            self.create(name)
        found = discovery.discover_library_files(self.tmp, "lore", CAMPAIGN)
        self.assertEqual([e["name"] for e in found], ["alpha", "Middle", "Zenith"])
        self.assertTrue(all(e["origin"] == "campaign" for e in found))

    def test_discovery_ignores_a_stray_global_lore_folder(self):
        # Even if one somehow exists on disk, a campaign-only type must not read it.
        stray = os.path.join(paths.user_root(self.tmp), "lore")
        os.makedirs(stray, exist_ok=True)
        with open(os.path.join(stray, "Global.md"), "w", encoding="utf-8") as fh:
            fh.write("# Lore: Global\n")
        self.create("Local")

        names = [e["name"] for e in discovery.discover_library_files(self.tmp, "lore", CAMPAIGN)]
        self.assertEqual(names, ["Local"])

    def test_discovery_of_another_campaign_does_not_leak(self):
        self.create("Mine")
        os.makedirs(paths.campaign_scenes_root(self.tmp, "Other"), exist_ok=True)
        self.assertEqual(discovery.discover_library_files(self.tmp, "lore", "Other"), [])

    def test_items_still_merge_campaign_over_global(self):
        # The scope change must not alter the existing global-backed libraries.
        endpoints_library.create_library_file(
            self.ctx, {}, {"type": "item", "name": "Rope", "content": "g", "scope": "global"})
        endpoints_library.create_library_file(
            self.ctx, {}, {"type": "item", "name": "Rope", "content": "c", "scope": "campaign"})
        found = discovery.discover_library_files(self.tmp, "item", CAMPAIGN, with_content=True)
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0]["origin"], "campaign")
        self.assertEqual(found[0]["content"], "c")
        self.assertEqual(found[0]["shadows"], ["items/Rope.md"])

    # --- save / rename ----------------------------------------------------

    def save(self, name, content, rename_from=None, ctx=None):
        body = {"type": "lore", "name": name, "content": content, "scope": "campaign"}
        if rename_from is not None:
            body["renameFrom"] = rename_from
        return endpoints_library.save_library_file(ctx or self.ctx, {}, body)

    def test_save_overwrites_in_place(self):
        self.create("Page", "# Lore: Page\n")
        status, payload = self.save("Page", "# Lore: Page\nKeywords: a\n")
        self.assertEqual(status, 200, payload)
        self.assertEqual(read(os.path.join(self.lore_dir(), "Page.md")),
                         "# Lore: Page\nKeywords: a\n")

    def test_save_creates_the_file_when_it_is_missing(self):
        status, _ = self.save("Fresh", "# Lore: Fresh\n")
        self.assertEqual(status, 200)
        self.assertTrue(os.path.isfile(os.path.join(self.lore_dir(), "Fresh.md")))

    def test_rename_moves_the_file_and_writes_the_new_content(self):
        self.create("Old Name", "# Lore: Old Name\n")
        status, payload = self.save("New Name", "# Lore: New Name\n", rename_from="Old Name")
        self.assertEqual(status, 200, payload)
        self.assertEqual(payload["entry"]["path"], f"campaigns/{CAMPAIGN}/lore/New Name.md")
        self.assertFalse(os.path.exists(os.path.join(self.lore_dir(), "Old Name.md")))
        self.assertEqual(read(os.path.join(self.lore_dir(), "New Name.md")), "# Lore: New Name\n")

    def test_rename_onto_an_existing_name_is_rejected_and_writes_nothing(self):
        self.create("Keep", "# Lore: Keep\n")
        self.create("Other", "# Lore: Other\n")

        status, payload = self.save("Keep", "# Lore: CLOBBERED\n", rename_from="Other")
        self.assertEqual(status, 409, payload)
        # Neither file may have been touched.
        self.assertEqual(read(os.path.join(self.lore_dir(), "Keep.md")), "# Lore: Keep\n")
        self.assertEqual(read(os.path.join(self.lore_dir(), "Other.md")), "# Lore: Other\n")

    def test_renaming_to_the_same_name_is_a_plain_save(self):
        self.create("Same", "# Lore: Same\n")
        status, _ = self.save("Same", "# Lore: Same\nKeywords: k\n", rename_from="Same")
        self.assertEqual(status, 200)
        self.assertEqual(read(os.path.join(self.lore_dir(), "Same.md")),
                         "# Lore: Same\nKeywords: k\n")

    def test_save_rejects_a_global_scope_and_a_traversing_name(self):
        status, payload = endpoints_library.save_library_file(
            self.ctx, {},
            {"type": "lore", "name": "P", "content": "x", "scope": "global"})
        self.assertEqual(status, 400)
        self.assertIn("campaign-only", payload["error"])

        status, _ = self.save("../escape", "x")
        self.assertEqual(status, 400)

    def test_save_rejects_an_unknown_library_type(self):
        status, _ = endpoints_library.save_library_file(
            self.ctx, {}, {"type": "nope", "name": "P", "content": "x"})
        self.assertEqual(status, 400)

    # --- delete + export --------------------------------------------------

    def test_delete_trashes_a_lore_page_through_the_shared_endpoint(self):
        self.create("Doomed")
        status, payload = endpoints_files.delete_campaign_file(
            self.ctx, {}, {"path": f"campaigns/{CAMPAIGN}/lore/Doomed.md"})
        self.assertEqual(status, 200, payload)
        self.assertFalse(os.path.exists(os.path.join(self.lore_dir(), "Doomed.md")))

    def test_export_maps_campaign_lore_into_a_top_level_lore_folder(self):
        self.assertEqual(
            discovery.export_dest_subpath(f"campaigns/{CAMPAIGN}/lore/Page.md"),
            "lore/Page.md")


if __name__ == "__main__":
    unittest.main()
