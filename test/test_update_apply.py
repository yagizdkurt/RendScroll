import os
import sys
import tempfile
import time
import unittest
from unittest import mock

import launcher
from src.server import term
from src.updates import update_apply


class _StubLog:
    def __init__(self):
        self.lines = []

    def line(self, step, status, detail=""):
        self.lines.append((step, status, detail))


class WaitForHeartbeatTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="rs-hb-")
        self.heartbeat = os.path.join(self.tmp, "launch-ok")
        self.log = _StubLog()

    def tearDown(self):
        import shutil

        shutil.rmtree(self.tmp, ignore_errors=True)

    def _write_heartbeat(self, version):
        with open(self.heartbeat, "w", encoding="utf-8") as fh:
            fh.write(version + "\n")

    def test_matching_version_is_accepted(self):
        since = time.time() - 1
        self._write_heartbeat("1.6.0")
        self.assertTrue(update_apply._wait_for_heartbeat(
            self.heartbeat, since, "1.6.0", self.log, timeout=2,
        ))

    def test_wrong_version_times_out_and_fails(self):
        """A fresh heartbeat from the OLD app (half-applied update) must not
        count as success."""
        since = time.time() - 1
        self._write_heartbeat("1.5.0")
        self.assertFalse(update_apply._wait_for_heartbeat(
            self.heartbeat, since, "1.6.0", self.log, timeout=0.6,
        ))
        self.assertTrue(
            any(status == "warn" for _, status, _ in self.log.lines),
            "mismatch should be logged for the apply log",
        )

    def test_empty_expected_version_accepts_any_fresh_heartbeat(self):
        """Job files written by an older app have no target_version."""
        since = time.time() - 1
        self._write_heartbeat("whatever")
        self.assertTrue(update_apply._wait_for_heartbeat(
            self.heartbeat, since, "", self.log, timeout=2,
        ))

    def test_missing_heartbeat_times_out(self):
        self.assertFalse(update_apply._wait_for_heartbeat(
            self.heartbeat, time.time(), "1.6.0", self.log, timeout=0.6,
        ))


class RelaunchTests(unittest.TestCase):
    def test_relaunch_gets_a_console_on_windows(self):
        """Regression: the launcher needs real std handles. DETACHED_PROCESS gave
        it sys.stdout=None and it crashed before writing the launch heartbeat, so
        every update rolled back. The relaunch must use CREATE_NEW_CONSOLE."""
        with mock.patch.object(update_apply.os, "name", "nt"), \
                mock.patch.object(update_apply.subprocess, "Popen") as popen:
            update_apply._relaunch(["python", "launcher.py"], "/install")
        kwargs = popen.call_args.kwargs
        self.assertEqual(kwargs.get("creationflags"), 0x00000010)  # CREATE_NEW_CONSOLE

    def test_relaunch_posix_uses_new_session(self):
        with mock.patch.object(update_apply.os, "name", "posix"), \
                mock.patch.object(update_apply.subprocess, "Popen") as popen:
            update_apply._relaunch(["python", "launcher.py"], "/install")
        kwargs = popen.call_args.kwargs
        self.assertTrue(kwargs.get("start_new_session"))
        self.assertNotIn("creationflags", kwargs)


class ConfigureConsoleTests(unittest.TestCase):
    def test_survives_missing_stdout(self):
        """Regression: with no std handles (detached/headless launch) sys.stdout
        is None; configure_console must degrade to no color, not crash."""
        original = term.COLOR_ENABLED
        try:
            with mock.patch.object(sys, "stdout", None):
                launcher.configure_console()
            self.assertFalse(term.COLOR_ENABLED)
        finally:
            term.set_color_enabled(original)


if __name__ == "__main__":
    unittest.main()
