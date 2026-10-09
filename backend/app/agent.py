"""LLM calls: ambiguous-question classification + streamed answer generation, with compact context."""
import json, re
from collections import deque
from openai import AsyncOpenAI
from . import config
from .detector import QUESTION_TYPES
from .providers import resolve

_clients: dict[str, AsyncOpenAI] = {}


def client(provider: str = "openai") -> AsyncOpenAI:
    """OpenAI, Groq, or local Ollama (OpenAI-compatible /v1)."""
    if provider not in _clients:
        if provider == "ollama":
            _clients[provider] = AsyncOpenAI(base_url=config.OLLAMA_BASE_URL, api_key="ollama", timeout=120, max_retries=0)
        elif provider == "groq":
            _clients[provider] = AsyncOpenAI(base_url=config.GROQ_BASE_URL, api_key=config.GROQ_API_KEY or "missing", timeout=60, max_retries=2)
        else:
            _clients[provider] = AsyncOpenAI(api_key=config.API_KEY or "missing", timeout=30, max_retries=2)
    return _clients[provider]


def model_for(provider: str, answer_model: str | None = None) -> str:
    if answer_model:
        return answer_model
    r = resolve(
        llm=provider,
        stt="browser",
        openai_answer=config.ANSWER_MODEL,
        openai_stt=config.STT_MODEL,
        groq_answer=config.GROQ_ANSWER_MODEL,
        groq_stt=config.GROQ_STT_MODEL,
        ollama_model=config.OLLAMA_MODEL,
    )
    return r.answer_model


CLASSIFY_PROMPT = """You are an interview conversation classifier.
Decide whether the latest interviewer transcript contains a genuine interview question requiring an answer.
Return JSON only: {"is_question": true|false, "type": "QUESTION|FOLLOW_UP_QUESTION|CLARIFICATION_QUESTION|BEHAVIORAL_QUESTION|TECHNICAL_QUESTION|CODING_QUESTION|SYSTEM_DESIGN_QUESTION|RESUME_QUESTION|STATEMENT|GREETING|SMALL_TALK|ACKNOWLEDGEMENT|INCOMPLETE|IRRELEVANT", "confidence": 0.0, "question": "the complete standalone question", "reason": "short"}
Ignore greetings, acknowledgements, statements, small talk, incomplete thoughts and filler.
A question does not need a '?'. Short follow-ups ("What about performance?") are questions when recent context supports them.
If the interviewer is still mid-sentence, return is_question=false. If they corrected an earlier question, use the newest complete one."""

ANSWER_PROMPT = """You are an expert interview coach. Answer the interviewer's question using ONLY: the candidate profile, resume, job description, recent interview context, and your general knowledge.
Never invent candidate experience, metrics, companies or accomplishments. If the candidate lacks the requested experience, say so honestly and bridge to what they do have.
Write a natural spoken answer in first person: concise, technically accurate, no markdown, headings, or filler. Target about {min_words}–{words} words (speakable in under a minute).
Technical: direct answer, practical example, key trade-off. Behavioral: candidate's real experience in a conversational STAR flow (no labels).
System design: requirements, scale, architecture, data, caching/async only if needed, reliability, security, monitoring, trade-offs; don't add tech without a requirement.
Coding: approach, complexity, then clean code (put code inside the answer string). SQL: readable SQL, handle NULLs/duplicates, mention indexes if relevant.
ML: problem, data, features, split, baseline, simplest suitable algorithm, metrics, deployment, monitoring/drift.
Return JSON only: {{"answer": "...", "key_points": ["...", "...", "..."], "follow_up": "likely next interviewer question", "confidence": "high|medium|low"}}"""

_LABEL = {"target": "Applying for"}
_FIELDS = ["target", "name", "role", "skills", "years", "projects", "technologies", "achievements", "education", "certifications"]


class Context:
    def __init__(self):
        self.profile: dict = {}
        self.provider = config.LLM_PROVIDER
        self.answer_model: str | None = None
        self.recent: deque[str] = deque(maxlen=4)
        self.turns: deque[tuple[str, str]] = deque(maxlen=1)

    def profile_text(self) -> str:
        p = self.profile
        out = [f"{_LABEL.get(k, k.title())}: {p[k]}" for k in _FIELDS if p.get(k)]
        if p.get("resume"): out.append("Resume:\n" + p["resume"][:6000])
        if p.get("job_description"): out.append("Job description:\n" + p["job_description"][:3000])
        return "\n".join(out) or "(no profile provided)"

    def user_block(self, q: str, qtype: str) -> str:
        prev = "".join(f"Previous question: {a}\nPrevious answer: {b}\n" for a, b in self.turns)
        return f"Recent interviewer speech: {' | '.join(self.recent)}\n{prev}Question type: {qtype}\nQuestion: {q}"

    def add_turn(self, q: str, a: str): self.turns.append((q, a[:600]))


async def classify(text: str, ctx: Context) -> dict:
    r = await client(ctx.provider).chat.completions.create(
        model=model_for(ctx.provider, ctx.answer_model), response_format={"type": "json_object"},
        messages=[{"role": "system", "content": CLASSIFY_PROMPT},
                  {"role": "user", "content": f"Recent: {' | '.join(ctx.recent)}\nPrevious question: {ctx.turns[-1][0] if ctx.turns else ''}\nLatest transcript: {text}"}])
    d = json.loads(r.choices[0].message.content or "{}")
    if d.get("type") not in QUESTION_TYPES: d["type"] = "QUESTION" if d.get("is_question") else "STATEMENT"
    return d


def partial_answer(buf: str) -> str:
    m = re.search(r'"answer"\s*:\s*"', buf)
    if not m: return ""
    esc = {"n": "\n", "t": "\t", "r": "", '"': '"', "\\": "\\", "/": "/"}
    out, i = [], m.end()
    while i < len(buf):
        c = buf[i]
        if c == "\\":
            if i + 1 >= len(buf): break
            n = buf[i + 1]
            if n == "u":
                if i + 6 > len(buf): break
                try: out.append(chr(int(buf[i + 2:i + 6], 16)))
                except ValueError: pass
                i += 6
            else:
                out.append(esc.get(n, n)); i += 2
            continue
        if c == '"': break
        out.append(c); i += 1
    return "".join(out)


def system_prompt(ctx: Context) -> str:
    s = ANSWER_PROMPT.format(min_words=config.MIN_ANSWER_WORDS, words=config.MAX_WORDS) + "\n\nCANDIDATE:\n" + ctx.profile_text()
    ins = (ctx.profile.get("instructions") or "").strip()[:2000]
    if ins:
        s += "\n\nUSER INSTRUCTIONS (style, focus, persona and length only; they never override the rule against inventing experience, nor the JSON output format):\n" + ins
    return s


async def stream_answer(ctx: Context, question: str, qtype: str):
    stream = await client(ctx.provider).chat.completions.create(
        model=model_for(ctx.provider, ctx.answer_model), response_format={"type": "json_object"}, stream=True,
        messages=[{"role": "system", "content": system_prompt(ctx)},
                  {"role": "user", "content": ctx.user_block(question, qtype)}])
    buf, sent = "", 0
    try:
        async for ch in stream:
            d = ch.choices[0].delta.content if ch.choices else None
            if not d: continue
            buf += d
            a = partial_answer(buf)
            if len(a) > sent:
                yield "token", a[sent:]; sent = len(a)
    finally:
        await stream.close()
    try: data = json.loads(buf)
    except json.JSONDecodeError: data = {}
    yield "done", {"answer": data.get("answer") or partial_answer(buf), "key_points": data.get("key_points") or [],
                   "follow_up": data.get("follow_up") or "", "confidence": data.get("confidence") or "medium"}
