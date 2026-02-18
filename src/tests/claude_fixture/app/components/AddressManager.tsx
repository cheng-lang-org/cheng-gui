/**
 * Address Manager Component
 * Extracted from ProfilePage for better maintainability
 */

import { useState } from 'react';
import { MapPin, Plus, PencilLine, Trash2, CheckCircle2, X } from 'lucide-react';
import { useLocale } from '../i18n/LocaleContext';

export interface AddressRecord {
    id: string;
    receiver: string;
    phone: string;
    region: string;
    detail: string;
    tag: string;
    isDefault: boolean;
}

export interface AddressDraft {
    receiver: string;
    phone: string;
    region: string;
    detail: string;
    tag: string;
    isDefault: boolean;
}

const STORAGE_KEY = 'profile_addresses_v2';

const emptyAddressDraft: AddressDraft = {
    receiver: '',
    phone: '',
    region: '',
    detail: '',
    tag: '',
    isDefault: false,
};

function readJson<T>(key: string, fallback: T): T {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    try {
        return JSON.parse(raw) as T;
    } catch {
        return fallback;
    }
}

function writeJson(key: string, value: unknown): void {
    localStorage.setItem(key, JSON.stringify(value));
}

function createId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

interface AddressManagerProps {
    addresses: AddressRecord[];
    onAddressesChange: (addresses: AddressRecord[]) => void;
    showEditor: boolean;
    onEditorClose: () => void;
}

export default function AddressManager({
    addresses,
    onAddressesChange,
    showEditor,
    onEditorClose,
}: AddressManagerProps) {
    const { t } = useLocale();
    const [editingAddressId, setEditingAddressId] = useState<string | null>(null);
    const [addressDraft, setAddressDraft] = useState<AddressDraft>(emptyAddressDraft);
    const [addressError, setAddressError] = useState('');

    const validateAddress = (draft: AddressDraft): string | null => {
        if (!draft.receiver.trim()) return '请输入收货人';
        if (!draft.phone.trim()) return '请输入手机号';
        if (!/^1[3-9]\d{9}$/.test(draft.phone.trim())) return '手机号格式不正确';
        if (!draft.region.trim()) return '请选择地区';
        if (!draft.detail.trim()) return '请输入详细地址';
        return null;
    };

    const handleSaveAddress = () => {
        const error = validateAddress(addressDraft);
        if (error) {
            setAddressError(error);
            return;
        }

        let updated: AddressRecord[];
        if (editingAddressId) {
            updated = addresses.map(addr => {
                if (addr.id === editingAddressId) {
                    return { ...addressDraft, id: editingAddressId };
                }
                if (addressDraft.isDefault) {
                    return { ...addr, isDefault: false };
                }
                return addr;
            });
        } else {
            const newAddress: AddressRecord = {
                ...addressDraft,
                id: createId('addr'),
            };
            if (addressDraft.isDefault) {
                updated = [{ ...newAddress }, ...addresses.map(a => ({ ...a, isDefault: false }))];
            } else {
                updated = [newAddress, ...addresses];
            }
        }

        onAddressesChange(updated);
        writeJson(STORAGE_KEY, updated);
        resetEditor();
    };

    const handleDeleteAddress = (id: string) => {
        const updated = addresses.filter(a => a.id !== id);
        onAddressesChange(updated);
        writeJson(STORAGE_KEY, updated);
    };

    const handleSetDefault = (id: string) => {
        const updated = addresses.map(a => ({
            ...a,
            isDefault: a.id === id,
        }));
        onAddressesChange(updated);
        writeJson(STORAGE_KEY, updated);
    };

    const startEdit = (address: AddressRecord) => {
        setEditingAddressId(address.id);
        setAddressDraft({
            receiver: address.receiver,
            phone: address.phone,
            region: address.region,
            detail: address.detail,
            tag: address.tag,
            isDefault: address.isDefault,
        });
        setAddressError('');
    };

    const resetEditor = () => {
        setEditingAddressId(null);
        setAddressDraft(emptyAddressDraft);
        setAddressError('');
        onEditorClose();
    };

    // Editor Modal
    if (showEditor) {
        return (
            <div className="fixed inset-0 bg-white z-50 flex flex-col">
                <header className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
                    <button onClick={resetEditor} className="p-2 hover:bg-gray-100 rounded-full">
                        <X size={24} />
                    </button>
                    <h1 className="font-semibold text-lg">
                        {editingAddressId ? '编辑地址' : '新增收货地址'}
                    </h1>
                    <button
                        onClick={handleSaveAddress}
                        className="px-4 py-2 bg-purple-500 text-white rounded-lg text-sm font-medium"
                    >
                        保存
                    </button>
                </header>

                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {addressError && (
                        <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm">
                            {addressError}
                        </div>
                    )}

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">收货人</label>
                        <input
                            type="text"
                            placeholder="姓名"
                            value={addressDraft.receiver}
                            onChange={(e) => setAddressDraft({ ...addressDraft, receiver: e.target.value })}
                            className="w-full p-3 border border-gray-300 rounded-xl"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">手机号</label>
                        <input
                            type="tel"
                            placeholder="手机号"
                            value={addressDraft.phone}
                            onChange={(e) => setAddressDraft({ ...addressDraft, phone: e.target.value })}
                            className="w-full p-3 border border-gray-300 rounded-xl"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">地区</label>
                        <input
                            type="text"
                            placeholder="省 市 区"
                            value={addressDraft.region}
                            onChange={(e) => setAddressDraft({ ...addressDraft, region: e.target.value })}
                            className="w-full p-3 border border-gray-300 rounded-xl"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">详细地址</label>
                        <textarea
                            placeholder="详细地址"
                            value={addressDraft.detail}
                            onChange={(e) => setAddressDraft({ ...addressDraft, detail: e.target.value })}
                            className="w-full p-3 border border-gray-300 rounded-xl resize-none"
                            rows={2}
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">标签</label>
                        <div className="flex gap-2">
                            {['家', '公司', '学校'].map(tag => (
                                <button
                                    key={tag}
                                    onClick={() => setAddressDraft({ ...addressDraft, tag })}
                                    className={`px-4 py-2 rounded-full text-sm ${addressDraft.tag === tag
                                        ? 'bg-purple-500 text-white'
                                        : 'bg-gray-100 text-gray-700'
                                        }`}
                                >
                                    {tag}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-700">设为默认</span>
                        <button
                            onClick={() => setAddressDraft({ ...addressDraft, isDefault: !addressDraft.isDefault })}
                            className={`w-12 h-6 rounded-full transition-colors ${addressDraft.isDefault ? 'bg-purple-500' : 'bg-gray-300'}`}
                        >
                            <div className={`w-5 h-5 bg-white rounded-full shadow transition-transform ${addressDraft.isDefault ? 'translate-x-6' : 'translate-x-0.5'}`} />
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // Address List View
    return (
        <div className="fixed inset-0 bg-white z-50 flex flex-col">
            <header className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
                <button onClick={onEditorClose} className="p-2 hover:bg-gray-100 rounded-full">
                    <X size={24} />
                </button>
                <h1 className="font-semibold text-lg flex items-center gap-2">
                    <MapPin size={20} />
                    收货地址
                </h1>
                <button
                    onClick={() => {
                        setEditingAddressId(null);
                        setAddressDraft(emptyAddressDraft);
                    }}
                    className="p-2 hover:bg-gray-100 rounded-full"
                >
                    <Plus size={24} />
                </button>
            </header>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {addresses.length === 0 ? (
                    <div className="text-center text-gray-400 py-10">
                        暂无收货地址
                    </div>
                ) : (
                    addresses.map((address) => (
                        <div
                            key={address.id}
                            className="bg-gray-50 rounded-xl p-4 space-y-2"
                        >
                            <div className="flex items-start justify-between">
                                <div>
                                    <div className="flex items-center gap-2">
                                        <span className="font-medium">{address.receiver}</span>
                                        <span className="text-gray-500 text-sm">{address.phone}</span>
                                        {address.isDefault && (
                                            <span className="px-2 py-0.5 bg-purple-100 text-purple-600 text-xs rounded">
                                                默认
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-sm text-gray-600 mt-1">
                                        {address.region} {address.detail}
                                    </div>
                                    {address.tag && (
                                        <span className="inline-block mt-1 px-2 py-0.5 bg-gray-200 text-gray-600 text-xs rounded">
                                            {address.tag}
                                        </span>
                                    )}
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => startEdit(address)}
                                        className="p-2 hover:bg-gray-200 rounded-lg"
                                    >
                                        <PencilLine size={16} className="text-gray-500" />
                                    </button>
                                    <button
                                        onClick={() => handleDeleteAddress(address.id)}
                                        className="p-2 hover:bg-gray-200 rounded-lg"
                                    >
                                        <Trash2 size={16} className="text-red-500" />
                                    </button>
                                </div>
                            </div>
                            {!address.isDefault && (
                                <button
                                    onClick={() => handleSetDefault(address.id)}
                                    className="text-purple-500 text-sm"
                                >
                                    设为默认
                                </button>
                            )}
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
