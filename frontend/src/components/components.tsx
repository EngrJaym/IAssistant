import { useMemo, useRef, useState } from "react";
import { validateResumeFile } from "../lib/resumeFile";
import { ThemeToggle } from "./ThemeToggle";

export type DialogueEntry = { id: string; ts: number; speaker: string; text: string };

const STATUS_CLASS: Record<string, string> = {
  READY: "idle",
  LISTENING: "ok",
  TRANSCRIBING: "info",
  "WAITING FOR COMPLETION": "info",
  "WAITING FOR TURN END": "info",
  "ANALYZING QUESTION": "warn",
  ANALYZING: "warn",
  GENERATING: "warn",
  SUGGESTING: "warn",
  "ANSWER READY": "ok",
  "SUGGESTION READY": "ok",
  REASSESSING: "warn",
  ERROR: "err",
  RECONNECTING: "warn",
};

const STATUS_LABEL: Record<string, string> = {
  READY: "Ready",
  LISTENING: "Listening",
  TRANSCRIBING: "Listening",
  "WAITING FOR COMPLETION": "Waiting",
  "WAITING FOR TURN END": "Waiting",
  "ANALYZING QUESTION": "Thinking",
  ANALYZING: "Thinking",
  GENERATING: "Writing",
  SUGGESTING: "Writing",
  "ANSWER READY": "Ready",
  "SUGGESTION READY": "Ready",
  REASSESSING: "Listening",
  ERROR: "Error",
  RECONNECTING: "Reconnecting",
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
          <img className="brand-logo" src="/logo.svg" width={36} height={36} alt="" />
          <h1 className="brand-title">IAssistant</h1>
        </div>
        <div className="auth-bar">
          <ThemeToggle compact />
          {auth?.enabled && (
            <>
              {auth.user ? (
                <>
                  {auth.user.picture && <img className="auth-avatar" src={auth.user.picture} alt="" />}
                  <button type="button" className="btn btn-sm btn-ghost" onClick={auth.onLogout}>Log out</button>
                </>
              ) : (
                auth.providers.map((p) => (
                  <a key={p} className="btn btn-sm" href={`/api/auth/login/${p}`}>
                    Sign in
                  </a>
                ))
              )}
            </>
          )}
        </div>
      </div>
    </header>
  );
}

export const StatusIndicator = ({ status, hint }: { status: string; hint?: string }) => (
  <div className={`status-pill ${STATUS_CLASS[status] ?? "idle"}`}>
    <span className="dot" />
    {STATUS_LABEL[status] ?? status}
    {hint && <span className="status-hint"> · {hint}</span>}
  </div>
);

export const LiveTranscript = ({ partial, finals }: { partial: string; finals: string[] }) => (
  <details className="card card-muted">
    <summary>Transcript</summary>
    <div className="card-inner">
      {finals.map((t, i) => (
        <p key={i} className="final">{t}</p>
      ))}
      {partial && <p className="partial">{partial}</p>}
      {!partial && !finals.length && <p className="muted">—</p>}
    </div>
  </details>
);

export const QuestionPanel = ({ question, possible }: { question: string; possible: string }) => {
  if (!question && !possible) return null;
  return (
    <section className="card">
      <h2 className="card-label">Question</h2>
      <p className="card-body">{question || possible}</p>
    </section>
  );
};

export const AnswerPanel = ({
  answer,
  points,
  followUp,
  metrics,
  dev,
}: {
  answer: string;
  points: string[];
  followUp: string;
  metrics: any;
  dev: boolean;
}) => (
  <section className="card card-answer">
    <h2 className="card-label">Suggestion</h2>
    <p className="card-body card-body-lg">{answer || <span className="muted">Your answer will appear here.</span>}</p>
    {(points.length > 0 || followUp) && (
      <details className="card-more">
        <summary>More</summary>
        {points.length > 0 && (
          <ul className="clean">
            {points.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        )}
        {followUp && <p className="muted">{followUp}</p>}
      </details>
    )}
    {dev && metrics && (
      <pre className="metrics">
        {metrics.cached
          ? "cached"
          : `${metrics.stt_ms ?? "-"} / ${metrics.detection_ms} / ${metrics.first_token_ms ?? "-"} / ${metrics.total_ms} ms`}
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
    <section className="card">
      {dbEnabled && (
        <div className="seg-control">
          <button type="button" className={view === "live" ? "active" : ""} onClick={() => setView("live")}>Live</button>
          <button type="button" className={view === "saved" ? "active" : ""} onClick={() => { setView("saved"); onRefreshSaved(); }}>Saved</button>
        </div>
      )}

      {dbEnabled && view === "saved" && (
        <div className="meeting-history">
          {!savedMeetings.length && <p className="muted">No saved sessions yet.</p>}
          {savedMeetings.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`meeting-card ${selectedMeetingId === m.id ? "active" : ""}`}
              onClick={() => onSelectMeeting(m.id)}
            >
              <strong>{formatMeetingWhen(m.started_at)}</strong>
              <span className="muted">{m.line_count} lines</span>
            </button>
          ))}
        </div>
      )}

      <div className="notes-toolbar">
        <input type="search" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search notes" />
        {exportDocxId && (
          <button type="button" className="btn btn-sm" onClick={() => onExportDocx(exportDocxId)}>Export</button>
        )}
        {view === "live" && entries.length > 0 && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={onClear}>Clear</button>
        )}
        {view === "saved" && selectedMeetingId && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => confirm("Delete?") && onDeleteSaved(selectedMeetingId)}>Delete</button>
        )}
      </div>
      <div className="notes-list" role="log" aria-live="polite">
        {!filtered.length && <p className="muted">No lines yet.</p>}
        {filtered.map((e) => (
          <article key={e.id} className="note-row">
            <div className="note-meta">
              <time className="note-time">{formatTime(e.ts)}</time>
              <span className={`speaker-tag ${speakerClass(e.speaker)}`}>{e.speaker}</span>
            </div>
            <p className="note-text">{e.text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

export function TabNav({
  tab,
  setTab,
}: {
  tab: "session" | "notes" | "setup";
  setTab: (t: "session" | "notes" | "setup") => void;
  noteCount?: number;
}) {
  const items: { id: typeof tab; label: string }[] = [
    { id: "session", label: "Coach" },
    { id: "notes", label: "Notes" },
    { id: "setup", label: "Setup" },
  ];
  return (
    <nav className="nav" aria-label="Main">
      {items.map((item) => (
        <button key={item.id} type="button" className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}>
          {item.label}
        </button>
      ))}
    </nav>
  );
}

const PRESETS: Record<string, string> = {
  Concise: "Keep answers short and conversational, as if spoken aloud.",
  Senior: "Answer as a senior engineer with trade-offs, under 120 words.",
  STAR: "Use natural STAR stories from my resume only.",
  Simple: "Explain simply, under 90 words.",
};

export function CandidateProfile({ profile, setProfile }: { profile: Record<string, string>; setProfile: (p: Record<string, string>) => void }) {
  const set = (k: string, v: string) => setProfile({ ...profile, [k]: v });
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadName, setUploadName] = useState("");
  const [uploadErr, setUploadErr] = useState("");

  async function upload(f?: File) {
    if (!f) return;
    setUploadErr("");
    const validationError = validateResumeFile(f);
    if (validationError) {
      setUploadErr(validationError);
      return;
    }
    const fd = new FormData();
    fd.append("file", f);
    setUploading(true);
    try {
      const r = await fetch("/api/parse-resume", { method: "POST", body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Upload failed.");
      set("resume", j.text);
      setUploadName(f.name);
    } catch (e) {
      setUploadErr(e instanceof Error ? e.message : "Upload failed.");
      setUploadName("");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="card">
      <h2 className="card-label">Your profile</h2>
      <label className="field">
        Style
        <select value="" onChange={(e) => e.target.value && set("instructions", PRESETS[e.target.value])}>
          <option value="">Preset…</option>
          {Object.keys(PRESETS).map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
        <textarea rows={2} placeholder="How to answer (optional)" value={profile.instructions ?? ""} onChange={(e) => set("instructions", e.target.value)} />
      </label>
      <label className="field">
        Role
        <input type="text" placeholder="Job title" value={profile.target ?? ""} onChange={(e) => set("target", e.target.value)} />
        <textarea rows={4} placeholder="Job description" value={profile.job_description ?? ""} onChange={(e) => set("job_description", e.target.value)} />
      </label>
      <label className="field">
        Resume
        <textarea rows={5} placeholder="Paste text or upload a file" value={profile.resume ?? ""} onChange={(e) => set("resume", e.target.value)} />
        <div className="resume-upload">
          <input
            ref={fileRef}
            id="resume-file"
            className="resume-upload-input"
            type="file"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={(e) => upload(e.target.files?.[0])}
          />
          <button
            type="button"
            className="resume-upload-btn"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            <span className="resume-upload-icon" aria-hidden="true">↑</span>
            <span>{uploading ? "Reading file…" : "Upload PDF or Word"}</span>
          </button>
          <p className="resume-upload-hint">PDF or .docx · max 10 MB</p>
          {uploadName && !uploadErr && <p className="resume-upload-ok">Loaded {uploadName}</p>}
          {uploadErr && <p className="resume-upload-err" role="alert">{uploadErr}</p>}
        </div>
      </label>
      <button type="button" className="btn btn-sm btn-ghost" onClick={() => confirm("Clear setup?") && setProfile({})}>Reset</button>
    </div>
  );
}

export const Controls = (p: {
  running: boolean;
  muted: boolean;
  mode: string;
  startDisabled?: boolean;
  onStart: () => void;
  onStop: () => void;
  onMute: () => void;
  onClear: () => void;
  setMode: (m: string) => void;
}) => (
  <footer className="control-bar">
    <div className="control-primary">
      <button type="button" className="btn btn-primary btn-lg" disabled={p.running || p.startDisabled} onClick={p.onStart}>Start</button>
      <button type="button" className="btn btn-lg" disabled={!p.running} onClick={p.onStop}>Stop</button>
    </div>
    <div className="control-secondary">
      <button type="button" className="btn btn-sm" disabled={!p.running} onClick={p.onMute}>{p.muted ? "Unmute" : "Mute"}</button>
      <button type="button" className="btn btn-sm btn-ghost" onClick={p.onClear}>Clear</button>
      <select className="mode-select" value={p.mode} onChange={(e) => p.setMode(e.target.value)} aria-label="Sensitivity">
        <option value="normal">Strict</option>
        <option value="balanced">Balanced</option>
        <option value="aggressive">Sensitive</option>
      </select>
    </div>
  </footer>
);
