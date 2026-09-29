/** Message of an unknown caught value, or the value itself if it isn't an Error. */
export function errorMessage(error: unknown): unknown {
  return error instanceof Error && error.message ? error.message : error;
}
