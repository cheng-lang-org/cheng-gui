/**
 * Transaction History Component
 * Extracted from ProfilePage for better maintainability
 */

import { useState } from 'react';
import { X, ArrowDownCircle, ArrowUpCircle, Clock } from 'lucide-react';

export interface LedgerEntry {
    id: string;
    type: 'points_recharge' | 'points_transfer' | 'rwad_recharge' | 'rwad_transfer' | 'domain_register' | 'domain_transfer';
    amount: number;
    target?: string;
    createdAt: number;
}

const STORAGE_KEY = 'profile_asset_ledger_v2';

function readJson<T>(key: string, fallback: T): T {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    try {
        return JSON.parse(raw) as T;
    } catch {
        return fallback;
    }
}

function createId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function formatShortTime(timestamp: number): string {
    const date = new Date(timestamp);
    return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

const typeLabels: Record<LedgerEntry['type'], string> = {
    points_recharge: '积分充值',
    points_transfer: '积分转出',
    rwad_recharge: 'RWAD充值',
    rwad_transfer: 'RWAD转出',
    domain_register: '域名注册',
    domain_transfer: '域名转让',
};

const typeIcons: Record<LedgerEntry['type'], 'in' | 'out'> = {
    points_recharge: 'in',
    points_transfer: 'out',
    rwad_recharge: 'in',
    rwad_transfer: 'out',
    domain_register: 'out',
    domain_transfer: 'out',
};

interface TransactionHistoryProps {
    show: boolean;
    onClose: () => void;
    ledger: LedgerEntry[];
}

export function addLedgerEntry(entry: Omit<LedgerEntry, 'id' | 'createdAt'>): LedgerEntry {
    const newEntry: LedgerEntry = {
        ...entry,
        id: createId('ledger'),
        createdAt: Date.now(),
    };
    const existing = readJson<LedgerEntry[]>(STORAGE_KEY, []);
    const updated = [newEntry, ...existing];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    return newEntry;
}

export default function TransactionHistory({ show, onClose, ledger }: TransactionHistoryProps) {
    if (!show) return null;

    return (
        <div className="fixed inset-0 bg-white z-50 flex flex-col">
            <header className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
                <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full">
                    <X size={24} />
                </button>
                <h1 className="font-semibold text-lg flex items-center gap-2">
                    <Clock size={20} />
                    交易记录
                </h1>
                <div className="w-10" />
            </header>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {ledger.length === 0 ? (
                    <div className="text-center text-gray-400 py-10">
                        暂无交易记录
                    </div>
                ) : (
                    ledger.map((entry) => {
                        const isIncoming = typeIcons[entry.type] === 'in';
                        return (
                            <div
                                key={entry.id}
                                className="bg-gray-50 rounded-xl p-4 flex items-center justify-between"
                            >
                                <div className="flex items-center gap-3">
                                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isIncoming ? 'bg-green-100' : 'bg-red-100'
                                        }`}>
                                        {isIncoming ? (
                                            <ArrowDownCircle size={20} className="text-green-500" />
                                        ) : (
                                            <ArrowUpCircle size={20} className="text-red-500" />
                                        )}
                                    </div>
                                    <div>
                                        <div className="font-medium text-sm">{typeLabels[entry.type]}</div>
                                        <div className="text-xs text-gray-400">
                                            {formatShortTime(entry.createdAt)}
                                        </div>
                                        {entry.target && (
                                            <div className="text-xs text-gray-500 mt-0.5">
                                                {entry.target}
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div className={`font-medium ${isIncoming ? 'text-green-500' : 'text-red-500'}`}>
                                    {isIncoming ? '+' : '-'}{entry.amount}
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}
