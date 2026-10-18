import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { apiFetch, fetchAuthMe, logout, saveProfile, type AuthState } from "./services/api";
import { initialSessionState, reduceSessionState } from "./sessionState";
import { Coach, Ev, startAudioCapture, startBrowserSTT, type AudioSource } from "./services/websocket";
import {
  AnswerPanel,
  CandidateProfile,
  Controls,
  DEFAULT_STYLE,
  Header,
  LiveTranscript,
  STYLE_PRESETS,
  StatusIndicator,
  TabNav,
} from "./components/components";

const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* storage unavailable */
    }
  },
};

function loadProfile(): Record<string, string> {
  try {
    const parsed = JSON.parse(store.get("coach.profile") || "{}");
    if (!parsed.instructions?.trim()) parsed.instructions = STYLE_PRESETS[DEFAULT_STYLE];
    return parsed;
  } catch {
    return { instructions: STYLE_PRESETS[DEFAULT_STYLE] };
  }
}

export default function App() {
  const [s, dispatch] = useReducer(reduceSessionState, initialSessionState);
  const [running, setRunning] = useState(false);
  const [muted, setMuted] = useState(false);
  const [mode, setMode] = useState("balanced");
  const [dev, setDev] = useState(false);
  const [tab, setTab] = useState<"session" | "setup">("session");
  const [llm, setLlm] = useState("groq");
  const [stt, setStt] = useState("groq");
  const [audioSource, setAudioSource] = useState<AudioSource>((store.get("coach.audio") as AudioSource) || "mic");
  const [meetingId, setMeetingId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Record<string, string>>(loadProfile);
  const [auth, setAuth] = useState<AuthState>({
    enabled: false,
    required: false,
    providers: [],
    user: null,
    profile: {},
  });
  const profileSyncRef = useRef<ReturnType<typeof setTimeout>>();

  const live = useRef({ profile, mode, muted, llm, stt, meetingId });
  live.current = { profile, mode, muted, llm, stt, meetingId };
  const coach = useRef<Coach>();
  const stopMic = useRef<() => void>();

  useEffect(() => {
    store.set("coach.profile", JSON.stringify(profile));
    if (!auth.user) return;
    clearTimeout(profileSyncRef.current);
    profileSyncRef.current = setTimeout(() => {
      saveProfile(profile).catch(() => {});
    }, 800);
    return () => clearTimeout(profileSyncRef.current);
  }, [profile, auth.user]);
  useEffect(() => {
    store.set("coach.audio", audioSource);
  }, [audioSource]);

  const loadAuth = useCallback(async () => {
    try {
      const a = await fetchAuthMe();
      setAuth(a);
      if (a.user && a.profile && Object.keys(a.profile).length) {
        setProfile((prev) => {
          const next = { ...prev, ...a.profile };
          if (!next.instructions?.trim()) next.instructions = STYLE_PRESETS[DEFAULT_STYLE];
          return next;
        });
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    apiFetch("/api/health")
      .then((r) => r.json())
      .then((h) => {
        if (h.defaults) {
          setLlm(h.defaults.llm);
          setStt(h.defaults.stt);
        }
      })
      .catch(() => {});
    loadAuth();
    const params = new URLSearchParams(window.location.search);
    if (params.get("auth_error")) {
      dispatch({ type: "error", message: "Sign-in failed. Check OAuth redirect URLs and try again." });
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [loadAuth]);

  useEffect(() => {
    if (!running) return;
    const t = setTimeout(
      () =>
        coach.current?.send({
          type: "config",
          profile,
          mode,
          meeting_id: meetingId,
        }),
      600,
    );
    return () => clearTimeout(t);
  }, [profile, mode, running, meetingId]);

  const onEvent = useCallback((e: Ev) => {
    dispatch(e);
  }, []);

  async function start() {
    dispatch({ type: "clear" });
    setTab("session");
    try {
      const r = await apiFetch("/api/session/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error([j.error ?? "Could not start the session.", j.hint].filter(Boolean).join(" "));
      }
      const j = await r.json();
      const mid = j.meeting_id as string | null;
      setMeetingId(mid);
      if (j.llm) setLlm(j.llm);
      if (j.stt) setStt(j.stt);
      coach.current = new Coach(onEvent, () => ({
        profile: live.current.profile,
        mode: live.current.mode,
        meeting_id: live.current.meetingId,
      }));
      coach.current.connect();
      stopMic.current =
        stt === "browser"
          ? startBrowserSTT(
              (text, final) => {
                if (!live.current.muted) coach.current?.send({ type: "transcript", text, final });
              },
              (message, fatal) => {
                if (fatal) stop();
                dispatch({ type: "error", message });
              },
            )
          : await startAudioCapture(audioSource, (b) => {
              if (!live.current.muted) coach.current?.sendAudio(b);
            });
      setRunning(true);
      setMuted(false);
    } catch (e: any) {
      stopMic.current?.();
      coach.current?.stop();
      setMeetingId(null);
      dispatch({ type: "error", message: e.message });
    }
  }

  function stop() {
    stopMic.current?.();
    coach.current?.stop();
    const mid = meetingId;
    apiFetch("/api/session/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meeting_id: mid }),
    }).catch(() => {});
    setRunning(false);
    setMeetingId(null);
    dispatch({ type: "status", status: "READY" });
  }

  const toggleMute = () => {
    const m = !muted;
    setMuted(m);
    coach.current?.send({ type: "mute", value: m });
  };

  const clearSession = () => {
    coach.current?.send({ type: "clear" });
    dispatch({ type: "clear" });
  };

  useEffect(() => () => {
    stopMic.current?.();
    coach.current?.stop();
  }, []);

  const status = running && muted ? "READY" : s.status;
  const startDisabled = auth.required && !auth.user;

  const handleLogout = async () => {
    await logout();
    setAuth((a) => ({ ...a, user: null }));
  };

  return (
    <div className="app">
      <Header
        auth={{
          enabled: auth.enabled,
          required: auth.required,
          providers: auth.providers,
          user: auth.user,
          onLogout: handleLogout,
        }}
      />
      {auth.required && !auth.user && <p className="banner-signin">Sign in to start.</p>}
      <TabNav tab={tab} setTab={setTab} />

      {tab === "session" && (
        <div className="session-layout">
          <div className="session-toolbar">
            <StatusIndicator status={status} hint={running && muted ? "Muted" : undefined} />
          </div>
          {s.error && <div className="alert-error">{s.error}</div>}
          <AnswerPanel answer={s.answer} metrics={s.metrics} dev={dev} />
          <LiveTranscript partial={s.partial} finals={s.finals} />
        </div>
      )}

      {tab === "setup" && (
        <>
          <div className="card setup-quick">
            <label className="field">
              Audio
              <select disabled={running} value={audioSource} onChange={(e) => setAudioSource(e.target.value as AudioSource)}>
                <option value="mic">Microphone</option>
                <option value="display">Meeting / tab audio</option>
              </select>
            </label>
            <label className="check-inline">
              <input type="checkbox" checked={dev} onChange={(e) => setDev(e.target.checked)} />
              Show timing metrics
            </label>
          </div>
          <CandidateProfile profile={profile} setProfile={setProfile} />
        </>
      )}

      <Controls
        running={running}
        muted={muted}
        mode={mode}
        startDisabled={auth.required && !auth.user}
        onStart={start}
        onStop={stop}
        onMute={toggleMute}
        onClear={clearSession}
        setMode={setMode}
      />
    </div>
  );
}
