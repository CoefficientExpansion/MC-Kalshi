import Link from "next/link";
import { getCurrentUser } from "@/server/auth";

// Sits in the garnet header (white-on-garnet text, orange focus ring). A server component: it reads
// the session on the server, so no auth state is shipped to the browser. Signed out, unconfigured,
// suspended and "lookup failed" all render the same "Sign in" link; the sign-in page explains when
// sign-in is not set up.

const focus = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

export async function AccountControl() {
  const member = await getCurrentUser();

  if (!member) {
    return (
      <Link
        href="/sign-in"
        className={`inline-flex min-h-11 items-center rounded-md bg-accent px-4 font-semibold text-on-accent hover:bg-accent-dark hover:text-on-brand ${focus}`}
      >
        Sign in
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <p className="text-sm leading-tight">
        <span className="block max-w-40 truncate font-semibold" title={member.displayName}>
          {member.displayName}
        </span>
        <span className="block tabular-nums">{member.points.toLocaleString("en-US")} pts</span>
      </p>
      <form action="/auth/sign-out" method="post">
        <button
          type="submit"
          className={`inline-flex min-h-11 items-center rounded-md border border-on-brand px-3 text-sm font-semibold hover:bg-brand-dark ${focus}`}
        >
          Sign out
        </button>
      </form>
    </div>
  );
}
