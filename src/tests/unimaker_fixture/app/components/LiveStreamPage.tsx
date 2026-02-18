import { useState } from 'react';
import { X, Camera, Video, Mic, MicOff, VideoOff, Settings, Users, MessageSquare, Gift, Share2 } from 'lucide-react';

interface LiveStreamPageProps {
    onClose: () => void;
}

export default function LiveStreamPage({ onClose }: LiveStreamPageProps) {
    const [title, setTitle] = useState('');
    const [isLive, setIsLive] = useState(false);
    const [isMicOn, setIsMicOn] = useState(true);
    const [isCameraOn, setIsCameraOn] = useState(true);
    const [viewerCount, setViewerCount] = useState(0);

    const handleStartLive = () => {
        if (title.trim()) {
            setIsLive(true);
            // 模拟观众数
            const interval = setInterval(() => {
                setViewerCount(prev => prev + Math.floor(Math.random() * 3));
            }, 2000);
            return () => clearInterval(interval);
        }
    };

    const handleEndLive = () => {
        setIsLive(false);
        setViewerCount(0);
        onClose();
    };

    // 开播前的准备页面
    if (!isLive) {
        return (
            <div className="fixed inset-0 bg-gray-900 z-50 flex flex-col">
                {/* Header */}
                <header className="flex items-center justify-between px-4 py-3">
                    <button onClick={onClose} className="p-2 text-white hover:bg-white/10 rounded-full">
                        <X size={24} />
                    </button>
                    <h1 className="font-semibold text-lg text-white">开始直播</h1>
                    <div className="w-10" />
                </header>

                {/* 预览区域 */}
                <div className="flex-1 flex items-center justify-center">
                    <div className="w-64 h-80 bg-gray-800 rounded-2xl flex items-center justify-center">
                        {isCameraOn ? (
                            <div className="text-center text-gray-400">
                                <Video size={48} className="mx-auto mb-2 opacity-50" />
                                <p className="text-sm">摄像头预览</p>
                            </div>
                        ) : (
                            <div className="text-center text-gray-500">
                                <VideoOff size={48} className="mx-auto mb-2" />
                                <p className="text-sm">摄像头已关闭</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* 设置区域 */}
                <div className="p-6 space-y-4">
                    {/* 直播标题 */}
                    <input
                        type="text"
                        placeholder="输入直播标题..."
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        className="w-full p-4 bg-gray-800 text-white border border-gray-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500 placeholder-gray-500"
                    />

                    {/* 控制按钮 */}
                    <div className="flex justify-center gap-6">
                        <button
                            onClick={() => setIsMicOn(!isMicOn)}
                            className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors ${isMicOn ? 'bg-gray-700 text-white' : 'bg-red-500/20 text-red-500'
                                }`}
                        >
                            {isMicOn ? <Mic size={24} /> : <MicOff size={24} />}
                        </button>
                        <button
                            onClick={() => setIsCameraOn(!isCameraOn)}
                            className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors ${isCameraOn ? 'bg-gray-700 text-white' : 'bg-red-500/20 text-red-500'
                                }`}
                        >
                            {isCameraOn ? <Video size={24} /> : <VideoOff size={24} />}
                        </button>
                        <button className="w-14 h-14 bg-gray-700 rounded-full flex items-center justify-center text-white">
                            <Settings size={24} />
                        </button>
                    </div>

                    {/* 开始直播按钮 */}
                    <button
                        onClick={handleStartLive}
                        disabled={!title.trim()}
                        className={`w-full py-4 rounded-full font-semibold text-lg transition-colors ${title.trim()
                                ? 'bg-gradient-to-r from-red-500 to-red-600 text-white hover:from-red-600 hover:to-red-700'
                                : 'bg-gray-700 text-gray-500'
                            }`}
                    >
                        开始直播
                    </button>
                </div>
            </div>
        );
    }

    // 直播中的页面
    return (
        <div className="fixed inset-0 bg-black z-50 flex flex-col">
            {/* 直播画面 */}
            <div className="flex-1 relative bg-gray-900">
                {/* 模拟直播画面 */}
                <div className="absolute inset-0 flex items-center justify-center">
                    <div className="text-gray-600">
                        <Video size={64} className="mx-auto mb-2 opacity-30" />
                        <p className="text-sm">直播画面</p>
                    </div>
                </div>

                {/* 顶部信息 */}
                <div className="absolute top-4 left-4 right-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="px-3 py-1.5 bg-red-500 text-white text-sm font-medium rounded-full flex items-center gap-1">
                            <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
                            直播中
                        </div>
                        <div className="px-3 py-1.5 bg-black/50 backdrop-blur-sm text-white text-sm rounded-full flex items-center gap-1">
                            <Users size={14} />
                            {viewerCount}
                        </div>
                    </div>
                    <button
                        onClick={handleEndLive}
                        className="px-4 py-1.5 bg-black/50 backdrop-blur-sm text-white text-sm rounded-full"
                    >
                        结束
                    </button>
                </div>

                {/* 直播标题 */}
                <div className="absolute bottom-20 left-4 right-4">
                    <div className="bg-black/50 backdrop-blur-sm rounded-lg p-3">
                        <p className="text-white font-medium">{title}</p>
                    </div>
                </div>
            </div>

            {/* 底部工具栏 */}
            <div className="bg-gray-900 px-4 py-4 flex items-center justify-around">
                <button
                    onClick={() => setIsMicOn(!isMicOn)}
                    className={`w-12 h-12 rounded-full flex items-center justify-center ${isMicOn ? 'bg-gray-700 text-white' : 'bg-red-500/20 text-red-500'
                        }`}
                >
                    {isMicOn ? <Mic size={22} /> : <MicOff size={22} />}
                </button>
                <button
                    onClick={() => setIsCameraOn(!isCameraOn)}
                    className={`w-12 h-12 rounded-full flex items-center justify-center ${isCameraOn ? 'bg-gray-700 text-white' : 'bg-red-500/20 text-red-500'
                        }`}
                >
                    {isCameraOn ? <Video size={22} /> : <VideoOff size={22} />}
                </button>
                <button className="w-12 h-12 bg-gray-700 rounded-full flex items-center justify-center text-white">
                    <MessageSquare size={22} />
                </button>
                <button className="w-12 h-12 bg-gray-700 rounded-full flex items-center justify-center text-white">
                    <Gift size={22} />
                </button>
                <button className="w-12 h-12 bg-gray-700 rounded-full flex items-center justify-center text-white">
                    <Share2 size={22} />
                </button>
            </div>
        </div>
    );
}
