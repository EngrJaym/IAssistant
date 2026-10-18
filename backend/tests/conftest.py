import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import config, db, main


@pytest.fixture
def client():
    return TestClient(main.app)


@pytest.fixture(autouse=True)
def isolate_memory_db():
    db.reset_memory()
    yield
    db.reset_memory()


@pytest.fixture
def groq_configured(monkeypatch):
    monkeypatch.setattr(config, "GROQ_API_KEY", "test-groq-key")
    monkeypatch.setattr(config, "API_KEY", "")
    monkeypatch.setattr(config, "PROVIDER_STACK", "groq")
    monkeypatch.setattr(config, "LLM_PROVIDER", "groq")
    monkeypatch.setattr(config, "STT_PROVIDER", "groq")
