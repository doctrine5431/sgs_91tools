# Project instructions

- Before any git push, tag push, GitHub Release creation, or asset upload, show the user the complete upload preview required by `docs/RELEASING.md`.
- Do not perform an external upload until the user explicitly confirms the displayed version, changelog, release notes, asset, checksum, and test result.
- The finished userscript must run fully on its own. Never make another userscript, `__JND`, or a remote script a required runtime dependency; external integrations may only be optional compatibility paths.
