import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env")   # repo root (docker / start.bat)
load_dotenv(Path(__file__).resolve().parents[1] / ".env")   # backend/.env overrides

API_KEY = os.getenv("OPENAI_API_KEY", "").strip()
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "").strip()
GROQ_BASE_URL = os.getenv("GROQ_BASE_URL", "https://api.groq.com/openai/v1").rstrip("/")

STT_MODEL = os.getenv("TRANSCRIPTION_MODEL", "").strip()
ANSWER_MODEL = os.getenv("ANSWER_MODEL", "").strip()
GROQ_STT_MODEL = os.getenv("GROQ_STT_MODEL", "").strip()
GROQ_ANSWER_MODEL = os.getenv("GROQ_ANSWER_MODEL", "").strip()

LLM_PROVIDER = os.getenv("LLM_PROVIDER", "ollama").lower()
STT_PROVIDER = os.getenv("STT_PROVIDER", "browser").lower()
PROVIDER_STACK = os.getenv("PROVIDER_STACK", "").strip().lower()  # free | groq | openai (optional)

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434/v1").rstrip("/")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2:3b")
THRESHOLD = float(os.getenv("QUESTION_CONFIDENCE_THRESHOLD", "0.80"))
MAX_WORDS = int(os.getenv("MAX_ANSWER_WORDS", "100"))
MIN_ANSWER_WORDS = int(os.getenv("MIN_ANSWER_WORDS", "40"))
DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
SESSION_SECRET = os.getenv("SESSION_SECRET", "").strip()
APP_BASE_URL = os.getenv("APP_BASE_URL", "http://localhost").rstrip("/")
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "").strip()
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "").strip()
GITHUB_CLIENT_ID = os.getenv("GITHUB_CLIENT_ID", "").strip()
GITHUB_CLIENT_SECRET = os.getenv("GITHUB_CLIENT_SECRET", "").strip()
HANDS_FREE = os.getenv("HANDS_FREE", "true").lower() in ("1", "true", "yes")
GROQ_CHUNK_SECONDS = float(os.getenv("GROQ_CHUNK_SECONDS", "4"))
GROQ_CHUNK_OVERLAP_MS = int(os.getenv("GROQ_CHUNK_OVERLAP_MS", "450"))
GROQ_CHUNK_SILENCE_MS = int(os.getenv("GROQ_CHUNK_SILENCE_MS", "750"))
ANSWER_COOLDOWN_SEC = float(os.getenv("ANSWER_COOLDOWN_SEC", "0.35"))
