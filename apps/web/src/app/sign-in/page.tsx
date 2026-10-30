import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getCurrentUser, isSignInConfigured } from "@/server/auth";
import { getSignInMode } from "@/server/sign-in-mode";
import { PasswordForm } from "./password-form";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage() {
  // Whether sign-in is configured depends on the runtime environment, so never prerender this page.
  await connection();
  const configured = isSignInConfigured();
  if (configured && (await getCurrentUser())) {
    redirect("/");
  }
  // Server-side only (ADR-0007): open mode is email and password for anyone; else the college code.
  const open = getSignInMode() === "open";

  return (
    <div className="mx-auto w-full max-w-md px-6 py-16 sm:px-8">
      {/* The college name as plain body text only (docs/design/theme.md, Boundaries). */}
      <p className="text-base">For the Maryville College community</p>
      <h1 className="mt-1 font-display text-4xl font-bold">Sign in</h1>
      <p className="mt-3 text-lg">
        {open
          ? "Sign in with your email and password, or create an account."
          : "Use your Maryville College email. We will send you a 6-digit code."}
      </p>

      <div className="mt-8 rounded-lg border border-border bg-surface p-4">
        {!configured ? (
          <p role="status" className="text-base">
            Sign-in is not set up on this server yet. Check back soon.
          </p>
        ) : open ? (
          <PasswordForm />
        ) : (
          <SignInForm />
        )}
      </div>

      {open ? (
        <p className="mt-6 text-sm text-muted">
          Unofficial student project. This is an open test: anyone can create an account for now.
          Points are play money, have no value and cannot be cashed in.
        </p>
      ) : (
        <p className="mt-6 text-sm text-muted">
          Unofficial student project. Points have no value and cannot be cashed in. Only{" "}
          @maryvillecollege.edu and @my.maryvillecollege.edu addresses can sign in.
        </p>
      )}
    </div>
  );
}
