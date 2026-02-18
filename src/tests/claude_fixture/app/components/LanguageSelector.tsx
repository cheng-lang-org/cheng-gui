import { useState } from 'react';
import { Globe, Check } from 'lucide-react';

interface LanguageSelectorProps {
    onSelect: (locale: string) => void;
}

interface Language {
    code: string;
    name: string;
    nativeName: string;
}

const languages: Language[] = [
    { code: 'en', name: 'English', nativeName: 'English' },
    { code: 'ja', name: 'Japanese', nativeName: '日本語' },
    { code: 'ko', name: 'Korean', nativeName: '한국어' },
    { code: 'fr', name: 'French', nativeName: 'Français' },
    { code: 'de', name: 'German', nativeName: 'Deutsch' },
    { code: 'ar', name: 'Arabic', nativeName: 'العربية' },
    { code: 'zh-CN', name: 'Simplified Chinese', nativeName: '简体中文' },
    { code: 'zh-TW', name: 'Traditional Chinese', nativeName: '繁體中文' },
];

export default function LanguageSelector({ onSelect }: LanguageSelectorProps) {
    const [selected, setSelected] = useState<string | null>(null);

    const handleSelect = (code: string) => {
        setSelected(code);
    };

    const handleConfirm = () => {
        if (selected) {
            localStorage.setItem('app_locale', selected);
            localStorage.setItem('app_language_set', 'true');
            onSelect(selected);
        }
    };

    return (
        <div className="fixed inset-0 bg-white z-50 overflow-hidden">
            <div
                className="h-full w-full"
                style={{
                    paddingTop: 'env(safe-area-inset-top, 0px)',
                    paddingBottom: 'env(safe-area-inset-bottom, 0px)',
                    paddingLeft: 'env(safe-area-inset-left, 0px)',
                    paddingRight: 'env(safe-area-inset-right, 0px)',
                }}
            >
                <div className="mx-auto flex h-full w-full max-w-sm flex-col min-h-0 px-4 pt-4 pb-3 sm:px-8">
                    {/* Logo/Title */}
                    <div className="text-center mb-5 flex-shrink-0">
                        <div className="w-16 h-16 bg-purple-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                            <Globe size={32} className="text-purple-600" />
                        </div>
                        <h1 className="text-2xl font-bold text-gray-800 mb-2">Welcome to UniMaker</h1>
                        <p className="text-gray-500 text-sm">Please select your preferred language</p>
                    </div>

                    {/* Language List - Vertical */}
                    <div
                        className="w-full flex-1 min-h-0 overflow-y-auto overscroll-y-contain space-y-2 pr-1"
                        style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-y' }}
                    >
                        {languages.map((lang) => (
                            <button
                                key={lang.code}
                                onClick={() => handleSelect(lang.code)}
                                className={`w-full flex items-center justify-between p-4 rounded-xl transition-all ${selected === lang.code
                                    ? 'bg-purple-500 text-white'
                                    : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
                                    }`}
                            >
                                <div className="text-left">
                                    <div className="font-medium">{lang.nativeName}</div>
                                    <div className={`text-xs ${selected === lang.code ? 'text-purple-200' : 'text-gray-400'}`}>
                                        {lang.name}
                                    </div>
                                </div>
                                {selected === lang.code && (
                                    <Check size={20} className="text-white" />
                                )}
                            </button>
                        ))}
                    </div>

                    <div className="pt-4 flex-shrink-0">
                        {/* Confirm Button */}
                        <button
                            onClick={handleConfirm}
                            disabled={!selected}
                            className={`w-full py-4 rounded-xl font-semibold transition-all ${selected
                                ? 'bg-purple-500 text-white hover:bg-purple-600'
                                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                                }`}
                        >
                            {selected ? 'Continue' : 'Select a language'}
                        </button>

                        {/* Skip Option */}
                        <button
                            onClick={() => {
                                localStorage.setItem('app_locale', 'zh-CN');
                                localStorage.setItem('app_language_set', 'true');
                                onSelect('zh-CN');
                            }}
                            className="mt-4 w-full text-gray-400 text-sm hover:text-gray-600 transition-colors"
                        >
                            跳过，使用简体中文
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
