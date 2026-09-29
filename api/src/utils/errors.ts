export function errorMessage(error: unknown): unknown {
  return error instanceof Error && error.message ? error.message : error;
}