#!/usr/bin/env bash
# Convenience wrapper for build.py
# Usage:
#   ./build.sh package                    - Package for current platform
#   ./build.sh package --target <triple>  - Package for specific target

set -e
cd "$(dirname "$0")"
python3 build.py "$@"
