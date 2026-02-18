import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, Loader2, RefreshCcw, XCircle } from 'lucide-react';
import {
    listByopProofReviewQueue,
    resolveActorId,
    verifyByopProof,
} from '../domain/payment/paymentApi';
import type { ByopProofReviewItem, ProofVerificationState } from '../domain/payment/types';

interface ByopReviewConsoleProps {
    onClose: () => void;
}

type FilterState = 'REVIEW_REQUIRED' | 'PENDING' | 'ALL';

function parsePurchaseSnapshot(item: ByopProofReviewItem): Record<string, unknown> {
    const metadata = item.proof.metadata;
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
        return {};
    }
    const snapshot = (metadata as Record<string, unknown>).purchaseSnapshot;
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
        return {};
    }
    return snapshot as Record<string, unknown>;
}

export default function ByopReviewConsole({ onClose }: ByopReviewConsoleProps) {
    const [filterState, setFilterState] = useState<FilterState>('REVIEW_REQUIRED');
    const [queue, setQueue] = useState<ByopProofReviewItem[]>([]);
    const [busy, setBusy] = useState(false);
    const [actingProofId, setActingProofId] = useState('');
    const [error, setError] = useState('');

    const reviewStates = useMemo(() => {
        if (filterState === 'ALL') {
            return ['PENDING', 'REVIEW_REQUIRED'] as ProofVerificationState[];
        }
        return [filterState];
    }, [filterState]);

    const loadQueue = useCallback(async (): Promise<void> => {
        setBusy(true);
        setError('');
        try {
            const next = await listByopProofReviewQueue({
                states: reviewStates,
                limit: 60,
            });
            setQueue(next);
        } catch (loadError) {
            setError((loadError as Error).message || '加载核验队列失败');
        } finally {
            setBusy(false);
        }
    }, [reviewStates]);

    useEffect(() => {
        let cancelled = false;
        const tick = () => {
            if (!cancelled) {
                void loadQueue();
            }
        };
        tick();
        const timer = window.setInterval(tick, 5000);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [loadQueue]);

    const handleVerdict = useCallback(async (
        item: ByopProofReviewItem,
        verdict: Exclude<ProofVerificationState, 'PENDING'>,
    ): Promise<void> => {
        setActingProofId(item.proof.proofId);
        setError('');
        try {
            const reasonCodes = verdict === 'REJECTED'
                ? ['manual_rejected']
                : verdict === 'REVIEW_REQUIRED'
                    ? ['manual_review_required']
                    : ['manual_passed'];
            await verifyByopProof(item.order.orderId, {
                proofId: item.proof.proofId,
                verdict,
                method: 'MANUAL',
                reasonCodes,
                reviewerId: resolveActorId(),
            });
            await loadQueue();
        } catch (submitError) {
            setError((submitError as Error).message || '写回核验结果失败');
        } finally {
            setActingProofId('');
        }
    }, [loadQueue]);

    return (
        <div className="fixed inset-0 z-[80] bg-gray-50 flex flex-col">
            <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3">
                <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-full">
                    <ArrowLeft size={22} />
                </button>
                <div className="flex-1 min-w-0">
                    <h1 className="text-base font-semibold text-gray-900 truncate">支付核验台</h1>
                    <p className="text-xs text-gray-500">处理 BYOP 的自动核验待办</p>
                </div>
                <button
                    onClick={() => {
                        void loadQueue();
                    }}
                    disabled={busy}
                    className="px-3 py-1.5 text-xs rounded-full border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-60 inline-flex items-center gap-1.5"
                >
                    <RefreshCcw size={13} />
                    刷新
                </button>
            </header>

            <div className="bg-white px-4 py-3 border-b border-gray-200 flex gap-2">
                {(['REVIEW_REQUIRED', 'PENDING', 'ALL'] as FilterState[]).map((state) => (
                    <button
                        key={state}
                        onClick={() => setFilterState(state)}
                        className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${
                            filterState === state
                                ? 'bg-blue-600 text-white border-blue-600'
                                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                        }`}
                    >
                        {state === 'REVIEW_REQUIRED' ? '待人工' : state === 'PENDING' ? '自动核验中' : '全部待办'}
                    </button>
                ))}
            </div>

            {error && (
                <div className="mx-4 mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                    {error}
                </div>
            )}

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {busy && queue.length === 0 && (
                    <div className="text-sm text-gray-500 inline-flex items-center gap-2">
                        <Loader2 size={14} className="animate-spin" />
                        加载核验队列...
                    </div>
                )}

                {!busy && queue.length === 0 && (
                    <div className="rounded-lg border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-500">
                        当前没有待处理核验单
                    </div>
                )}

                {queue.map((item) => {
                    const snapshot = parsePurchaseSnapshot(item);
                    const snapshotText = Object.keys(snapshot).length > 0 ? JSON.stringify(snapshot) : '{}';
                    const working = actingProofId === item.proof.proofId;
                    return (
                        <div key={item.proof.proofId} className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
                            <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                    <div className="text-sm font-semibold text-gray-900 truncate">{item.order.orderId}</div>
                                    <div className="text-xs text-gray-500 mt-1">
                                        {item.order.scene} · {item.order.orderState}/{item.order.paymentState}
                                    </div>
                                </div>
                                <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-700 text-xs">
                                    {item.verification.state}
                                </span>
                            </div>

                            <div className="text-xs text-gray-600 space-y-1">
                                <div>渠道：{item.proof.channel ?? '-'}</div>
                                <div>交易号：{item.proof.proofRef}</div>
                                <div>金额：{typeof item.proof.paidAmountCny === 'number' ? item.proof.paidAmountCny.toFixed(2) : '-'}</div>
                                <div>购买快照：{snapshotText}</div>
                                {item.verification.reasonCodes.length > 0 && (
                                    <div>原因：{item.verification.reasonCodes.join(', ')}</div>
                                )}
                            </div>

                            <div className="grid grid-cols-3 gap-2">
                                <button
                                    onClick={() => {
                                        void handleVerdict(item, 'PASSED');
                                    }}
                                    disabled={working}
                                    className="py-2 text-xs rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-60 inline-flex items-center justify-center gap-1"
                                >
                                    <CheckCircle2 size={13} />
                                    通过
                                </button>
                                <button
                                    onClick={() => {
                                        void handleVerdict(item, 'REVIEW_REQUIRED');
                                    }}
                                    disabled={working}
                                    className="py-2 text-xs rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
                                >
                                    继续人工
                                </button>
                                <button
                                    onClick={() => {
                                        void handleVerdict(item, 'REJECTED');
                                    }}
                                    disabled={working}
                                    className="py-2 text-xs rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-60 inline-flex items-center justify-center gap-1"
                                >
                                    <XCircle size={13} />
                                    驳回
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
