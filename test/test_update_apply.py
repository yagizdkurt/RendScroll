import sys
import unittest
from unittest import mock

import launcher
from src.updates import update_apply


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
        original = launcher.COLOR_ENABLED
        try:
            with mock.patch.object(sys, "stdout", None):
                launcher.configure_console()
            self.assertFalse(launcher.COLOR_ENABLED)
        finally:
            launcher.COLOR_ENABLED = original


if __name__ == "__main__":
    unittest.main()
