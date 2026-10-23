export default defineNuxtConfig({
  compatibilityDate: '2026-09-28',
  css: [
    '~/assets/css/base.css',
    '~/assets/css/auth.css',
    '~/assets/css/chat.css',
    '~/assets/css/admin.css',
  ],
  devServer: {
    host: '0.0.0.0',
    port: Number(process.env.PORT) || 3000,
  },
  runtimeConfig: {
    public: {
      apiUrl: process.env.NUXT_PUBLIC_API_URL || process.env.API_URL || 'http://localhost:4000',
      r2Url: process.env.NUXT_PUBLIC_R2_URL || process.env.R2_URL || '/error.html?msg=Could not find the R2 URL',
      wikiraceUrl: process.env.NUXT_PUBLIC_WIKIRACE_URL || process.env.WIKIRACE_URL || '/error.html?msg=Could not find the WIKIRACE URL',
    },
  },
});