export function usePingverseWIKIRACE() {
  const config = useRuntimeConfig();
  const wikiraceUrl = String(config.public.wikiraceUrl).replace(/\/+$/, '');

  async function request(path, options = {}) {
    let response;
    try {
      response = await fetch(`${wikiraceUrl}${path}`, { credentials: 'include', ...options });
    } catch {
      throw new Error('Could not reach the server. Check your connection and try again.');
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  }

  return {
    wikiraceUrl,
    get: (path) => request(path),
    post: (path, body) => request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  };
}