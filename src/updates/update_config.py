"""Configuration for RendScroll's repository-based update check and install."""

import os

# --- Update check (Stage 1) ------------------------------------------------- #
UPDATE_MANIFEST_URL = "https://raw.githubusercontent.com/yagizdkurt/RendScroll/main/update_manifest.json"
UPDATE_CHECK_TIMEOUT_SECONDS = 3.0

# --- Update install (Stage 2) ----------------------------------------------- #
# Default source zip when the manifest omits `download_url`. GitHub codeload serves
# the main branch as a zip wrapped in a single `RendScroll-main/` directory.
DEFAULT_DOWNLOAD_URL = "https://codeload.github.com/yagizdkurt/RendScroll/zip/refs/heads/main"
DOWNLOAD_TIMEOUT_SECONDS = 60.0

# Update working area. Lives at the install root; treated as user/update-owned and is
# both git-ignored and one of update_installer.PROTECTED_ROOTS.
UPDATE_WORK_DIR = ".rendscroll-update"
UPDATE_DOWNLOAD_DIR = os.path.join(UPDATE_WORK_DIR, "download")
UPDATE_EXTRACT_DIR = os.path.join(UPDATE_WORK_DIR, "extract")
UPDATE_BACKUP_DIR = os.path.join(UPDATE_WORK_DIR, "backup")
UPDATE_LOGS_DIR = os.path.join(UPDATE_WORK_DIR, "logs")
UPDATE_JOB_FILE = os.path.join(UPDATE_WORK_DIR, "job.json")
UPDATE_DOWNLOAD_ZIP = os.path.join(UPDATE_DOWNLOAD_DIR, "source.zip")
# Written by a freshly launched launcher once its server binds — the apply helper
# polls for it to confirm the relaunch succeeded.
UPDATE_HEARTBEAT_FILE = os.path.join(UPDATE_WORK_DIR, "launch-ok")
