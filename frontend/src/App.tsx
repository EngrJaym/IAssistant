import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { apiFetch, fetchAuthMe, loginWithPassword, logout, saveProfile, type AuthState } from "./services/api";
import {
  accountSettingsFor,
  audioKey,
  defaultProfile,
  forgetSharedSettings,
  profileKey,
  profilePayload,
} from "./services/accountSettings";
import { initialSessionState, reduceSessionState } from "./sessionState";
import {
  CoachPopupPage,
  MeetingWindowHold,
  closeMeetingWindow,
  focusMeetingWindow,
  openMeetingPopup,
  publishCoachPopup,
  subscribeMeetingWindow,
  subscribePopupCommands,
} from "./components/CoachPopup";
import { Coach, Ev, startAudioCapture, startBrowserSTT, type AudioSource } from "./services/websocket";
import type { StyleTemplate } from "./lib/stylePresets";
import {
  CandidateProfile,
  Controls,
  Header,
  LiveTranscript,
  LoginPage,
  StatusIndicator,
  TabNav,
  TurnQueue,
} from "./components/components";

const popupView = new URLSearchParams(window.location.search).get("popup") === "1";

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
  remove: (k: string) => {
    try {
      localStorage.removeItem(k);
    } catch {
      /* storage unavailable */
    }
  },
};

export default function App() {
  if (popupView) return <CoachPopupPage />;
  return <CoachApp />;
}

function CoachApp() {
  const [s, dispatch] = useReducer(reduceSessionState, initialSessionState);
  const [running, setRunning] = useState(false);
  const [mode, setMode] = useState("balanced");
  const [dev, setDev] = useState(false);
  const [tab, setTab] = useState<"session" | "setup">("session");
  const [llm, setLlm] = useState("groq");
  const [stt, setStt] = useState("groq");
  const [audioSource, setAudioSource] = useState<AudioSource>("mic");
  const [meetingId, setMeetingId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Record<string, string>>(defaultProfile);
  const [templates, setTemplates] = useState<StyleTemplate[]>([]);
  const [profileOwner, setProfileOwner] = useState<string | null>(null);
  const [popupError, setPopupError] = useState("");
  const [meetingWindow, setMeetingWindow] = useState(false);
  const [auth, setAuth] = useState<AuthState>({
    enabled: false,
    required: true,
    providers: [],
    user: null,
    profile: {},
  });
  const [authChecked, setAuthChecked] = useState(false);
  const [loginError, setLoginError] = useState("");
  const profileSyncRef = useRef<ReturnType<typeof setTimeout>>();
  const activeUserId = useRef<string | null>(null);
  const skipProfileSave = useRef(false);

  const live = useRef({ profile, mode, llm, stt, meetingId });
  live.current = { profile, mode, llm, stt, meetingId };
  const coach = useRef<Coach>();
  const stopMic = useRef<() => void>();
  activeUserId.current = auth.user?.id ?? null;

  useEffect(() => {
    const uid = auth.user?.id;
    if (!uid || uid !== profileOwner) return;
    const snapshot = profilePayload(profile, audioSource, mode, dev, templates);
    store.set(profileKey(uid), JSON.stringify(snapshot));
    store.set(audioKey(uid), audioSource);
    clearTimeout(profileSyncRef.current);
    if (skipProfileSave.current) {
      skipProfileSave.current = false;
      return;
    }
    profileSyncRef.current = setTimeout(() => {
      if (activeUserId.current !== uid) return;
      saveProfile(snapshot).catch(() => {});
    }, 800);
    return () => clearTimeout(profileSyncRef.current);
  }, [profile, templates, audioSource, mode, dev, auth.user, profileOwner]);

  const applyAccount = useCallback((a: AuthState) => {
    setAuth(a);
    if (!a.user) {
      setProfileOwner(null);
      setProfile(defaultProfile());
      setTemplates([]);
      setAudioSource("mic");
      setMode("balanced");
      setDev(false);
      setTab("session");
      return;
    }
    const serverHasProfile = !!a.profile && Object.keys(a.profile).length > 0;
    skipProfileSave.current = serverHasProfile;
    const settings = accountSettingsFor(a.user.id, a.profile, store.get);
    setProfile(settings.profile);
    setTemplates(settings.templates);
    setAudioSource(settings.audio);
    setMode(settings.mode);
    setDev(settings.dev);
    setTab("session");
    setProfileOwner(a.user.id);
    forgetSharedSettings(store.remove);
  }, []);

  const loadAuth = useCallback(async () => {
    try {
      applyAccount(await fetchAuthMe());
    } catch {
      setAuth((a) => ({ ...a, user: null }));
      setProfileOwner(null);
    } finally {
      setAuthChecked(true);
    }
  }, [applyAccount]);

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
    const authError = params.get("auth_error");
    if (authError) {
      const messages: Record<string, string> = {
        not_allowed: "This account is signed in with Google, but it is not on the allowlist.",
        unverified_email: "Google has not verified this email address.",
        allowlist_empty: "Sign-in is closed until ALLOWED_EMAILS is set on the server.",
        invalid_state: "Sign-in expired. Try again.",
        oauth_failed: "Sign-in failed. Check the OAuth redirect URL and try again.",
        provider_unconfigured: "Google sign-in is not configured on the server.",
      };
      setLoginError(messages[authError] || "Sign-in failed. Check OAuth redirect URLs and try again.");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [loadAuth]);

  useEffect(() => subscribeMeetingWindow(setMeetingWindow), []);

  useEffect(() => {
    publishCoachPopup({
      answer: s.answer,
      turns: s.turns,
      status: s.status,
      partial: s.partial,
      running,
    });
  }, [s.answer, s.turns, s.partial, s.status, running]);

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
                coach.current?.send({ type: "transcript", text, final });
              },
              (message, fatal) => {
                if (fatal) stop();
                dispatch({ type: "error", message });
              },
            )
          : await startAudioCapture(audioSource, (b) => {
              coach.current?.sendAudio(b);
            });
      setRunning(true);
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

  const stage = () => {
    coach.current?.send({ type: "stage" });
  };

  const clearSession = () => {
    coach.current?.send({ type: "clear" });
    dispatch({ type: "clear" });
  };

  const sessionActions = useRef({ start, stop, stage, clearSession });
  sessionActions.current = { start, stop, stage, clearSession };
  useEffect(
    () =>
      subscribePopupCommands((command) => {
        const actions = sessionActions.current;
        if (command === "start") void actions.start();
        else if (command === "stop") actions.stop();
        else if (command === "stage") actions.stage();
        else actions.clearSession();
      }),
    [],
  );

  useEffect(() => () => {
    stopMic.current?.();
    coach.current?.stop();
  }, []);

  const status = s.status;
  const startDisabled = auth.required && !auth.user;

  const handleLogout = async () => {
    closeMeetingWindow();
    const uid = auth.user?.id;
    stopMic.current?.();
    coach.current?.stop();
    const mid = meetingId;
    if (mid) {
      apiFetch("/api/session/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meeting_id: mid }),
      }).catch(() => {});
    }
    setRunning(false);
    setMeetingId(null);
    dispatch({ type: "clear" });
    dispatch({ type: "status", status: "READY" });
    clearTimeout(profileSyncRef.current);
    if (uid && uid === profileOwner) {
      const snapshot = profilePayload(profile, audioSource, mode, dev, templates);
      store.set(profileKey(uid), JSON.stringify(snapshot));
      store.set(audioKey(uid), audioSource);
      try {
        await saveProfile(snapshot);
      } catch {
        /* this account's cache still has the latest setup */
      }
    }
    setProfileOwner(null);
    setProfile(defaultProfile());
    setTemplates([]);
    setAudioSource("mic");
    setMode("balanced");
    setDev(false);
    setTab("session");
    await logout();
    setAuth((a) => ({ ...a, user: null, profile: {} }));
    setLoginError("");
  };

  const handleMeetingPopup = async () => {
    const message = await openMeetingPopup();
    setPopupError(message || "");
  };

  const handlePasswordLogin = async (email: string, password: string) => {
    const message = await loginWithPassword(email, password);
    if (!message) {
      setLoginError("");
      await loadAuth();
    }
    return message;
  };

  if (auth.user && meetingWindow) {
    return (
      <MeetingWindowHold
        onShow={() => {
          focusMeetingWindow();
          publishCoachPopup({
            answer: s.answer,
            turns: s.turns,
            status: s.status,
            partial: s.partial,
            running,
          });
        }}
      />
    );
  }

  if (!auth.user) {
    return (
      <div className="app login-app">
        <Header />
        {authChecked ? (
          <LoginPage providers={auth.providers} error={loginError} onPasswordLogin={handlePasswordLogin} />
        ) : (
          <p className="login-lead">Checking sign-in…</p>
        )}
      </div>
    );
  }

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
        onMeetingPopup={handleMeetingPopup}
      />
      <TabNav tab={tab} setTab={setTab} />
      {popupError && <div className="alert-error" role="alert">{popupError}</div>}

      {tab === "session" && (
        <div className="session-layout">
          <div className="session-toolbar">
            <StatusIndicator status={status} />
          </div>
          {s.error && <div className="alert-error">{s.error}</div>}
          <TurnQueue turns={s.turns} partial={s.partial} />
          {dev && s.metrics && (
            <pre className="metrics">
              {s.metrics.cached
                ? "cached"
                : `${s.metrics.stt_ms ?? "-"} / ${s.metrics.detection_ms} / ${s.metrics.first_token_ms ?? "-"} / ${s.metrics.total_ms} ms`}
            </pre>
          )}
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
            <label className="field">
              Sensitivity
              <select aria-label="Sensitivity" value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="normal">Strict</option>
                <option value="balanced">Balanced</option>
                <option value="aggressive">Sensitive</option>
              </select>
            </label>
            <label className="check-inline">
              <input type="checkbox" checked={dev} onChange={(e) => setDev(e.target.checked)} />
              Show timing metrics
            </label>
          </div>
          <CandidateProfile profile={profile} setProfile={setProfile} templates={templates} setTemplates={setTemplates} />
        </>
      )}

      <Controls
        running={running}
        startDisabled={auth.required && !auth.user}
        onStart={start}
        onStop={stop}
        onStage={stage}
        onClear={clearSession}
      />
    </div>
  );
}
