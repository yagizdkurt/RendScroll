"""Shared step logger for the update flow.

Both the in-server prepare phase (``endpoints_updates.run_update_install``:
download/extract/validate/handoff) and the detached apply helper
(``update_apply``) write the same plain-text, timestamped, user-readable step
log under ``.rendscroll-update/logs/``, so a failed update always leaves a
trace on disk no matter which phase it died in.
"""

from __future__ import annotations

import os
import time
import traceback


class StepLogger:
    """Plain-text, timestamped, user-readable step log (also echoed to stdout)."""

    def __init__(self, path):
        self.path = path
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        self._fh = open(path, "a", encoding="utf-8")

    def line(self, step, status, detail=""):
        stamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        text = f"{stamp}  {step:<9} {status:<5} {detail}".rstrip()
        self._fh.write(text + "\n")
        self._fh.flush()
        print(text, flush=True)

    def exception(self, step, exc):
        """Log a step failure followed by the full traceback, indented so the
        step lines stay scannable. Must be called from the ``except`` block."""
        self.line(step, "fail", str(exc))
        for tb_line in traceback.format_exc().rstrip().splitlines():
            self._fh.write("    " + tb_line + "\n")
        self._fh.flush()

    def close(self):
        try:
            self._fh.close()
        except OSError:
            pass


__all__ = ["StepLogger"]
