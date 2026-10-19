import { THEME_EVENT, applyTheme, loadTheme, type Theme } from "../services/theme";
import { useEffect, useState } from "react";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => loadTheme());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    const use = (next: string | null) => {
      if (next === "light" || next === "dark") setTheme(next);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === "coach.theme") use(event.newValue);
    };
    const onTheme = (event: Event) => use((event as CustomEvent<string>).detail);
    window.addEventListener("storage", onStorage);
    window.addEventListener(THEME_EVENT, onTheme);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(THEME_EVENT, onTheme);
    };
  }, []);

  const dark = theme === "dark";
  const flip = () => {
    const next: Theme = dark ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
  };

  return (
    <button
      type="button"
      className={`theme-switch${dark ? " is-dark" : ""}`}
      role="switch"
      aria-checked={dark}
      aria-label={dark ? "Dark mode" : "Light mode"}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={flip}
    >
      <span className="theme-switch-name">{dark ? "Dark" : "Light"}</span>
      <span className="theme-switch-track" aria-hidden="true">
        <span className="theme-switch-thumb">{dark ? "☾" : "☀"}</span>
      </span>
    </button>
  );
}
