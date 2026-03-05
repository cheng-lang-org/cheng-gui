import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'
import { VitePWA } from 'vite-plugin-pwa'

const isHarmonyRawfileBuild = process.env.UNIMAKER_HARMONY_RAWFILE === '1'
const publicBase = isHarmonyRawfileBuild ? './' : '/'

const pwaPlugin = VitePWA({
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
        start_url: publicBase,
        icons: [
            {
                src: `${publicBase}vite.svg`,
                sizes: '192x192',
                type: 'image/svg+xml',
            },
            {
                src: `${publicBase}vite.svg`,
                sizes: '512x512',
                type: 'image/svg+xml',
            },
        ],
    },
})

export default defineConfig({
    base: publicBase,
    plugins: [
        react(),
        wasm(),
        topLevelAwait(),
        pwaPlugin,
    ],
    build: {
        target: 'es2017',
        modulePreload: isHarmonyRawfileBuild
            ? false
            : {
                polyfill: true,
            },
        cssCodeSplit: !isHarmonyRawfileBuild,
        rollupOptions: {
            output: {
                inlineDynamicImports: isHarmonyRawfileBuild,
                manualChunks: isHarmonyRawfileBuild
                    ? undefined
                    : (id) => {
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
