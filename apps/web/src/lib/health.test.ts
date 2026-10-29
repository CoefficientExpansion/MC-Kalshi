import { afterEach, describe, expect, it, vi } from "vitest";
import { buildHealth } from "./health";

describe("buildHealth", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports unconfigured with 200 when no database check is available", async () => {
    const result = await buildHealth({ dbCheck: undefined, commit: "abc123" });
    expect(result).toEqual({
      status: 200,
      body: { ok: true, db: "unconfigured", commit: "abc123" },
    });
  });

  it("defaults the commit to 'dev' when none is given or it is empty", async () => {
    expect((await buildHealth({ dbCheck: undefined })).body.commit).toBe("dev");
    expect((await buildHealth({ dbCheck: undefined, commit: "" })).body.commit).toBe("dev");
  });

  it("reports ok with 200 when the database check resolves", async () => {
    const result = await buildHealth({ dbCheck: async () => {}, commit: "abc123" });
    expect(result).toEqual({
      status: 200,
      body: { ok: true, db: "ok", commit: "abc123" },
    });
  });

  it("reports error with 503 and leaks nothing when the database check rejects", async () => {
    const secret = "postgres://user:hunter2@db.example.com:5432/app";
    const result = await buildHealth({
      dbCheck: async () => {
        throw new Error(`connection refused for ${secret}`);
      },
      commit: "abc123",
    });
    expect(result.status).toBe(503);
    expect(result.body).toEqual({ ok: false, db: "error", commit: "abc123" });
    const serialized = JSON.stringify(result.body);
    expect(serialized).not.toContain("hunter2");
    expect(serialized).not.toContain("connection refused");
  });

  it("treats a database check that hangs past the timeout as an error", async () => {
    const result = await buildHealth({
      dbCheck: () => new Promise<void>(() => {}),
      commit: "abc123",
      timeoutMs: 20,
    });
    expect(result.status).toBe(503);
    expect(result.body.db).toBe("error");
  });

  it("times out after 2 s by default", async () => {
    vi.useFakeTimers();
    let settled = false;
    const pending = buildHealth({ dbCheck: () => new Promise<void>(() => {}) }).then((r) => {
      settled = true;
      return r;
    });
    await vi.advanceTimersByTimeAsync(1_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;
    expect(settled).toBe(true);
    expect(result.status).toBe(503);
  });

  it("clears its timeout timer once the check settles", async () => {
    vi.useFakeTimers();
    await buildHealth({ dbCheck: async () => {} });
    expect(vi.getTimerCount()).toBe(0);
    await buildHealth({
      dbCheck: async () => {
        throw new Error("nope");
      },
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not surface an unhandled rejection when the check fails after the timeout", async () => {
    vi.useFakeTimers();
    const late = buildHealth({
      dbCheck: () =>
        new Promise<void>((_, reject) => {
          setTimeout(() => reject(new Error("late failure")), 30);
        }),
      timeoutMs: 5,
    });
    await vi.advanceTimersByTimeAsync(5);
    const result = await late;
    expect(result.status).toBe(503);
    // Advancing past the late rejection must not raise; Vitest fails the run on an unhandled rejection.
    await vi.advanceTimersByTimeAsync(100);
  });
});
