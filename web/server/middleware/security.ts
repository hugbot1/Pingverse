export default defineEventHandler((event) => {
  const config = useRuntimeConfig(event);
  const apiUrl = String(config.public.apiUrl).replace(/\/+$/, '');
  const websocketUrl = apiUrl.replace(/^http/, 'ws');
  // Nuxt's SSR bootstrap is inline. Give this response a one-time nonce so
  // the browser can run that bootstrap without allowing arbitrary inline JS.
  const nonce = crypto.randomUUID();
  event.context.cspNonce = nonce;
  const directives = [
    "default-src 'self'",
    ...(import.meta.dev ? [] : [`script-src 'self' 'nonce-${nonce}'`]),
    "style-src 'self'",
    "font-src 'self'",
    `img-src 'self' data: ${apiUrl}`,
    `media-src 'self' ${apiUrl}`,
    `connect-src 'self' ${apiUrl} ${websocketUrl}${process.env.NODE_ENV === 'production' ? '' : ' ws:'}`,
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ];
  setHeaders(event, {
    ...(!import.meta.dev ? { 'Content-Security-Policy': directives.join('; ') } : {}),
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  });
});
