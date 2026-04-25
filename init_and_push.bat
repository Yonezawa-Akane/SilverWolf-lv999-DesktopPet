@echo off
chcp 65001 > nul
setlocal EnableExtensions EnableDelayedExpansion

REM ============================================================
REM   Silver Wolf Pet - one-shot Git init + push to GitHub
REM   Repo target: SilverWolf-lv999-DesktopPet (public)
REM ============================================================

cd /d "%~dp0"
echo.
echo ============================================================
echo   Silver Wolf Pet  ::  Git init + push to GitHub
echo ============================================================
echo.

REM ---- 0. 清理可能残留的损坏 .git ----------------------------
if exist ".git\config.lock" (
    echo [0/7] Cleaning up stale .git folder ...
    rmdir /s /q ".git"
)

REM ---- 1. 检查 git --------------------------------------------
where git >nul 2>nul
if errorlevel 1 (
    echo [ERROR] git not found in PATH.
    echo         Install from https://git-scm.com/download/win and re-run.
    pause & exit /b 1
)
echo [1/7] git: OK
git --version

REM ---- 2. git config (一次性，不会覆盖已有全局配置) ---------
for /f "tokens=*" %%i in ('git config --global user.name 2^>nul') do set GUSER=%%i
if "!GUSER!"=="" (
    echo [2/7] Setting global git user.name = Yonezawa
    git config --global user.name "Yonezawa"
) else (
    echo [2/7] git user.name = !GUSER!
)
for /f "tokens=*" %%i in ('git config --global user.email 2^>nul') do set GMAIL=%%i
if "!GMAIL!"=="" (
    echo       Setting global git user.email = raindeng0504@gmail.com
    git config --global user.email "raindeng0504@gmail.com"
) else (
    echo       git user.email = !GMAIL!
)

REM ---- 3. init -----------------------------------------------
echo [3/7] git init (branch: main)
git init -b main
if errorlevel 1 (
    echo [WARN] '-b main' not supported by old git; falling back ...
    git init
    git symbolic-ref HEAD refs/heads/main
)

REM ---- 4. add + commit ---------------------------------------
echo [4/7] Staging files (node_modules / dist excluded by .gitignore)
git add -A
git status --short
echo.
git commit -m "feat: initial open-source release of Silver Wolf Pet (银狼lv.999 桌宠)" -m "Electron-based Honkai: Star Rail Silver Wolf themed AI desktop companion. Fan project, MIT licensed."
if errorlevel 1 (
    echo [ERROR] commit failed.
    pause & exit /b 1
)

REM ---- 5. remote ----------------------------------------------
echo.
echo [5/7] Configuring GitHub remote.
echo.
echo   Repo to create: SilverWolf-lv999-DesktopPet  (public)
echo.
echo   *** Choose how to create the GitHub repo ***
echo     [A] I will create it manually on https://github.com/new
echo         and then this script just pushes.
echo     [B] Use 'gh' CLI to create it automatically (requires `gh auth login`)
echo.
set /p choice=Enter A or B:

if /i "!choice!"=="B" goto USE_GH
goto MANUAL

:USE_GH
where gh >nul 2>nul
if errorlevel 1 (
    echo [ERROR] gh CLI not found. Install from https://cli.github.com/  or pick [A].
    pause & exit /b 1
)
gh auth status >nul 2>nul
if errorlevel 1 (
    echo gh not authenticated. Running `gh auth login` ...
    gh auth login
    if errorlevel 1 ( pause & exit /b 1 )
)
echo Creating public repo via gh ...
gh repo create "SilverWolf-lv999-DesktopPet" --public --source=. --remote=origin --description "银狼lv.999 桌宠 :: Honkai Star Rail Silver Wolf themed AI desktop companion (Electron + Anthropic Claude). Fan project."
if errorlevel 1 (
    echo [ERROR] gh repo create failed. Maybe the repo name is taken or contains unsupported chars.
    echo         Falling through to manual mode.
    goto MANUAL
)
goto PUSH

:MANUAL
echo.
echo   ^>^>^>  Open this URL in browser, create the repo (Public, NO readme/.gitignore/license auto-generated):
echo        https://github.com/new
echo.
echo        Name           : SilverWolf-lv999-DesktopPet
echo        Visibility     : Public
echo        Initialize with: nothing (we already have files locally)
echo.
set /p ghuser=Your GitHub username (e.g. yourname):
if "!ghuser!"=="" ( echo [ERROR] empty username. & pause & exit /b 1 )

REM URL-encode the % char in repo name not needed here; GitHub URLs accept Unicode + dots
set REPO_URL=https://github.com/!ghuser!/SilverWolf-lv999-DesktopPet.git
echo Adding remote: !REPO_URL!
git remote remove origin 2>nul
git remote add origin "!REPO_URL!"

:PUSH
echo.
echo [6/7] Pushing to origin/main ...
git push -u origin main
if errorlevel 1 (
    echo.
    echo [ERROR] push failed. Common causes:
    echo   - You haven't logged into GitHub on this machine yet.
    echo     Easiest fix: install GitHub Desktop or run `gh auth login`,
    echo     OR create a Personal Access Token at
    echo     https://github.com/settings/tokens  and use it as the password.
    echo   - The remote URL is wrong (check above).
    echo   - The repo name on GitHub doesn't match.
    pause & exit /b 1
)

echo.
echo [7/7] DONE.
echo   Repo URL: https://github.com/!ghuser!/SilverWolf-lv999-DesktopPet
echo.
pause
endlocal
