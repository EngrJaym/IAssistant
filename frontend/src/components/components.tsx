import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { validateResumeFile } from "../lib/resumeFile";
import {
  DEFAULT_STYLE,
  STYLE_PRESETS,
  newTemplateId,
  type StyleTemplate,
} from "../lib/stylePresets";
import { BrandLogo } from "./BrandLogo";
import { ThemeToggle } from "./ThemeToggle";

export { DEFAULT_STYLE, STYLE_PRESETS, withDefaultStyle } from "../lib/stylePresets";

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

export function Header({ auth, onMeetingPopup }: { auth?: AuthBarProps; onMeetingPopup?: () => void }) {
  return (
    <header className="app-header">
      <div className="header-row">
        <h1 className="brand" aria-label="IAssistant">
          <BrandLogo />
        </h1>
        <div className="auth-bar">
          {onMeetingPopup && (
            <button
              type="button"
              className="icon-btn"
              aria-label="Open meeting window"
              title="Open a small window you can keep in front of the meeting"
              onClick={onMeetingPopup}
            >
              <svg className="popup-icon" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="3" y="4" width="18" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
                <rect x="11" y="10" width="8" height="6" rx="1.2" fill="currentColor" opacity="0.85" />
              </svg>
            </button>
          )}
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
  const [showPassword, setShowPassword] = useState(false);
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
        <div className="field">
          <label htmlFor="login-password">Password</label>
          <div className="password-wrap">
            <input
              id="login-password"
              type={showPassword ? "text" : "password"}
              name="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              className="password-toggle"
              aria-label={showPassword ? "Hide password" : "Show password"}
              onClick={() => setShowPassword((shown) => !shown)}
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
        </div>
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

export const TurnQueue = ({
  turns,
  partial,
}: {
  turns: { qid: number; question: string; answer: string; done: boolean }[];
  partial: string;
}) => (
  <div className="turn-queue" aria-live="polite">
    {turns.map((turn) => (
      <article key={turn.qid} className={turn.done ? "turn is-done" : "turn"}>
        <p className="turn-question">{turn.question}</p>
        <p className="turn-answer">{turn.answer || (turn.done ? "" : "Answering…")}</p>
      </article>
    ))}
    {!turns.length && <p className="turn-answer">Your answer will appear here.</p>}
    {partial && <p className="turn-hearing">{partial}</p>}
  </div>
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

function styleSelection(instructions: string, templates: StyleTemplate[]): string {
  const template = templates.find((item) => item.body === instructions);
  if (template) return `template:${template.id}`;
  const preset = Object.keys(STYLE_PRESETS).find((name) => STYLE_PRESETS[name] === instructions);
  return preset ?? "";
}

export function CandidateProfile({
  profile,
  setProfile,
  templates = [],
  setTemplates = () => {},
}: {
  profile: Record<string, string>;
  setProfile: (p: Record<string, string>) => void;
  templates?: StyleTemplate[];
  setTemplates?: (templates: StyleTemplate[]) => void;
}) {
  const set = (k: string, v: string) => setProfile({ ...profile, [k]: v });
  const styleName = styleSelection(profile.instructions ?? "", templates);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadName, setUploadName] = useState("");
  const [uploadErr, setUploadErr] = useState("");
  const [confirming, setConfirming] = useState<null | { title: string; body: string; confirm: string; onConfirm: () => void }>(null);

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

  function applyStyle(value: string) {
    if (value.startsWith("template:")) {
      const template = templates.find((item) => item.id === value.slice("template:".length));
      if (template) set("instructions", template.body);
      return;
    }
    if (STYLE_PRESETS[value]) set("instructions", STYLE_PRESETS[value]);
  }

  function updateTemplate(id: string, patch: Partial<StyleTemplate>) {
    const current = templates.find((item) => item.id === id);
    const next = templates.map((item) => (item.id === id ? { ...item, ...patch } : item));
    setTemplates(next);
    if (current && patch.body !== undefined && (profile.instructions ?? "") === current.body) {
      set("instructions", patch.body);
    }
  }

  function addTemplate() {
    if (templates.length >= 12) return;
    const title = templates.some((item) => item.title === "My style") ? `My style ${templates.length + 1}` : "My style";
    const body = (profile.instructions ?? "").trim() || STYLE_PRESETS[DEFAULT_STYLE];
    const created = { id: newTemplateId(), title, body };
    setTemplates([...templates, created]);
    set("instructions", body);
  }

  function removeTemplate(id: string) {
    const template = templates.find((item) => item.id === id);
    if (!template) return;
    setConfirming({
      title: "Remove template",
      body: `Remove “${template.title}”? This cannot be undone.`,
      confirm: "Remove",
      onConfirm: () => setTemplates(templates.filter((item) => item.id !== id)),
    });
  }

  return (
    <div className="card">
      <h2 className="card-label">Your profile</h2>
      <label className="field">
        Style
        <select aria-label="Style" value={styleName} onChange={(e) => applyStyle(e.target.value)}>
          <option value="">Custom</option>
          {Object.keys(STYLE_PRESETS).map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
          {templates.length > 0 && (
            <optgroup label="My templates">
              {templates.map((template) => (
                <option key={template.id} value={`template:${template.id}`}>{template.title}</option>
              ))}
            </optgroup>
          )}
        </select>
        <textarea rows={4} placeholder="How to answer (optional)" value={profile.instructions ?? ""} onChange={(e) => set("instructions", e.target.value)} />
      </label>
      <div className="template-editor" aria-label="Custom templates">
        <div className="template-head">
          <h3>My templates</h3>
          <button type="button" className="btn btn-sm" onClick={addTemplate} disabled={templates.length >= 12}>
            Add template
          </button>
        </div>
        <p className="template-lead">Save your own answer styles. Rename a template, edit its wording, or remove it.</p>
        {templates.map((template) => (
          <div key={template.id} className="template-card">
            <input
              type="text"
              aria-label={`Template title ${template.title}`}
              value={template.title}
              maxLength={60}
              onChange={(e) => updateTemplate(template.id, { title: e.target.value })}
            />
            <textarea
              rows={3}
              aria-label={`Template text ${template.title}`}
              value={template.body}
              maxLength={2000}
              onChange={(e) => updateTemplate(template.id, { body: e.target.value })}
            />
            <div className="template-actions">
              <button type="button" className="btn btn-sm" onClick={() => set("instructions", template.body)}>Use</button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => removeTemplate(template.id)}>Remove</button>
            </div>
          </div>
        ))}
      </div>
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
      <button
        type="button"
        className="btn btn-sm btn-ghost"
        onClick={() =>
          setConfirming({
            title: "Reset setup",
            body: "Clear the role, job description, resume, and answer style on this account?",
            confirm: "Reset",
            onConfirm: () => setProfile({}),
          })
        }
      >
        Reset
      </button>
      {confirming && (
        <ConfirmModal
          title={confirming.title}
          body={confirming.body}
          confirmLabel={confirming.confirm}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            confirming.onConfirm();
            setConfirming(null);
          }}
        />
      )}
    </div>
  );
}

export function ConfirmModal({
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="confirm-title">{title}</h2>
        <p>{body}</p>
        <div className="modal-actions">
          <button ref={cancelRef} type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn btn-danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function BarIcon({ children }: { children: ReactNode }) {
  return (
    <svg className="bar-icon" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      {children}
    </svg>
  );
}

export const Controls = (p: {
  running: boolean;
  startDisabled?: boolean;
  onStart: () => void;
  onStop: () => void;
  onStage: () => void;
  onClear: () => void;
}) => (
  <nav className="control-bar" aria-label="Session">
    <button type="button" className="bar-btn bar-btn-start" disabled={p.running || p.startDisabled} onClick={p.onStart}>
      <BarIcon><path d="M8 5.5v13l11-6.5-11-6.5z" /></BarIcon>
      <span>Start</span>
    </button>
    <button type="button" className="bar-btn" disabled={!p.running} onClick={p.onStop}>
      <BarIcon><rect x="7" y="7" width="10" height="10" rx="1.5" /></BarIcon>
      <span>Stop</span>
    </button>
    <button type="button" className="bar-btn bar-btn-stage" disabled={!p.running} onClick={p.onStage}>
      <BarIcon>
        <path d="M6 3.5v17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M6 4.5h11l-2.2 3.2L17 11H6V4.5z" />
      </BarIcon>
      <span>Stage</span>
    </button>
    <button type="button" className="bar-btn" onClick={p.onClear}>
      <BarIcon>
        <path d="M8 7h8M9.5 7V5.8A1.8 1.8 0 0 1 11.3 4h1.4A1.8 1.8 0 0 1 14.5 5.8V7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M7 7.5h10l-.7 11.2a1.5 1.5 0 0 1-1.5 1.3H9.2a1.5 1.5 0 0 1-1.5-1.3L7 7.5z" />
      </BarIcon>
      <span>Clear</span>
    </button>
  </nav>
);
