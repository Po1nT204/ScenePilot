// Only idempotent Supabase reads can retry. Writes, RPCs and token refresh never do.
function readKind(input: RequestInfo | URL, init?: RequestInit): 'auth' | 'database' | null {
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  if (method !== 'GET') return null;
  const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
  if (path === '/auth/v1/user') return 'auth';
  return /^\/rest\/v1\/[a-zA-Z_][a-zA-Z0-9_]*$/.test(path) && path !== '/rest/v1/rpc' ? 'database' : null;
}
function failureKind(error: unknown) {
  if (error instanceof Error && error.name === 'TimeoutError') return 'timeout';
  if (error instanceof TypeError) return 'network';
  return 'other';
}
export function supabaseTransport(transport: typeof fetch = fetch, timeoutMs = 15000): typeof fetch {
  return async (input, init) => {
    const caller = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const kind = readKind(input, init);
    // Two read attempts share the original time budget, instead of doubling it.
    const total = AbortSignal.timeout(timeoutMs);
    const attempts = kind ? 2 : 1;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      caller?.throwIfAborted();
      total.throwIfAborted();
      const deadline = AbortSignal.timeout(kind ? Math.max(1, Math.floor(timeoutMs / 2)) : timeoutMs);
      const signal = AbortSignal.any([total, deadline, ...(caller ? [caller] : [])]);
      try {
        const response = await transport(input, { ...init, cache: 'no-store', signal });
        if (kind && [408, 502, 503, 504].includes(response.status)) {
          // No URL, query, cookie, token, user ID or response body in diagnostics.
          console.warn(`[supabase] ${kind} read HTTP ${response.status}; attempt ${attempt}/${attempts}`);
          if (attempt < attempts && !caller?.aborted && !total.aborted) {
            await response.body?.cancel();
            continue;
          }
        }
        return response;
      } catch (error) {
        const reason = failureKind(error);
        if (kind && !caller?.aborted) console.warn(`[supabase] ${kind} read ${reason}; attempt ${attempt}/${attempts}`);
        if (!kind || attempt === attempts || caller?.aborted || total.aborted || !['network', 'timeout'].includes(reason)) throw error;
      }
    }
    throw new Error('Supabase request exhausted');
  };
}
