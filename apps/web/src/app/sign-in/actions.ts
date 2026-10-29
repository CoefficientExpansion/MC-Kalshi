"use server";

import { redirect } from "next/navigation";
import { getAuthDeps } from "@/server/auth";
import { requestEmailCode, verifyEmailCode } from "@/server/auth-flow";
import type { SignInState } from "./state";

// Two-step email-code sign-in. One action, told apart by the pressed button's `intent`:
//   send / resend  -> email a code, show the code field
//   verify         -> check the code, create the profile on first sign-in, go home
//   change         -> back to the email field

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
