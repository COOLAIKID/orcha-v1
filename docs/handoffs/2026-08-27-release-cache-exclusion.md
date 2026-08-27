# Handoff — Release cache exclusion correction

Changed: Updated `orcha-v1-starter-kit/scripts/package-orcha-release.ps1` to
exclude `__pycache__`, `.mypy_cache`, `.ruff_cache`, `.cache`, Python bytecode,
and coverage state during staging, then validate the same paths after ZIP
creation. Updated `RELEASE-MANIFEST.md` to describe the corrected boundary.

Discovered: The prior release scan checked several directory classes but did
not check Python bytecode or `__pycache__`; those files had entered the ZIP
despite a zero reported exclusion count.

Validated: Regenerated archive scan is required after this handoff; the
packager now fails closed if any listed cache or bytecode path is present.

Open: Hosted multi-tenant persistence and provider credential storage remain
outside this local starter kit.
