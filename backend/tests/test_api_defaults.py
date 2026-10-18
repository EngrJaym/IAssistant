"""REST defaults: Groq stack from server config, explicit llm/stt not overridden."""

from app import config, main


def test_health_defaults_match_provider_stack(client, groq_configured):
    h = client.get("/api/health").json()
    assert h["ok"] is True
    assert h["defaults"]["stack"] == "groq"
    assert h["defaults"]["llm"] == "groq"
    assert h["defaults"]["stt"] == "groq"
    assert h["configured"]["groq"] is True


def test_session_start_empty_body_uses_groq_stack(client, groq_configured, monkeypatch):
    async def fake_groq_ids():
        return {"openai/gpt-oss-20b", "whisper-large-v3-turbo"}

    monkeypatch.setattr(main, "groq_model_ids", fake_groq_ids)
    r = client.post("/api/session/start", json={})
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["stack"] == "groq"
    assert body["llm"] == "groq"
    assert body["stt"] == "groq"
    assert body["meeting_id"]


def test_resolved_explicit_ollama_not_forced_to_groq(monkeypatch):
    monkeypatch.setattr(config, "PROVIDER_STACK", "groq")
    monkeypatch.setattr(config, "LLM_PROVIDER", "groq")
    monkeypatch.setattr(config, "STT_PROVIDER", "groq")
    r = main._resolved(llm="ollama", stt="browser", stack=None)
    assert r.stack == "free"
    assert r.llm == "ollama"
    assert r.stt == "browser"


def test_resolved_no_explicit_args_uses_groq_stack(monkeypatch):
    monkeypatch.setattr(config, "PROVIDER_STACK", "groq")
    monkeypatch.setattr(config, "LLM_PROVIDER", "groq")
    monkeypatch.setattr(config, "STT_PROVIDER", "groq")
    r = main._resolved()
    assert r.stack == "groq"
    assert r.llm == "groq"
    assert r.stt == "groq"
