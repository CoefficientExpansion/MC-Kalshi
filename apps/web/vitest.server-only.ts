// Stands in for the `server-only` package under Vitest (see vitest.config.mts). The real package
// throws when imported outside a React Server Components build; tests import server modules
// directly, so it resolves to this empty module instead.
export {};
