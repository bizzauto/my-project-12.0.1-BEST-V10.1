@echo off
REM ============================================================
REM  BizzAuto — Commit & Push (saare pending changes)
REM  Run this from the project root. Git MUST be installed.
REM ============================================================
cd /d "%~dp0"

echo.
echo [1/4] Git status...
git status --short

echo.
echo [2/4] Staging all changes (gitignore excludes node_modules, dist, secrets)...
git add -A

echo.
echo [3/4] Committing...
git commit -m "feat(ui): enterprise app shell redesign + functional sidebar search"

echo.
echo [4/4] Pushing to current branch's upstream...
git push

echo.
echo Done. Press any key to close.
pause >nul
