"use client";

import { useActionState } from "react";
import { signInAction } from "./actions";
import { INITIAL_SIGN_IN_STATE } from "./state";

const input =
  "block w-full rounded-md border border-border bg-background px-3 py-2 text-base text-foreground placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink";
const primary =
  "inline-flex min-h-11 w-full items-center justify-center rounded-md bg-accent px-4 py-2 font-semibold text-on-accent hover:bg-accent-dark hover:text-on-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink disabled:opacity-60";
const secondary =
  "inline-flex min-h-11 items-center rounded-md px-2 text-sm font-semibold text-brand-ink underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink disabled:opacity-60";

export function SignInForm() {
  const [state, formAction, pending] = useActionState(signInAction, INITIAL_SIGN_IN_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {state.error ? (
        <p
          role="alert"
          className="rounded-md border border-danger px-3 py-2 text-sm font-semibold text-danger"
        >
          {state.error}
        </p>
      ) : null}
      {state.notice ? (
        <p
          role="status"
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground"
        >
          {state.notice}
        </p>
      ) : null}

      {state.step === "email" ? (
        <>
          <div className="flex flex-col gap-1">
            <label htmlFor="email" className="text-sm font-semibold">
              Maryville College email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              required
              defaultValue={state.email}
              placeholder="you@my.maryvillecollege.edu"
              className={input}
            />
          </div>
          <button type="submit" name="intent" value="send" disabled={pending} className={primary}>
            {pending ? "Sending…" : "Send code"}
          </button>
        </>
      ) : (
        <>
          <input type="hidden" name="email" value={state.email} />
          <p className="text-base">
            We sent a 6-digit code to <span className="font-semibold">{state.email}</span>. It can
            take a minute to arrive.
          </p>
          <div className="flex flex-col gap-1">
            <label htmlFor="code" className="text-sm font-semibold">
              6-digit code
            </label>
            <input
              id="code"
              name="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              className={`${input} tabular-nums tracking-widest`}
            />
          </div>
          <button type="submit" name="intent" value="verify" disabled={pending} className={primary}>
            {pending ? "Checking…" : "Verify and sign in"}
          </button>
          <div className="flex flex-wrap gap-x-4">
            <button
              type="submit"
              name="intent"
              value="resend"
              disabled={pending}
              className={secondary}
              formNoValidate
            >
              Send a new code
            </button>
            <button
              type="submit"
              name="intent"
              value="change"
              disabled={pending}
              className={secondary}
              formNoValidate
            >
              Use a different email
            </button>
          </div>
        </>
      )}
    </form>
  );
}
