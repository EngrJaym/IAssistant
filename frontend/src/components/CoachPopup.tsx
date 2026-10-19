import { useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { StatusIndicator } from "./components";

export type CoachPopupState = {
  answer: string;
  status: string;
  partial: string;
  hint?: string;
};

const CHANNEL = "iassistant-coach-popup";

let latest: CoachPopupState = { answer: "", status: "READY", partial: "" };
let pipWindow: Window | null = null;
let pipRoot: Root | null = null;

export function publishCoachPopup(state: CoachPopupState) {
  latest = state;
  window.dispatchEvent(new CustomEvent("iassistant-popup", { detail: state }));
  try {
    const channel = new BroadcastChannel(CHANNEL);
    channel.postMessage(state);
    channel.close();
  } catch {
    /* BroadcastChannel is unavailable */
  }
}

export function subscribeCoachPopup(onChange: (state: CoachPopupState) => void) {
  onChange(latest);
  const onEvent = (event: Event) => onChange((event as CustomEvent<CoachPopupState>).detail);
  window.addEventListener("iassistant-popup", onEvent);
  let channel: BroadcastChannel | null = null;
  try {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (message) => {
      if (message.data && typeof message.data === "object") onChange(message.data as CoachPopupState);
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
    <section className="coach-popup-card" aria-label="Meeting coach">
      <div className="coach-popup-bar">
        <strong>IAssistant</strong>
        <StatusIndicator status={state.status} hint={state.hint} />
      </div>
      <p className="coach-popup-answer">{state.answer || "Your answer will appear here."}</p>
      {state.partial && <p className="coach-popup-partial">{state.partial}</p>}
    </section>
  );
}

function PopupApp() {
  const [state, setState] = useState<CoachPopupState>(latest);
  useEffect(() => subscribeCoachPopup(setState), []);
  return (
    <div className="coach-popup-app">
      <CoachPopupCard state={state} />
    </div>
  );
}

function markTransparent(doc: Document) {
  doc.documentElement.classList.add("coach-popup");
  doc.body.classList.add("coach-popup");
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
  });
}

/** Small always-on-top window for keeping the coach in front of a meeting. */
export async function openMeetingPopup(): Promise<string | null> {
  const pip = pictureInPicture();
  if (pip) {
    try {
      if (pipWindow && !pipWindow.closed) {
        pipWindow.focus();
        return null;
      }
      const opened = await pip.requestWindow({ width: 400, height: 280 });
      pipWindow = opened;
      mountPopup(opened);
      publishCoachPopup(latest);
      return null;
    } catch {
      /* Fall back to a small browser window. */
    }
  }
  if (pipWindow && !pipWindow.closed) {
    pipWindow.focus();
    publishCoachPopup(latest);
    return null;
  }
  const opened = window.open(
    `${location.origin}${location.pathname}?popup=1`,
    "iassistant-meeting",
    "popup=yes,width=400,height=300,left=24,top=24",
  );
  if (!opened) return "The browser blocked the meeting window. Allow pop-ups for this site, then try again.";
  pipWindow = opened;
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

