/** Same-origin API calls; sends session cookie when OAuth is enabled. */
export function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  return fetch(input, { credentials: "include", ...init });
}

export type AuthUser = {
  id: string;
  email: string;
  name?: string | null;
  picture?: string | null;
  provider: string;
};

export type AuthState = {
  enabled: boolean;
  required: boolean;
  providers: string[];
  user: AuthUser | null;
  profile: Record<string, string>;
};

export async function fetchAuthMe(): Promise<AuthState> {
  const r = await apiFetch("/api/auth/me");
  if (!r.ok) throw new Error("Could not load account status.");
  return r.json();
}

export async function logout(): Promise<void> {
  await apiFetch("/api/auth/logout", { method: "POST" });
}

export function loginUrl(provider: string): string {
  return `/api/auth/login/${provider}`;
}

export async function loginWithPassword(email: string, password: string): Promise<string | null> {
  const r = await apiFetch("/api/auth/login/password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (r.ok) return null;
  const body = await r.json().catch(() => ({}));
  return typeof body.error === "string" ? body.error : "Invalid email or password.";
}

export async function saveProfile(profile: Record<string, string>): Promise<void> {
  const r = await apiFetch("/api/profile", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profile }),
  });
  if (!r.ok) throw new Error("Could not save profile.");
}
