import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getCurrentUser, isSignInConfigured } from "@/server/auth";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage() {
  // Whether sign-in is configured depends on the runtime environment, so never prerender this page.
  await connection();
  const configured = isSignInConfigured();
  if (configured && (await getCurrentUser())) {
    redirect("/");
  }

  return (
    <div className="mx-auto w-full max-w-md px-6 py-16 sm:px-8">
      {/* The college name as plain body text only (docs/design/theme.md, Boundaries). */}
      <p className="text-base">For the Maryville College community</p>
      <h1 className="mt-1 font-display text-4xl font-bold">Sign in</h1>
      <p className="mt-3 text-lg">
        Use your Maryville College email. We will send you a 6-digit code.
      </p>

      <div className="mt-8 rounded-lg border border-border bg-surface p-4">
        {configured ? (
          <SignInForm />
        ) : (
          <p role="status" className="text-base">
            Sign-in is not set up on this server yet. Check back soon.
          </p>
        )}
      </div>

      <p className="mt-6 text-sm text-muted">
        Unofficial student project. Points have no value and cannot be cashed in. Only{" "}
        @maryvillecollege.edu and @my.maryvillecollege.edu addresses can sign in.
      </p>
    </div>
  );
}
