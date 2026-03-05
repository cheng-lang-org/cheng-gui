
export interface App {
    id: string;
    name: string;
    icon: string;
    description: string;
    category: string;
    rating: number;
    price: number | 'free';
    sellerId?: string;
    wechatQr?: string;
    alipayQr?: string;
    creditCardEnabled?: boolean;
    walletAddress?: string;
    isInstalled?: boolean;
}

function mockQr(data: string): string {
    return `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(data)}`;
}

export const mockApps: App[] = [
    {
        id: 'bazi',
        name: '八字排盘',
        icon: '☯',
        description: '专业四柱八字排盘，含大运流年',
        category: '命理',
        rating: 4.9,
        price: 'free',
        isInstalled: true,
    },
    {
        id: 'ziwei',
        name: '紫微斗数',
        icon: '✦',
        description: '紫微斗数命盘，十二宫主星布局',
        category: '命理',
        rating: 4.9,
        price: 'free',
        isInstalled: true,
    },

    {
        id: 'doudizhu',
        name: '斗地主',
        icon: '🃏',
        description: '经典三人斗地主，欢乐对战',
        category: '游戏',
        rating: 4.9,
        price: 'free',
        isInstalled: true,
    },
    {
        id: 'mahjong',
        name: '四人麻将',
        icon: '🀄',
        description: '经典国粹，好友对战',
        category: '游戏',
        rating: 4.9,
        price: 'free',
        isInstalled: true,
    },
    {
        id: 'werewolf',
        name: '狼人杀',
        icon: '🐺',
        description: '多人桌游，考验智慧',
        category: '游戏',
        rating: 4.7,
        price: 'free',
    },
    {
        id: 'chess',
        name: '中国象棋',
        icon: '🀄',
        description: '经典中国象棋，人机对弈',
        category: '游戏',
        rating: 4.8,
        price: 'free',
        isInstalled: true,
    },

    {
        id: 'minecraft',
        name: '我的世界',
        icon: '⛏️',
        description: '3D方块构建世界，自由创造',
        category: '游戏',
        rating: 4.8,
        price: 'free',
        isInstalled: true,
    },
];
