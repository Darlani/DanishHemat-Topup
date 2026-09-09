@echo off
setlocal EnableExtensions EnableDelayedExpansion

echo.
echo ========================================
echo      DaPay Git Checkpoint - NO PUSH
echo ========================================
echo.

echo [1/3] Checking repository...
git status --short
if errorlevel 1 (
    echo.
    echo [ERROR] Git repository tidak dapat dibaca.
    exit /b 1
)

echo.
echo [2/3] Select files to stage...
set "FILES_TO_STAGE="
set /p "FILES_TO_STAGE=Files to stage (space-separated paths): "
if not defined FILES_TO_STAGE (
    echo.
    echo [ERROR] File list tidak boleh kosong.
    exit /b 1
)

if "!FILES_TO_STAGE!"=="." goto :unsafe_input
if "!FILES_TO_STAGE!"==".." goto :unsafe_input
if "!FILES_TO_STAGE!"=="*" goto :unsafe_input
if "!FILES_TO_STAGE!"=="-A" goto :unsafe_input
if "!FILES_TO_STAGE!"=="--all" goto :unsafe_input
if "!FILES_TO_STAGE!"=="-a" goto :unsafe_input
if not "!FILES_TO_STAGE:&= !"=="!FILES_TO_STAGE!" goto :unsafe_input
if not "!FILES_TO_STAGE:|= !"=="!FILES_TO_STAGE!" goto :unsafe_input
if not "!FILES_TO_STAGE:<= !"=="!FILES_TO_STAGE!" goto :unsafe_input
if not "!FILES_TO_STAGE:>= !"=="!FILES_TO_STAGE!" goto :unsafe_input
if not "!FILES_TO_STAGE:^= !"=="!FILES_TO_STAGE!" goto :unsafe_input

for %%P in (!FILES_TO_STAGE!) do (
    if "%%~P"=="." goto :unsafe_input
    if "%%~P"==".." goto :unsafe_input
    if "%%~P"=="*" goto :unsafe_input
    if "%%~P"=="-A" goto :unsafe_input
    if "%%~P"=="--all" goto :unsafe_input
    if "%%~P"=="-a" goto :unsafe_input
)

git add -- !FILES_TO_STAGE!
if errorlevel 1 (
    echo.
    echo [ERROR] git add gagal.
    exit /b 1
)

echo.
echo [2/3] Staged changes:
git status --short
git diff --cached --stat
git diff --cached --check
if errorlevel 1 (
    echo.
    echo [ERROR] Staged diff check gagal.
    exit /b 1
)

echo.
echo [REVIEW] Staged diff follows:
git diff --cached
echo.
set "CONFIRM="
set /p "CONFIRM=Commit staged changes? (Y/N): "
if /I "!CONFIRM!"=="N" (
    echo [INFO] Commit dibatalkan. Staged changes dibiarkan.
    exit /b 0
)
if /I not "!CONFIRM!"=="Y" (
    echo [ERROR] Jawaban harus Y atau N.
    exit /b 1
)

echo.
echo [3/3] Creating commit...
set "MSG="
set /p "MSG=Commit message: "

if not defined MSG (
    echo [ERROR] Commit message tidak boleh kosong.
    exit /b 1
)

git commit -m "!MSG!"
if errorlevel 1 (
    echo.
    echo [ERROR] git commit gagal.
    exit /b 1
)

echo.
echo ========================================
echo     Checkpoint berhasil - NO PUSH
echo ========================================
echo.

git status --short
git log -1 --oneline
exit /b 0

:unsafe_input
echo.
echo [ERROR] File list mengandung pola atau karakter yang tidak aman.
echo [INFO] Gunakan path eksplisit, quote path yang memiliki spasi, dan jangan gunakan . atau wildcard.
exit /b 1