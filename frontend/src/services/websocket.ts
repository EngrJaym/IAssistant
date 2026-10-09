export type Ev = { type: string; [k: string]: any };
export { startAudioCapture, startMicCapture } from "./audio";
export type { AudioSource } from "./audio";

/** WebSocket client with automatic reconnection; re-sends the start message (profile + mode) on every (re)connect. */
export class Coach {
  private ws?: WebSocket;
  private tries = 0;
  active = false;
  constructor(private onEvent: (e: Ev) => void, private hello: () => object) {}

  connect() {
    this.active = true;
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/interview`);
    ws.onopen = () => { this.tries = 0; this.send({ type: "start", ...this.hello() }); };
    ws.onmessage = (m) => this.onEvent(JSON.parse(m.data));
    ws.onclose = () => {
      if (!this.active) return;
      if (this.tries >= 5) { this.active = false; return this.onEvent({ type: "error", message: "Connection lost. Press Start to reconnect." }); }
      this.onEvent({ type: "status", status: "RECONNECTING" });
      setTimeout(() => this.active && this.connect(), 1000 * ++this.tries);
    };
    this.ws = ws;
  }
  send(o: object) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(o)); }
  sendAudio(b: ArrayBuffer) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(b); }
  stop() { this.send({ type: "stop" }); this.active = false; this.ws?.close(); }
}

/** @deprecated use startMicCapture from ./audio */
export { startMicCapture as startMic } from "./audio";

/** Free speech-to-text using the browser's built-in recognizer (Chrome/Edge). Sends text, not audio, to our backend. */
export function startBrowserSTT(onText: (text: string, final: boolean) => void, onError: (msg: string, fatal: boolean) => void): () => void {
  const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SR) throw new Error("This browser has no built-in speech recognition. Use Chrome or Edge, or switch to OpenAI speech-to-text.");
  let on = true;
  const r = new SR();
  r.continuous = true; r.interimResults = true; r.lang = "en-US";
  r.onresult = (e: any) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i], t: string = res[0].transcript;
      if (res.isFinal) onText(t.trim(), true); else interim += t;
    }
    if (interim.trim()) onText(interim.trim(), false);
  };
  r.onerror = (e: any) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      on = false;
      onError("Microphone access was denied. Enable microphone permission in your browser settings (click the lock icon next to the address bar, set Microphone to Allow), then press Start again.", true);
    } else if (e.error === "network") onError("Browser speech recognition lost its connection (it uses an online service). Retrying...", false);
  };
  r.onend = () => { if (on) setTimeout(() => { try { if (on) r.start(); } catch { /* already running */ } }, 300); };   // Chrome stops after silence
  r.start();
  return () => { on = false; try { r.stop(); } catch { /* not running */ } };
}
