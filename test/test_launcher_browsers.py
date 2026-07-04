import json
import os
import shutil
import tempfile
import unittest
from unittest import mock

import launcher
from src.server import paths


class BrowserCandidateTests(unittest.TestCase):
    ENV = {
        "ProgramFiles": r"C:\Program Files",
        "ProgramFiles(x86)": r"C:\Program Files (x86)",
        "LocalAppData": r"C:\Users\dm\AppData\Local",
    }

    def test_chrome_candidates_cover_all_install_roots(self):
        with mock.patch.dict(os.environ, self.ENV, clear=True):
            paths = launcher.chrome_candidates()
        self.assertEqual(len(paths), 3)
        for path in paths:
            self.assertTrue(path.endswith(os.path.join("Google", "Chrome", "Application", "chrome.exe")))

    def test_edge_candidates_point_at_msedge(self):
        with mock.patch.dict(os.environ, self.ENV, clear=True):
            paths = launcher.edge_candidates()
        self.assertEqual(len(paths), 3)
        for path in paths:
            self.assertTrue(path.endswith(os.path.join("Microsoft", "Edge", "Application", "msedge.exe")))

    def test_firefox_candidates_skip_local_appdata(self):
        with mock.patch.dict(os.environ, self.ENV, clear=True):
            paths = launcher.firefox_candidates()
        self.assertEqual(len(paths), 2)
        for path in paths:
            self.assertTrue(path.endswith(os.path.join("Mozilla Firefox", "firefox.exe")))

    def test_missing_env_vars_drop_candidates(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertEqual(launcher.chrome_candidates(), [])
            self.assertEqual(launcher.firefox_candidates(), [])


class LaunchArgTests(unittest.TestCase):
    def test_chromium_args_match_managed_app_window_launch(self):
        # Guard: the Chrome launch must stay exactly what it was before the
        # browser registry refactor.
        args = launcher.chromium_launch_args(
            r"C:\chrome.exe", "http://127.0.0.1:8000", r"C:\tmp\profile", (1920, 1080))
        self.assertEqual(args, [
            r"C:\chrome.exe",
            "--app=http://127.0.0.1:8000",
            r"--user-data-dir=C:\tmp\profile",
            "--no-first-run",
            "--disable-first-run-ui",
            "--disable-translate",
            "--disable-features=Translate",
            "--lang=tr",
            "--start-fullscreen",
            "--window-position=0,0",
            "--window-size=1920,1080",
        ])

    def test_chromium_args_omit_window_size_when_unknown(self):
        args = launcher.chromium_launch_args("exe", "url", "profile", None)
        self.assertNotIn("--window-size", " ".join(args))

    def test_firefox_args_use_isolated_profile_and_no_remote(self):
        args = launcher.firefox_launch_args(
            r"C:\firefox.exe", "http://127.0.0.1:8000", r"C:\tmp\ffprofile", (1920, 1080))
        self.assertEqual(args[0], r"C:\firefox.exe")
        self.assertIn("-profile", args)
        self.assertEqual(args[args.index("-profile") + 1], r"C:\tmp\ffprofile")
        self.assertIn("-no-remote", args)
        self.assertEqual(args[-1], "http://127.0.0.1:8000")

    def test_registry_specs_are_complete(self):
        for spec_id, spec in launcher.BROWSER_SPECS.items():
            self.assertTrue(spec["display_name"], spec_id)
            self.assertTrue(callable(spec["candidates"]), spec_id)
            self.assertTrue(callable(spec["launch_args"]), spec_id)
            self.assertIn("configure_profile", spec)
            self.assertTrue(spec["profile_prefix"].startswith("rendscroll-"), spec_id)
        self.assertEqual(set(launcher.BROWSER_AUTO_ORDER), set(launcher.BROWSER_SPECS))


class ReadBrowserChoiceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="rs-browser-choice-")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def write_options(self, payload, raw=None):
        target = os.path.join(paths.user_root(self.tmp), paths.OPTIONS_CURRENT_FILE)
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, "w", encoding="utf-8") as fh:
            fh.write(raw if raw is not None else json.dumps(payload))

    def test_missing_file_means_auto(self):
        self.assertEqual(launcher.read_browser_choice(self.tmp), "auto")

    def test_valid_choices_pass_through(self):
        for choice in ("auto", "chrome", "edge", "firefox", "default"):
            self.write_options({"browser": choice})
            self.assertEqual(launcher.read_browser_choice(self.tmp), choice)

    def test_unknown_value_means_auto(self):
        self.write_options({"browser": "netscape"})
        self.assertEqual(launcher.read_browser_choice(self.tmp), "auto")

    def test_corrupt_json_means_auto(self):
        self.write_options(None, raw="{not json")
        self.assertEqual(launcher.read_browser_choice(self.tmp), "auto")

    def test_non_object_json_means_auto(self):
        self.write_options(["browser", "chrome"])
        self.assertEqual(launcher.read_browser_choice(self.tmp), "auto")


class OpenBrowserResolutionTests(unittest.TestCase):
    def launch(self, choice, installed):
        """Run open_browser with fake installs; returns (result, launched, opened)."""
        launched = []
        opened = []

        def fake_find(spec_id):
            return f"{spec_id}.exe" if spec_id in installed else None

        def fake_launch(spec_id, exe_path, url):
            launched.append(spec_id)
            return f"proc-{spec_id}", f"profile-{spec_id}"

        with mock.patch.object(launcher, "find_browser_executable", fake_find), \
                mock.patch.object(launcher, "launch_managed_browser", fake_launch), \
                mock.patch.object(launcher.webbrowser, "open", opened.append):
            result = launcher.open_browser("http://x", choice)
        return result, launched, opened

    def test_auto_prefers_first_installed_in_order(self):
        result, launched, opened = self.launch("auto", installed={"edge", "firefox"})
        self.assertEqual(launched, ["edge"])
        self.assertEqual(result, ("proc-edge", "profile-edge", "Microsoft Edge"))
        self.assertEqual(opened, [])

    def test_auto_with_nothing_installed_falls_back_to_default(self):
        result, launched, opened = self.launch("auto", installed=set())
        self.assertEqual(launched, [])
        self.assertEqual(result, (None, None, "default browser"))
        self.assertEqual(opened, ["http://x"])

    def test_explicit_browser_launches_it(self):
        result, launched, _ = self.launch("firefox", installed={"chrome", "firefox"})
        self.assertEqual(launched, ["firefox"])
        self.assertEqual(result[2], "Mozilla Firefox")

    def test_explicit_missing_browser_falls_back_to_default(self):
        result, launched, opened = self.launch("edge", installed={"chrome"})
        self.assertEqual(launched, [])
        self.assertEqual(result, (None, None, "default browser"))
        self.assertEqual(opened, ["http://x"])

    def test_default_choice_never_probes_managed_browsers(self):
        result, launched, opened = self.launch("default", installed={"chrome", "edge"})
        self.assertEqual(launched, [])
        self.assertEqual(result, (None, None, "default browser"))
        self.assertEqual(opened, ["http://x"])


if __name__ == "__main__":
    unittest.main()
