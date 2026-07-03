// @vitest-environment node
// auth.ts is server-side code; jose's TextEncoder-based secret needs a real
// Node Uint8Array, which the default jsdom environment does not provide.
import { test, expect, vi, beforeEach, afterEach } from "vitest";

// `server-only` throws when imported outside a React Server Component; stub it out.
vi.mock("server-only", () => ({}));

// In-memory cookie store shared by the mocked `next/headers` cookies().
const cookieStore = new Map<string, string>();

const cookies = {
  get: vi.fn((name: string) => {
    const value = cookieStore.get(name);
    return value === undefined ? undefined : { name, value };
  }),
  set: vi.fn((name: string, value: string) => {
    cookieStore.set(name, value);
  }),
  delete: vi.fn((name: string) => {
    cookieStore.delete(name);
  }),
};

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => cookies),
}));

import {
  createSession,
  getSession,
  deleteSession,
  verifySession,
} from "@/lib/auth";

const COOKIE_NAME = "auth-token";

beforeEach(() => {
  cookieStore.clear();
  cookies.get.mockClear();
  cookies.set.mockClear();
  cookies.delete.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

test("createSession writes a signed auth-token cookie with secure options", async () => {
  await createSession("user-123", "user@example.com");

  expect(cookies.set).toHaveBeenCalledTimes(1);
  const [name, token, options] = cookies.set.mock.calls[0];

  expect(name).toBe(COOKIE_NAME);
  expect(typeof token).toBe("string");
  // A JWT has three dot-separated segments.
  expect(token.split(".")).toHaveLength(3);
  expect(options).toMatchObject({
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
  expect(options.expires).toBeInstanceOf(Date);
});

test("getSession returns the payload for a valid token (round-trip)", async () => {
  await createSession("user-123", "user@example.com");

  const session = await getSession();

  expect(session).not.toBeNull();
  expect(session?.userId).toBe("user-123");
  expect(session?.email).toBe("user@example.com");
});

test("getSession returns null when no cookie is present", async () => {
  const session = await getSession();
  expect(session).toBeNull();
});

test("getSession returns null for a malformed / tampered token", async () => {
  cookieStore.set(COOKIE_NAME, "not-a-real-jwt");

  const session = await getSession();
  expect(session).toBeNull();
});

test("getSession returns null for an expired token", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2020-01-01T00:00:00Z"));

  await createSession("user-123", "user@example.com");

  // Jump 8 days forward — past the 7-day expiration.
  vi.setSystemTime(new Date("2020-01-09T00:00:00Z"));

  const session = await getSession();
  expect(session).toBeNull();
});

test("deleteSession removes the auth-token cookie", async () => {
  await createSession("user-123", "user@example.com");
  expect(cookieStore.has(COOKIE_NAME)).toBe(true);

  await deleteSession();

  expect(cookies.delete).toHaveBeenCalledWith(COOKIE_NAME);
  expect(cookieStore.has(COOKIE_NAME)).toBe(false);
});

test("verifySession returns the payload for a valid token from the request", async () => {
  await createSession("user-123", "user@example.com");
  const token = cookieStore.get(COOKIE_NAME)!;

  const request = {
    cookies: {
      get: (name: string) =>
        name === COOKIE_NAME ? { name, value: token } : undefined,
    },
  } as any;

  const session = await verifySession(request);

  expect(session).not.toBeNull();
  expect(session?.userId).toBe("user-123");
  expect(session?.email).toBe("user@example.com");
});

test("verifySession returns null when the request has no auth cookie", async () => {
  const request = {
    cookies: {
      get: () => undefined,
    },
  } as any;

  const session = await verifySession(request);
  expect(session).toBeNull();
});

test("verifySession returns null for an invalid token in the request", async () => {
  const request = {
    cookies: {
      get: () => ({ name: COOKIE_NAME, value: "garbage.token.value" }),
    },
  } as any;

  const session = await verifySession(request);
  expect(session).toBeNull();
});
