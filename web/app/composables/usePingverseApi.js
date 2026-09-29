export function usePingverseApi() {
  const config = useRuntimeConfig();
  const apiUrl = String(config.public.apiUrl).replace(/\/+$/, '');

  async function request(path, options = {}) {
    let response;
    try {
      response = await fetch(`${apiUrl}${path}`, { credentials: 'include', ...options });
    } catch {
      throw new Error('Could not reach the server. Check your connection and try again.');
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  }

  return {
    apiUrl,
    get: (path) => request(path),
    post: (path, body) => request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  };
}