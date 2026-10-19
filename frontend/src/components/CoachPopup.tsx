import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createRoot, type Root } from "react-dom/client";
import { popupLookVars } from "../lib/popupLook";
import { THEME_EVENT, loadTheme, type Theme } from "../services/theme";
import { Controls, StatusIndicator } from "./components";
import { ThemeToggle } from "./ThemeToggle";

export type CoachPopupState = {
  answer: string;
  status: string;
  partial: string;
  hint?: string;
  running: boolean;
  muted: boolean;
};

export type PopupCommand = "start" | "stop" | "mute" | "clear";

type PopupMessage =
  | { type: "coach"; state: CoachPopupState }
  | { type: "presence"; open: boolean }
  | { type: "command"; command: PopupCommand };

const CHANNEL = "iassistant-coach-popup";

let latest: CoachPopupState = { answer: "", status: "READY", partial: "", running: false, muted: false };
let pipWindow: Window | null = null;
let pipRoot: Root | null = null;
let remoteOpenUntil = 0;

function broadcast(message: PopupMessage) {
  window.dispatchEvent(new CustomEvent("iassistant-popup", { detail: message }));
  try {
    const channel = new BroadcastChannel(CHANNEL);
    channel.postMessage(message);
    channel.close();
  } catch {
    /* BroadcastChannel is unavailable */
  }
}

function notePresence(open: boolean) {
  remoteOpenUntil = open ? Date.now() + 4000 : 0;
}

export function meetingWindowOpen(): boolean {
  if (pipWindow) return !pipWindow.closed;
  return Date.now() < remoteOpenUntil;
}

export function subscribeMeetingWindow(onChange: (open: boolean) => void) {
  const emit = () => onChange(meetingWindowOpen());
  const onEvent = (event: Event) => {
    const message = (event as CustomEvent<PopupMessage>).detail;
    if (message?.type === "presence") notePresence(message.open);
    emit();
  };
  window.addEventListener("iassistant-popup", onEvent);
  let channel: BroadcastChannel | null = null;
  try {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (message) => {
      const data = message.data as PopupMessage;
      if (data?.type === "presence") notePresence(data.open);
      if (data?.type === "coach" && data.state) latest = data.state;
      emit();
    };
  } catch {
    /* BroadcastChannel is unavailable */
  }
  emit();
  const timer = window.setInterval(emit, 700);
  return () => {
    window.removeEventListener("iassistant-popup", onEvent);
    channel?.close();
    window.clearInterval(timer);
  };
}

export function focusMeetingWindow() {
  if (pipWindow && !pipWindow.closed) pipWindow.focus();
}

export function closeMeetingWindow() {
  if (pipWindow && !pipWindow.closed) pipWindow.close();
  pipWindow = null;
  notePresence(false);
  broadcast({ type: "presence", open: false });
}

export function publishCoachPopup(state: CoachPopupState) {
  latest = state;
  broadcast({ type: "coach", state });
}

export function sendPopupCommand(command: PopupCommand) {
  broadcast({ type: "command", command });
}

export function subscribePopupCommands(onCommand: (command: PopupCommand) => void) {
  const take = (message: PopupMessage | undefined) => {
    if (message?.type === "command") onCommand(message.command);
  };
  const onEvent = (event: Event) => take((event as CustomEvent<PopupMessage>).detail);
  window.addEventListener("iassistant-popup", onEvent);
  let channel: BroadcastChannel | null = null;
  try {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (message) => take(message.data as PopupMessage);
  } catch {
    /* BroadcastChannel is unavailable */
  }
  return () => {
    window.removeEventListener("iassistant-popup", onEvent);
    channel?.close();
  };
}

export function subscribeCoachPopup(onChange: (state: CoachPopupState) => void) {
  onChange(latest);
  const onEvent = (event: Event) => {
    const message = (event as CustomEvent<PopupMessage>).detail;
    if (message?.type === "coach") onChange(message.state);
  };
  window.addEventListener("iassistant-popup", onEvent);
  let channel: BroadcastChannel | null = null;
  try {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (message) => {
      const data = message.data as PopupMessage;
      if (data?.type === "coach" && data.state) onChange(data.state);
    };
  } catch {
    /* BroadcastChannel is unavailable */
  }
  return () => {
    window.removeEventListener("iassistant-popup", onEvent);
    channel?.close();
  };
}

export function CoachPopupCard({ state }: { state: CoachPopupState }) {
  return (
    <section className="coach-popup-card is-comfortable is-left" aria-label="Meeting coach">
      <div className="coach-popup-bar">
        <strong>IAssistant</strong>
        <div className="coach-popup-tools">
          <StatusIndicator status={state.status} hint={state.hint} />
          <ThemeToggle />
        </div>
      </div>
      <p className="coach-popup-answer">{state.answer || "Your answer will appear here."}</p>
      {state.partial && <p className="coach-popup-partial">{state.partial}</p>}
      <Controls
        running={state.running}
        muted={state.muted}
        onStart={() => sendPopupCommand("start")}
        onStop={() => sendPopupCommand("stop")}
        onMute={() => sendPopupCommand("mute")}
        onClear={() => sendPopupCommand("clear")}
      />
    </section>
  );
}

function paintTheme(root: HTMLElement, theme: Theme) {
  root.setAttribute("data-theme", theme);
  root.style.colorScheme = theme;
  root.style.background = "transparent";
}

function PopupApp() {
  const [state, setState] = useState<CoachPopupState>(latest);
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const frame = useRef<HTMLDivElement>(null);
  useEffect(() => subscribeCoachPopup(setState), []);
  useEffect(() => {
    const root = frame.current?.ownerDocument.documentElement;
    if (root) paintTheme(root, theme);
    if (root && root !== document.documentElement) paintTheme(document.documentElement, theme);
  }, [theme]);
  useEffect(() => {
    const use = (next: string | null) => {
      if (next === "light" || next === "dark") setTheme(next);
    };
    const onTheme = (event: Event) => use((event as CustomEvent<string>).detail);
    const onStorage = (event: StorageEvent) => {
      if (event.key === "coach.theme") use(event.newValue);
    };
    window.addEventListener(THEME_EVENT, onTheme);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(THEME_EVENT, onTheme);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  useEffect(() => {
    const ping = () => broadcast({ type: "presence", open: true });
    ping();
    const timer = window.setInterval(ping, 1200);
    const bye = () => broadcast({ type: "presence", open: false });
    window.addEventListener("pagehide", bye);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pagehide", bye);
      bye();
    };
  }, []);
  return (
    <div ref={frame} className="coach-popup-app" style={popupLookVars() as CSSProperties}>
      <CoachPopupCard state={state} />
    </div>
  );
}

function markTransparent(doc: Document) {
  doc.documentElement.classList.add("coach-popup");
  doc.body.classList.add("coach-popup");
  paintTheme(doc.documentElement, loadTheme());
  doc.body.style.background = "transparent";
}

function copyStyles(target: Document) {
  for (const sheet of document.styleSheets) {
    try {
      const css = [...sheet.cssRules].map((rule) => rule.cssText).join("\n");
      const style = target.createElement("style");
      style.textContent = css;
      target.head.appendChild(style);
    } catch {
      if (sheet.href) {
        const link = target.createElement("link");
        link.rel = "stylesheet";
        link.href = sheet.href;
        target.head.appendChild(link);
      }
    }
  }
}

type PictureInPicture = {
  requestWindow: (options?: { width?: number; height?: number }) => Promise<Window>;
};

function pictureInPicture(): PictureInPicture | null {
  const host = window as Window & { documentPictureInPicture?: PictureInPicture };
  return host.documentPictureInPicture ?? null;
}

function mountPopup(target: Window) {
  markTransparent(target.document);
  copyStyles(target.document);
  const holder = target.document.createElement("div");
  target.document.body.appendChild(holder);
  pipRoot?.unmount();
  pipRoot = createRoot(holder);
  pipRoot.render(<PopupApp />);
  target.addEventListener("pagehide", () => {
    pipRoot?.unmount();
    pipRoot = null;
    if (pipWindow === target) pipWindow = null;
    broadcast({ type: "presence", open: false });
  });
}

function claim(opened: Window) {
  pipWindow = opened;
  broadcast({ type: "presence", open: true });
}

/** Small always-on-top window for keeping the coach in front of a meeting. */
export async function openMeetingPopup(): Promise<string | null> {
  const pip = pictureInPicture();
  if (pip) {
    try {
      if (pipWindow && !pipWindow.closed) {
        pipWindow.focus();
        broadcast({ type: "presence", open: true });
        return null;
      }
      const opened = await pip.requestWindow({ width: 420, height: 340 });
      claim(opened);
      mountPopup(opened);
      publishCoachPopup(latest);
      return null;
    } catch {
      /* Fall back to a small browser window. */
    }
  }
  if (pipWindow && !pipWindow.closed) {
    pipWindow.focus();
    broadcast({ type: "presence", open: true });
    publishCoachPopup(latest);
    return null;
  }
  const opened = window.open(
    `${location.origin}${location.pathname}?popup=1`,
    "iassistant-meeting",
    "popup=yes,width=420,height=360,left=24,top=24",
  );
  if (!opened) return "The browser blocked the meeting window. Allow pop-ups for this site, then try again.";
  claim(opened);
  publishCoachPopup(latest);
  window.setTimeout(() => publishCoachPopup(latest), 500);
  return null;
}

export function CoachPopupPage() {
  useEffect(() => {
    markTransparent(document);
  }, []);
  return <PopupApp />;
}

export function MeetingWindowHold({ onShow }: { onShow: () => void }) {
  return (
    <div className="hold-app">
      <section className="hold-card" aria-label="Meeting window">
        <div className="hold-run" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
        <h1>App is in the small window</h1>
        <p>This tab is paused so the coach runs in the meeting window only. Close that window to use this tab again.</p>
        <button type="button" className="btn" onClick={onShow}>
          Show small window
        </button>
      </section>
    </div>
  );
}
