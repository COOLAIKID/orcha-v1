"""Keep a Windows PC from sleeping while an always-on company is running."""

from __future__ import annotations

import sys


ES_CONTINUOUS = 0x80000000
ES_SYSTEM_REQUIRED = 0x00000001


def hold_pc_awake(active: bool) -> None:
    """Ask Windows to stay awake. No-op on other platforms. Display may still sleep."""
    if sys.platform != "win32":
        return
    try:
        import ctypes
        flags = ES_CONTINUOUS | (ES_SYSTEM_REQUIRED if active else 0)
        ctypes.windll.kernel32.SetThreadExecutionState(flags)
    except Exception:
        return
