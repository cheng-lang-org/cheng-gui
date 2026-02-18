import React from 'react'
import ReactDOM from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { Capacitor } from '@capacitor/core'
import App from './App'
import './index.css'

function detectNativeRuntime(): boolean {
    const cap = Capacitor as unknown as {
        getPlatform?: () => string
        isPluginAvailable?: (name: string) => boolean
    }
    const platform = typeof cap.getPlatform === 'function' ? cap.getPlatform() : ''
    if (platform && platform !== 'web') {
        return true
    }
    if (typeof cap.isPluginAvailable === 'function' && cap.isPluginAvailable('Libp2pBridge')) {
        return true
    }
    return Capacitor.isNativePlatform()
}

const isNativePlatform = detectNativeRuntime()

async function disableNativeServiceWorkerCaches(): Promise<void> {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
        return
    }
    try {
        const registrations = await navigator.serviceWorker.getRegistrations()
        await Promise.all(registrations.map((registration) => registration.unregister()))
    } catch (error) {
        console.warn('failed to unregister native service workers', error)
    }
    if (typeof caches === 'undefined') {
        return
    }
    try {
        const keys = await caches.keys()
        await Promise.all(keys.map((key) => caches.delete(key)))
    } catch (error) {
        console.warn('failed to clear native service worker caches', error)
    }
}

if (isNativePlatform) {
    void disableNativeServiceWorkerCaches()
} else {
    registerSW({ immediate: true })
}

const isDesktopShell =
    typeof window !== 'undefined'
    && Boolean(window.unimakerDesktop?.isDesktop || navigator.userAgent.includes('Electron'))

if (isDesktopShell) {
    document.body.classList.add('unimaker-desktop')
}

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
)
