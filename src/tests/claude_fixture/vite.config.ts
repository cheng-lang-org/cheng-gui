import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
    plugins: [
        react(),
        wasm(),
        topLevelAwait(),
        VitePWA({
            registerType: 'autoUpdate',
            includeAssets: ['vite.svg'],
            workbox: {
                maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
                globIgnores: [
                    '**/edge-models/mediapipe/selfie_segmentation/*.wasm',
                    '**/edge-models/mediapipe/selfie_segmentation/*.js',
                    '**/edge-models/mediapipe/selfie_segmentation/*.tflite',
                    '**/edge-models/mediapipe/selfie_segmentation/*.binarypb',
                ],
            },
            manifest: {
                name: 'UniMaker',
                short_name: 'UniMaker',
                description: 'UniMaker 专业八字与紫微排盘',
                theme_color: '#1d4ed8',
                background_color: '#ffffff',
                display: 'standalone',
                start_url: '/',
                icons: [
                    {
                        src: '/vite.svg',
                        sizes: '192x192',
                        type: 'image/svg+xml',
                    },
                    {
                        src: '/vite.svg',
                        sizes: '512x512',
                        type: 'image/svg+xml',
                    },
                ],
            },
        }),
    ],
    build: {
        rollupOptions: {
            output: {
                manualChunks(id) {
                    if (id.includes('/app/components/BaziPage.tsx')
                        || id.includes('/app/components/ZiweiPage.tsx')
                        || id.includes('/app/utils/bazi.ts')
                        || id.includes('/app/utils/ziwei.ts')
                        || id.includes('/app/domain/astrology/')) {
                        return 'astrology';
                    }
                    return undefined;
                },
            },
        },
        chunkSizeWarningLimit: 3500,
    },
})
