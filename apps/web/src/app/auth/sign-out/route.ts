import { type NextRequest, NextResponse } from "next/server";
import { signOutCurrent } from "@/server/auth";

// POST only. A cross-site form must not be able to sign a member out, so the Origin header (sent
// by browsers on form posts) has to match this site's host.
export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (origin !== null) {
    let originHost: string | undefined;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = undefined;
    }
    if (originHost !== host) {
      return new NextResponse("Forbidden", { status: 403 });
    }
  }
  await signOutCurrent();
  // 303 turns the POST into a GET of the home page.
  return NextResponse.redirect(new URL("/", request.url), 303);
}
