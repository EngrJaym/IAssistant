@echo off
setlocal
cd /d "%~dp0"
python -c "import sys; sys.exit(0 if sys.version_info>=(3,11) else 1)" >nul 2>nul || (echo Python 3.11 or newer is required. & pause & exit /b 1)
where node >nul 2>nul || (echo Node.js 18 or newer is required. & pause & exit /b 1)
if not exist backend\.env (
  copy backend\.env.example backend\.env >nul
  echo Created backend\.env - set OPENAI_API_KEY in it, save, then run start.bat again.
  notepad backend\.env
  pause & exit /b 0
)
if not exist backend\.venv python -m venv backend\.venv
backend\.venv\Scripts\python -c "import fastapi,openai,websockets,pypdf,docx,multipart,dotenv" >nul 2>nul || backend\.venv\Scripts\python -m pip install -r backend\requirements.txt
if not exist frontend\node_modules ( pushd frontend & call npm install & popd )
start "IAssistant - backend" cmd /k "cd /d %~dp0backend && .venv\Scripts\python -m uvicorn app.main:app --port 8000"
start "IAssistant - frontend" cmd /k "cd /d %~dp0frontend && npm run dev"
timeout /t 5 >nul
start http://localhost:80
