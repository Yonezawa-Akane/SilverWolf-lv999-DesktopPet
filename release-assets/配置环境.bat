@echo off
chcp 65001 >nul
title 银狼桌宠 - 环境配置（首次运行）
echo.
echo ====== 银狼桌宠首次配置 ======
echo.

REM 检查 VC++ 2015-2022 x64 运行库是否已装
reg query "HKLM\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" /v Installed >nul 2>&1
if %errorlevel%==0 (
  echo [OK] VC++ 运行库已安装，无需重复配置。
  goto DONE
)

echo [!] 未检测到 VC++ 运行库，正在自动安装...
echo     ^(这是语音输入功能的依赖，约 14MB^)
echo.

if not exist "%~dp0redist\vc_redist.x64.exe" (
  echo [X] 找不到 redist\vc_redist.x64.exe，请联系开发者重新发包。
  pause & exit /b 1
)

"%~dp0redist\vc_redist.x64.exe" /install /quiet /norestart
if %errorlevel%==0 (
  echo [OK] VC++ 运行库安装成功。
) else if %errorlevel%==1638 (
  echo [OK] VC++ 运行库已是最新版本。
) else if %errorlevel%==3010 (
  echo [OK] 安装完成，重启电脑后语音功能即可用。
) else (
  echo [X] 自动安装失败 ^(错误码 %errorlevel%^)。
  echo     请手动运行 redist\vc_redist.x64.exe 完成安装。
  pause & exit /b 1
)

:DONE
echo.
echo 配置完成！现在可以双击 "启动银狼.bat" 启动应用。
echo.
pause
