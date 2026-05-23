import { afterEach, describe, expect, it, vi } from "vitest";
import { getDevBypassDoctorEmail } from "./auth";

describe("getDevBypassDoctorEmail", () => {
  const originalEnv = {
    NODE_ENV: process.env.NODE_ENV,
    DEV_AUTH_BYPASS: process.env.DEV_AUTH_BYPASS,
    DEV_AUTH_EMAIL: process.env.DEV_AUTH_EMAIL,
  };

  afterEach(() => {
    (process.env as any).NODE_ENV = originalEnv.NODE_ENV;
    process.env.DEV_AUTH_BYPASS = originalEnv.DEV_AUTH_BYPASS;
    process.env.DEV_AUTH_EMAIL = originalEnv.DEV_AUTH_EMAIL;
    vi.restoreAllMocks();
  });

  it("returns the normalized local bypass email in development", () => {
    (process.env as any).NODE_ENV = "development";
    process.env.DEV_AUTH_BYPASS = "true";
    process.env.DEV_AUTH_EMAIL = " Test@Example.com ";

    expect(getDevBypassDoctorEmail()).toBe("test@example.com");
  });

  it("throws if dev bypass is enabled outside development", () => {
    (process.env as any).NODE_ENV = "production";
    process.env.DEV_AUTH_BYPASS = "true";
    process.env.DEV_AUTH_EMAIL = "test@example.com";

    expect(() => getDevBypassDoctorEmail()).toThrow("DEV_AUTH_BYPASS must not be enabled outside local development.");
  });
});

