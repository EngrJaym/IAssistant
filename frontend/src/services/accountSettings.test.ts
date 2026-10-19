import { describe, expect, it } from "vitest";
import {
  LEGACY_AUDIO_KEY,
  LEGACY_PROFILE_KEY,
  accountSettingsFor,
  audioForAccount,
  audioKey,
  forgetSharedSettings,
  profileForAccount,
  profileKey,
  profilePayload,
} from "./accountSettings";
import { DEFAULT_STYLE, STYLE_PRESETS } from "../components/components";

describe("profileForAccount", () => {
  it("uses the server profile and ignores another account cache and the shared key", () => {
    const store = new Map<string, string>([
      [LEGACY_PROFILE_KEY, JSON.stringify({ resume: "shared resume", target: "Shared role" })],
      [profileKey("user-a"), JSON.stringify({ resume: "account A", target: "Role A" })],
      [profileKey("user-b"), JSON.stringify({ resume: "account B", job_description: "Only B" })],
    ]);
    const profile = profileForAccount("user-b", { resume: "server B", target: "Server role" }, (key) => store.get(key) ?? null);
    expect(profile.resume).toBe("server B");
    expect(profile.target).toBe("Server role");
    expect(profile.job_description).toBeUndefined();
    expect(profile.instructions).toBe(STYLE_PRESETS[DEFAULT_STYLE]);
  });

  it("falls back to this account cache when the server profile is empty", () => {
    const store = new Map<string, string>([
      [LEGACY_PROFILE_KEY, JSON.stringify({ resume: "shared resume" })],
      [profileKey("user-a"), JSON.stringify({ resume: "account A" })],
      [profileKey("user-b"), JSON.stringify({ resume: "account B", target: "Role B" })],
    ]);
    const profile = profileForAccount("user-b", {}, (key) => store.get(key) ?? null);
    expect(profile.resume).toBe("account B");
    expect(profile.target).toBe("Role B");
    expect(profile.instructions).toBe(STYLE_PRESETS[DEFAULT_STYLE]);
  });

  it("starts from defaults when this account has no server or cached profile", () => {
    const store = new Map<string, string>([
      [LEGACY_PROFILE_KEY, JSON.stringify({ resume: "shared resume" })],
      [profileKey("user-a"), JSON.stringify({ resume: "account A" })],
    ]);
    const profile = profileForAccount("user-b", {}, (key) => store.get(key) ?? null);
    expect(profile).toEqual({ instructions: STYLE_PRESETS[DEFAULT_STYLE] });
  });
});

describe("accountSettingsFor", () => {
  it("keeps audio on the account profile and out of the coach profile", () => {
    const settings = accountSettingsFor(
      "user-b",
      {
        resume: "server B",
        audio_source: "display",
        session_mode: "aggressive",
        show_metrics: "1",
        style_templates: JSON.stringify([{ id: "a", title: "Board update", body: "Lead with the decision." }]),
      },
      () => "mic",
    );
    expect(settings.profile.resume).toBe("server B");
    expect(settings.profile.audio_source).toBeUndefined();
    expect(settings.profile.session_mode).toBeUndefined();
    expect(settings.profile.style_templates).toBeUndefined();
    expect(settings.audio).toBe("display");
    expect(settings.mode).toBe("aggressive");
    expect(settings.dev).toBe(true);
    const saved = profilePayload(settings.profile, settings.audio, settings.mode, settings.dev);
    expect(saved.audio_source).toBe("display");
    expect(saved.session_mode).toBe("aggressive");
    expect(saved.show_metrics).toBe("1");
    expect(saved.resume).toBe("server B");
    expect(settings.templates).toEqual([{ id: "a", title: "Board update", body: "Lead with the decision." }]);
    const withTemplate = profilePayload(settings.profile, settings.audio, settings.mode, settings.dev, settings.templates);
    expect(JSON.parse(withTemplate.style_templates)[0].title).toBe("Board update");
  });
});

describe("audioForAccount", () => {
  it("reads only this account's audio setting", () => {
    const store = new Map<string, string>([
      [LEGACY_AUDIO_KEY, "display"],
      [audioKey("user-a"), "display"],
    ]);
    expect(audioForAccount("user-a", (key) => store.get(key) ?? null)).toBe("display");
    expect(audioForAccount("user-b", (key) => store.get(key) ?? null)).toBe("mic");
  });
});

describe("forgetSharedSettings", () => {
  it("removes the old shared keys", () => {
    const removed: string[] = [];
    forgetSharedSettings((key) => removed.push(key));
    expect(removed).toEqual([LEGACY_PROFILE_KEY, LEGACY_AUDIO_KEY]);
  });
});
