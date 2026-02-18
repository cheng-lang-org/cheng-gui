import { useState } from 'react';
import { Car, Users, Calendar, Clock } from 'lucide-react';
import PublishBasePage, { type PublishConfig } from './PublishBasePage';
import { publishDistributedContent } from '../data/distributedContent';
import { useLocale } from '../i18n/LocaleContext';
import { getPublishLocationErrorMessage } from '../utils/publishLocationError';

interface PublishRidePageProps {
    onClose: () => void;
}

export default function PublishRidePage({ onClose }: PublishRidePageProps) {
    const { t } = useLocale();
    const [rideType, setRideType] = useState<'offer' | 'need'>('offer');

    const rideConfig: PublishConfig = {
        category: 'ride',
        title: t.pubRide_title,
        titleIcon: Car,
        titleIconColor: 'text-green-500',
        publishButtonColor: 'bg-green-500 hover:bg-green-600',
        fields: [
            { key: 'fromAddress', type: 'text', label: t.pubRide_from, placeholder: t.pubRide_from, required: true },
            { key: 'toAddress', type: 'text', label: t.pubRide_to, placeholder: t.pubRide_to, required: true },
            { key: 'date', type: 'date', label: t.pubRide_date, icon: Calendar, grid: 'half', required: true },
            { key: 'time', type: 'time', label: t.pubRide_time, icon: Clock, grid: 'half', required: true },
            { key: 'note', type: 'textarea', label: t.pubRide_notePlaceholder, placeholder: t.pubRide_notePlaceholder, rows: 3 },
        ],
        validate: (data) => {
            return !!(data.fromAddress && data.toAddress && data.date && data.time);
        },
        buildSummary: (data, _images) => {
            const rt = data.rideType as string || 'offer';
            const routeLabel = `${data.fromAddress} → ${data.toAddress}`;
            return `${rt === 'offer' ? t.pubRide_offerLabel : t.pubRide_lookForLabel} · ${routeLabel} · ${data.date} ${data.time}`;
        },
    };

    const handlePublish = async (data: Record<string, unknown>, images: string[]) => {
        const fullData: Record<string, unknown> = { ...data, rideType };
        const summary = rideConfig.buildSummary(fullData, images);

        console.log('Publishing ride:', fullData);
        await publishDistributedContent({
            publishCategory: 'ride',
            type: 'text',
            content: summary,
            locationHint: {
                city: typeof fullData['fromAddress'] === 'string' ? fullData['fromAddress'].trim() || undefined : undefined,
            },
            extra: fullData,
        });
    };

    return (
        <PublishBasePage
            config={rideConfig}
            onClose={onClose}
            onPublish={handlePublish}
            resolvePublishError={(error) => getPublishLocationErrorMessage(t, error)}
            publishLabel={t.pub_publish}
            publishingLabel={t.common_loading}
        >
            {/* Custom ride type selector */}
            <div className="flex gap-2">
                <button
                    onClick={() => setRideType('offer')}
                    className={`flex-1 py-3 rounded-xl font-medium flex items-center justify-center gap-2 transition-colors ${rideType === 'offer' ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-700'}`}
                >
                    <Car size={18} />
                    {t.pubRide_offerSeat}
                </button>
                <button
                    onClick={() => setRideType('need')}
                    className={`flex-1 py-3 rounded-xl font-medium flex items-center justify-center gap-2 transition-colors ${rideType === 'need' ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-700'}`}
                >
                    <Users size={18} />
                    {t.pubRide_lookForSeat}
                </button>
            </div>

            {/* Additional fields for ride offer */}
            {rideType === 'offer' && (
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-1">
                            <Users size={14} />{t.pubRide_seats}
                        </label>
                        <select className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl">
                            {[1, 2, 3, 4].map(n => <option key={n} value={n}>{n} {t.pubRide_seatUnit}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">{t.pubRide_costShare}</label>
                        <input type="number" placeholder="¥0" className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl" />
                    </div>
                </div>
            )}
        </PublishBasePage>
    );
}
