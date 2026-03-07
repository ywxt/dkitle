#!/usr/bin/env python3
"""
Build script for dkitle browser extension (cross-platform).

Usage:
    python build.py chrome           - Build Chrome extension (.zip)
    python build.py firefox          - Build Firefox extension (.zip)
    python build.py all              - Build both (default)
    python build.py chrome --dev     - Build Chrome as unpacked directory (for debugging)
    python build.py all --dev        - Build both as unpacked directories
"""

import os
import shutil
import sys
import zipfile
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent
EXT_DIR = ROOT_DIR / "dkitle-extension"
BUILD_DIR = ROOT_DIR / "build"

EXT_FILES = [
    "background.js",
    "popup.html",
    "popup.js",
    "providers/intercept-base.js",
    "providers/provider-base.js",
    "providers/youtube-intercept.js",
    "providers/youtube.js",
    "providers/bilibili-intercept.js",
    "providers/bilibili.js",
]

TARGETS = {
    "chrome": {"manifest_src": "manifest.json", "out_name": "dkitle-chrome.zip"},
    "firefox": {"manifest_src": "manifest.firefox.json", "out_name": "dkitle-firefox.zip"},
}


def copy_extension_files(target: str, dest: Path) -> None:
    """Copy manifest and extension files to the destination directory."""
    cfg = TARGETS[target]
    if dest.exists():
        shutil.rmtree(dest)
    (dest / "providers").mkdir(parents=True)

    # Copy manifest
    shutil.copy2(EXT_DIR / cfg["manifest_src"], dest / "manifest.json")

    # Copy extension files
    for f in EXT_FILES:
        shutil.copy2(EXT_DIR / f, dest / f)


def build_zip(target: str) -> None:
    """Build a .zip package for distribution."""
    cfg = TARGETS[target]
    staging = BUILD_DIR / f"staging-{target}"

    copy_extension_files(target, staging)

    # Create zip
    out_path = BUILD_DIR / cfg["out_name"]
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, _dirs, files in os.walk(staging):
            for fname in sorted(files):
                full = Path(root) / fname
                arcname = full.relative_to(staging).as_posix()
                zf.write(full, arcname)

    # Clean up staging
    shutil.rmtree(staging)

    print(f"Built: {out_path}")


def build_dev(target: str) -> None:
    """Build an unpacked directory for debugging / direct browser loading."""
    out_dir = BUILD_DIR / target

    copy_extension_files(target, out_dir)

    print(f"Built: {out_dir}/")


def main() -> None:
    args = sys.argv[1:]
    dev_mode = "--dev" in args
    args = [a for a in args if a != "--dev"]

    target = args[0] if args else "all"

    if target not in ("chrome", "firefox", "all"):
        print(
            f"Usage: {sys.argv[0]} {{chrome|firefox|all}} [--dev]",
            file=sys.stderr,
        )
        sys.exit(1)

    if BUILD_DIR.exists():
        shutil.rmtree(BUILD_DIR)
    BUILD_DIR.mkdir()

    build_fn = build_dev if dev_mode else build_zip
    targets = TARGETS if target == "all" else [target]

    for t in targets:
        build_fn(t)

    print("Done.")


if __name__ == "__main__":
    main()
