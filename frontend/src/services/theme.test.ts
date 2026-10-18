import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyTheme, initTheme, loadTheme, toggleTheme } from "./theme";

describe("theme", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("applyTheme persists and sets data-theme", () => {
    applyTheme("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem("coach.theme")).toBe("dark");
    expect(loadTheme()).toBe("dark");
  });

  it("toggleTheme switches light and dark", () => {
    applyTheme("light");
    expect(toggleTheme()).toBe("dark");
    expect(toggleTheme()).toBe("light");
  });

  it("loadTheme falls back when storage is empty", () => {
    expect(["light", "dark"]).toContain(loadTheme());
  });

  it("initTheme applies saved preference", () => {
    localStorage.setItem("coach.theme", "dark");
    expect(initTheme()).toBe("dark");
  });
});
