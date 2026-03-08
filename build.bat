@echo off
REM Convenience wrapper for build.py
REM Usage:
REM   build.bat package                    - Package for current platform
REM   build.bat package --target <triple>  - Package for specific target

cd /d "%~dp0"
python build.py %*
