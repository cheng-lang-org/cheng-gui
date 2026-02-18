import { useState } from 'react';
import { X, Edit3, FileText, Clock, Bookmark, Heart, Settings, HelpCircle, Moon, LogOut, Globe, ChevronRight, Check, TrendingUp } from 'lucide-react';
import { ImageWithFallback } from './figma/ImageWithFallback';
import { useLocale } from '../i18n/LocaleContext';

interface SidebarProps {
    isOpen: boolean;
    onClose: () => void;
    onNavigate?: (page: string) => void;
}

const languageOptions = [
    { code: 'en', nativeName: 'English' },
    { code: 'ja', nativeName: '日本語' },
    { code: 'ko', nativeName: '한국어' },
    { code: 'fr', nativeName: 'Français' },
    { code: 'de', nativeName: 'Deutsch' },
    { code: 'ar', nativeName: 'العربية' },
    { code: 'zh-CN', nativeName: '简体中文' },
    { code: 'zh-TW', nativeName: '繁體中文' },
];

export default function Sidebar({ isOpen, onClose, onNavigate }: SidebarProps) {
    const [showLanguagePicker, setShowLanguagePicker] = useState(false);
    const { locale, setLocale, t } = useLocale();

    const currentLanguageName = languageOptions.find(l => l.code === locale)?.nativeName || '简体中文';

    const handleLanguageChange = (code: string) => {
        setLocale(code);
        setShowLanguagePicker(false);
    };

    const menuItems = [
        { icon: Edit3, label: t.sidebar_creationCenter, badge: null },
        { icon: FileText, label: t.sidebar_drafts, badge: '3' },
        { icon: Clock, label: t.sidebar_history, badge: null },
        { icon: Bookmark, label: t.sidebar_favorites, badge: null },
        { icon: Heart, label: t.sidebar_liked, badge: null },
    ];

    const settingsItems = [
        { icon: Settings, label: t.sidebar_settings },
        { icon: HelpCircle, label: t.sidebar_helpFeedback },
        { icon: Moon, label: t.sidebar_darkMode },
    ];

    if (!isOpen) return null;

    return (
        <>
            {/* Overlay */}
            <div
                className="fixed inset-0 bg-black bg-opacity-50 z-40 transition-opacity"
                onClick={onClose}
            />

            {/* Sidebar Panel */}
            <div className="fixed left-0 top-0 h-full w-72 bg-white z-50 shadow-xl transform transition-transform duration-300 ease-out flex flex-col">
                {/* Header with Close Button */}
                <div className="flex items-center justify-end p-4">
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                    >
                        <X size={22} />
                    </button>
                </div>

                {/* User Profile Section */}
                <div className="px-6 pb-6 border-b border-gray-100">
                    <div className="flex items-center gap-3 mb-4">
                        <ImageWithFallback
                            src="https://images.unsplash.com/photo-1617409122337-594499222247?w=100"
                            alt="Avatar"
                            className="w-14 h-14 rounded-full object-cover"
                        />
                        <div>
                            <h2 className="font-semibold text-lg">{t.sidebar_myNode}</h2>
                            <p className="text-sm text-gray-500">ID: 12345678</p>
                        </div>
                    </div>

                    {/* Stats */}
                    <div className="flex items-center gap-6 text-center">
                        <div className="flex-1">
                            <div className="font-semibold text-lg">128</div>
                            <div className="text-xs text-gray-500">{t.sidebar_follow}</div>
                        </div>
                        <div className="flex-1">
                            <div className="font-semibold text-lg">2.3万</div>
                            <div className="text-xs text-gray-500">{t.sidebar_fans}</div>
                        </div>
                        <div className="flex-1">
                            <div className="font-semibold text-lg">56.8万</div>
                            <div className="text-xs text-gray-500">{t.sidebar_likesCollections}</div>
                        </div>
                    </div>
                </div>

                {/* Menu Items */}
                <div className="flex-1 overflow-y-auto py-4">
                    <div className="px-2">
                        {menuItems.map((item, index) => (
                            <button
                                key={index}
                                className="w-full flex items-center gap-4 px-4 py-3 hover:bg-gray-50 rounded-lg transition-colors"
                            >
                                <item.icon size={22} className="text-gray-600" />
                                <span className="flex-1 text-left text-gray-800">{item.label}</span>
                                {item.badge && (
                                    <span className="px-2 py-0.5 bg-red-500 text-white text-xs rounded-full">
                                        {item.badge}
                                    </span>
                                )}
                            </button>
                        ))}
                    </div>

                    {/* Trading Entry */}
                    <div className="px-2 mb-2">
                        <button
                            onClick={() => { onNavigate?.('trading'); onClose(); }}
                            className="w-full flex items-center gap-4 px-4 py-3 hover:bg-gray-50 rounded-lg transition-colors bg-gradient-to-r from-yellow-50 to-orange-50 border border-yellow-200/50"
                        >
                            <TrendingUp size={22} className="text-yellow-600" />
                            <span className="flex-1 text-left font-medium text-gray-800">{t.sidebar_trading || 'DEX Trading'}</span>
                            <span className="px-1.5 py-0.5 bg-yellow-400 text-yellow-900 text-[10px] font-bold rounded">DEX</span>
                        </button>
                    </div>

                    <div className="h-px bg-gray-100 my-4 mx-6" />

                    <div className="px-2">
                        {settingsItems.map((item, index) => (
                            <button
                                key={index}
                                className="w-full flex items-center gap-4 px-4 py-3 hover:bg-gray-50 rounded-lg transition-colors"
                            >
                                <item.icon size={22} className="text-gray-600" />
                                <span className="flex-1 text-left text-gray-800">{item.label}</span>
                            </button>
                        ))}

                        {/* 语言设置 */}
                        <button
                            onClick={() => setShowLanguagePicker(true)}
                            className="w-full flex items-center gap-4 px-4 py-3 hover:bg-gray-50 rounded-lg transition-colors"
                        >
                            <Globe size={22} className="text-gray-600" />
                            <span className="flex-1 text-left text-gray-800">{t.sidebar_language}</span>
                            <span className="text-sm text-gray-400">{currentLanguageName}</span>
                            <ChevronRight size={16} className="text-gray-400" />
                        </button>
                    </div>
                </div>

                {/* Bottom Section */}
                <div className="border-t border-gray-100 p-4">
                    <button className="w-full flex items-center gap-4 px-4 py-3 hover:bg-gray-50 rounded-lg transition-colors text-red-500">
                        <LogOut size={22} />
                        <span>{t.sidebar_logout}</span>
                    </button>
                </div>
            </div>

            {/* Language Picker Overlay */}
            {showLanguagePicker && (
                <div className="fixed left-0 top-0 h-full w-72 bg-white z-[60] shadow-xl flex flex-col">
                    <div className="flex items-center gap-3 px-4 py-4 border-b border-gray-100">
                        <button
                            onClick={() => setShowLanguagePicker(false)}
                            className="p-1 hover:bg-gray-100 rounded-full"
                        >
                            <X size={20} />
                        </button>
                        <h3 className="font-semibold text-lg">{t.sidebar_languageSettings}</h3>
                    </div>
                    <div className="flex-1 overflow-y-auto py-2 px-2">
                        {languageOptions.map((lang) => (
                            <button
                                key={lang.code}
                                onClick={() => handleLanguageChange(lang.code)}
                                className={`w-full flex items-center justify-between px-4 py-3 rounded-lg transition-colors ${locale === lang.code
                                    ? 'bg-purple-500 text-white'
                                    : 'hover:bg-gray-50 text-gray-800'
                                    }`}
                            >
                                <span className="font-medium">{lang.nativeName}</span>
                                {locale === lang.code && <Check size={18} />}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </>
    );
}
