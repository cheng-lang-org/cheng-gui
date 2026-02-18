import { useState } from 'react';
import { ArrowLeft, Search, Star, Download, Users } from 'lucide-react';

interface App {
    id: string;
    name: string;
    icon: string;
    description: string;
    category: string;
    rating: number;
    downloads: string;
    price: number | 'free';
    isInstalled?: boolean;
}

const mockApps: App[] = [
    {
        id: 'movie',
        name: '一起看电影',
        icon: '🎬',
        description: '群内同步观影，支持弹幕互动',
        category: '娱乐',
        rating: 4.8,
        downloads: '10万+',
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
        downloads: '50万+',
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
        downloads: '30万+',
        price: 'free',
    },
    {
        id: 'vote',
        name: '群投票',
        icon: '📊',
        description: '快速发起投票决策',
        category: '工具',
        rating: 4.6,
        downloads: '100万+',
        price: 'free',
        isInstalled: true,
    },
    {
        id: 'quiz',
        name: '知识竞答',
        icon: '🧠',
        description: '多人答题PK',
        category: '教育',
        rating: 4.5,
        downloads: '20万+',
        price: 10, // 10 RWAD
    },
    {
        id: 'karaoke',
        name: '在线K歌',
        icon: '🎤',
        description: '群内K歌房，共享音乐',
        category: '娱乐',
        rating: 4.4,
        downloads: '15万+',
        price: 'free',
    },
    {
        id: 'chess',
        name: '象棋对弈',
        icon: '♟️',
        description: '经典中国象棋',
        category: '游戏',
        rating: 4.8,
        downloads: '25万+',
        price: 'free',
    },
    {
        id: 'fortune',
        name: '抽签占卜',
        icon: '🔮',
        description: '趣味占卜问答',
        category: '娱乐',
        rating: 4.3,
        downloads: '8万+',
        price: 5, // 5 RWAD
    },
];

const categories = ['全部', '娱乐', '游戏', '工具', '教育'];

interface AppMarketplaceProps {
    onBack: () => void;
}

export default function AppMarketplace({ onBack }: AppMarketplaceProps) {
    const [selectedCategory, setSelectedCategory] = useState('全部');
    const [searchQuery, setSearchQuery] = useState('');
    const [apps] = useState<App[]>(mockApps);

    const filteredApps = apps.filter(app => {
        const matchesCategory = selectedCategory === '全部' || app.category === selectedCategory;
        const matchesSearch = !searchQuery ||
            app.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            app.description.toLowerCase().includes(searchQuery.toLowerCase());
        return matchesCategory && matchesSearch;
    });

    return (
        <div className="h-full flex flex-col bg-gray-50">
            {/* Header */}
            <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3">
                <button onClick={onBack} className="p-1 hover:bg-gray-100 rounded-full">
                    <ArrowLeft size={24} />
                </button>
                <h1 className="text-xl font-semibold flex-1">应用市场</h1>
            </header>

            {/* Search */}
            <div className="bg-white px-4 py-3 border-b border-gray-200">
                <div className="relative">
                    <Search size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="搜索应用..."
                        className="w-full pl-10 pr-4 py-2 bg-gray-100 rounded-full focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                </div>
            </div>

            {/* Categories */}
            <div className="bg-white px-4 py-3 border-b border-gray-200 flex gap-2 overflow-x-auto">
                {categories.map(cat => (
                    <button
                        key={cat}
                        onClick={() => setSelectedCategory(cat)}
                        className={`px-4 py-2 rounded-full text-sm whitespace-nowrap transition-colors ${selectedCategory === cat
                                ? 'bg-purple-500 text-white'
                                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                            }`}
                    >
                        {cat}
                    </button>
                ))}
            </div>

            {/* Apps List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {filteredApps.map(app => (
                    <div
                        key={app.id}
                        className="bg-white rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow"
                    >
                        <div className="flex items-start gap-4">
                            <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center text-3xl flex-shrink-0">
                                {app.icon}
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between mb-1">
                                    <h3 className="font-semibold text-gray-900">{app.name}</h3>
                                    {app.isInstalled && (
                                        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                                            已启用
                                        </span>
                                    )}
                                </div>
                                <p className="text-sm text-gray-600 mb-2 truncate">{app.description}</p>
                                <div className="flex items-center gap-4 text-xs text-gray-500">
                                    <span className="flex items-center gap-1">
                                        <Star size={12} className="text-yellow-500 fill-yellow-500" />
                                        {app.rating}
                                    </span>
                                    <span className="flex items-center gap-1">
                                        <Download size={12} />
                                        {app.downloads}
                                    </span>
                                    <span className="flex items-center gap-1">
                                        <Users size={12} />
                                        {app.category}
                                    </span>
                                </div>
                            </div>
                            <button
                                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex-shrink-0 ${app.isInstalled
                                        ? 'bg-gray-100 text-gray-600'
                                        : app.price === 'free'
                                            ? 'bg-purple-500 text-white hover:bg-purple-600'
                                            : 'bg-orange-500 text-white hover:bg-orange-600'
                                    }`}
                            >
                                {app.isInstalled ? '打开' : app.price === 'free' ? '启用' : `${app.price} RWAD`}
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
