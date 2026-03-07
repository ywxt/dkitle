#!/usr/bin/env bash
# Wrapper for build.py (Linux/macOS convenience)
exec python3 "$(dirname "$0")/build.py" "$@"
