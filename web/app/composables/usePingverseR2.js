export function usePingverseR2() {
  const config = useRuntimeConfig();
  const r2Url = String(config.public.r2Url).replace(/\/+$/, '');

  async function request(path, options = {}) {
    let response;
    try {
      response = await fetch(`${r2Url}${path}`, { credentials: 'include', ...options });
    } catch {
      throw new Error('Could not reach the server. Check your connection and try again.');
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  }

  return {
    r2Url,
    get: (path) => request(path),
    post: (path, body) => request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  };
}