import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Member } from "@/server/profiles";

const getCurrentUser = vi.fn<() => Promise<Member | null>>();
vi.mock("@/server/auth", () => ({ getCurrentUser: () => getCurrentUser() }));

import { AccountControl } from "./account-control";

const render = async () => renderToStaticMarkup(await AccountControl());

describe("AccountControl", () => {
  beforeEach(() => getCurrentUser.mockReset());

  it("offers a sign-in link when signed out (or when sign-in is not configured)", async () => {
    getCurrentUser.mockResolvedValue(null);
    const html = await render();
    expect(html).toMatch(/href="\/sign-in"/);
    expect(html).toMatch(/Sign in/);
    expect(html).not.toMatch(/Sign out/);
    expect(html).not.toMatch(/Portfolio/);
  });

  it("shows the display name, points and a sign-out form when signed in", async () => {
    getCurrentUser.mockResolvedValue({
      id: "00000000-0000-4000-8000-000000000001",
      email: "jane@my.maryvillecollege.edu",
      displayName: "jane",
      role: "member",
      points: 10_000,
    });
    const html = await render();
    expect(html).toMatch(/jane/);
    expect(html).toMatch(/10,000 pts/);
    expect(html).toMatch(/<form action="\/auth\/sign-out" method="post"/);
    expect(html).toMatch(/Sign out/);
    expect(html).toMatch(/<a[^>]*href="\/portfolio"[^>]*>Portfolio<\/a>/);
    // The email is not shown in the header (SOP-09).
    expect(html).not.toMatch(/maryvillecollege\.edu/);
    expect(html.replace(/<[^>]+>/g, " ")).not.toMatch(/\bbets?\b|\$|cash[\s-]?out/i);
  });

  it("escapes a hostile display name", async () => {
    getCurrentUser.mockResolvedValue({
      id: "00000000-0000-4000-8000-000000000001",
      email: "x@maryvillecollege.edu",
      displayName: '<img src=x onerror="alert(1)">',
      role: "member",
      points: 0,
    });
    const html = await render();
    expect(html).not.toMatch(/<img/);
    expect(html).toMatch(/0 pts/);
  });
});
