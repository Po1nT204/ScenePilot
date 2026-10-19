// Next may reconstruct request.url with localhost while the browser used 127.0.0.1.
// Compare the browser origin to the actual Host; never trust forwarded headers here.
export function validUploadOrigin(request: Request) {
  try {
    const value = request.headers.get('origin'), host = request.headers.get('host');
    if (!value || !host) return false;
    const origin = new URL(value);
    if (origin.origin !== value || origin.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)) return false;
    const target = new URL(`http://${host}`);
    return target.origin === origin.origin && target.host === host.toLowerCase() && !target.username && !target.password;
  } catch { return false; }
}
