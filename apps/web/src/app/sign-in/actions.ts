"use server";

import { redirect } from "next/navigation";
import { getAuthDeps } from "@/server/auth";
import { requestEmailCode, verifyEmailCode } from "@/server/auth-flow";
import { signInWithEmailPassword, signUpWithEmailPassword } from "@/server/auth-password";
import type { PasswordFormState, SignInState } from "./state";

// Two sign-in forms; the server decides which one works (SIGN_IN_MODE, ADR-0007). Server actions
// can be called directly, so each one refuses to run in the other mode, whatever the page shows.
//
// College mode, `signInAction`: two-step email code, told apart by the pressed button's `intent`:
//   send / resend  -> email a code, show the code field
//   verify         -> check the code, create the profile on first sign-in, go home
//   change         -> back to the email field
// Open mode, `passwordAction`: `intent` is `sign-up` (create account) or `sign-in`.

const CODE_OFF = "Sign-in with an emailed code is turned off for now. Use your email and password.";

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function signInAction(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const intent = field(formData, "intent");
  const email = field(formData, "email");

  if (intent === "change") {
    return { step: "email", email: "" };
  }

  const deps = await getAuthDeps();
  if (deps.open) {
    return { step: "email", email, error: CODE_OFF };
  }

  if (intent === "verify") {
    const result = await verifyEmailCode(deps, email, field(formData, "code"));
    if (result.ok) {
      redirect("/");
    }
    return { step: "code", email, error: result.message };
  }

  // "send" and "resend"
  const result = await requestEmailCode(deps, email);
  if (!result.ok) {
    return { step: intent === "resend" ? "code" : "email", email, error: result.message };
  }
  return {
    step: "code",
    email: result.email,
    notice: intent === "resend" ? "We sent a new code." : undefined,
  };
}

export async function passwordAction(
  _prev: PasswordFormState,
  formData: FormData,
): Promise<PasswordFormState> {
  const intent = field(formData, "intent");
  const email = field(formData, "email");
  // Read as-is: a password is never trimmed, logged or returned.
  const password = formData.get("password");

  const deps = await getAuthDeps();
  const result =
    intent === "sign-up"
      ? await signUpWithEmailPassword(deps, email, password)
      : await signInWithEmailPassword(deps, email, password);
  if (result.ok) {
    redirect("/");
  }
  return { email, error: result.message };
}
