import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
    appId: 'com.unimaker.app',
    appName: 'UniMaker',
    webDir: 'dist',
    server: {
        androidScheme: 'https',
    },
    android: {
        buildOptions: {
            keystorePath: undefined,
            keystoreAlias: undefined,
        },
    },
    ios: {
        contentInset: 'never',
    },
};

export default config;
