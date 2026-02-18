import { useState, useCallback, useEffect, useMemo } from 'react';
import { ArrowLeft, RotateCcw, User } from 'lucide-react';
import VictoryConfetti from './VictoryConfetti';
import { useLocale } from '../i18n/LocaleContext';
import {
    type MahjongGameState, type PlayerIndex,
    createMahjongGame, drawTile, discardTile, executePeng,
    sortHand, tileShort, aiDiscard, aiShouldPeng, canPeng,
    playerName,
} from '../games/mahjong/engine';

interface Props { onClose: () => void; }

// ── Seat colors & positions ──────────────────
const SEAT_META: Record<number, { label: string; gradient: string; color: string }> = {
    0: { label: '你', gradient: 'from-blue-500 to-blue-600', color: 'text-blue-300' },
    1: { label: '右', gradient: 'from-amber-500 to-amber-600', color: 'text-amber-300' },
    2: { label: '对', gradient: 'from-rose-500 to-rose-600', color: 'text-rose-300' },
    3: { label: '左', gradient: 'from-emerald-500 to-emerald-600', color: 'text-emerald-300' },
};

// ── Tile Component (premium) ─────────────────
function TileView({ label, selected, onClick, small, highlight, dimmed }: {
    label: string; selected?: boolean; onClick?: () => void;
    small?: boolean; highlight?: boolean; dimmed?: boolean;
}) {
    // Parse tile parts for coloring
    const suitChar = label.charAt(label.length - 1);
    const numPart = label.slice(0, -1);
    const isWind = ['东', '南', '西', '北'].includes(label);
    const isDragon = ['中', '發', '白'].includes(label);
    const isZhong = label === '中';
    const isFa = label === '發';

    let textColor = 'text-gray-800';
    if (suitChar === '万') textColor = 'text-red-600';
    else if (suitChar === '条') textColor = 'text-green-600';
    else if (suitChar === '饼') textColor = 'text-blue-600';
    else if (isZhong) textColor = 'text-red-600';
    else if (isFa) textColor = 'text-green-600';

    return (
        <button
            onClick={onClick}
            disabled={dimmed}
            className={`
                inline-flex flex-col items-center justify-center rounded-md border font-bold select-none transition-all
                ${small ? 'w-7 h-9 text-[10px]' : 'w-9 h-12 text-xs'}
                ${selected
                    ? 'bg-yellow-50 border-yellow-400 -translate-y-2 shadow-lg shadow-yellow-400/30 ring-1 ring-yellow-300'
                    : highlight
                        ? 'bg-orange-50 border-orange-300 shadow-md shadow-orange-300/20'
                        : 'bg-gradient-to-b from-white to-gray-50 border-gray-200/80 shadow-sm hover:shadow-md hover:-translate-y-0.5'}
                ${dimmed ? 'opacity-40' : ''}
            `}
        >
            {isWind || isDragon ? (
                <span className={`${textColor} font-black ${small ? 'text-[11px]' : 'text-sm'}`}>{label}</span>
            ) : (
                <>
                    <span className={`${textColor} font-black leading-none`}>{numPart}</span>
                    <span className="text-[8px] text-gray-400 leading-none">{suitChar}</span>
                </>
            )}
        </button>
    );
}

// ── Opponent panel ───────────────────────────
function OpponentPanel({ index, game, position }: {
    index: PlayerIndex; game: MahjongGameState;
    position: 'top' | 'left' | 'right';
}) {
    const { t } = useLocale();
    const seat = SEAT_META[index];
    const name = playerName(index, t.mj_you ?? '你');
    const hand = game.hands[index];
    const melds = game.melds[index];
    const discards = game.discards[index];
    const isActive = game.currentPlayer === index && game.phase !== 'FINISHED';

    if (position === 'top') {
        return (
            <div className="flex flex-col items-center gap-1">
                {/* Avatar + name */}
                <div className="flex items-center gap-2">
                    <div className={`
                        w-7 h-7 rounded-full bg-gradient-to-br ${seat.gradient} flex items-center justify-center
                        ${isActive ? 'ring-2 ring-yellow-400 shadow-lg shadow-yellow-400/30' : ''}
                    `}>
                        <span className="text-white text-[10px] font-bold">{seat.label}</span>
                    </div>
                    <span className={`text-xs font-medium ${isActive ? 'text-yellow-300' : 'text-emerald-300/60'}`}>
                        {name}
                    </span>
                    <span className="text-[10px] text-emerald-400/40">{hand.length}张</span>
                </div>
                {/* Face-down tiles */}
                <div className="flex justify-center gap-px">
                    {hand.map((_, i) => (
                        <div key={i} className="w-4 h-5 rounded-[3px] bg-gradient-to-b from-emerald-600/40 to-emerald-800/40 border border-emerald-500/20" />
                    ))}
                </div>
                {/* Melds */}
                {melds.length > 0 && (
                    <div className="flex gap-1">
                        {melds.map((m, mi) => (
                            <div key={mi} className="flex gap-px">
                                {m.tiles.map((tile, ti) => (
                                    <TileView key={ti} label={tileShort(tile)} small />
                                ))}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className={`flex flex-col items-center gap-1 ${position === 'left' ? 'items-start' : 'items-end'}`}>
            <div className={`
                w-7 h-7 rounded-full bg-gradient-to-br ${seat.gradient} flex items-center justify-center
                ${isActive ? 'ring-2 ring-yellow-400 shadow-lg shadow-yellow-400/30' : ''}
            `}>
                <span className="text-white text-[10px] font-bold">{seat.label}</span>
            </div>
            <span className={`text-[10px] ${isActive ? 'text-yellow-300' : 'text-emerald-300/50'}`}>{name}</span>
            <div className={`flex flex-col gap-px ${position === 'left' ? 'items-start' : 'items-end'}`}>
                {hand.slice(0, 7).map((_, i) => (
                    <div key={i} className="w-5 h-3 rounded-[2px] bg-gradient-to-r from-emerald-600/40 to-emerald-800/40 border border-emerald-500/20" />
                ))}
                {hand.length > 7 && (
                    <span className="text-[8px] text-emerald-500/40">+{hand.length - 7}</span>
                )}
            </div>
        </div>
    );
}

// ── Main Component ───────────────────────────

export default function MahjongPage({ onClose }: Props) {
    const { t } = useLocale();
    const [game, setGame] = useState<MahjongGameState>(() => {
        const g = createMahjongGame();
        return drawTile(g);
    });
    const [selectedTile, setSelectedTile] = useState<number | null>(null);
    const [autoPlaying, setAutoPlaying] = useState(false);

    const restart = useCallback(() => {
        const g = createMahjongGame();
        setGame(drawTile(g));
        setSelectedTile(null);
        setAutoPlaying(false);
    }, []);

    const handleDiscard = useCallback(() => {
        if (selectedTile === null || game.currentPlayer !== 0) return;
        setGame(discardTile(game, selectedTile));
        setSelectedTile(null);
    }, [selectedTile, game]);

    const handleTileClick = useCallback((tileId: number) => {
        if (game.currentPlayer !== 0 || game.phase === 'FINISHED') return;

        if (selectedTile === tileId) {
            // Double click to discard
            setGame(discardTile(game, tileId));
            setSelectedTile(null);
        } else {
            setSelectedTile(tileId);
        }
    }, [game, selectedTile]);

    const handleAction = useCallback((action: 'hu' | 'peng' | 'gang' | 'skip') => {
        if (!game.pendingAction) return;
        if (action === 'peng' && game.lastDiscard) {
            setGame(executePeng(game, 0 as PlayerIndex));
        } else if (action === 'hu') {
            setGame(prev => ({ ...prev, phase: 'FINISHED', winner: 0 as PlayerIndex }));
        } else {
            const nextPlayer = ((game.lastDiscardBy! + 1) % 4) as PlayerIndex;
            setGame(prev => ({ ...prev, currentPlayer: nextPlayer, phase: 'PLAYING', pendingAction: null }));
        }
    }, [game]);

    // AI turns
    useEffect(() => {
        if (game.phase === 'FINISHED' || game.phase === 'WAITING_ACTION') return;
        if (game.currentPlayer === 0) return;
        setAutoPlaying(true);
        const timer = setTimeout(() => {
            let state = game;
            state = drawTile(state);
            if (state.phase === 'FINISHED') { setGame(state); setAutoPlaying(false); return; }
            const tileId = aiDiscard(state.hands[state.currentPlayer]);
            state = discardTile(state, tileId);
            if (state.phase === 'WAITING_ACTION') { setGame(state); setAutoPlaying(false); return; }
            setGame(state);
            setAutoPlaying(false);
        }, 400 + Math.random() * 300);
        return () => clearTimeout(timer);
    }, [game.currentPlayer, game.phase]);

    // Auto-draw for human
    useEffect(() => {
        if (game.currentPlayer !== 0 || game.phase !== 'PLAYING') return;
        if (game.hands[0].length >= 14) return;
        const timer = setTimeout(() => { setGame(prev => drawTile(prev)); }, 200);
        return () => clearTimeout(timer);
    }, [game.currentPlayer, game.phase, game.hands[0]?.length]);

    const statusText = useMemo(() => {
        if (game.phase === 'FINISHED') {
            if (game.isDraw) return t.mj_draw ?? '流局';
            if (game.winner === 0) return '🎉 胡了！';
            return `${playerName(game.winner!, t.mj_you ?? '你')} 胡了`;
        }
        if (game.phase === 'WAITING_ACTION') return '选择操作';
        if (game.currentPlayer === 0) return t.mj_yourTurn ?? '轮到你出牌';
        return t.mj_thinking ?? '思考中...';
    }, [game.phase, game.winner, game.isDraw, game.currentPlayer, t]);

    return (
        <div
            className="fixed inset-0 z-50 flex flex-col text-gray-100"
            style={{
                paddingTop: 'env(safe-area-inset-top)',
                paddingBottom: 'env(safe-area-inset-bottom)',
                background: 'radial-gradient(ellipse at 50% 40%, #1a3a2e 0%, #0e2a1c 50%, #081a10 100%)',
            }}
        >
            {/* Subtle felt texture */}
            <div className="absolute inset-0 opacity-[0.02]" style={{
                backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'20\' height=\'20\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Ccircle cx=\'10\' cy=\'10\' r=\'0.5\' fill=\'white\'/%3E%3C/svg%3E")',
            }} />

            {/* Header */}
            <header className="relative z-10 flex items-center justify-between px-4 py-2 shrink-0">
                <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg transition-colors">
                    <ArrowLeft size={20} className="text-emerald-200" />
                </button>
                <h1 className="text-base font-bold text-emerald-100">{t.mj_title ?? '四人麻将'}</h1>
                <button onClick={restart} className="p-2 hover:bg-white/10 rounded-lg transition-colors">
                    <RotateCcw size={18} className="text-emerald-200" />
                </button>
            </header>

            {/* Status bar */}
            <div className="relative z-10 text-center py-1 shrink-0">
                <span className={`inline-flex items-center gap-2 px-4 py-1 rounded-full text-sm font-semibold border ${game.phase === 'FINISHED'
                    ? game.winner === 0
                        ? 'bg-green-500/20 text-green-200 border-green-500/30'
                        : 'bg-red-500/20 text-red-200 border-red-500/30'
                    : game.phase === 'WAITING_ACTION'
                        ? 'bg-yellow-500/20 text-yellow-200 border-yellow-500/30 animate-pulse'
                        : 'bg-black/20 text-emerald-200 border-emerald-500/20'
                    }`}>
                    {statusText}
                </span>
                <span className="ml-2 text-[10px] text-emerald-400/40">余 {game.wall.length} 张</span>
            </div>

            {/* Table area */}
            <div className="relative z-10 flex-1 flex flex-col justify-between px-3 overflow-hidden min-h-0">
                {/* Top player (seat 2) */}
                <div className="py-1 shrink-0">
                    <OpponentPanel index={2 as PlayerIndex} game={game} position="top" />
                </div>

                {/* Middle row: left player, center, right player */}
                <div className="flex items-center justify-between flex-1 min-h-0">
                    {/* Left player (seat 3) */}
                    <OpponentPanel index={3 as PlayerIndex} game={game} position="left" />

                    {/* Center discard area */}
                    <div className="flex-1 flex flex-col items-center justify-center gap-2 px-3">
                        {/* Last discard highlight */}
                        {game.lastDiscard && (
                            <div className="flex flex-col items-center gap-1">
                                <span className="text-[10px] text-emerald-400/50">
                                    {playerName(game.lastDiscardBy! as PlayerIndex, t.mj_you ?? '你')} 打出
                                </span>
                                <TileView label={tileShort(game.lastDiscard)} highlight />
                            </div>
                        )}

                        {/* Recent discards pool */}
                        <div className="flex flex-wrap justify-center gap-0.5 max-h-16 overflow-hidden px-4">
                            {[...game.discards[0], ...game.discards[1], ...game.discards[2], ...game.discards[3]]
                                .slice(-16)
                                .map((tile, i) => (
                                    <TileView key={i} label={tileShort(tile)} small dimmed />
                                ))}
                        </div>
                    </div>

                    {/* Right player (seat 1) */}
                    <OpponentPanel index={1 as PlayerIndex} game={game} position="right" />
                </div>
            </div>

            {/* Player hand (bottom) */}
            <div className="relative z-10 shrink-0 px-2 pb-2">
                {/* Player melds */}
                {game.melds[0].length > 0 && (
                    <div className="flex gap-2 mb-1.5 justify-center">
                        {game.melds[0].map((meld, mi) => (
                            <div key={mi} className="flex gap-0.5 px-1.5 py-1 rounded-lg bg-emerald-800/30 border border-emerald-600/20">
                                {meld.tiles.map((tile, ti) => (
                                    <TileView key={ti} label={tileShort(tile)} small />
                                ))}
                            </div>
                        ))}
                    </div>
                )}

                {/* Hand tiles */}
                <div className="flex flex-wrap justify-center gap-0.5 mb-2">
                    {sortHand(game.hands[0]).map(tile => (
                        <TileView
                            key={tile.id}
                            label={tileShort(tile)}
                            selected={selectedTile === tile.id}
                            onClick={() => handleTileClick(tile.id)}
                        />
                    ))}
                </div>

                {/* Action buttons */}
                <div className="flex justify-center gap-2">
                    {game.phase === 'WAITING_ACTION' && game.pendingAction && (
                        <>
                            {game.pendingAction.options.includes('hu') && (
                                <button onClick={() => handleAction('hu')}
                                    className="px-5 py-2 rounded-xl bg-gradient-to-r from-red-500 to-rose-500 text-white text-sm font-bold shadow-md shadow-red-500/20 hover:from-red-400 hover:to-rose-400 active:scale-95 transition-all">
                                    🀄 {t.mj_hu ?? '胡'}
                                </button>
                            )}
                            {game.pendingAction.options.includes('peng') && (
                                <button onClick={() => handleAction('peng')}
                                    className="px-5 py-2 rounded-xl bg-gradient-to-r from-yellow-500 to-amber-500 text-gray-900 text-sm font-bold shadow-md shadow-yellow-500/20 hover:from-yellow-400 hover:to-amber-400 active:scale-95 transition-all">
                                    🔥 {t.mj_peng ?? '碰'}
                                </button>
                            )}
                            {game.pendingAction.options.includes('gang') && (
                                <button onClick={() => handleAction('gang')}
                                    className="px-5 py-2 rounded-xl bg-gradient-to-r from-purple-500 to-violet-500 text-white text-sm font-bold shadow-md shadow-purple-500/20 hover:from-purple-400 hover:to-violet-400 active:scale-95 transition-all">
                                    💎 {t.mj_gang ?? '杠'}
                                </button>
                            )}
                            <button onClick={() => handleAction('skip')}
                                className="px-5 py-2 rounded-xl bg-white/10 text-gray-300 text-sm font-medium hover:bg-white/15 active:scale-95 transition-all">
                                {t.mj_skip ?? '过'}
                            </button>
                        </>
                    )}

                    {game.phase === 'PLAYING' && game.currentPlayer === 0 && selectedTile !== null && (
                        <button onClick={handleDiscard}
                            className="px-8 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-green-500 text-white text-sm font-bold shadow-md shadow-emerald-500/20 hover:from-emerald-400 hover:to-green-400 active:scale-95 transition-all">
                            出牌
                        </button>
                    )}

                    {game.phase === 'FINISHED' && (
                        <button onClick={restart}
                            className="px-8 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-green-500 text-white text-sm font-bold shadow-md shadow-emerald-500/20 hover:from-emerald-400 hover:to-green-400 active:scale-95 transition-all">
                            {t.mj_playAgain ?? '再来一局'}
                        </button>
                    )}
                </div>
            </div>
            {game.phase === 'FINISHED' && game.winner === 0 && <VictoryConfetti />}
        </div>
    );
}
