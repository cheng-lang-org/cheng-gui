import { registerPlugin } from '@capacitor/core';
import type { Libp2pBridgePlugin } from './definitions';

export const Libp2pBridge = registerPlugin<Libp2pBridgePlugin>('Libp2pBridge');

export * from './definitions';
