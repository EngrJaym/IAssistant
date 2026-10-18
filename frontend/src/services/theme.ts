export type Theme = "light" | "dark";

const KEY = "coach.theme";

export function initTheme(): Theme {
  const saved = localStorage.getItem(KEY) as Theme | null;
  const theme = saved === "dark" || saved === "light" ? saved : systemTheme();
  applyTheme(theme);
  return theme;
}

function systemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(KEY, theme);
}

export function loadTheme(): Theme {
  const t = localStorage.getItem(KEY);
  if (t === "dark" || t === "light") return t;
  return systemTheme();
}

export function toggleTheme(): Theme {
  const next: Theme = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  applyTheme(next);
  return next;
}
