@echo off
chcp 65001 >nul
cd /d "%~dp0"
title SilverWolfPet Build

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] Node.js not found. Install from https://nodejs.org
    pause & exit /b 1
)

echo Killing any running instances...
taskkill /f /im SilverWolfPet.exe >nul 2>&1
timeout /t 1 /nobreak >nul

echo.
echo [1/5] npm install...
call npm install
if %errorlevel% neq 0 ( echo [!] FAILED & pause & exit /b 1 )

echo.
echo [2/5] icon...
where python >nul 2>&1
if %errorlevel% equ 0 ( python -m pip install pillow -q 2>nul & python scripts\gen_icon.py )

echo.
echo [3/5] electron-packager...
call npm run build
if %errorlevel% neq 0 ( echo [!] BUILD FAILED & pause & exit /b 1 )

set "DIST=dist\SilverWolfPet-win32-x64"
echo.
echo [4/5] copying docs into %DIST% ...
if exist "docs\快速开始.txt"   copy /Y "docs\快速开始.txt"   "%DIST%\" >nul
if exist "docs\使用说明书.md"  copy /Y "docs\使用说明书.md"  "%DIST%\" >nul
if exist "README.md"           copy /Y "README.md"           "%DIST%\" >nul
if exist "CHANGELOG.md"        copy /Y "CHANGELOG.md"        "%DIST%\" >nul

echo.
echo [5/5] zipping release...
for /f "tokens=*" %%v in ('node -p "require('./package.json').version"') do set VERSION=%%v
set "ZIPNAME=SilverWolfPet-v%VERSION%-win-x64.zip"
if exist "dist\%ZIPNAME%" del "dist\%ZIPNAME%"
powershell -NoProfile -Command "$ErrorActionPreference='Stop'; try { Compress-Archive -Path 'dist\SilverWolfPet-win32-x64\*' -DestinationPath 'dist\%ZIPNAME%' -Force; Write-Host '[ok] zipped' } catch { Write-Host '[!] zip failed:' $_.Exception.Message; exit 1 }"

echo.
echo ============================================
echo  DONE
echo ============================================
echo  Folder:  %DIST%\SilverWolfPet.exe
echo  Release: dist\%ZIPNAME%
echo ============================================
echo.
if exist dist ( explorer dist )
pause
