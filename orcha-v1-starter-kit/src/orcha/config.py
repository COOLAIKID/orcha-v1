"""Small, dependency-free configuration loader for the local API.

The Windows start scripts already load ``orcha.local.env``. Loading the same
ignored file here keeps the documented direct ``uvicorn`` command honest while
leaving explicitly provided process environment variables authoritative. This
is deliberately not a general dotenv implementation or a remote secret store.
"""

from __future__ import annotations

import os
import re
from pathlib import Path


_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_TRUTHY = {"1", "true", "yes", "on"}


def _default_path() -> Path:
    return Path(__file__).resolve().parents[2] / "orcha.local.env"


def load_local_environment(path: str | Path | None = None) -> Path | None:
    """Load the optional local API environment file without overriding env.

    ``ORCHA_LOCAL_ENV_FILE`` selects a different private file. Set
    ``ORCHA_DISABLE_LOCAL_ENV=true`` when the API is launched in an explicit
    hosted environment where process/container secrets must be the only source.
    Missing files are normal; malformed entries fail fast so a typo cannot
    silently produce a misleading ``unconfigured`` runtime.
    """

    if os.getenv("ORCHA_DISABLE_LOCAL_ENV", "").strip().lower() in _TRUTHY:
        return None
    selected = Path(path or os.getenv("ORCHA_LOCAL_ENV_FILE", "") or _default_path()).expanduser()
    if not selected.is_file():
        return None

    for line_number, raw_line in enumerate(selected.read_text(encoding="utf-8-sig").splitlines(), start=1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        name, separator, value = line.partition("=")
        name = name.strip()
        if not separator or not _NAME.fullmatch(name):
            raise ValueError(f"Invalid environment entry at {selected}:{line_number}. Use NAME=value.")
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        # Process/container values are explicit and win over the local helper.
        os.environ.setdefault(name, value)
    return selected
