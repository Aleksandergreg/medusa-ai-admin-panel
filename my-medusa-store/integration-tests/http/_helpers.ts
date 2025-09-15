export function shouldRunPgIntegration(): boolean {
  // Enable when running in CI with Postgres service or explicitly via env
  if (process.env.RUN_PG_TESTS === "1") return true;
  if (process.env.CI === "true") return true;
  // Heuristic: if a Postgres host is provided
  if (process.env.DB_HOST || process.env.POSTGRES_HOST) return true;
  return false;
}

