import { FileText, ShoppingBag, Radio, AppWindow, UtensilsCrossed, Car, Briefcase, UserPlus, Home, Tag, Recycle, Rocket, Megaphone } from 'lucide-react';
import { useLocale } from '../i18n/LocaleContext';
import type { Translations } from '../i18n/translations';

export type PublishType = 'content' | 'product' | 'live' | 'app' | 'food' | 'ride' | 'job' | 'hire' | 'rent' | 'sell' | 'secondhand' | 'crowdfunding' | 'ad';

interface PublishTypeSelectorProps {
    onSelect: (type: PublishType) => void;
    onClose: () => void;
}

export const publishTypes: { type: PublishType; labelKey: keyof Translations; fallbackLabel: string; icon: React.ElementType; from: string; to: string; border: string }[] = [
    { type: 'content', labelKey: 'publish_content', fallbackLabel: '内容', icon: FileText, from: 'from-purple-500', to: 'to-purple-600', border: 'hover:border-purple-300' },
    { type: 'product', labelKey: 'publish_ecommerce', fallbackLabel: '电商', icon: ShoppingBag, from: 'from-orange-500', to: 'to-orange-600', border: 'hover:border-orange-300' },
    { type: 'live', labelKey: 'publish_live', fallbackLabel: '直播', icon: Radio, from: 'from-red-500', to: 'to-red-600', border: 'hover:border-red-300' },
    { type: 'app', labelKey: 'publish_app', fallbackLabel: '应用', icon: AppWindow, from: 'from-blue-500', to: 'to-blue-600', border: 'hover:border-blue-300' },
    { type: 'food', labelKey: 'publish_food', fallbackLabel: '外卖', icon: UtensilsCrossed, from: 'from-amber-500', to: 'to-amber-600', border: 'hover:border-amber-300' },
    { type: 'ride', labelKey: 'publish_ride', fallbackLabel: '顺风车', icon: Car, from: 'from-green-500', to: 'to-green-600', border: 'hover:border-green-300' },
    { type: 'job', labelKey: 'publish_job', fallbackLabel: '求职', icon: Briefcase, from: 'from-indigo-500', to: 'to-indigo-600', border: 'hover:border-indigo-300' },
    { type: 'hire', labelKey: 'publish_hire', fallbackLabel: '招聘', icon: UserPlus, from: 'from-pink-500', to: 'to-pink-600', border: 'hover:border-pink-300' },
    { type: 'rent', labelKey: 'publish_rent', fallbackLabel: '出租', icon: Home, from: 'from-teal-500', to: 'to-teal-600', border: 'hover:border-teal-300' },
    { type: 'sell', labelKey: 'publish_sell', fallbackLabel: '出售', icon: Tag, from: 'from-rose-500', to: 'to-rose-600', border: 'hover:border-rose-300' },
    { type: 'secondhand', labelKey: 'publish_secondhand', fallbackLabel: '二手', icon: Recycle, from: 'from-lime-500', to: 'to-lime-600', border: 'hover:border-lime-300' },
    { type: 'crowdfunding', labelKey: 'publish_crowdfunding', fallbackLabel: '众筹', icon: Rocket, from: 'from-cyan-500', to: 'to-cyan-600', border: 'hover:border-cyan-300' },
    { type: 'ad', labelKey: 'publish_ad', fallbackLabel: '广告', icon: Megaphone, from: 'from-yellow-400', to: 'to-yellow-500', border: 'hover:border-yellow-300' },
];


export default function PublishTypeSelector({ onSelect, onClose }: PublishTypeSelectorProps) {
    const { t } = useLocale();

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-end" onClick={onClose}>
            <div
                className="bg-white w-full rounded-t-3xl overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="p-6">
                    <h3 className="text-lg font-semibold text-center mb-6">{t.publish_selectType}</h3>

                    <div className="grid grid-cols-4 gap-3 mb-6">
                        {publishTypes.map(({ type, labelKey, fallbackLabel, icon: Icon, from, to, border }) => (
                            <button
                                key={type}
                                onClick={() => onSelect(type)}
                                className={`p-3 bg-gradient-to-br from-gray-50 to-gray-100 rounded-2xl hover:shadow-lg transition-all flex flex-col items-center gap-2 border-2 border-transparent ${border}`}
                            >
                                <div className={`w-12 h-12 bg-gradient-to-br ${from} ${to} rounded-xl flex items-center justify-center shadow-lg`}>
                                    <Icon size={24} className="text-white" />
                                </div>
                                <div className="text-center">
                                    <div className="font-semibold text-gray-800 text-xs">{t[labelKey] || fallbackLabel}</div>
                                </div>
                            </button>
                        ))}
                    </div>

                    <button
                        onClick={onClose}
                        className="w-full py-3 text-gray-500 hover:text-gray-700 transition-colors"
                    >
                        {t.publish_cancel}
                    </button>
                </div>
            </div>
        </div>
    );
}
