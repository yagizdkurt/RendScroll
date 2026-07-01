import json
import socket
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


if __name__ == "__main__":
    unittest.main()
