#!/usr/bin/env python3
"""
Build script for dkitle desktop app packaging.

Usage:
    python build.py package                                    - Build for current platform
    python build.py package --target x86_64-unknown-linux-gnu  - Build for specific target
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
APP_DIR = ROOT_DIR / "dkitle-app"
BUILD_DIR = ROOT_DIR / "build"

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


def build_package(target_triple: str) -> None:
    """Build the Rust app and create a release archive."""
    if target_triple not in TARGET_INFO:
        print(f"Unsupported target: {target_triple}", file=sys.stderr)
        print(f"Supported targets: {', '.join(TARGET_INFO.keys())}", file=sys.stderr)
        sys.exit(1)

    info = TARGET_INFO[target_triple]
    version = _get_version()

    print(f"Building dkitle v{version} for {target_triple}...")

    # 1. Generate icons
    print("==> Generating icons...")
    icon_script = ROOT_DIR / "scripts" / "generate_icons.py"
    result = subprocess.run([sys.executable, str(icon_script)])
    if result.returncode != 0:
        print("Icon generation failed!", file=sys.stderr)
        sys.exit(1)

    # 2. Build Rust app
    print("==> Building Rust application...")
    cargo_args = ["cargo", "build", "--release", "--target", target_triple]
    result = subprocess.run(cargo_args, cwd=APP_DIR)
    if result.returncode != 0:
        print("Cargo build failed!", file=sys.stderr)
        sys.exit(1)

    # 3. Assemble release archive
    print("==> Assembling release archive...")
    staging = BUILD_DIR / "staging-package"
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

    elif info["os"] == "linux":
        staging.mkdir(parents=True)
        shutil.copy2(binary_src, staging / info["exe"])
        os.chmod(staging / info["exe"], 0o755)
        shutil.copy2(APP_DIR / "assets" / "dkitle.desktop", staging / "dkitle.desktop")
        shutil.copy2(APP_DIR / "assets" / "icon.png", staging / "icon.png")

    elif info["os"] == "windows":
        staging.mkdir(parents=True)
        shutil.copy2(binary_src, staging / info["exe"])

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

    command = args[0] if args else "package"

    if command == "package":
        if target_triple is None:
            target_triple = _detect_target()
        if BUILD_DIR.exists():
            shutil.rmtree(BUILD_DIR)
        BUILD_DIR.mkdir()
        build_package(target_triple)
    else:
        print(f"Usage: {sys.argv[0]} package [--target <triple>]", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
