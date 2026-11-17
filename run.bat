@echo off
rem Start the read_me server. Usage: run.bat [folder-to-browse]
cd /d "%~dp0"
set ROOT=%~1
if "%ROOT%"=="" set ROOT=C:\laragon\www
start "" http://127.0.0.1:8765
".venv\Scripts\python.exe" -m readme_server --port 8765 --root "%ROOT%"
