/**
 * Anonymous per-user identity.
 *
 * There is no sign-in flow yet: each browser is assigned a random UUID that is
 * stored in an HttpOnly cookie. That UUID names the user's Durable Object (and
 * therefore their private SQLite vocabulary database). When real accounts are
 * added, this is the single place that needs to change.
 */

const COOKIE_NAME = "newslang_uid";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export interface Identity {
  userId: string;
  /** `Set-Cookie` value to send back when a new identity was created. */
  setCookie?: string;
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function resolveIdentity(request: Request): Identity {
  const existing = readCookie(request.headers.get("cookie"), COOKIE_NAME);
  if (existing && UUID_RE.test(existing)) {
    return { userId: existing };
  }

  const userId = crypto.randomUUID();
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return {
    userId,
    setCookie: `${COOKIE_NAME}=${userId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${MAX_AGE_SECONDS}${secure}`,
  };
}
