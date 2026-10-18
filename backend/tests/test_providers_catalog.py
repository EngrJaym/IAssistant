from app.providers import catalog, resolve


def test_catalog_includes_all_stacks():
    c = catalog(openai_answer="", openai_stt="", groq_answer="", groq_stt="", ollama_model="llama3.2:3b")
    assert set(c) >= {"free", "groq", "openai"}
    for sid in ("free", "groq", "openai"):
        assert c[sid]["llm"] and c[sid]["stt"]


def test_resolve_custom_stack_infers_providers():
    r = resolve(llm="openai", stt="openai", stack="custom")
    assert r.llm == "openai"
    assert r.stt == "openai"
    assert r.stack == "openai"
