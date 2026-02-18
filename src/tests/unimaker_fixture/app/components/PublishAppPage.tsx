import { useState, useRef } from 'react';
import { X, Upload, Code, Globe, Image as ImageIcon, FileText, Check, AlertCircle } from 'lucide-react';

interface PublishAppPageProps {
    onClose: () => void;
}

export default function PublishAppPage({ onClose }: PublishAppPageProps) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const iconInputRef = useRef<HTMLInputElement>(null);
    const [appName, setAppName] = useState('');
    const [description, setDescription] = useState('');
    const [version, setVersion] = useState('1.0.0');
    const [appIcon, setAppIcon] = useState<string | null>(null);
    const [appFile, setAppFile] = useState<File | null>(null);
    const [category, setCategory] = useState<string>('');
    const [isOpenSource, setIsOpenSource] = useState(false);
    const [repoUrl, setRepoUrl] = useState('');

    const categories = [
        { id: 'tools', name: '工具', icon: '🔧' },
        { id: 'social', name: '社交', icon: '💬' },
        { id: 'games', name: '游戏', icon: '🎮' },
        { id: 'media', name: '媒体', icon: '🎬' },
        { id: 'finance', name: '金融', icon: '💰' },
        { id: 'education', name: '教育', icon: '📚' },
    ];

    const handleIconSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => setAppIcon(e.target?.result as string);
            reader.readAsDataURL(file);
        }
    };

    const handleAppFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setAppFile(file);
        }
    };

    const handlePublish = () => {
        console.log('Publishing app:', {
            appName, description, version, appIcon, appFile, category, isOpenSource, repoUrl
        });
        onClose();
    };

    const canPublish = appName.length > 0 && description.length > 0 && category;

    return (
        <div className="fixed inset-0 bg-white z-50 flex flex-col">
            {/* Header */}
            <header className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
                <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full">
                    <X size={24} />
                </button>
                <h1 className="font-semibold text-lg">发布应用</h1>
                <button
                    onClick={handlePublish}
                    disabled={!canPublish}
                    className={`px-5 py-2 rounded-full font-medium transition-colors ${canPublish
                            ? 'bg-blue-500 text-white hover:bg-blue-600'
                            : 'bg-gray-200 text-gray-400'
                        }`}
                >
                    发布
                </button>
            </header>

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
                <div className="p-4 space-y-6">
                    {/* 应用图标 */}
                    <div className="flex items-center gap-4">
                        <input
                            type="file"
                            ref={iconInputRef}
                            onChange={handleIconSelect}
                            accept="image/*"
                            className="hidden"
                        />
                        <button
                            onClick={() => iconInputRef.current?.click()}
                            className="w-20 h-20 bg-gray-100 rounded-2xl flex items-center justify-center border-2 border-dashed border-gray-300 hover:border-blue-500 transition-colors overflow-hidden"
                        >
                            {appIcon ? (
                                <img src={appIcon} alt="App Icon" className="w-full h-full object-cover" />
                            ) : (
                                <ImageIcon size={32} className="text-gray-400" />
                            )}
                        </button>
                        <div>
                            <div className="font-medium text-gray-800">应用图标</div>
                            <div className="text-xs text-gray-500">建议 512x512 PNG</div>
                        </div>
                    </div>

                    {/* 应用名称 */}
                    <div>
                        <h3 className="text-sm font-medium text-gray-700 mb-2">应用名称</h3>
                        <input
                            type="text"
                            placeholder="输入应用名称"
                            value={appName}
                            onChange={(e) => setAppName(e.target.value)}
                            className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                            maxLength={30}
                        />
                    </div>

                    {/* 应用描述 */}
                    <div>
                        <h3 className="text-sm font-medium text-gray-700 mb-2">应用描述</h3>
                        <textarea
                            placeholder="描述你的应用功能和特点..."
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            className="w-full h-24 p-3 bg-gray-50 border border-gray-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                    </div>

                    {/* 版本号 */}
                    <div>
                        <h3 className="text-sm font-medium text-gray-700 mb-2">版本号</h3>
                        <input
                            type="text"
                            placeholder="1.0.0"
                            value={version}
                            onChange={(e) => setVersion(e.target.value)}
                            className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                    </div>

                    {/* 分隔线 */}
                    <div className="h-px bg-gray-200" />

                    {/* 分类选择 */}
                    <div>
                        <h3 className="text-sm font-medium text-gray-700 mb-3">应用分类</h3>
                        <div className="grid grid-cols-3 gap-2">
                            {categories.map((cat) => (
                                <button
                                    key={cat.id}
                                    onClick={() => setCategory(cat.id)}
                                    className={`p-3 rounded-xl flex items-center gap-2 transition-colors border-2 ${category === cat.id
                                            ? 'border-blue-500 bg-blue-50'
                                            : 'border-gray-200 hover:border-blue-200'
                                        }`}
                                >
                                    <span className="text-xl">{cat.icon}</span>
                                    <span className="text-sm font-medium">{cat.name}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* 应用文件上传 */}
                    <div>
                        <h3 className="text-sm font-medium text-gray-700 mb-2">应用文件</h3>
                        <input
                            type="file"
                            ref={fileInputRef}
                            onChange={handleAppFileSelect}
                            accept=".zip,.apk,.ipa,.wasm"
                            className="hidden"
                        />
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            className="w-full p-4 bg-gray-50 border-2 border-dashed border-gray-300 rounded-xl hover:border-blue-500 transition-colors flex items-center justify-center gap-3"
                        >
                            {appFile ? (
                                <>
                                    <Check size={20} className="text-green-500" />
                                    <span className="text-gray-700">{appFile.name}</span>
                                </>
                            ) : (
                                <>
                                    <Upload size={20} className="text-gray-400" />
                                    <span className="text-gray-600">上传 ZIP/APK/IPA/WASM</span>
                                </>
                            )}
                        </button>
                    </div>

                    {/* 开源选项 */}
                    <button
                        onClick={() => setIsOpenSource(!isOpenSource)}
                        className={`w-full p-4 rounded-xl flex items-center justify-between transition-colors border-2 ${isOpenSource ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
                            }`}
                    >
                        <div className="flex items-center gap-3">
                            <Code size={20} className="text-gray-600" />
                            <span className="font-medium">开源项目</span>
                        </div>
                        <div className={`w-12 h-6 rounded-full transition-colors ${isOpenSource ? 'bg-blue-500' : 'bg-gray-300'} relative`}>
                            <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${isOpenSource ? 'translate-x-7' : 'translate-x-1'}`} />
                        </div>
                    </button>

                    {isOpenSource && (
                        <div>
                            <h3 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
                                <Globe size={16} />
                                仓库地址
                            </h3>
                            <input
                                type="url"
                                placeholder="https://github.com/username/repo"
                                value={repoUrl}
                                onChange={(e) => setRepoUrl(e.target.value)}
                                className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                    )}

                    {/* 提示 */}
                    <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-start gap-2">
                        <AlertCircle size={16} className="text-blue-600 mt-0.5 flex-shrink-0" />
                        <p className="text-xs text-blue-700">
                            应用将通过去中心化网络分发，确保你的应用符合平台规范。
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
