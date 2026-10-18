import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { apiFetch, fetchAuthMe, logout, saveProfile, type AuthState } from "./services/api";
import { Coach, Ev, startAudioCapture, startBrowserSTT, type AudioSource } from "./services/websocket";
import {
  AnswerPanel,
  CandidateProfile,
  Controls,
  DialogueEntry,
  Header,
  LiveTranscript,
  MeetingNotes,
  QuestionPanel,
  SavedMeeting,
  SpeakerPicker,
  StatusIndicator,
  TabNav,
  formatTime,
} from "./components/components";

const init = {
  status: "READY",
  partial: "",
  finals: [] as string[],
  question: "",
  qtype: "",
  answer: "",
  points: [] as string[],
  followUp: "",
  confidence: "",
  possible: "",
  metrics: null as any,
  error: "",
  detected: false,
  phaseReason: "",
};
type S = typeof init;

function reduce(s: S, e: Ev): S {
  switch (e.type) {
    case "status":
      return { ...s, status: e.status, error: e.status === "ERROR" ? s.error : "" };
    case "phase":
      return { ...s, status: e.status, phaseReason: e.reason || "" };
    case "transcript_partial":
      return { ...s, partial: e.text };
    case "transcript_final":
      return { ...s, partial: "", finals: [...s.finals.slice(-3), e.text] };
    case "possible_question":
      return { ...s, possible: e.question };
    case "question_detected":
      return { ...s, question: e.question, qtype: e.qtype, detected: true, possible: "", error: "" };
    case "answer_start":
      return { ...s, question: e.question, answer: "", points: [], followUp: "", confidence: "", metrics: null };
    case "answer_token":
      return { ...s, answer: s.answer + e.text };
    case "answer_complete":
      return {
        ...s,
        answer: e.answer,
        points: e.key_points,
        followUp: e.follow_up,
        confidence: e.confidence,
        metrics: e.metrics,
      };
    case "error":
      return { ...s, error: e.message, status: "ERROR" };
    case "clear":
      return { ...init, status: s.status === "ERROR" ? "READY" : s.status };
    default:
      return s;
  }
}

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

function loadDialogue(): DialogueEntry[] {
  try {
    const raw = store.get("coach.dialogue");
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function appendDialogue(entries: DialogueEntry[], text: string, ts: number, speaker: string): DialogueEntry[] {
  const trimmed = text.trim();
  if (!trimmed) return entries;
  const last = entries[entries.length - 1];
  if (last && last.text === trimmed && Math.abs(last.ts - ts) < 2000) return entries;
  return [...entries, { id: `${ts}-${Math.random().toString(36).slice(2, 8)}`, ts, speaker, text: trimmed }];
}

function tagLastAsInterviewer(entries: DialogueEntry[], question: string): DialogueEntry[] {
  if (!entries.length || !question.trim()) return entries;
  const q = question.trim().toLowerCase();
  const next = [...entries];
  for (let i = next.length - 1; i >= 0; i--) {
    const line = next[i].text.toLowerCase();
    if (line.includes(q.slice(0, Math.min(q.length, 40))) || q.includes(line.slice(0, Math.min(line.length, 40)))) {
      next[i] = { ...next[i], speaker: "Interviewer" };
      break;
    }
  }
  return next;
}

function linesFromApi(lines: { speaker: string; text: string; ts: number }[]): DialogueEntry[] {
  return lines.map((l, i) => ({
    id: `${l.ts}-${i}`,
    ts: l.ts,
    speaker: l.speaker,
    text: l.text,
  }));
}

export default function App() {
  const [s, dispatch] = useReducer(reduce, init);
  const [running, setRunning] = useState(false);
  const [muted, setMuted] = useState(false);
  const [mode, setMode] = useState("balanced");
  const [dev, setDev] = useState(false);
  const [tab, setTab] = useState<"session" | "notes" | "setup">("session");
  const [llm, setLlm] = useState("groq");
  const [stt, setStt] = useState("groq");
  const [dbEnabled, setDbEnabled] = useState(false);
  const [speaker, setSpeaker] = useState(store.get("coach.speaker") || "Interviewer");
  const [audioSource, setAudioSource] = useState<AudioSource>((store.get("coach.audio") as AudioSource) || "mic");
  const [handsFree, setHandsFree] = useState(store.get("coach.handsFree") !== "0");
  const [speakerHint, setSpeakerHint] = useState("");
  const [dialogue, setDialogue] = useState<DialogueEntry[]>(loadDialogue);
  const [savedMeetings, setSavedMeetings] = useState<SavedMeeting[]>([]);
  const [notesView, setNotesView] = useState<"live" | "saved">("live");
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null);
  const [meetingId, setMeetingId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(store.get("coach.profile") || "{}");
    } catch {
      return {};
    }
  });
  const [auth, setAuth] = useState<AuthState>({
    enabled: false,
    required: false,
    providers: [],
    user: null,
    profile: {},
  });
  const profileSyncRef = useRef<ReturnType<typeof setTimeout>>();

  const live = useRef({ profile, mode, muted, llm, stt, speaker, meetingId, handsFree });
  live.current = { profile, mode, muted, llm, stt, speaker, meetingId, handsFree };
  const coach = useRef<Coach>();
  const stopMic = useRef<() => void>();
  const dialogueRef = useRef(dialogue);
  dialogueRef.current = dialogue;

  const persistDialogue = useCallback((entries: DialogueEntry[]) => {
    dialogueRef.current = entries;
    setDialogue(entries);
    store.set("coach.dialogue", JSON.stringify(entries));
  }, []);

  const refreshSavedMeetings = useCallback(async () => {
    if (!dbEnabled) return;
    if (auth.required && !auth.user) return;
    try {
      const r = await apiFetch("/api/meetings");
      if (r.status === 401) return;
      if (!r.ok) return;
      const j = await r.json();
      setSavedMeetings(j.meetings || []);
    } catch {
      /* ignore */
    }
  }, [dbEnabled, auth.required, auth.user]);

  const loadSavedMeeting = useCallback(async (id: string) => {
    try {
      const r = await apiFetch(`/api/meetings/${id}`);
      if (!r.ok) return;
      const j = await r.json();
      persistDialogue(linesFromApi(j.lines || []));
      setSelectedMeetingId(id);
      setNotesView("saved");
    } catch {
      /* ignore */
    }
  }, [persistDialogue]);

  const recordLine = useCallback(
    (text: string, ts?: number) => {
      const next = appendDialogue(dialogueRef.current, text, ts ?? Date.now(), live.current.speaker);
      if (next !== dialogueRef.current) persistDialogue(next);
    },
    [persistDialogue],
  );

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
    store.set("coach.speaker", speaker);
  }, [speaker]);
  useEffect(() => {
    store.set("coach.audio", audioSource);
  }, [audioSource]);
  useEffect(() => {
    store.set("coach.handsFree", handsFree ? "1" : "0");
  }, [handsFree]);

  const loadAuth = useCallback(async () => {
    try {
      const a = await fetchAuthMe();
      setAuth(a);
      if (a.user && a.profile && Object.keys(a.profile).length) {
        setProfile((prev) => ({ ...prev, ...a.profile }));
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    apiFetch("/api/health")
      .then((r) => r.json())
      .then((h) => {
        setDbEnabled(!!h.database);
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
    if (tab === "notes" && dbEnabled) refreshSavedMeetings();
  }, [tab, dbEnabled, refreshSavedMeetings]);

  useEffect(() => {
    if (!running) return;
    const t = setTimeout(
      () =>
        coach.current?.send({
          type: "config",
          profile,
          mode,
          speaker,
          meeting_id: meetingId,
          hands_free: handsFree,
        }),
      600,
    );
    return () => clearTimeout(t);
  }, [profile, mode, running, speaker, meetingId, handsFree]);

  const onEvent = useCallback(
    (e: Ev) => {
      if (e.type === "transcript_final") recordLine(e.text, typeof e.ts === "number" ? e.ts : Date.now());
      if (e.type === "question_detected") {
        persistDialogue(tagLastAsInterviewer(dialogueRef.current, e.question));
      }
      if (e.type === "speaker_status") setSpeakerHint(e.label || "");
      dispatch(e);
    },
    [recordLine, persistDialogue],
  );

  async function start() {
    dispatch({ type: "clear" });
    persistDialogue([]);
    setNotesView("live");
    setSelectedMeetingId(null);
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
        speaker: live.current.speaker,
        meeting_id: live.current.meetingId,
        hands_free: live.current.handsFree,
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
    refreshSavedMeetings();
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

  const exportNotes = (format: "txt" | "md") => {
    const lines = dialogue.map((e) =>
      format === "md" ? `**${e.speaker}** (${formatTime(e.ts)}): ${e.text}` : `[${formatTime(e.ts)}] ${e.speaker}: ${e.text}`,
    );
    const body = format === "md" ? `# Meeting dialogue\n\n${lines.join("\n\n")}\n` : lines.join("\n") + "\n";
    const blob = new Blob([body], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `meeting-notes-${new Date().toISOString().slice(0, 10)}.${format === "md" ? "md" : "txt"}`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const exportDocx = async (id: string) => {
    const r = await apiFetch(`/api/meetings/${id}/export.docx`);
    if (!r.ok) return;
    const blob = await r.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `meeting-dialogue-${id.slice(0, 8)}.docx`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const deleteSaved = async (id: string) => {
    await apiFetch(`/api/meetings/${id}`, { method: "DELETE" });
    if (selectedMeetingId === id) {
      setSelectedMeetingId(null);
      persistDialogue([]);
    }
    refreshSavedMeetings();
  };

  const clearNotes = () => {
    if (!confirm("Clear the dialogue shown in this view? (Saved meetings on the server are not deleted.)")) return;
    persistDialogue([]);
  };

  const onNotesViewChange = (v: "live" | "saved") => {
    setNotesView(v);
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
    setSavedMeetings([]);
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
            <SpeakerPicker speaker={speaker} setSpeaker={setSpeaker} disabled={running && handsFree} />
          </div>
          {s.error && <div className="alert-error">{s.error}</div>}
          <AnswerPanel answer={s.answer} points={s.points} followUp={s.followUp} metrics={s.metrics} dev={dev} />
          <QuestionPanel question={s.question} possible={s.possible} />
          <LiveTranscript partial={s.partial} finals={s.finals} />
        </div>
      )}

      {tab === "notes" && (
        <MeetingNotes
          entries={dialogue}
          savedMeetings={savedMeetings}
          dbEnabled={dbEnabled}
          view={notesView}
          setView={onNotesViewChange}
          selectedMeetingId={selectedMeetingId}
          onSelectMeeting={(id) => id && loadSavedMeeting(id)}
          onRefreshSaved={refreshSavedMeetings}
          onExportDocx={exportDocx}
          onClear={clearNotes}
          onExport={exportNotes}
          onDeleteSaved={deleteSaved}
          currentMeetingId={meetingId}
        />
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
              <input type="checkbox" checked={handsFree} disabled={running} onChange={(e) => setHandsFree(e.target.checked)} />
              Hands-free (interviewer only)
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
