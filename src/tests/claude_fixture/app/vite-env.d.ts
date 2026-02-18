/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare module '*.csv?raw' {
    const content: string;
    export default content;
}

declare module 'lunar-javascript';

interface Window {
    unimakerDesktop?: {
        isDesktop: boolean;
        platform: string;
        electron: string;
    };
}

interface ImportMetaEnv {
    readonly VITE_LIBP2P_INGRESS_URL?: string;
    readonly [key: `VITE_FF_${string}`]: string | undefined;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
