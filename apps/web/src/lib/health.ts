export type DbStatus = "unconfigured" | "ok" | "error";

export interface HealthBody {
  readonly ok: boolean;
  readonly db: DbStatus;
  readonly commit: string;
}

export interface HealthResult {
  readonly status: 200 | 503;
  readonly body: HealthBody;
}

export interface HealthInput {
  /** Resolves when the database answers. `undefined` means no `DATABASE_URL` is configured. */
  readonly dbCheck: (() => Promise<void>) | undefined;
  /** Git commit the server was built from; empty or missing becomes "dev". */
  readonly commit?: string;
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 2_000;

/**
 * Build the body for `GET /api/health`. Pure apart from the injected `dbCheck`.
 * The failure branch deliberately drops the cause: driver errors can echo the connection string.
 */
export async function buildHealth(input: HealthInput): Promise<HealthResult> {
  const commit = input.commit || "dev";
  if (input.dbCheck === undefined) {
    return { status: 200, body: { ok: true, db: "unconfigured", commit } };
  }
  try {
    await withTimeout(input.dbCheck(), input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    return { status: 200, body: { ok: true, db: "ok", commit } };
  } catch {
    return { status: 503, body: { ok: false, db: "error", commit } };
  }
}

async function withTimeout(promise: Promise<void>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("health check timed out")), ms);
  });
  try {
    await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
