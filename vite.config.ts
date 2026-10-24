import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import { VitePWA } from 'vite-plugin-pwa'

function agentDevPlugin(): Plugin {
  return {
    name: 'agent-dev-proxy',
    configureServer(server) {
      server.middlewares.use('/api/agent', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end(JSON.stringify({ error: 'method_not_allowed' }))
          return
        }
        let body = ''
        req.on('data', (chunk) => { body += chunk })
        req.on('end', async () => {
          try {
            const env = loadEnv('development', process.cwd(), '')
            if (env.MINIMAX_APIKEY) process.env.MINIMAX_APIKEY = env.MINIMAX_APIKEY
            const { handler } = await server.ssrLoadModule('/netlify/functions/agent.ts')
            const result = await handler({
              httpMethod: req.method ?? 'POST',
              body,
              headers: req.headers as Record<string, string | undefined>,
            })
            res.statusCode = result.statusCode
            if (result.headers) {
              for (const [k, v] of Object.entries(result.headers)) {
                res.setHeader(k, v)
              }
            }
            res.end(result.body)
          } catch (err) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }))
          }
        })
      })
    },
  }
}

export default defineConfig({
  plugins: [
    react(),
    agentDevPlugin(),
    nodePolyfills(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'OpenCircle',
        short_name: 'OpenCircle',
        description: 'Open-source USDC wallet — Send, Receive, Swap, Bridge',
        theme_color: '#122d45',
        background_color: '#f9f9fc',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        id: '/',
        icons: [
          {
            src: '/icons/icon-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
        categories: ['finance', 'utilities'],
        screenshots: [
          {
            src: '/icons/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            // @ts-expect-error — form_factor is valid PWA manifest but not yet in vite-plugin-pwa types
            form_factor: 'narrow',
          },
        ],
      },
      workbox: {
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5 MB — large bundle from Circle SDK
        // Cache app shell + fonts; skip large crypto chunks (they must be fresh)
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // The Circle client key is inlined into the JS bundle, so a stale
        // precached shell means a stale credential and a guaranteed 401.
        // Serve navigations network-first: offline still works from cache,
        // but an online visitor always gets the current build.
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: ({ request }: { request: Request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'opencircle-app-shell',
              networkTimeoutSeconds: 3,
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'gstatic-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false }, // keep dev server fast
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'react/jsx-runtime',
      '@tanstack/react-query',
      'wagmi',
      'wagmi/chains',
      'wagmi/connectors',
      'viem',
      'viem/chains',
      'connectkit',
      'framer-motion',
      'lucide-react',
      'sonner',
      'clsx',
      'tailwind-merge',
      'vite-plugin-node-polyfills/shims/buffer',
      'vite-plugin-node-polyfills/shims/global',
      'vite-plugin-node-polyfills/shims/process',
    ],
  },
  server: {
    allowedHosts: true,
    cors: true,
    // MED-01: Security headers for the dev server
    // In production, set these at your CDN / reverse-proxy layer.
    headers: {
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'payment=(self), usb=(), camera=()',
    },
  },
})
