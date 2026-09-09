@ECHO OFF
REM pull-and-deploy.cmd — Windows CMD wrapper around pull-and-deploy.ps1
REM Usage: scripts\pull-and-deploy.cmd [branch] [extra deploy args...]
SETLOCAL
SET BRANCH=%~1
IF "%BRANCH%"=="" SET BRANCH=main
SHIFT 2>nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0pull-and-deploy.ps1" -Branch "%BRANCH%" -DeployArgs "%*"
EXIT /B %ERRORLEVEL%
