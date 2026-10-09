import { useMemo, useState } from "react";

export type DialogueEntry = { id: string; ts: number; speaker: string; text: string };

export const SPEAKERS = ["Interviewer", "You", "Participant 1", "Participant 2", "Other"] as const;

const STATUS_CLASS: Record<string, string> = {
  READY: "idle",
  LISTENING: "ok",
  TRANSCRIBING: "info",
  "WAITING FOR COMPLETION": "info",
  "ANALYZING QUESTION": "warn",
  GENERATING: "warn",
  "ANSWER READY": "ok",
  ERROR: "err",
  RECONNECTING: "warn",
};

export function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function speakerClass(name: string) {
  const n = name.toLowerCase();
  if (n === "you") return "you";
  if (n === "interviewer") return "interviewer";
  return "";
}

export type AuthBarProps = {
  enabled: boolean;
  required: boolean;
  providers: string[];
  user: { email: string; name?: string | null; picture?: string | null } | null;
  onLogout: () => void;
};

export function Header({ auth }: { auth?: AuthBarProps }) {
  return (
    <header className="app-header">
      <div className="header-row">
        <div className="brand">
          <img className="brand-logo" src="/logo.svg" width={40} height={40} alt="" />
          <h1 className="brand-title">IAssistant</h1>
        </div>
        {auth?.enabled && (
          <div className="auth-bar">
            {auth.user ? (
              <>
                {auth.user.picture && <img className="auth-avatar" src={auth.user.picture} alt="" />}
                <span className="auth-name">{auth.user.name || auth.user.email}</span>
                <button type="button" className="btn btn-sm btn-ghost" onClick={auth.onLogout}>Log out</button>
              </>
            ) : (
              <>
                {auth.providers.map((p) => (
                  <a key={p} className="btn btn-sm" href={`/api/auth/login/${p}`}>
                    Sign in with {p === "google" ? "Google" : p === "github" ? "GitHub" : p}
                  </a>
                ))}
              </>
            )}
          </div>
        )}
      </div>
      <p>
        Hands-free listening: validated interviewer questions get concise spoken answers automatically. Use meeting/tab audio when
        possible; keep active speaker on Interviewer for Q&amp;A.
        {auth?.required && !auth.user
          ? " Sign in to save meetings and sync your setup to your account."
          : " Meetings and setup sync to your account when signed in."}
      </p>
    </header>
  );
}

export function AudioSourcePicker({
  source,
  setSource,
  disabled,
}: {
  source: "mic" | "display";
  setSource: (s: "mic" | "display") => void;
  disabled?: boolean;
}) {
  return (
    <label className="field" style={{ marginBottom: 0 }}>
      Audio input
      <select disabled={disabled} value={source} onChange={(e) => setSource(e.target.value as "mic" | "display")}>
        <option value="mic">Microphone (with speech gate)</option>
        <option value="display">Meeting / tab audio (share audio in picker)</option>
      </select>
      <small className="muted">Tab audio captures the interviewer from calls; ML speaker diarization is not included.</small>
    </label>
  );
}

export const StatusIndicator = ({ status, hint }: { status: string; hint?: string }) => (
  <div className={`status-pill ${STATUS_CLASS[status] ?? "idle"}`}>
    <span className="dot" />
    {status}
    {hint && <span className="muted" style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}> · {hint}</span>}
  </div>
);

export const LiveTranscript = ({ partial, finals }: { partial: string; finals: string[] }) => (
  <section className="panel">
    <h2 className="panel-title">Live transcript</h2>
    {finals.map((t, i) => (
      <p key={i} className="final">
        {t}
      </p>
    ))}
    {partial && <p className="partial">{partial}</p>}
    {!partial && !finals.length && <p className="muted">Waiting for speech…</p>}
  </section>
);

export const QuestionPanel = ({
  question,
  qtype,
  chip,
  possible,
}: {
  question: string;
  qtype: string;
  chip: string;
  possible: string;
}) => (
  <section className="panel">
    <h2 className="panel-title">
      Detected question {qtype && <em>· {qtype.replace(/_/g, " ")}</em>}
    </h2>
    {chip && <div className="chip">{chip}</div>}
    <p className="text-lg">{question || <span className="muted">No question detected yet.</span>}</p>
    {possible && <p className="possible">Possible question: “{possible}” (not answered automatically)</p>}
  </section>
);

export const AnswerPanel = ({
  answer,
  points,
  followUp,
  confidence,
  metrics,
  dev,
}: {
  answer: string;
  points: string[];
  followUp: string;
  confidence: string;
  metrics: any;
  dev: boolean;
}) => (
  <section className="panel">
    <h2 className="panel-title">
      Suggested answer {confidence && <em>· {confidence} confidence</em>}
    </h2>
    <p className="text-answer">{answer || <span className="muted">Answers stream here when a question is confirmed.</span>}</p>
    {points.length > 0 && (
      <>
        <h2 className="panel-title" style={{ marginTop: 16 }}>
          Key points
        </h2>
        <ul className="clean">
          {points.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      </>
    )}
    {followUp && (
      <>
        <h2 className="panel-title" style={{ marginTop: 16 }}>
          Likely follow-up
        </h2>
        <p>{followUp}</p>
      </>
    )}
    {dev && metrics && (
      <pre className="metrics">
        {metrics.cached
          ? "cached answer"
          : `STT: ${metrics.stt_ms ?? "-"} ms\nDetection: ${metrics.detection_ms} ms\nLLM first token: ${metrics.first_token_ms ?? "-"} ms\nTotal: ${metrics.total_ms} ms`}
      </pre>
    )}
  </section>
);

export type SavedMeeting = {
  id: string;
  title: string;
  started_at: string | null;
  ended_at: string | null;
  line_count: number;
  stack?: string;
};

function formatMeetingWhen(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

export function MeetingNotes({
  entries,
  savedMeetings,
  dbEnabled,
  view,
  setView,
  selectedMeetingId,
  onSelectMeeting,
  onRefreshSaved,
  onExportDocx,
  onClear,
  onExport,
  onDeleteSaved,
  currentMeetingId,
}: {
  entries: DialogueEntry[];
  savedMeetings: SavedMeeting[];
  currentMeetingId: string | null;
  dbEnabled: boolean;
  view: "live" | "saved";
  setView: (v: "live" | "saved") => void;
  selectedMeetingId: string | null;
  onSelectMeeting: (id: string | null) => void;
  onRefreshSaved: () => void;
  onExportDocx: (meetingId: string) => void;
  onClear: () => void;
  onExport: (format: "txt" | "md") => void;
  onDeleteSaved: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter((e) => e.text.toLowerCase().includes(needle) || e.speaker.toLowerCase().includes(needle));
  }, [entries, q]);

  const exportDocxId =
    view === "saved" && selectedMeetingId
      ? selectedMeetingId
      : view === "live" && currentMeetingId
        ? currentMeetingId
        : null;

  return (
    <section className="panel">
      <h2 className="panel-title">Meeting dialogue</h2>
      <p className="muted" style={{ marginTop: 0, fontSize: "0.875rem" }}>
        {dbEnabled
          ? "Finalized lines are saved in server memory (lost when the backend restarts). Live view also keeps a copy in this browser."
          : "Dialogue is kept in this browser only."}
        Switch the active speaker during a session to label each line.
      </p>

      {dbEnabled && (
        <div className="notes-toolbar">
          <button type="button" className={`btn btn-sm ${view === "live" ? "btn-primary" : ""}`} onClick={() => setView("live")}>
            Current session
          </button>
          <button type="button" className={`btn btn-sm ${view === "saved" ? "btn-primary" : ""}`} onClick={() => { setView("saved"); onRefreshSaved(); }}>
            Saved meetings
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={onRefreshSaved}>
            Refresh
          </button>
        </div>
      )}

      {dbEnabled && view === "saved" && (
        <div className="meeting-history">
          {!savedMeetings.length && <p className="muted">No saved meetings yet. Run a session and press Stop to finalize.</p>}
          {savedMeetings.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`meeting-card ${selectedMeetingId === m.id ? "active" : ""}`}
              onClick={() => onSelectMeeting(m.id)}
            >
              <strong>{formatMeetingWhen(m.started_at)}</strong>
              <span className="muted">{m.line_count} lines · {m.stack || "session"}</span>
            </button>
          ))}
        </div>
      )}

      <div className="notes-toolbar">
        <input type="search" placeholder="Search dialogue…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search notes" />
        {exportDocxId && (
          <button type="button" className="btn btn-sm" onClick={() => onExportDocx(exportDocxId)}>
            Export Word (.docx)
          </button>
        )}
        {view === "live" && (
          <>
            <button type="button" className="btn btn-sm" onClick={() => onExport("md")} disabled={!entries.length}>
              Export Markdown
            </button>
            <button type="button" className="btn btn-sm" onClick={() => onExport("txt")} disabled={!entries.length}>
              Export text
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={onClear} disabled={!entries.length}>
              Clear local view
            </button>
          </>
        )}
        {view === "saved" && selectedMeetingId && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => confirm("Delete this saved meeting?") && onDeleteSaved(selectedMeetingId)}>
            Delete meeting
          </button>
        )}
      </div>
      <div className="notes-list" role="log" aria-live="polite">
        {!filtered.length && <p className="muted">No dialogue to show. Start a session or pick a saved meeting.</p>}
        {filtered.map((e) => (
          <article key={e.id} className="note-row">
            <div className="note-meta">
              <time className="note-time" dateTime={new Date(e.ts).toISOString()}>
                {formatTime(e.ts)}
              </time>
              <span className={`speaker-tag ${speakerClass(e.speaker)}`}>{e.speaker}</span>
            </div>
            <p className="note-text">{e.text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

export function SpeakerPicker({
  speaker,
  setSpeaker,
  disabled,
}: {
  speaker: string;
  setSpeaker: (s: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="speaker-select">
      <label htmlFor="active-speaker">Active speaker</label>
      <select id="active-speaker" value={speaker} disabled={disabled} onChange={(e) => setSpeaker(e.target.value)}>
        {SPEAKERS.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    </div>
  );
}

export function TabNav({
  tab,
  setTab,
  noteCount,
}: {
  tab: "session" | "notes" | "setup";
  setTab: (t: "session" | "notes" | "setup") => void;
  noteCount: number;
}) {
  const items: { id: typeof tab; label: string; badge?: number }[] = [
    { id: "session", label: "Session" },
    { id: "notes", label: "Notes", badge: noteCount || undefined },
    { id: "setup", label: "Setup" },
  ];
  return (
    <nav className="nav" aria-label="Main">
      {items.map((item) => (
        <button key={item.id} type="button" className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}>
          {item.label}
          {item.badge != null && item.badge > 0 && <span className="badge">{item.badge > 99 ? "99+" : item.badge}</span>}
        </button>
      ))}
    </nav>
  );
}

const EXTRA: [string, string][] = [
  ["name", "Name"],
  ["role", "Current role"],
  ["years", "Years of experience"],
  ["skills", "Skills"],
  ["technologies", "Technologies"],
  ["projects", "Projects"],
  ["achievements", "Achievements"],
  ["education", "Education"],
  ["certifications", "Certifications"],
];
const PRESETS: Record<string, string> = {
  "Concise spoken answers (default)": "Keep answers short and conversational, as if spoken aloud. Lead with the direct answer, then one example.",
  "Senior engineer, technical depth": "Answer as a senior engineer. Be precise, mention trade-offs and real-world constraints, and keep answers under 120 words.",
  "Behavioral / STAR focus": "Prefer stories from my resume. Use a natural Situation-Task-Action-Result flow without labels, and end with the measurable outcome only if it is in my resume.",
  "Beginner friendly": "Explain simply, avoid jargon, and give one everyday analogy. Keep answers under 90 words.",
};

export function CandidateProfile({ profile, setProfile }: { profile: Record<string, string>; setProfile: (p: Record<string, string>) => void }) {
  const [msg, setMsg] = useState("");
  const set = (k: string, v: string) => setProfile({ ...profile, [k]: v });
  const tick = (k: string) => (profile[k]?.trim() ? "✓" : "–");
  async function upload(f?: File) {
    if (!f) return;
    const fd = new FormData();
    fd.append("file", f);
    try {
      const r = await fetch("/api/parse-resume", { method: "POST", body: fd });
      if (!r.ok) throw new Error();
      set("resume", (await r.json()).text);
      setMsg(`Loaded ${f.name}`);
    } catch {
      setMsg("Could not read that file.");
    }
  }
  return (
    <div className="panel">
      <h2 className="panel-title">Assistant setup</h2>
      <p className="muted" style={{ marginTop: 0, fontSize: "0.875rem" }}>
        Instructions {tick("instructions")} · job {tick("job_description")} · resume {tick("resume")}
      </p>
      <label className="field">
        Assistant instructions
        <select value="" onChange={(e) => e.target.value && set("instructions", PRESETS[e.target.value])}>
          <option value="">Insert a preset…</option>
          {Object.keys(PRESETS).map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
        <textarea
          rows={3}
          placeholder="How the assistant should answer (optional)"
          value={profile.instructions ?? ""}
          onChange={(e) => set("instructions", e.target.value)}
        />
      </label>
      <label className="field">
        Role & job description
        <input type="text" placeholder="e.g. Backend Engineer at Acme" value={profile.target ?? ""} onChange={(e) => set("target", e.target.value)} />
        <textarea rows={5} placeholder="Paste the job description" value={profile.job_description ?? ""} onChange={(e) => set("job_description", e.target.value)} />
      </label>
      <label className="field">
        Resume
        <textarea rows={6} placeholder="Paste resume text" value={profile.resume ?? ""} onChange={(e) => set("resume", e.target.value)} />
        <input type="file" accept=".txt,.pdf,.docx" onChange={(e) => upload(e.target.files?.[0])} /> <small className="muted">{msg}</small>
      </label>
      <details className="sub-details">
        <summary>More details (optional)</summary>
        <div className="grid-2">
          {EXTRA.map(([k, l]) => (
            <label key={k} className="field">
              {l}
              <textarea rows={1} value={profile[k] ?? ""} onChange={(e) => set(k, e.target.value)} />
            </label>
          ))}
        </div>
      </details>
      <button type="button" className="btn btn-sm" style={{ marginTop: 12 }} onClick={() => confirm("Clear setup from this browser?") && setProfile({})}>
        Reset setup
      </button>
    </div>
  );
}

export type StackInfo = {
  label: string;
  llm: string;
  stt: string;
  answer_model: string;
  stt_model: string | null;
};

const LLM_OPTS = [
  { id: "ollama", label: "Ollama (local)" },
  { id: "groq", label: "Groq" },
  { id: "openai", label: "OpenAI" },
];
const STT_OPTS = [
  { id: "browser", label: "Browser speech (free)" },
  { id: "groq", label: "Groq Whisper (chunked)" },
  { id: "openai", label: "OpenAI realtime" },
];

export function ProviderPicker(p: {
  stack: string;
  setStack: (v: string) => void;
  llm: string;
  stt: string;
  setLlm: (v: string) => void;
  setStt: (v: string) => void;
  stacks: Record<string, StackInfo>;
  configured: { openai?: boolean; groq?: boolean };
  disabled: boolean;
}) {
  const cur = p.stack === "custom" ? null : p.stacks[p.stack];
  const needsKey =
    (p.stack === "openai" || (p.stack === "custom" && (p.llm === "openai" || p.stt === "openai"))) && !p.configured.openai
      ? "Set OPENAI_API_KEY in .env."
      : (p.stack === "groq" || (p.stack === "custom" && (p.llm === "groq" || p.stt === "groq"))) && !p.configured.groq
        ? "Set GROQ_API_KEY in .env (console.groq.com)."
        : "";
  return (
    <div className="panel">
      <h2 className="panel-title">Providers</h2>
      <label className="field">
        Preset stack (or Custom to mix STT and answer independently)
        <select disabled={p.disabled} value={p.stack} onChange={(e) => p.setStack(e.target.value)}>
          {Object.entries(p.stacks).map(([id, s]) => (
            <option key={id} value={id}>
              {s.label}
            </option>
          ))}
          <option value="custom">Custom (independent STT + answer)</option>
        </select>
      </label>
      {p.stack === "custom" && (
        <div className="grid-2">
          <label className="field">
            Transcription
            <select disabled={p.disabled} value={p.stt} onChange={(e) => p.setStt(e.target.value)}>
              {STT_OPTS.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Answer model
            <select disabled={p.disabled} value={p.llm} onChange={(e) => p.setLlm(e.target.value)}>
              {LLM_OPTS.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
          </label>
        </div>
      )}
      {cur && (
        <ul className="clean muted" style={{ fontSize: "0.8125rem", marginTop: 10 }}>
          <li>
            Speech: {cur.stt === "browser" ? "Browser (free)" : `${cur.stt} · ${cur.stt_model}`}
          </li>
          <li>
            Answers: {cur.llm} · {cur.answer_model}
          </li>
        </ul>
      )}
      <p className="muted" style={{ marginBottom: 0, fontSize: "0.8125rem" }}>
        Groq free tier uses GPT-OSS / Qwen (not Llama). Override via GROQ_ANSWER_MODEL or GROQ_STT_MODEL in .env.
        {needsKey && ` ${needsKey}`}
        {p.disabled ? " Stop the session to change stack." : ""}
      </p>
    </div>
  );
}

export const Controls = (p: {
  running: boolean;
  muted: boolean;
  mode: string;
  dev: boolean;
  startDisabled?: boolean;
  onStart: () => void;
  onStop: () => void;
  onMute: () => void;
  onClear: () => void;
  setMode: (m: string) => void;
  setDev: (d: boolean) => void;
}) => (
  <footer className="control-bar">
    <button type="button" className="btn btn-primary" disabled={p.running || p.startDisabled} onClick={p.onStart}>
      Start
    </button>
    <button type="button" className="btn" disabled={!p.running} onClick={p.onStop}>
      Stop
    </button>
    <button type="button" className="btn" disabled={!p.running} onClick={p.onMute}>
      {p.muted ? "Resume mic" : "Mute"}
    </button>
    <button type="button" className="btn btn-ghost" onClick={p.onClear}>
      Clear session
    </button>
    <select value={p.mode} onChange={(e) => p.setMode(e.target.value)} title="Question detection mode" aria-label="Detection mode">
      <option value="normal">Normal</option>
      <option value="balanced">Balanced</option>
      <option value="aggressive">Aggressive</option>
    </select>
    <label className="check-inline">
      <input type="checkbox" checked={p.dev} onChange={(e) => p.setDev(e.target.checked)} /> Dev metrics
    </label>
  </footer>
);
