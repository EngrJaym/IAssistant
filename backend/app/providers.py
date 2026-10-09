"""Provider stacks and cheapest-model resolution (extend by adding models to the ranked lists)."""
from __future__ import annotations

from dataclasses import dataclass

# Stacks group LLM + STT; switching stack picks the cheapest models for that vendor.
STACKS: dict[str, dict[str, str]] = {
    "free": {"llm": "ollama", "stt": "browser", "label": "Free (browser speech + local Ollama)"},
    "groq": {"llm": "groq", "stt": "groq", "label": "Groq free tier (Whisper + GPT-OSS / Qwen)"},
    "openai": {"llm": "openai", "stt": "openai", "label": "OpenAI (realtime STT + GPT)"},
}

# Lower rank = cheaper / preferred default.
LLM_MODELS: dict[str, list[tuple[int, str]]] = {
    "openai": [(1, "gpt-4o-mini"), (2, "gpt-4o"), (3, "gpt-4.1-mini"), (4, "gpt-4.1")],
    # Groq free/developer tier (Llama 3.x removed Aug 2026 — see Groq deprecations docs).
    "groq": [
        (1, "openai/gpt-oss-20b"),
        (2, "openai/gpt-oss-120b"),
        (3, "qwen/qwen3.8-27b"),
    ],
    "ollama": [(1, "llama3.2:3b"), (2, "llama3.2:1b"), (3, "qwen2.5:3b")],
}

STT_MODELS: dict[str, list[tuple[int, str]]] = {
    "openai": [(1, "gpt-4o-mini-transcribe"), (2, "gpt-4o-transcribe"), (3, "whisper-1")],
    "groq": [(1, "whisper-large-v3-turbo"), (2, "whisper-large-v3")],
}

VALID_LLM = frozenset({"openai", "groq", "ollama"})
VALID_STT = frozenset({"openai", "groq", "browser"})


@dataclass(frozen=True)
class Resolved:
    stack: str
    llm: str
    stt: str
    answer_model: str
    stt_model: str | None  # None for browser STT


def _pick(ranked: list[tuple[int, str]], override: str | None, env_fallback: str | None) -> str:
    if override and override.strip():
        return override.strip()
    if env_fallback and env_fallback.strip():
        return env_fallback.strip()
    return min(ranked, key=lambda x: x[0])[1]


def _pick_from_catalog(
    ranked: list[tuple[int, str]],
    override: str,
    available: set[str] | None,
) -> str:
    """Use explicit override if set; else first ranked model present on the provider."""
    if override and override.strip():
        want = override.strip()
        if available is not None and want not in available:
            raise ValueError(f"Model '{want}' is not available on this API key.")
        return want
    if available is None:
        return min(ranked, key=lambda x: x[0])[1]
    for _, model_id in sorted(ranked, key=lambda x: x[0]):
        if model_id in available:
            return model_id
    raise ValueError(f"No supported model available. Tried: {[m for _, m in ranked]}")


def stack_for(llm: str, stt: str) -> str:
    for sid, s in STACKS.items():
        if s["llm"] == llm and s["stt"] == stt:
            return sid
    return "custom"


def resolve(
    *,
    llm: str,
    stt: str,
    stack: str | None = None,
    openai_answer: str = "",
    openai_stt: str = "",
    groq_answer: str = "",
    groq_stt: str = "",
    ollama_model: str = "",
    groq_available: set[str] | None = None,
) -> Resolved:
    """Resolve stack + cheapest models. Explicit stack wins; else infer from llm/stt."""
    sid = (stack or "").strip().lower()
    if sid == "custom":
        sid = "custom"
    elif sid in STACKS:
        llm, stt = STACKS[sid]["llm"], STACKS[sid]["stt"]
    elif llm not in VALID_LLM:
        llm = "openai"
    if stt not in VALID_STT:
        stt = "browser"
    if sid not in STACKS:
        sid = stack_for(llm, stt)

    if llm == "groq":
        answer = _pick_from_catalog(LLM_MODELS["groq"], groq_answer, groq_available)
    else:
        answer = _pick(
            LLM_MODELS.get(llm, LLM_MODELS["openai"]),
            {"openai": openai_answer, "ollama": ollama_model}.get(llm, ""),
            ollama_model if llm == "ollama" else None,
        )

    stt_model = None
    if stt == "openai":
        stt_model = _pick(STT_MODELS["openai"], openai_stt, openai_stt)
    elif stt == "groq":
        stt_model = _pick_from_catalog(STT_MODELS["groq"], groq_stt, groq_available)

    return Resolved(stack=sid, llm=llm, stt=stt, answer_model=answer, stt_model=stt_model)


def catalog(
    *,
    openai_answer: str,
    openai_stt: str,
    groq_answer: str,
    groq_stt: str,
    ollama_model: str,
    groq_available: set[str] | None = None,
) -> dict:
    """Health payload: each stack with auto-resolved cheapest models."""
    out = {}
    for sid in STACKS:
        try:
            r = resolve(
                llm=STACKS[sid]["llm"],
                stt=STACKS[sid]["stt"],
                stack=sid,
                openai_answer=openai_answer,
                openai_stt=openai_stt,
                groq_answer=groq_answer,
                groq_stt=groq_stt,
                ollama_model=ollama_model,
                groq_available=groq_available,
            )
        except ValueError:
            continue
        out[sid] = {
            "label": STACKS[sid]["label"],
            "llm": r.llm,
            "stt": r.stt,
            "answer_model": r.answer_model,
            "stt_model": r.stt_model,
        }
    if "groq" not in out:
        r = resolve(llm="groq", stt="groq", stack="groq", groq_answer=groq_answer, groq_stt=groq_stt, groq_available=None)
        out["groq"] = {
            "label": STACKS["groq"]["label"],
            "llm": r.llm,
            "stt": r.stt,
            "answer_model": r.answer_model,
            "stt_model": r.stt_model,
        }
    return out


def pcm16_to_wav(pcm: bytes, rate: int = 24000) -> bytes:
    import struct

    n = len(pcm)
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF",
        36 + n,
        b"WAVE",
        b"fmt ",
        16,
        1,
        1,
        rate,
        rate * 2,
        2,
        16,
        b"data",
        n,
    )
    return header + pcm
