import json
import os
import socket
import tempfile
import unittest
import urllib.error

from src.updates import update_checker
from src.updates.update_config import UPDATE_MANIFEST_URL


def manifest(**overrides):
    data = {
        "latest": "1.1.2",
        "minimum_supported": "1.0.0",
        "url": "https://github.com/yagizdkurt/RendScroll",
        "title": "RendScroll 1.1.2",
        "changes": "Useful changes.",
    }
    data.update(overrides)
    return data


class UpdateCheckerTests(unittest.TestCase):
    def test_semver_comparison(self):
        self.assertEqual(update_checker.compare_versions("0.1.0", "0.1.1"), -1)
        self.assertEqual(update_checker.compare_versions("1.0.0", "1.0.0"), 0)
        self.assertEqual(update_checker.compare_versions("1.0.0", "0.1.1"), 1)

    def test_update_available_includes_changes(self):
        result = update_checker.result_from_manifest(manifest(), current_version="1.1.1")

        self.assertEqual(result["state"], update_checker.STATE_UPDATE_AVAILABLE)
        self.assertEqual(result["current_version"], "1.1.1")
        self.assertEqual(result["latest_version"], "1.1.2")
        self.assertEqual(result["title"], "RendScroll 1.1.2")
        self.assertEqual(result["changes"], "Useful changes.")

    def test_same_version_is_up_to_date(self):
        result = update_checker.result_from_manifest(manifest(latest="1.1.1"), current_version="1.1.1")

        self.assertEqual(result["state"], update_checker.STATE_UP_TO_DATE)
        self.assertEqual(result["latest_version"], "1.1.1")

    def test_older_remote_version_is_up_to_date(self):
        result = update_checker.result_from_manifest(manifest(latest="1.1.0"), current_version="1.1.1")

        self.assertEqual(result["state"], update_checker.STATE_UP_TO_DATE)

    def test_missing_changes_does_not_fail(self):
        data = manifest()
        data.pop("changes")

        result = update_checker.result_from_manifest(data, current_version="1.1.1")

        self.assertEqual(result["state"], update_checker.STATE_UPDATE_AVAILABLE)
        self.assertNotIn("changes", result)

    def test_non_string_or_empty_changes_is_ignored(self):
        for value in (["bad"], 7, "", "   "):
            with self.subTest(value=value):
                result = update_checker.result_from_manifest(
                    manifest(changes=value),
                    current_version="1.1.1",
                )
                self.assertEqual(result["state"], update_checker.STATE_UPDATE_AVAILABLE)
                self.assertNotIn("changes", result)

    def test_malformed_manifest_fails_safely(self):
        result = update_checker.check_for_updates(
            current_version="1.1.1",
            opener=lambda url, timeout: "{not json",
        )

        self.assertEqual(result["state"], update_checker.STATE_CHECK_FAILED)

    def test_invalid_version_data_fails_safely(self):
        result = update_checker.check_for_updates(
            current_version="1.1.1",
            opener=lambda url, timeout: json.dumps(manifest(latest="1.1")),
        )

        self.assertEqual(result["state"], update_checker.STATE_CHECK_FAILED)

    def test_missing_latest_fails_safely(self):
        data = manifest()
        data.pop("latest")

        result = update_checker.check_for_updates(
            current_version="1.1.1",
            opener=lambda url, timeout: json.dumps(data),
        )

        self.assertEqual(result["state"], update_checker.STATE_CHECK_FAILED)

    def test_timeout_fails_safely(self):
        def opener(url, timeout):
            raise socket.timeout("timed out")

        result = update_checker.check_for_updates(current_version="1.1.1", opener=opener)

        self.assertEqual(result["state"], update_checker.STATE_CHECK_FAILED)

    def test_network_failure_fails_safely(self):
        def opener(url, timeout):
            raise urllib.error.URLError("offline")

        result = update_checker.check_for_updates(current_version="1.1.1", opener=opener)

        self.assertEqual(result["state"], update_checker.STATE_CHECK_FAILED)

    def test_disabled_skips_fetch(self):
        result = update_checker.check_for_updates(
            current_version="1.1.1",
            enabled=False,
            opener=lambda url, timeout: self.fail("opener should not be called"),
        )

        self.assertEqual(result["state"], update_checker.STATE_DISABLED)

    def test_configured_manifest_url_is_github_raw_main(self):
        self.assertEqual(
            UPDATE_MANIFEST_URL,
            "https://raw.githubusercontent.com/yagizdkurt/RendScroll/main/update_manifest.json",
        )

    def test_download_url_is_passed_through(self):
        data = manifest(download_url="https://codeload.github.com/x/y/zip/refs/heads/main")
        result = update_checker.result_from_manifest(data, current_version="1.1.1")
        self.assertEqual(
            result["download_url"], "https://codeload.github.com/x/y/zip/refs/heads/main"
        )

    def test_minimum_supported_version_alias_is_accepted(self):
        data = manifest()
        data.pop("minimum_supported")
        data["minimum_supported_version"] = "1.0.5"
        result = update_checker.result_from_manifest(data, current_version="1.1.1")
        self.assertEqual(result["minimum_supported"], "1.0.5")

    def test_minimum_supported_version_wins_over_legacy_name(self):
        data = manifest(minimum_supported="1.0.0")
        data["minimum_supported_version"] = "1.0.5"
        result = update_checker.result_from_manifest(data, current_version="1.1.1")
        self.assertEqual(result["minimum_supported"], "1.0.5")

    def test_under_minimum_supported_requires_manual_update(self):
        result = update_checker.result_from_manifest(
            manifest(latest="1.4.1", minimum_supported="1.4.1", changes="Normal notes."),
            current_version="1.4.0",
        )

        self.assertEqual(result["state"], update_checker.STATE_UPDATE_AVAILABLE)
        self.assertTrue(result["manual_update_required"])
        self.assertEqual(
            result["changes"],
            'You are using older version than "1.4.1" thus you need to update '
            "project manually. You can do this by moving content folder out, "
            "downloading the project again then moving it back in. Auto updates "
            "wont work on unsupported versions.",
        )

    def test_new_optional_fields_absent_still_validates(self):
        data = manifest()
        data.pop("minimum_supported")
        result = update_checker.result_from_manifest(data, current_version="1.1.1")
        self.assertEqual(result["state"], update_checker.STATE_UPDATE_AVAILABLE)
        self.assertNotIn("download_url", result)


class LoadAppVersionTests(unittest.TestCase):
    def _write_manifest(self, content):
        fh = tempfile.NamedTemporaryFile(
            "w", suffix=".json", delete=False, encoding="utf-8"
        )
        self.addCleanup(os.remove, fh.name)
        with fh:
            fh.write(content)
        return fh.name

    def test_reads_latest_from_manifest(self):
        path = self._write_manifest(json.dumps({"latest": "2.3.4"}))
        self.assertEqual(update_checker.load_app_version(path), "2.3.4")

    def test_missing_file_fails_loudly(self):
        with self.assertRaises(update_checker.UpdateCheckError):
            update_checker.load_app_version("/no/such/update_manifest.json")

    def test_malformed_json_fails_loudly(self):
        path = self._write_manifest("{not json")
        with self.assertRaises(update_checker.UpdateCheckError):
            update_checker.load_app_version(path)

    def test_non_object_json_fails_loudly(self):
        path = self._write_manifest('["latest"]')
        with self.assertRaises(update_checker.UpdateCheckError):
            update_checker.load_app_version(path)

    def test_missing_or_invalid_latest_fails_loudly(self):
        for content in ("{}", json.dumps({"latest": "1.5"})):
            with self.subTest(content=content):
                path = self._write_manifest(content)
                with self.assertRaises(update_checker.UpdateCheckError):
                    update_checker.load_app_version(path)

    def test_app_version_matches_committed_manifest(self):
        """APP_VERSION is single-sourced from the repo's update_manifest.json."""
        with open(update_checker.LOCAL_MANIFEST_PATH, encoding="utf-8") as fh:
            data = json.load(fh)
        self.assertEqual(update_checker.APP_VERSION, data["latest"])


if __name__ == "__main__":
    unittest.main()
