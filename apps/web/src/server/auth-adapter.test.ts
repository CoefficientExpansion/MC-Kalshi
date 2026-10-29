import { AuthApiError, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { adaptSupabaseAuth } from "./auth";

// The real error class Supabase returns, so a change in its fields (status, code) breaks here.
const rateLimited = () =>
  new AuthApiError("Email rate limit exceeded", 429, "over_email_send_rate_limit");
const expired = () => new AuthApiError("Token has expired or is invalid", 403, "otp_expired");
// The Before User Created hook answers a disallowed address with its own http_code (403) and no
// stable error code.
const hookRejected = () =>
  new AuthApiError("Sign-in is limited to Maryville College addresses", 403, undefined);

function stub(auth: Record<string, unknown>): SupabaseClient {
  return { auth } as unknown as SupabaseClient;
}

const otpArgs = { email: "a@maryvillecollege.edu", options: { shouldCreateUser: true } };
const verifyArgs = { email: "a@maryvillecollege.edu", token: "123456", type: "email" as const };

describe("adaptSupabaseAuth", () => {
  describe("signInWithOtp", () => {
    it.each([
      ["rate limit", rateLimited, { status: 429, code: "over_email_send_rate_limit" }],
      ["hook rejection", hookRejected, { status: 403, code: undefined }],
    ])("maps the %s error to {status, code}", async (_, make, expected) => {
      const signInWithOtp = vi.fn(async () => ({
        data: { user: null, session: null },
        error: make(),
      }));
      const result = await adaptSupabaseAuth(stub({ signInWithOtp })).signInWithOtp(otpArgs);
      expect(result).toEqual({ error: expected });
      expect(signInWithOtp).toHaveBeenCalledWith(otpArgs);
    });

    it("returns error null on success", async () => {
      const signInWithOtp = async () => ({ data: { user: null, session: null }, error: null });
      expect(await adaptSupabaseAuth(stub({ signInWithOtp })).signInWithOtp(otpArgs)).toEqual({
        error: null,
      });
    });
  });

  describe("verifyOtp", () => {
    it.each([
      ["otp_expired", expired, { status: 403, code: "otp_expired" }],
      ["rate limit", rateLimited, { status: 429, code: "over_email_send_rate_limit" }],
    ])("maps the %s error and returns user null", async (_, make, expected) => {
      const verifyOtp = async () => ({ data: { user: null, session: null }, error: make() });
      const result = await adaptSupabaseAuth(stub({ verifyOtp })).verifyOtp(verifyArgs);
      expect(result).toEqual({ user: null, error: expected });
    });

    it("returns only id and email of the user on success", async () => {
      const verifyOtp = async () => ({
        data: {
          user: { id: "u1", email: "a@maryvillecollege.edu", app_metadata: {}, aud: "x" },
          session: {},
        },
        error: null,
      });
      expect(await adaptSupabaseAuth(stub({ verifyOtp })).verifyOtp(verifyArgs)).toEqual({
        user: { id: "u1", email: "a@maryvillecollege.edu" },
        error: null,
      });
    });
  });

  describe("signOut", () => {
    it("defaults to local scope and maps an error", async () => {
      const signOut = vi.fn(async () => ({ error: rateLimited() }));
      expect(await adaptSupabaseAuth(stub({ signOut })).signOut()).toEqual({
        error: { status: 429, code: "over_email_send_rate_limit" },
      });
      expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    });

    it("passes a scope through and returns error null on success", async () => {
      const signOut = vi.fn(async () => ({ error: null }));
      expect(await adaptSupabaseAuth(stub({ signOut })).signOut("local")).toEqual({
        error: null,
      });
      expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    });
  });
});
