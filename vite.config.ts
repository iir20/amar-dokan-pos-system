
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Removed includeAssets for non-existent files to prevent 404s in production build
      // includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'mask-icon.svg'],
      
      // TERMUX FIX: Disable internal SW minification. 
      minify: false, 
      manifest: {
        name: 'Amar Dokan POS',
        short_name: 'Amar Dokan',
        description: 'Offline-first POS system for Bangladeshi businesses',
        theme_color: '#10b981',
        background_color: '#f8fafc',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        lang: 'bn-BD',
        icons: [
          {
            src: 'https://cdn-icons-png.flaticon.com/512/9425/9425785.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'https://cdn-icons-png.flaticon.com/512/9425/9425785.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: 'https://cdn-icons-png.flaticon.com/512/9425/9425785.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ],
        categories: ["business", "finance", "productivity"],
        shortcuts: [
          {
            name: "Sell",
            short_name: "POS",
            description: "Open Point of Sale",
            url: "/",
            icons: [{ "src": "https://cdn-icons-png.flaticon.com/512/9425/9425785.png", "sizes": "192x192" }]
          }
        ],
        screenshots: [
           {
              "src": "https://images.unsplash.com/photo-1556742049-0cfed4f7a07d?auto=format&fit=crop&w=1080&q=80",
              "sizes": "1080x1920",
              "type": "image/jpg",
              "form_factor": "wide",
              "label": "Dashboard View"
           },
           {
              "src": "https://images.unsplash.com/photo-1556742049-0cfed4f7a07d?auto=format&fit=crop&w=600&q=80",
              "sizes": "600x1066",
              "type": "image/jpg",
              "label": "Mobile POS View"
           }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // TERMUX FIX: Increase file size limit
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
        // TERMUX FIX: Do not cache sourcemaps
        globIgnores: ['**/*.map', '**/node_modules/**'],
        
        // PRODUCTION FIX: Runtime Caching for External CDNs
        // This ensures icons and images work even when offline
        runtimeCaching: [
            {
                urlPattern: /^https:\/\/cdn-icons-png\.flaticon\.com\/.*/i,
                handler: 'CacheFirst',
                options: {
                    cacheName: 'flaticon-images',
                    expiration: {
                        maxEntries: 50,
                        maxAgeSeconds: 60 * 60 * 24 * 30 // 30 Days
                    },
                    cacheableResponse: {
                        statuses: [0, 200]
                    }
                }
            },
            {
                urlPattern: /^https:\/\/images\.unsplash\.com\/.*/i,
                handler: 'CacheFirst',
                options: {
                    cacheName: 'unsplash-images',
                    expiration: {
                        maxEntries: 50,
                        maxAgeSeconds: 60 * 60 * 24 * 30 
                    },
                    cacheableResponse: {
                        statuses: [0, 200]
                    }
                }
            },
            {
                urlPattern: /^https:\/\/picsum\.photos\/.*/i,
                handler: 'CacheFirst',
                options: {
                    cacheName: 'picsum-images',
                    expiration: {
                        maxEntries: 50,
                        maxAgeSeconds: 60 * 60 * 24 * 7 
                    },
                    cacheableResponse: {
                        statuses: [0, 200]
                    }
                }
            }
        ]
      }
    })
  ],
  base: '/', 
  server: {
    host: '0.0.0.0',
    port: 5000,
    strictPort: true,
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 5000,
    strictPort: true,
    allowedHosts: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: false, 
    // TERMUX FIX: Use 'esbuild'
    minify: 'esbuild',
    cssMinify: 'esbuild',
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
        output: {
            manualChunks: {
                'react-vendor': ['react', 'react-dom'],
                'charts': ['recharts'],
                'pdf': ['jspdf', 'html2canvas'],
                'ui': ['lucide-react']
            }
        }
    }
  }
});
