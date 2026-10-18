import { applyTheme, loadTheme, type Theme } from "../services/theme";
import { useEffect, useState } from "react";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => loadTheme());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

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
