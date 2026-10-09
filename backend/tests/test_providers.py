import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.providers import catalog, resolve


def test_resolve_cheapest_groq():
    r = resolve(llm="groq", stt="groq", stack="groq")
    assert r.answer_model == "openai/gpt-oss-20b"
    assert r.stt_model == "whisper-large-v3-turbo"


def test_resolve_groq_from_api_catalog():
    avail = {"openai/gpt-oss-120b", "whisper-large-v3-turbo"}
    r = resolve(llm="groq", stt="groq", stack="groq", groq_available=avail)
    assert r.answer_model == "openai/gpt-oss-120b"
    assert r.stt_model == "whisper-large-v3-turbo"


def test_env_overrides_win():
    r = resolve(llm="groq", stt="groq", groq_answer="custom-llm", groq_stt="custom-whisper")
    assert r.answer_model == "custom-llm" and r.stt_model == "custom-whisper"


def test_stack_catalog():
    c = catalog(openai_answer="", openai_stt="", groq_answer="", groq_stt="", ollama_model="llama3.2:3b")
    assert c["free"]["stt"] == "browser" and c["openai"]["stt_model"]
