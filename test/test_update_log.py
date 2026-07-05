import json
import os
import shutil
import tempfile
import unittest
from unittest import mock

from src.server import endpoints_updates, state
from src.updates import update_apply
from src.updates.update_log import StepLogger


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


class StepLoggerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="rs-log-")
        self.path = os.path.join(self.tmp, "logs", "steps.log")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_line_writes_timestamped_step(self):
        log = StepLogger(self.path)
        log.line("PLAN", "ok", "3 files")
        log.close()
        content = read(self.path)
        self.assertIn("PLAN", content)
        self.assertIn("ok", content)
        self.assertIn("3 files", content)

    def test_exception_writes_full_traceback(self):
        log = StepLogger(self.path)
        try:
            raise OSError("disk on fire")
        except OSError as exc:
            log.exception("BACKUP", exc)
        log.close()
        content = read(self.path)
        self.assertIn("BACKUP", content)
        self.assertIn("disk on fire", content)
        self.assertIn("Traceback", content)
        self.assertIn("OSError", content)

    def test_appends_across_instances(self):
        log = StepLogger(self.path)
        log.line("APPLY", "start")
        log.close()
        log = StepLogger(self.path)
        log.line("APPLY", "ok")
        log.close()
        content = read(self.path)
        self.assertIn("start", content)
        self.assertIn("ok", content)


class PrepareFailureLoggingTests(unittest.TestCase):
    """run_update_install runs before the detached helper exists; a failure
    there must still leave a prepare-*.log with the traceback on disk."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="rs-prep-")
        self._progress = state.update_progress_snapshot()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)
        state.set_update_progress(**{
            k: self._progress[k] for k in ("phase", "message", "ok", "active")
        })

    def _prepare_logs(self):
        logs_dir = os.path.join(self.tmp, ".rendscroll-update", "logs")
        if not os.path.isdir(logs_dir):
            return []
        return [os.path.join(logs_dir, name)
                for name in os.listdir(logs_dir) if name.startswith("prepare-")]

    def test_download_failure_writes_log_and_phase_accurate_message(self):
        with mock.patch.object(
            endpoints_updates.update_installer, "download_zip",
            side_effect=OSError("connection reset"),
        ):
            endpoints_updates.run_update_install(self.tmp, "9.9.9")

        logs = self._prepare_logs()
        self.assertEqual(len(logs), 1)
        content = read(logs[0])
        self.assertIn("DOWNLOAD", content)
        self.assertIn("connection reset", content)
        self.assertIn("Traceback", content)

        progress = state.update_progress_snapshot()
        self.assertEqual(progress["phase"], "failed")
        self.assertFalse(progress["ok"])
        self.assertIn("during download", progress["message"])
        self.assertIn("prepare-", progress["message"])

    def test_validate_failure_is_reported_as_validate(self):
        with mock.patch.object(
            endpoints_updates.update_installer, "download_zip",
        ), mock.patch.object(
            endpoints_updates.update_installer, "extract_zip",
            return_value=os.path.join(self.tmp, "extract"),
        ), mock.patch.object(
            endpoints_updates.update_installer, "validate_extract",
            side_effect=endpoints_updates.update_installer.UpdateInstallError("bad tree"),
        ):
            endpoints_updates.run_update_install(self.tmp, "9.9.9")

        content = read(self._prepare_logs()[0])
        self.assertIn("VALIDATE", content)
        self.assertIn("bad tree", content)
        progress = state.update_progress_snapshot()
        self.assertIn("during validate", progress["message"])


class ApplyFatalLoggingTests(unittest.TestCase):
    def test_fatal_crash_is_written_to_the_job_log(self):
        """The helper is detached (stderr invisible); a crash outside the
        normal step handling must still land in the job's log file."""
        tmp = tempfile.mkdtemp(prefix="rs-fatal-")
        try:
            logs_path = os.path.join(tmp, "logs", "apply.log")
            job_path = os.path.join(tmp, "job.json")
            # Job with logs_path but missing install_root: run() starts its
            # log, then crashes with KeyError -> main() must log FATAL.
            with open(job_path, "w", encoding="utf-8") as fh:
                json.dump({"logs_path": logs_path}, fh)

            code = update_apply.main(["update_apply.py", job_path])

            self.assertEqual(code, 1)
            content = read(logs_path)
            self.assertIn("FATAL", content)
            self.assertIn("KeyError", content)
            self.assertIn("Traceback", content)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
