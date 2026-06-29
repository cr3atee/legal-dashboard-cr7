@echo off
setlocal
cd /d "%~dp0"

echo [1/4] Installing dependencies...
call npm.cmd ci
if errorlevel 1 goto :error

echo [2/4] Building map...
call npm.cmd run build
if errorlevel 1 goto :error

echo [3/4] Preparing domain package...
node package-domain.cjs
if errorlevel 1 goto :error

echo [4/4] Creating ZIP...
if exist standalone-map-domain.zip del /f /q standalone-map-domain.zip
tar -a -c -f standalone-map-domain.zip domain-package
if errorlevel 1 goto :error

echo.
echo Ready:
echo %CD%\domain-package
echo %CD%\standalone-map-domain.zip
pause
exit /b 0

:error
echo.
echo Build failed. Check the messages above.
pause
exit /b 1
