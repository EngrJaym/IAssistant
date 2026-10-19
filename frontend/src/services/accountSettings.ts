import {
  DEFAULT_STYLE,
  STYLE_PRESETS,
  parseTemplates,
  serializeTemplates,
  withDefaultStyle,
  type StyleTemplate,
} from "../lib/stylePresets";

/** Shared keys from before settings were scoped to an account. Do not read these. */
export const LEGACY_PROFILE_KEY = "coach.profile";
export const LEGACY_AUDIO_KEY = "coach.audio";

export type AccountAudio = "mic" | "display";

export function profileKey(userId: string): string {
  return `coach.profile.${userId}`;
}

export function audioKey(userId: string): string {
  return `coach.audio.${userId}`;
}

export function defaultProfile(): Record<string, string> {
  return { instructions: STYLE_PRESETS[DEFAULT_STYLE] };
}

function asProfile(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") out[key] = item;
  }
  return out;
}

/**
 * Profile for this account only.
 * A non-empty server profile replaces local data. An empty server profile may use
 * this account's own cache. Another account's cache and the old shared key are ignored.
 */
export function profileForAccount(
  userId: string,
  serverProfile: Record<string, string> | undefined | null,
  read: (key: string) => string | null,
): Record<string, string> {
  const server = asProfile(serverProfile) ?? {};
  if (Object.keys(server).length > 0) return withDefaultStyle(server);
  const raw = read(profileKey(userId));
  if (raw) {
    try {
      const cached = asProfile(JSON.parse(raw));
      if (cached && Object.keys(cached).length > 0) return withDefaultStyle(cached);
    } catch {
      /* ignore corrupt cache */
    }
  }
  return defaultProfile();
}

export function audioForAccount(userId: string, read: (key: string) => string | null): AccountAudio {
  return read(audioKey(userId)) === "display" ? "display" : "mic";
}

const SESSION_MODES = new Set(["normal", "balanced", "aggressive"]);

/** Drop UI settings so the coach profile stays candidate data only. */
export function accountSettingsFor(
  userId: string,
  serverProfile: Record<string, string> | undefined | null,
  read: (key: string) => string | null,
): { profile: Record<string, string>; audio: AccountAudio; mode: string; dev: boolean; templates: StyleTemplate[] } {
  const resolved = profileForAccount(userId, serverProfile, read);
  const profile = { ...resolved };
  delete profile.audio_source;
  delete profile.session_mode;
  delete profile.show_metrics;
  delete profile.style_templates;
  const audio: AccountAudio =
    resolved.audio_source === "display" || resolved.audio_source === "mic"
      ? resolved.audio_source
      : audioForAccount(userId, read);
  const mode = SESSION_MODES.has(resolved.session_mode) ? resolved.session_mode : "balanced";
  return { profile, audio, mode, dev: resolved.show_metrics === "1", templates: parseTemplates(resolved.style_templates) };
}

export function profilePayload(
  profile: Record<string, string>,
  audio: AccountAudio,
  mode: string,
  dev: boolean,
  templates: StyleTemplate[] = [],
): Record<string, string> {
  const payload: Record<string, string> = {
    ...profile,
    audio_source: audio,
    session_mode: SESSION_MODES.has(mode) ? mode : "balanced",
    show_metrics: dev ? "1" : "0",
  };
  delete payload.style_templates;
  const encoded = serializeTemplates(templates);
  if (encoded) payload.style_templates = encoded;
  return payload;
}

export function forgetSharedSettings(remove: (key: string) => void): void {
  remove(LEGACY_PROFILE_KEY);
  remove(LEGACY_AUDIO_KEY);
}
