"use client";

import { useActionState } from "react";
import { passwordAction } from "./actions";
import { INITIAL_PASSWORD_FORM_STATE } from "./state";

// Open mode only (SIGN_IN_MODE=open, ADR-0007): one form, two submit buttons. Same styles as the
// code form (`sign-in-form.tsx`); theme tokens only.

const input =
  "block w-full rounded-md border border-border bg-background px-3 py-2 text-base text-foreground placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink";
const primary =
  "inline-flex min-h-11 w-full items-center justify-center rounded-md bg-accent px-4 py-2 font-semibold text-on-accent hover:bg-accent-dark hover:text-on-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink disabled:opacity-60";
const secondary =
  "inline-flex min-h-11 w-full items-center justify-center rounded-md border border-border bg-background px-4 py-2 font-semibold text-brand-ink hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink disabled:opacity-60";

export function PasswordForm() {
  const [state, formAction, pending] = useActionState(passwordAction, INITIAL_PASSWORD_FORM_STATE);

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

      <div className="flex flex-col gap-1">
        <label htmlFor="email" className="text-sm font-semibold">
          Email
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
          placeholder="you@example.com"
          className={input}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="password" className="text-sm font-semibold">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          minLength={10}
          maxLength={72}
          required
          aria-describedby="password-hint"
          className={input}
        />
        <p id="password-hint" className="text-sm text-muted">
          10 to 72 characters.
        </p>
      </div>

      <button type="submit" name="intent" value="sign-in" disabled={pending} className={primary}>
        Sign in
      </button>
      <button type="submit" name="intent" value="sign-up" disabled={pending} className={secondary}>
        Create account
      </button>
    </form>
  );
}
