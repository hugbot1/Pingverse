export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('render:html:chunk', (context, { event }) => {
    const nonce = event.context.cspNonce;
    if (!nonce) return;
    const htmlChunk = new TextDecoder().decode(context.chunk).replace(
      /<script(?![^>]*\bnonce=)/gi,
      `<script nonce="${nonce}"`,
    );
    context.chunk = new TextEncoder().encode(htmlChunk);
  });

  nitroApp.hooks.hook('render:html', (html, { event }) => {
    const nonce = event.context.cspNonce;
    if (!nonce) return;

    // Nuxt emits some inline bootstrap scripts from the renderer itself,
    // outside of Unhead. Attach this request's nonce before sending HTML.
    for (const key of ['head', 'bodyPrepend', 'body', 'bodyAppend']) {
      const chunks = html[key];
      if (!chunks) continue;
      html[key] = chunks.map((chunk) =>
        chunk.replace(/<script(?![^>]*\bnonce=)/gi, `<script nonce="${nonce}"`),
      );
    }
  });
});
