@echo off
"%~dp0..\node.exe" --preserve-symlinks --preserve-symlinks-main "%~dp0codex.cjs" %*
exit /b %ERRORLEVEL%
