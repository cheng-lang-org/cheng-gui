import { useState } from 'react';
import { X, MapPin, Calendar, Clock, Users, Car, Navigation } from 'lucide-react';

interface PublishRidePageProps {
    onClose: () => void;
}

export default function PublishRidePage({ onClose }: PublishRidePageProps) {
    const [fromAddress, setFromAddress] = useState('');
    const [toAddress, setToAddress] = useState('');
    const [date, setDate] = useState('');
    const [time, setTime] = useState('');
    const [seats, setSeats] = useState('1');
    const [price, setPrice] = useState('');
    const [rideType, setRideType] = useState<'offer' | 'need'>('offer');
    const [note, setNote] = useState('');

    const handlePublish = () => {
        console.log('Publishing ride:', { fromAddress, toAddress, date, time, seats, price, rideType, note });
        onClose();
    };

    const canPublish = fromAddress && toAddress && date && time;

    return (
        <div className="fixed inset-0 bg-white z-50 flex flex-col">
            <header className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
                <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full">
                    <X size={24} />
                </button>
                <h1 className="font-semibold text-lg">发布顺风车</h1>
                <button
                    onClick={handlePublish}
                    disabled={!canPublish}
                    className={`px-5 py-2 rounded-full font-medium transition-colors ${canPublish ? 'bg-green-500 text-white hover:bg-green-600' : 'bg-gray-200 text-gray-400'}`}
                >
                    发布
                </button>
            </header>

            <div className="flex-1 overflow-y-auto p-4 space-y-5">
                {/* 类型切换 */}
                <div className="flex gap-2">
                    <button onClick={() => setRideType('offer')} className={`flex-1 py-3 rounded-xl font-medium flex items-center justify-center gap-2 ${rideType === 'offer' ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-700'}`}>
                        <Car size={18} />
                        我有车位
                    </button>
                    <button onClick={() => setRideType('need')} className={`flex-1 py-3 rounded-xl font-medium flex items-center justify-center gap-2 ${rideType === 'need' ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-700'}`}>
                        <Users size={18} />
                        我找车位
                    </button>
                </div>

                {/* 路线 */}
                <div className="space-y-3">
                    <div className="flex items-center gap-3">
                        <div className="w-3 h-3 rounded-full bg-green-500" />
                        <input type="text" placeholder="出发地" value={fromAddress} onChange={(e) => setFromAddress(e.target.value)} className="flex-1 p-3 bg-gray-50 border border-gray-200 rounded-xl" />
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="w-3 h-3 rounded-full bg-red-500" />
                        <input type="text" placeholder="目的地" value={toAddress} onChange={(e) => setToAddress(e.target.value)} className="flex-1 p-3 bg-gray-50 border border-gray-200 rounded-xl" />
                    </div>
                </div>

                {/* 时间 */}
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <h3 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-1"><Calendar size={14} />日期</h3>
                        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl" />
                    </div>
                    <div>
                        <h3 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-1"><Clock size={14} />时间</h3>
                        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl" />
                    </div>
                </div>

                {rideType === 'offer' && (
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <h3 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-1"><Users size={14} />空余座位</h3>
                            <select value={seats} onChange={(e) => setSeats(e.target.value)} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl">
                                {[1, 2, 3, 4].map(n => <option key={n} value={n}>{n} 座</option>)}
                            </select>
                        </div>
                        <div>
                            <h3 className="text-sm font-medium text-gray-700 mb-2">费用分摊 (每人)</h3>
                            <input type="number" placeholder="¥0" value={price} onChange={(e) => setPrice(e.target.value)} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl" />
                        </div>
                    </div>
                )}

                <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2">备注</h3>
                    <textarea placeholder="如：可绕路接送、不接受宠物等..." value={note} onChange={(e) => setNote(e.target.value)} className="w-full h-20 p-3 bg-gray-50 border border-gray-200 rounded-xl resize-none" />
                </div>
            </div>
        </div>
    );
}
