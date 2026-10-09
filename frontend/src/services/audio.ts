const RATE = 24000;
const HANG_MS = 800;
const VOICE_RMS = 0.012;

async function pcmStreamFromMedia(stream: MediaStream, onChunk: (b: ArrayBuffer) => void): Promise<() => void> {
  const ctx = new AudioContext();
  const src = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(2048, 1, 1);
  const ratio = ctx.sampleRate / RATE;
  const pre: ArrayBuffer[] = [];
  let open = false;
  let lastVoice = -1e9;
  proc.onaudioprocess = (e) => {
    const x = e.inputBuffer.getChannelData(0);
    let sum = 0;
    for (let i = 0; i < x.length; i++) sum += x[i] * x[i];
    const n = Math.floor(x.length / ratio);
    const out = new Int16Array(n);
    for (let i = 0; i < n; i++) {
      const p = i * ratio;
      const j = Math.floor(p);
      const f = p - j;
      const v = x[j] * (1 - f) + (x[j + 1] ?? x[j]) * f;
      out[i] = Math.max(-1, Math.min(1, v)) * 32767;
    }
    const now = performance.now();
    if (Math.sqrt(sum / x.length) > VOICE_RMS) lastVoice = now;
    if (now - lastVoice < HANG_MS) {
      if (!open) {
        open = true;
        pre.splice(0).forEach(onChunk);
      }
      onChunk(out.buffer);
    } else {
      open = false;
      pre.push(out.buffer);
      if (pre.length > 3) pre.shift();
    }
  };
  src.connect(proc);
  proc.connect(ctx.destination);
  return () => {
    proc.disconnect();
    src.disconnect();
    stream.getTracks().forEach((t) => t.stop());
    ctx.close();
  };
}

export type AudioSource = "mic" | "display";

/** Microphone with client-side VAD (speech-only chunks to the server). */
export async function startMicCapture(onChunk: (b: ArrayBuffer) => void): Promise<() => void> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
  } catch (e: any) {
    if (e?.name === "NotAllowedError" || e?.name === "SecurityError")
      throw new Error(
        "Microphone access was denied. Allow microphone permission in the browser, then press Start again.",
      );
    throw new Error("Could not open the microphone: " + (e?.message ?? e));
  }
  return pcmStreamFromMedia(stream, onChunk);
}

/**
 * Tab/window audio (meeting sound). User must enable "Share audio" in the browser picker.
 * Video track is stopped immediately; only audio is sent. Requires Chrome/Edge and HTTPS or localhost.
 */
export async function startDisplayAudioCapture(onChunk: (b: ArrayBuffer) => void): Promise<() => void> {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error("Meeting audio capture needs Chrome or Edge (getDisplayMedia). Use microphone instead.");
  }
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  stream.getVideoTracks().forEach((t) => t.stop());
  if (!stream.getAudioTracks().length) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error('No audio shared. When prompted, check "Share tab audio" or "Share system audio", then try again.');
  }
  return pcmStreamFromMedia(stream, onChunk);
}

export async function startAudioCapture(
  source: AudioSource,
  onChunk: (b: ArrayBuffer) => void,
): Promise<() => void> {
  return source === "display" ? startDisplayAudioCapture(onChunk) : startMicCapture(onChunk);
}
