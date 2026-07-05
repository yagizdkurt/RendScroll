"""Repository manifest update checking for RendScroll.

This module fetches and validates update metadata only. It never renders UI,
modifies files, downloads application archives, or performs updates.
"""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request

from .update_config import UPDATE_CHECK_TIMEOUT_SECONDS, UPDATE_MANIFEST_URL


STATE_DISABLED = "disabled"
STATE_UP_TO_DATE = "up_to_date"
STATE_UPDATE_AVAILABLE = "update_available"
STATE_CHECK_FAILED = "check_failed"
MANUAL_UPDATE_REQUIRED_CHANGES = (
    'You are using older version than "{minimum_supported}" thus you need '
    "to update project manually. You can do this by moving content folder out, "
    "downloading the project again then moving it back in. Auto updates wont "
    "work on unsupported versions."
)

_SEMVER_RE = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")


class UpdateCheckError(ValueError):
    """Raised when manifest content cannot produce a valid update result."""


def parse_semver(version):
    """Parse a MAJOR.MINOR.PATCH version string into a comparable tuple."""
    if not isinstance(version, str):
        raise UpdateCheckError("version must be a string")
    match = _SEMVER_RE.match(version.strip())
    if not match:
        raise UpdateCheckError(f"invalid semantic version: {version!r}")
    return tuple(int(part) for part in match.groups())


def compare_versions(left, right):
    """Return -1, 0, or 1 for semantic version comparison."""
    left_parts = parse_semver(left)
    right_parts = parse_semver(right)
    if left_parts < right_parts:
        return -1
    if left_parts > right_parts:
        return 1
    return 0


def _base_result(state, current_version):
    return {
        "state": state,
        "current_version": current_version,
    }


def _optional_string(manifest, key):
    value = manifest.get(key)
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value or None


# Repo root update_manifest.json, located relative to this file so it works
# regardless of cwd (tests, the detached apply helper).
LOCAL_MANIFEST_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "update_manifest.json",
)


def load_app_version(manifest_path=LOCAL_MANIFEST_PATH):
    """Read the app's own version from the committed local update manifest.

    update_manifest.json ships with the code (and inside every update zip), so
    its `latest` field always describes the code that is running. It is the
    single source of truth for APP_VERSION — never hardcode a version string.
    A missing/broken manifest is the same integrity class as a missing
    index.html, so this fails loudly instead of guessing a version.
    """
    try:
        with open(manifest_path, encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, json.JSONDecodeError) as exc:
        raise UpdateCheckError(
            f"cannot read app version from {manifest_path}: {exc}. "
            "update_manifest.json is part of the app; re-download RendScroll."
        ) from exc
    if not isinstance(data, dict):
        raise UpdateCheckError(f"{manifest_path} must contain a JSON object")
    latest = _optional_string(data, "latest")
    if not latest:
        raise UpdateCheckError(f"{manifest_path} is missing a latest version string")
    parse_semver(latest)
    return latest


# Read once at import: the version can only change via the update flow, which
# replaces this file's manifest and relaunches the process.
APP_VERSION = load_app_version()


def validate_manifest(manifest):
    """Return normalized manifest data or raise UpdateCheckError."""
    if not isinstance(manifest, dict):
        raise UpdateCheckError("manifest must be a JSON object")

    latest = _optional_string(manifest, "latest")
    if not latest:
        raise UpdateCheckError("manifest missing required latest version")
    parse_semver(latest)

    normalized = {"latest": latest}

    # `minimum_supported_version` is the canonical field name; `minimum_supported`
    # (the original Stage 1 name) is accepted for backward compatibility. Either
    # normalizes to the internal `minimum_supported` key.
    minimum = _optional_string(manifest, "minimum_supported_version") or _optional_string(
        manifest, "minimum_supported"
    )
    if minimum:
        parse_semver(minimum)
        normalized["minimum_supported"] = minimum

    for key in ("url", "download_url", "title", "changes"):
        value = _optional_string(manifest, key)
        if not value:
            continue
        normalized[key] = value
    return normalized


def result_from_manifest(manifest, current_version=APP_VERSION):
    """Compare a normalized or raw manifest with current_version."""
    parse_semver(current_version)
    data = validate_manifest(manifest)

    latest = data["latest"]
    state = (
        STATE_UPDATE_AVAILABLE
        if compare_versions(current_version, latest) < 0
        else STATE_UP_TO_DATE
    )
    result = _base_result(state, current_version)
    result["latest_version"] = latest

    for source_key, result_key in (
        ("minimum_supported", "minimum_supported"),
        ("url", "url"),
        ("download_url", "download_url"),
        ("title", "title"),
        ("changes", "changes"),
    ):
        if source_key in data:
            result[result_key] = data[source_key]

    minimum = data.get("minimum_supported")
    if minimum and compare_versions(current_version, minimum) < 0:
        result["manual_update_required"] = True
        result["changes"] = MANUAL_UPDATE_REQUIRED_CHANGES.format(
            minimum_supported=minimum
        )

    return result


def _download_json(url, timeout, opener=None):
    if opener is not None:
        return opener(url, timeout=timeout)

    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": "RendScroll-update-checker",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read().decode("utf-8")


def check_for_updates(
    current_version=APP_VERSION,
    manifest_url=UPDATE_MANIFEST_URL,
    enabled=True,
    timeout=UPDATE_CHECK_TIMEOUT_SECONDS,
    opener=None,
):
    """Fetch the remote manifest and return a structured update state."""
    if not enabled:
        return _base_result(STATE_DISABLED, current_version)

    try:
        body = _download_json(manifest_url, timeout, opener=opener)
        manifest = json.loads(body)
        return result_from_manifest(manifest, current_version=current_version)
    except (
        OSError,
        TimeoutError,
        ValueError,
        json.JSONDecodeError,
        urllib.error.URLError,
        urllib.error.HTTPError,
        UpdateCheckError,
    ) as exc:
        result = _base_result(STATE_CHECK_FAILED, current_version)
        result["error"] = str(exc)
        return result


__all__ = [
    "APP_VERSION",
    "LOCAL_MANIFEST_PATH",
    "load_app_version",
    "STATE_CHECK_FAILED",
    "STATE_DISABLED",
    "STATE_UPDATE_AVAILABLE",
    "STATE_UP_TO_DATE",
    "MANUAL_UPDATE_REQUIRED_CHANGES",
    "UpdateCheckError",
    "check_for_updates",
    "compare_versions",
    "parse_semver",
    "result_from_manifest",
    "validate_manifest",
]
