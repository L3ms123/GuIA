@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" -c "import cohere, dotenv, edge_tts, flask, flask_cors, imageio_ffmpeg" >nul 2>nul
  if not errorlevel 1 (
    ".venv\Scripts\python.exe" run_guia.py
    exit /b !errorlevel!
  )
)

python -c "import cohere, dotenv, edge_tts, flask, flask_cors, imageio_ffmpeg" >nul 2>nul
if not errorlevel 1 (
  python run_guia.py
  exit /b !errorlevel!
) else if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" run_guia.py
  exit /b !errorlevel!
) else (
  python run_guia.py
  exit /b !errorlevel!
)
