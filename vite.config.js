
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),

    VitePWA({
      registerType: 'autoUpdate',

      includeAssets: [
        'favicon.svg',
        'apple-touch-icon.png'
      ],

      manifest: {
        name: 'RainMap Chennai',
        short_name: 'RainMap',
        description: 'Monitor rainfall, explore rain-aware routes and receive weather updates in Chennai.',

        theme_color: '#8b5cf6',
        background_color: '#f7f6f8',

        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',

        icons: [
          {
            src: '/pwa-192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: '/pwa-512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      }
    })
  ]
})
