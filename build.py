#!/usr/bin/env python3
"""
Build script for dkitle (cross-platform).

Usage:
    python build.py chrome           - Build Chrome extension (.zip)
    python build.py firefox          - Build Firefox extension (.zip)
    python build.py all              - Build both extensions (default)
    python build.py chrome --dev     - Build Chrome as unpacked directory (for debugging)
    python build.py all --dev        - Build both as unpacked directories
    python build.py package          - Build Rust app + extensions, create release archive
    python build.py package --target x86_64-unknown-linux-gnu
"""

import os
import platform
import shutil
import subprocess
import sys
import tarfile
import zipfile
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent
EXT_DIR = ROOT_DIR / "dkitle-extension"
APP_DIR = ROOT_DIR / "dkitle-app"
BUILD_DIR = ROOT_DIR / "build"

EXT_FILES = [
    "background.js",
    "popup.html",
    "popup.js",
    "icons/icon-16.png",
    "icons/icon-32.png",
    "icons/icon-48.png",
    "icons/icon-128.png",
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

# Map target triples to platform info
TARGET_INFO = {
    "x86_64-unknown-linux-gnu": {"os": "linux", "arch": "x86_64", "exe": "dkitle-app", "archive": "tar.gz"},
    "aarch64-unknown-linux-gnu": {"os": "linux", "arch": "aarch64", "exe": "dkitle-app", "archive": "tar.gz"},
    "x86_64-pc-windows-msvc": {"os": "windows", "arch": "x86_64", "exe": "dkitle-app.exe", "archive": "zip"},
    "aarch64-pc-windows-msvc": {"os": "windows", "arch": "aarch64", "exe": "dkitle-app.exe", "archive": "zip"},
    "x86_64-apple-darwin": {"os": "macos", "arch": "x86_64", "exe": "dkitle-app", "archive": "tar.gz"},
    "aarch64-apple-darwin": {"os": "macos", "arch": "aarch64", "exe": "dkitle-app", "archive": "tar.gz"},
}


def _get_version() -> str:
    """Read version from Cargo.toml."""
    cargo_toml = APP_DIR / "Cargo.toml"
    for line in cargo_toml.read_text().splitlines():
        if line.strip().startswith("version"):
            return line.split('"')[1]
    return "0.0.0"


def _detect_target() -> str:
    """Detect the current platform's target triple."""
    machine = platform.machine().lower()
    system = platform.system().lower()

    arch_map = {"x86_64": "x86_64", "amd64": "x86_64", "aarch64": "aarch64", "arm64": "aarch64"}
    arch = arch_map.get(machine, machine)

    if system == "linux":
        return f"{arch}-unknown-linux-gnu"
    elif system == "windows":
        return f"{arch}-pc-windows-msvc"
    elif system == "darwin":
        return f"{arch}-apple-darwin"
    else:
        print(f"Unsupported platform: {system} {machine}", file=sys.stderr)
        sys.exit(1)


def copy_extension_files(target: str, dest: Path) -> None:
    """Copy manifest and extension files to the destination directory."""
    cfg = TARGETS[target]
    if dest.exists():
        shutil.rmtree(dest)
    (dest / "providers").mkdir(parents=True)
    (dest / "icons").mkdir(parents=True)

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


def build_package(target_triple: str) -> None:
    """Build the Rust app and extensions, then create a release archive."""
    if target_triple not in TARGET_INFO:
        print(f"Unsupported target: {target_triple}", file=sys.stderr)
        print(f"Supported targets: {', '.join(TARGET_INFO.keys())}", file=sys.stderr)
        sys.exit(1)

    info = TARGET_INFO[target_triple]
    version = _get_version()

    print(f"Building dkitle v{version} for {target_triple}...")

    # 1. Build Rust app
    print("==> Building Rust application...")
    cargo_args = ["cargo", "build", "--release", "--target", target_triple]
    result = subprocess.run(cargo_args, cwd=APP_DIR)
    if result.returncode != 0:
        print("Cargo build failed!", file=sys.stderr)
        sys.exit(1)

    # 2. Build browser extensions
    print("==> Building browser extensions...")
    for t in TARGETS:
        build_zip(t)

    # 3. Assemble release archive
    print("==> Assembling release archive...")
    staging = BUILD_DIR / f"staging-package"
    if staging.exists():
        shutil.rmtree(staging)

    binary_src = APP_DIR / "target" / target_triple / "release" / info["exe"]
    if not binary_src.exists():
        print(f"Binary not found: {binary_src}", file=sys.stderr)
        sys.exit(1)

    archive_name = f"dkitle-{version}-{info['os']}-{info['arch']}"

    if info["os"] == "macos":
        # Create .app bundle
        app_dir = staging / "dkitle.app" / "Contents"
        (app_dir / "MacOS").mkdir(parents=True)
        (app_dir / "Resources").mkdir(parents=True)

        shutil.copy2(binary_src, app_dir / "MacOS" / info["exe"])
        os.chmod(app_dir / "MacOS" / info["exe"], 0o755)
        shutil.copy2(APP_DIR / "assets" / "macos" / "Info.plist", app_dir / "Info.plist")
        shutil.copy2(APP_DIR / "assets" / "macos" / "AppIcon.icns", app_dir / "Resources" / "AppIcon.icns")

        # Copy extension zips alongside .app
        for t in TARGETS:
            shutil.copy2(BUILD_DIR / TARGETS[t]["out_name"], staging / TARGETS[t]["out_name"])

    elif info["os"] == "linux":
        staging.mkdir(parents=True)
        shutil.copy2(binary_src, staging / info["exe"])
        os.chmod(staging / info["exe"], 0o755)
        shutil.copy2(APP_DIR / "assets" / "dkitle.desktop", staging / "dkitle.desktop")
        shutil.copy2(APP_DIR / "assets" / "icon.png", staging / "icon.png")

        # Copy extension zips
        for t in TARGETS:
            shutil.copy2(BUILD_DIR / TARGETS[t]["out_name"], staging / TARGETS[t]["out_name"])

    elif info["os"] == "windows":
        staging.mkdir(parents=True)
        shutil.copy2(binary_src, staging / info["exe"])

        # Copy extension zips
        for t in TARGETS:
            shutil.copy2(BUILD_DIR / TARGETS[t]["out_name"], staging / TARGETS[t]["out_name"])

    # 4. Create archive
    if info["archive"] == "tar.gz":
        out_path = BUILD_DIR / f"{archive_name}.tar.gz"
        with tarfile.open(out_path, "w:gz") as tar:
            for item in sorted(staging.rglob("*")):
                if item.is_file():
                    arcname = f"{archive_name}/{item.relative_to(staging).as_posix()}"
                    tar.add(item, arcname=arcname)
    else:
        out_path = BUILD_DIR / f"{archive_name}.zip"
        with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for item in sorted(staging.rglob("*")):
                if item.is_file():
                    arcname = f"{archive_name}/{item.relative_to(staging).as_posix()}"
                    zf.write(item, arcname)

    # Clean up staging
    shutil.rmtree(staging)

    print(f"Built: {out_path}")
    print("Done.")


def main() -> None:
    args = sys.argv[1:]
    dev_mode = "--dev" in args
    args = [a for a in args if a != "--dev"]

    # Extract --target value
    target_triple = None
    filtered_args = []
    i = 0
    while i < len(args):
        if args[i] == "--target" and i + 1 < len(args):
            target_triple = args[i + 1]
            i += 2
        else:
            filtered_args.append(args[i])
            i += 1
    args = filtered_args

    command = args[0] if args else "all"

    if command == "package":
        if target_triple is None:
            target_triple = _detect_target()
        if BUILD_DIR.exists():
            shutil.rmtree(BUILD_DIR)
        BUILD_DIR.mkdir()
        build_package(target_triple)
        return

    if command not in ("chrome", "firefox", "all"):
        print(
            f"Usage: {sys.argv[0]} {{chrome|firefox|all|package}} [--dev] [--target <triple>]",
            file=sys.stderr,
        )
        sys.exit(1)

    if BUILD_DIR.exists():
        shutil.rmtree(BUILD_DIR)
    BUILD_DIR.mkdir()

    build_fn = build_dev if dev_mode else build_zip
    targets = TARGETS if command == "all" else [command]

    for t in targets:
        build_fn(t)

    print("Done.")


if __name__ == "__main__":
    main()
