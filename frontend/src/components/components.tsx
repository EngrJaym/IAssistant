import { useRef, useState, type FormEvent } from "react";
import { validateResumeFile } from "../lib/resumeFile";
import { BrandLogo } from "./BrandLogo";
import { ThemeToggle } from "./ThemeToggle";

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
        <h1 className="brand" aria-label="IAssistant">
          <BrandLogo />
        </h1>
        <div className="auth-bar">
          <ThemeToggle />
          {auth?.user && (
            <>
              {auth.user.picture && <img className="auth-avatar" src={auth.user.picture} alt="" />}
              <button type="button" className="btn btn-sm btn-ghost" onClick={auth.onLogout}>Log out</button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

const OAUTH_LABEL: Record<string, string> = { google: "Google", github: "GitHub" };

export function LoginPage({
  providers,
  error,
  onPasswordLogin,
}: {
  providers: string[];
  error?: string;
  onPasswordLogin: (email: string, password: string) => Promise<string | null>;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState("");
  const remoteError =
    error && error.includes("not configured on the server") && providers.length === 0 ? "" : error || "";
  const shown = localError || remoteError;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setLocalError("");
    try {
      const message = await onPasswordLogin(email, password);
      if (message) setLocalError(message);
    } catch {
      setLocalError("Could not sign in. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="login-card" aria-label="Sign in">
      <h2>Sign in</h2>
      <p className="login-lead">Approved accounts only.</p>
      {shown && (
        <div className="alert-error" role="alert">
          {shown}
        </div>
      )}
      {providers.map((p) => (
        <a key={p} className="btn btn-block login-oauth" href={`/api/auth/login/${p}`}>
          Continue with {OAUTH_LABEL[p] ?? p}
        </a>
      ))}
      {providers.length > 0 && <div className="login-divider">or</div>}
      <form onSubmit={submit}>
        <label className="field">
          Email
          <input
            type="email"
            name="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="field">
          Password
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button type="submit" className="btn btn-primary btn-block login-submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </section>
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

export const AnswerPanel = ({
  answer,
  metrics,
  dev,
}: {
  answer: string;
  metrics: any;
  dev: boolean;
}) => (
  <section className="card card-answer">
    <h2 className="card-label">Suggestion</h2>
    <p className="card-body card-body-lg">{answer || <span className="muted">Your answer will appear here.</span>}</p>
    {dev && metrics && (
      <pre className="metrics">
        {metrics.cached
          ? "cached"
          : `${metrics.stt_ms ?? "-"} / ${metrics.detection_ms} / ${metrics.first_token_ms ?? "-"} / ${metrics.total_ms} ms`}
      </pre>
    )}
  </section>
);

export function TabNav({
  tab,
  setTab,
}: {
  tab: "session" | "setup";
  setTab: (t: "session" | "setup") => void;
}) {
  const items: { id: typeof tab; label: string }[] = [
    { id: "session", label: "Coach" },
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

export const STYLE_PRESETS: Record<string, string> = {
  Plain:
    "Answer as me, in the first person, using only my resume and profile. Use short everyday words a non-technical person can follow. Give a concise explanation, one simple example, and one analogy a beginner would understand. If you must use a technical term, explain it in plain language right away.",
  Concise: "Keep answers short and conversational, as if spoken aloud.",
  Senior: "Answer as a senior engineer with trade-offs, under 120 words.",
  STAR: "Use natural STAR stories from my resume only.",
  Simple: "Explain simply, under 90 words.",
};

export const DEFAULT_STYLE = "Plain";

export function CandidateProfile({ profile, setProfile }: { profile: Record<string, string>; setProfile: (p: Record<string, string>) => void }) {
  const set = (k: string, v: string) => setProfile({ ...profile, [k]: v });
  const styleName = Object.keys(STYLE_PRESETS).find((k) => STYLE_PRESETS[k] === (profile.instructions ?? "")) ?? "";
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
        <select
          aria-label="Style"
          value={styleName}
          onChange={(e) => set("instructions", e.target.value ? STYLE_PRESETS[e.target.value] : "")}
        >
          <option value="">Custom</option>
          {Object.keys(STYLE_PRESETS).map((k) => (
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
