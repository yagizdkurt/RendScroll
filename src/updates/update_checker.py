"""Repository manifest update checking for RendScroll.

This module fetches and validates update metadata only. It never renders UI,
modifies files, downloads application archives, or performs updates.
"""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.request

from .update_config import UPDATE_CHECK_TIMEOUT_SECONDS, UPDATE_MANIFEST_URL


APP_VERSION = "1.2.0"
STATE_DISABLED = "disabled"
STATE_UP_TO_DATE = "up_to_date"
STATE_UPDATE_AVAILABLE = "update_available"
STATE_CHECK_FAILED = "check_failed"

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


def validate_manifest(manifest):
    """Return normalized manifest data or raise UpdateCheckError."""
    if not isinstance(manifest, dict):
        raise UpdateCheckError("manifest must be a JSON object")

    latest = _optional_string(manifest, "latest")
    if not latest:
        raise UpdateCheckError("manifest missing required latest version")
    parse_semver(latest)

    normalized = {"latest": latest}

    # `minimum_supported_version` is the Stage 2 name; `minimum_supported` is the
    # original Stage 1 field. Accept either and normalize to `minimum_supported`.
    minimum = _optional_string(manifest, "minimum_supported") or _optional_string(
        manifest, "minimum_supported_version"
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
    "STATE_CHECK_FAILED",
    "STATE_DISABLED",
    "STATE_UPDATE_AVAILABLE",
    "STATE_UP_TO_DATE",
    "UpdateCheckError",
    "check_for_updates",
    "compare_versions",
    "parse_semver",
    "result_from_manifest",
    "validate_manifest",
]
