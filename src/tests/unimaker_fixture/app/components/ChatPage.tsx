import { useState } from 'react';
import {
    ArrowLeft,
    Mic,
    Smile,
    Plus,
    Send,
    Gift,
    MapPin,
    Video,
    UserPlus,
    Gamepad2,
    X
} from 'lucide-react';
import { ImageWithFallback } from './figma/ImageWithFallback';

interface ChatMessage {
    id: string;
    sender: 'me' | 'other';
    content: string;
    type: 'text' | 'redPacket' | 'location' | 'voice' | 'videoCall';
    timestamp: number;
    avatar?: string;
    name?: string;
    extra?: {
        redPacketAmount?: number;
        redPacketMessage?: string;
        locationName?: string;
        voiceDuration?: number;
    };
}

interface ChatPageProps {
    chatId: string;
    chatName: string;
    chatAvatar: string;
    isGroup?: boolean;
    onBack: () => void;
}

const mockMessages: ChatMessage[] = [
    {
        id: '1',
        sender: 'other',
        content: '你好，想和你交流一下关于libp2p的技术问题',
        type: 'text',
        timestamp: Date.now() - 1000 * 60 * 30,
        name: '科技探索者',
    },
    {
        id: '2',
        sender: 'me',
        content: '好的，请说',
        type: 'text',
        timestamp: Date.now() - 1000 * 60 * 25,
    },
    {
        id: '3',
        sender: 'other',
        content: 'libp2p的DHT是如何实现的？',
        type: 'text',
        timestamp: Date.now() - 1000 * 60 * 20,
        name: '科技探索者',
    },
];

// 群内已启用的应用
const enabledGroupApps = [
    { id: 'movie', name: '一起看电影', icon: '🎬' },
    { id: 'mahjong', name: '四人麻将', icon: '🀄' },
    { id: 'vote', name: '群投票', icon: '📊' },
];

export default function ChatPage({ chatId, chatName, chatAvatar, isGroup = false, onBack }: ChatPageProps) {
    const [messages] = useState<ChatMessage[]>(mockMessages);
    const [inputText, setInputText] = useState('');
    const [showMorePanel, setShowMorePanel] = useState(false);
    const [showRedPacketModal, setShowRedPacketModal] = useState(false);
    const [showLocationModal, setShowLocationModal] = useState(false);
    const [showGroupApps, setShowGroupApps] = useState(false);

    const formatTime = (timestamp: number) => {
        const date = new Date(timestamp);
        return `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
    };

    const handleSend = () => {
        if (!inputText.trim()) return;
        // TODO: Add message to list
        setInputText('');
    };

    return (
        <div className="h-full flex flex-col bg-gray-100">
            {/* Header */}
            <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3">
                <button onClick={onBack} className="p-1 hover:bg-gray-100 rounded-full">
                    <ArrowLeft size={24} />
                </button>
                <ImageWithFallback
                    src={chatAvatar}
                    alt={chatName}
                    className="w-10 h-10 rounded-full object-cover"
                />
                <div className="flex-1">
                    <h1 className="font-semibold">{chatName}</h1>
                    {isGroup && <span className="text-xs text-gray-500">群聊 · 5人</span>}
                </div>
            </header>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.map((msg) => (
                    <div
                        key={msg.id}
                        className={`flex gap-2 ${msg.sender === 'me' ? 'flex-row-reverse' : ''}`}
                    >
                        <ImageWithFallback
                            src={msg.sender === 'me' ? 'https://images.unsplash.com/photo-1617409122337-594499222247?w=100' : chatAvatar}
                            alt="avatar"
                            className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                        />
                        <div className={`max-w-[70%] ${msg.sender === 'me' ? 'items-end' : 'items-start'}`}>
                            {msg.type === 'text' && (
                                <div className={`p-3 rounded-2xl ${msg.sender === 'me'
                                        ? 'bg-purple-500 text-white rounded-tr-sm'
                                        : 'bg-white rounded-tl-sm'
                                    }`}>
                                    <p className="text-sm">{msg.content}</p>
                                </div>
                            )}
                            {msg.type === 'redPacket' && (
                                <div className="p-4 bg-gradient-to-br from-red-500 to-orange-500 rounded-xl text-white min-w-[180px]">
                                    <div className="flex items-center gap-2 mb-2">
                                        <Gift size={24} />
                                        <span className="font-medium">红包</span>
                                    </div>
                                    <p className="text-sm opacity-90">{msg.extra?.redPacketMessage || '恭喜发财'}</p>
                                </div>
                            )}
                            {msg.type === 'location' && (
                                <div className="bg-white rounded-xl overflow-hidden min-w-[200px]">
                                    <div className="h-24 bg-gradient-to-br from-blue-100 to-green-100 flex items-center justify-center">
                                        <MapPin size={32} className="text-red-500" />
                                    </div>
                                    <div className="p-3">
                                        <p className="text-sm font-medium">{msg.extra?.locationName || '位置'}</p>
                                        <p className="text-xs text-gray-500">点击查看详情</p>
                                    </div>
                                </div>
                            )}
                            <p className="text-xs text-gray-400 mt-1">{formatTime(msg.timestamp)}</p>
                        </div>
                    </div>
                ))}
            </div>

            {/* Input Area */}
            <div className="bg-white border-t border-gray-200 p-3">
                <div className="flex items-center gap-2">
                    <button className="p-2 hover:bg-gray-100 rounded-full">
                        <Mic size={24} className="text-gray-600" />
                    </button>
                    <input
                        type="text"
                        value={inputText}
                        onChange={(e) => setInputText(e.target.value)}
                        placeholder="输入消息..."
                        className="flex-1 px-4 py-2 bg-gray-100 rounded-full focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                    <button className="p-2 hover:bg-gray-100 rounded-full">
                        <Smile size={24} className="text-gray-600" />
                    </button>
                    {inputText.trim() ? (
                        <button
                            onClick={handleSend}
                            className="p-2 bg-purple-500 rounded-full hover:bg-purple-600"
                        >
                            <Send size={20} className="text-white" />
                        </button>
                    ) : (
                        <button
                            onClick={() => setShowMorePanel(!showMorePanel)}
                            className="p-2 hover:bg-gray-100 rounded-full"
                        >
                            <Plus size={24} className="text-gray-600" />
                        </button>
                    )}
                </div>

                {/* More Panel */}
                {showMorePanel && (
                    <div className="mt-3 pt-3 border-t border-gray-100">
                        <div className="grid grid-cols-4 gap-4">
                            <button
                                onClick={() => setShowRedPacketModal(true)}
                                className="flex flex-col items-center gap-2"
                            >
                                <div className="w-14 h-14 bg-red-100 rounded-xl flex items-center justify-center">
                                    <Gift size={28} className="text-red-500" />
                                </div>
                                <span className="text-xs text-gray-600">红包</span>
                            </button>
                            <button
                                onClick={() => setShowLocationModal(true)}
                                className="flex flex-col items-center gap-2"
                            >
                                <div className="w-14 h-14 bg-green-100 rounded-xl flex items-center justify-center">
                                    <MapPin size={28} className="text-green-500" />
                                </div>
                                <span className="text-xs text-gray-600">位置</span>
                            </button>
                            <button className="flex flex-col items-center gap-2">
                                <div className="w-14 h-14 bg-blue-100 rounded-xl flex items-center justify-center">
                                    <Video size={28} className="text-blue-500" />
                                </div>
                                <span className="text-xs text-gray-600">视频通话</span>
                            </button>
                            <button className="flex flex-col items-center gap-2">
                                <div className="w-14 h-14 bg-purple-100 rounded-xl flex items-center justify-center">
                                    <UserPlus size={28} className="text-purple-500" />
                                </div>
                                <span className="text-xs text-gray-600">拉人进群</span>
                            </button>
                            {isGroup && (
                                <button
                                    onClick={() => setShowGroupApps(true)}
                                    className="flex flex-col items-center gap-2"
                                >
                                    <div className="w-14 h-14 bg-orange-100 rounded-xl flex items-center justify-center">
                                        <Gamepad2 size={28} className="text-orange-500" />
                                    </div>
                                    <span className="text-xs text-gray-600">群应用</span>
                                </button>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* Red Packet Modal */}
            {showRedPacketModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl w-full max-w-sm overflow-hidden">
                        <div className="bg-gradient-to-br from-red-500 to-orange-500 p-4 text-white flex items-center justify-between">
                            <h3 className="font-semibold text-lg">发红包</h3>
                            <button onClick={() => setShowRedPacketModal(false)}>
                                <X size={24} />
                            </button>
                        </div>
                        <div className="p-4 space-y-4">
                            <div>
                                <label className="text-sm text-gray-600 block mb-2">金额 (RWAD)</label>
                                <input
                                    type="number"
                                    placeholder="输入金额"
                                    className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
                                />
                            </div>
                            <div>
                                <label className="text-sm text-gray-600 block mb-2">祝福语</label>
                                <input
                                    type="text"
                                    placeholder="恭喜发财，大吉大利"
                                    className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
                                />
                            </div>
                            <button className="w-full py-3 bg-gradient-to-r from-red-500 to-orange-500 text-white rounded-lg font-medium">
                                发送红包
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Location Modal */}
            {showLocationModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-end">
                    <div className="bg-white w-full rounded-t-2xl overflow-hidden">
                        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
                            <h3 className="font-semibold">发送位置</h3>
                            <button onClick={() => setShowLocationModal(false)}>
                                <X size={24} className="text-gray-600" />
                            </button>
                        </div>
                        <div className="h-64 bg-gradient-to-br from-blue-50 to-green-50 flex items-center justify-center">
                            <div className="text-center">
                                <MapPin size={48} className="text-red-500 mx-auto mb-2" />
                                <p className="text-gray-600">正在获取位置...</p>
                                <p className="text-sm text-gray-400 mt-1">中国 广东省 深圳市 南山区</p>
                            </div>
                        </div>
                        <div className="p-4">
                            <button className="w-full py-3 bg-purple-500 text-white rounded-lg font-medium">
                                发送当前位置
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Group Apps Modal */}
            {showGroupApps && (
                <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-end">
                    <div className="bg-white w-full rounded-t-2xl overflow-hidden max-h-[70vh]">
                        <div className="sticky top-0 p-4 border-b border-gray-200 flex items-center justify-between bg-white">
                            <h3 className="font-semibold">群应用</h3>
                            <button onClick={() => setShowGroupApps(false)}>
                                <X size={24} className="text-gray-600" />
                            </button>
                        </div>
                        <div className="p-4 space-y-3">
                            {enabledGroupApps.map((app) => (
                                <div
                                    key={app.id}
                                    className="flex items-center justify-between p-4 bg-gray-50 rounded-xl"
                                >
                                    <div className="flex items-center gap-3">
                                        <span className="text-2xl">{app.icon}</span>
                                        <span className="font-medium">{app.name}</span>
                                    </div>
                                    <button className="px-4 py-2 bg-purple-500 text-white text-sm rounded-lg hover:bg-purple-600">
                                        发起
                                    </button>
                                </div>
                            ))}
                            <button className="w-full py-3 border-2 border-dashed border-gray-300 rounded-lg text-gray-500 hover:border-purple-500 hover:text-purple-500">
                                + 前往应用市场
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
