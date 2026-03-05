import React from 'react'
import ReactDOM from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { Capacitor } from '@capacitor/core'
import App from './App'
import './index.css'

function detectNativeRuntime(): boolean {
    const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
    const isHarmonyRawfileBuild = (env?.BASE_URL ?? '').trim() === './'
    const cap = Capacitor as unknown as {
        getPlatform?: () => string
        isPluginAvailable?: (name: string) => boolean
    }
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent.toLowerCase() : ''
    const marker = [
        ua,
        typeof navigator !== 'undefined' ? navigator.platform.toLowerCase() : '',
        typeof navigator !== 'undefined' ? navigator.vendor.toLowerCase() : '',
    ].join(' ')
    const isHarmonyLike =
        isHarmonyRawfileBuild
        || marker.includes('openharmony')
        || marker.includes('harmonyos')
        || marker.includes('harmony')
        || marker.includes('hmos')
        || marker.includes('ohos')
        || marker.includes('hongmeng')
        || marker.includes('zhuoyi')
        || marker.includes('zyt')
        || marker.includes('huawei_family')
    if (isHarmonyLike) {
        ;(window as Window & { __UNIMAKER_WEB_BRIDGE_FALLBACK__?: boolean }).__UNIMAKER_WEB_BRIDGE_FALLBACK__ = true
        return true
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
const BOOT_TIMEOUT_MS = 12000

declare global {
    interface Window {
        __unimakerBooted?: boolean
        __UNIMAKER_WEB_BRIDGE_FALLBACK__?: boolean
    }
}

function setBootFallbackText(text: string): void {
    const bootFallback = document.getElementById('unimaker-boot-fallback')
    if (bootFallback) {
        bootFallback.textContent = text
    }
}

function showFatalBootScreen(message: string, detail?: string): void {
    const root = document.getElementById('root')
    if (!root) {
        return
    }
    const detailText = (detail ?? '').trim()
    const safeMessage = message.replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const safeDetail = detailText.replace(/</g, '&lt;').replace(/>/g, '&gt;')
    root.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;background:#f8fafc;padding:16px;box-sizing:border-box;">
        <div style="width:100%;max-width:420px;border:1px solid #fecaca;background:#fff1f2;border-radius:14px;padding:16px;color:#7f1d1d;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
          <div style="font-weight:700;font-size:16px;">Unimaker 启动失败</div>
          <div style="margin-top:8px;font-size:14px;line-height:1.45;">${safeMessage}</div>
          ${safeDetail ? `<div style="margin-top:10px;font-size:12px;line-height:1.45;opacity:.85;word-break:break-all;">${safeDetail}</div>` : ''}
          <div style="margin-top:14px;display:flex;gap:8px;">
            <button id="unimaker-retry-btn" style="border:0;background:#2563eb;color:#fff;border-radius:10px;padding:8px 12px;font-size:13px;">重试启动</button>
          </div>
        </div>
      </div>`
    const retryButton = document.getElementById('unimaker-retry-btn')
    retryButton?.addEventListener('click', () => {
        window.location.reload()
    })
}

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

class AppErrorBoundary extends React.Component<
    { children: React.ReactNode },
    { errorMessage: string | null; errorStack: string | null }
> {
    constructor(props: { children: React.ReactNode }) {
        super(props)
        this.state = { errorMessage: null, errorStack: null }
    }

    static getDerivedStateFromError(error: unknown): { errorMessage: string; errorStack: string | null } {
        if (error instanceof Error) {
            return { errorMessage: error.message || 'unknown_error', errorStack: error.stack ?? null }
        }
        return { errorMessage: String(error ?? 'unknown_error'), errorStack: null }
    }

    componentDidCatch(error: unknown): void {
        const message = error instanceof Error ? error.message : String(error ?? 'unknown_error')
        const stack = error instanceof Error ? error.stack : ''
        showFatalBootScreen(message, stack ?? '')
    }

    render(): React.ReactNode {
        if (this.state.errorMessage) {
            return null
        }
        return this.props.children
    }
}

function installBootDiagnostics(): void {
    window.addEventListener('error', (event) => {
        const message = event.message || 'window_error'
        const detail = event.error instanceof Error ? (event.error.stack ?? '') : ''
        console.error('unimaker_window_error', message, detail)
    })
    window.addEventListener('unhandledrejection', (event) => {
        const reason = event.reason instanceof Error ? event.reason.message : String(event.reason ?? 'unknown_rejection')
        const detail = event.reason instanceof Error ? (event.reason.stack ?? '') : ''
        console.error('unimaker_unhandled_rejection', reason, detail)
    })
}

function removeBootFallback(): void {
    const bootFallback = document.getElementById('unimaker-boot-fallback')
    bootFallback?.remove()
}

async function bootstrap(): Promise<void> {
    installBootDiagnostics()
    window.__unimakerBooted = false
    setBootFallbackText('Unimaker 启动中...')

    if (isNativePlatform) {
        await disableNativeServiceWorkerCaches()
    } else {
        registerSW({ immediate: true })
    }

    const isDesktopShell =
        typeof window !== 'undefined'
        && Boolean(window.unimakerDesktop?.isDesktop || navigator.userAgent.includes('Electron'))

    if (isDesktopShell) {
        document.body.classList.add('unimaker-desktop')
    }

    const rootEl = document.getElementById('root')
    if (!rootEl) {
        throw new Error('root_element_missing')
    }
    ReactDOM.createRoot(rootEl).render(
        <React.StrictMode>
            <AppErrorBoundary>
                <App />
            </AppErrorBoundary>
        </React.StrictMode>,
    )

    window.addEventListener('unimaker-app-mounted', () => {
        window.__unimakerBooted = true
        removeBootFallback()
    }, { once: true })

    const bootObserver = new MutationObserver(() => {
        if (window.__unimakerBooted) {
            return
        }
        if (rootEl.childElementCount > 0) {
            window.__unimakerBooted = true
            removeBootFallback()
            bootObserver.disconnect()
        }
    })
    bootObserver.observe(rootEl, { childList: true })

    window.setTimeout(() => {
        if (window.__unimakerBooted) {
            bootObserver.disconnect()
            return
        }
        bootObserver.disconnect()
        showFatalBootScreen('应用启动超时，请重试。')
    }, BOOT_TIMEOUT_MS)
}

void bootstrap().catch((error) => {
    const message = error instanceof Error ? error.message : String(error ?? 'bootstrap_failed')
    const detail = error instanceof Error ? (error.stack ?? '') : ''
    console.error('unimaker_bootstrap_failed', message, detail)
    showFatalBootScreen(message, detail)
})
