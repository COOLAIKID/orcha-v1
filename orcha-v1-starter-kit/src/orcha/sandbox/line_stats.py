"""Line counts for workspace writes. Never invents git or compiler stats."""

from __future__ import annotations

from difflib import SequenceMatcher


def count_lines(text: str) -> int:
    if not text:
        return 0
    return text.count("\n") + (0 if text.endswith("\n") else 1)


def line_delta(before: str | None, after: str) -> dict:
    after_lines = after.splitlines()
    lines = len(after_lines)
    if before is None:
        return {"created": True, "lines": lines, "linesAdded": lines, "linesRemoved": 0}
    matcher = SequenceMatcher(a=before.splitlines(), b=after_lines, autojunk=False)
    added = 0
    removed = 0
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "replace":
            removed += i2 - i1
            added += j2 - j1
        elif tag == "delete":
            removed += i2 - i1
        elif tag == "insert":
            added += j2 - j1
    return {"created": False, "lines": lines, "linesAdded": added, "linesRemoved": removed}
