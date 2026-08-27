"""Private, local feedback intake. A GitHub sink can implement FeedbackSink later."""

from __future__ import annotations

import json
import os
import platform
import re
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Annotated, Literal, Protocol
from uuid import uuid4

from pydantic import BaseModel, Field, field_validator

# Diagnostics are opt-in, but their input is still untrusted browser text.
# Redact both labeled assignments and common raw credential/path shapes; an
# error can contain a token without spelling out the variable name.
REDACT_ASSIGNMENT = re.compile(
    r"(?i)\b(?:api[_-]?key|token|secret|password|authorization|bearer)\b\s*(?:[:=]|is)\s*[^\s,;]+"
)
REDACT_BEARER = re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]{12,}")
REDACT_JWT = re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b")
REDACT_PROVIDER_KEY = re.compile(r"\b(?:sk-or-v1-|sk-|gsk_|AIza)[A-Za-z0-9_-]{16,}\b")
REDACT_ENV_ASSIGNMENT = re.compile(r"\b[A-Z][A-Z0-9_]{2,}\s*=\s*[^\s,;]+")
REDACT_WINDOWS_PATH = re.compile(r"(?<![A-Za-z0-9])[A-Za-z]:[\\/][^\s\"'<>|]+")
REDACT_UNIX_PATH = re.compile(r"(?<![A-Za-z0-9:])/(?:Users|home|var|tmp|opt|mnt|workspace|private|etc|usr|root)(?:[/\\][^\s\"'<>|]+)+")
REDACT_URL = re.compile(r"https?://[^\s]+", re.IGNORECASE)


class FeedbackPayload(BaseModel):
    type: Literal["bug", "suggestion", "feature", "other"]
    message: str = Field(min_length=1, max_length=4000)
    actual: str | None = Field(default=None, max_length=2000)
    expected: str | None = Field(default=None, max_length=2000)
    include_technical_info: bool = False
    route: str | None = Field(default=None, max_length=300)
    client_errors: list[Annotated[str, Field(max_length=600)]] = Field(default_factory=list, max_length=5)

    @field_validator("message", "actual", "expected", "route", mode="before")
    @classmethod
    def strip_text(cls, value):
        return value.strip() if isinstance(value, str) else value


class FeedbackSink(Protocol):
    def submit(self, record: dict) -> str: ...


class LocalFeedbackSink:
    def __init__(self, directory: Path | str | None = None):
        self.directory = Path(directory or os.getenv("ORCHA_FEEDBACK_DIR", "var/feedback"))
        self._lock = Lock()

    def submit(self, record: dict) -> str:
        with self._lock:
            self.directory.mkdir(parents=True, exist_ok=True)
            path = self.directory / "feedback.jsonl"
            with path.open("a", encoding="utf-8") as target:
                target.write(json.dumps(record, ensure_ascii=False) + "\n")
        return record["id"]


def sanitize_text(value: str, limit: int = 600) -> str:
    sanitized = str(value or "").replace("\x00", "")
    for pattern, replacement in (
        (REDACT_ASSIGNMENT, "[redacted]"),
        (REDACT_BEARER, "[redacted]"),
        (REDACT_JWT, "[redacted]"),
        (REDACT_PROVIDER_KEY, "[redacted]"),
        (REDACT_ENV_ASSIGNMENT, "[redacted]"),
        (REDACT_WINDOWS_PATH, "[path]"),
        (REDACT_UNIX_PATH, "[path]"),
        (REDACT_URL, "[url]"),
    ):
        sanitized = pattern.sub(replacement, sanitized)
    return sanitized.strip()[:limit]


def sanitize_diagnostics(payload: FeedbackPayload, runtime_version: str | None = None) -> dict | None:
    if not payload.include_technical_info:
        return None
    route = (payload.route or "/").split("?", 1)[0].split("#", 1)[0]
    # The browser supplies window.location.pathname. Fail closed if an
    # untrusted caller submits an origin, protocol-relative URL, or other
    # non-path value so diagnostics cannot become a cross-site tracker.
    if not route.startswith("/") or route.startswith("//"):
        route = "/"
    return {
        "orchaVersion": "0.1.0",
        "runtimeVersion": sanitize_text(runtime_version or "unavailable", 80),
        "platform": platform.system()[:80],
        "route": route[:300],
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "recentErrors": [sanitize_text(item) for item in payload.client_errors if isinstance(item, str)][:5],
    }


def make_feedback_record(payload: FeedbackPayload, runtime_version: str | None = None) -> dict:
    return {
        "id": f"fb_{uuid4().hex[:12]}",
        "submittedAt": datetime.now(timezone.utc).isoformat(),
        "type": payload.type,
        "message": sanitize_text(payload.message, 4000),
        "actual": sanitize_text(payload.actual, 2000) if payload.actual else None,
        "expected": sanitize_text(payload.expected, 2000) if payload.expected else None,
        "diagnostics": sanitize_diagnostics(payload, runtime_version),
    }
