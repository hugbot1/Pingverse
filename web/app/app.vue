<template>
  <NuxtPage />
  <AppDialog />
</template>

<script setup>
const requestEvent = import.meta.server ? useRequestEvent() : null;

useHead({
  htmlAttrs: { lang: 'en' },
  meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1' }],

  script: requestEvent?.context.cspNonce
    ? [{ nonce: requestEvent.context.cspNonce, innerHTML: '' }]
    : [],
  link: [
    { rel: 'icon', type: 'image/x-icon', href: '/assets/logos/favicon.ico' },
  ],
});
</script>