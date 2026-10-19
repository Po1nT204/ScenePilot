// Bound each HTTP request, preserve caller cancellation, and avoid Next's fetch cache.
// No retries: especially important for writes with an uncertain network outcome.
export function supabaseTransport(transport: typeof fetch = fetch, timeoutMs = 15000): typeof fetch {
  return (input, init) => {
    const caller = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const timeout = AbortSignal.timeout(timeoutMs);
    return transport(input, { ...init, cache: 'no-store', signal: caller ? AbortSignal.any([caller, timeout]) : timeout });
  };
}
