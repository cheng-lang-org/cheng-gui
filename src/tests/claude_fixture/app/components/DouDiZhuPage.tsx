import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ArrowLeft, Crown, RotateCcw, User } from 'lucide-react';
import VictoryConfetti from './VictoryConfetti';
import { useLocale } from '../i18n/LocaleContext';
import {
    type Card,
    type GameState,
    type HandResult,
    HandType,
    Rank,
    Suit,
    cardLabel,
    suitColor,
    deal,
    sortCards,
    classifyHand,
    canBeat,
    createInitialState,
    aiSelectPlay,
    aiBid,
} from '../games/doudizhu/engine';

// ── Props ────────────────────────────────────

interface Props { onClose: () => void; }

// ── Premium Card component ───────────────────

function CardView({
    card, selected, onClick, faceDown = false, small = false, animationDelay, style,
}: {
    card: Card; selected?: boolean; onClick?: () => void;
    faceDown?: boolean; small?: boolean; animationDelay?: string; style?: React.CSSProperties;
}) {
    const color = suitColor(card);
    const label = cardLabel(card);
    const isJoker = card.suit === Suit.Joker;
    const isBigJoker = isJoker && card.rank === Rank.BigJoker;
    const isSmallJoker = isJoker && card.rank === Rank.SmallJoker;

    if (faceDown) {
        return (
            <div className={`
                ${small ? 'w-7 h-10' : 'w-11 h-[62px]'} rounded-lg
                bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800
                border border-blue-400/30 shadow-md
                flex items-center justify-center
            `}>
                <div className="w-[60%] h-[60%] rounded border border-blue-400/20 flex items-center justify-center">
                    <span className="text-blue-300/50 text-[8px] font-bold">♠</span>
                </div>
            </div>
        );
    }

    return (
        <button
            onClick={onClick}
            style={{
                animation: animationDelay ? 'deal-enter 0.4s cubic-bezier(0.2, 0.8, 0.2, 1) backwards' : 'none',
                animationDelay,
                ...style,
            }}
            className={`
                ${small ? 'w-7 h-10 text-[10px]' : 'w-11 h-[62px] text-sm'}
                rounded-lg border shadow-sm flex flex-col items-start justify-start p-0.5
                transition-transform duration-150 select-none cursor-pointer relative overflow-hidden will-change-transform
                ${selected
                    ? 'border-yellow-400 -translate-y-3 bg-yellow-50 ring-1 ring-yellow-300'
                    : 'border-gray-200/80 bg-gradient-to-b from-white to-gray-50 active:-translate-y-0.5'}
                ${isBigJoker ? '!bg-gradient-to-b !from-red-50 !to-red-100 !border-red-300' : ''}
                ${isSmallJoker ? '!bg-gradient-to-b !from-gray-50 !to-gray-100 !border-gray-300' : ''}
            `}
        >
            {/* Corner Index */}
            <div className="flex flex-col items-center gap-0 leading-none w-4">
                {isJoker ? (
                    <>
                        <span className={`text-[10px] font-black writing-vertical-rl ${isBigJoker ? 'text-red-500' : 'text-gray-600'}`}>
                            {isBigJoker ? 'J' : 'j'}
                        </span>
                    </>
                ) : (
                    <>
                        <span className={`font-black tracking-tighter ${color === 'red' ? 'text-red-600' : 'text-gray-800'}`}>
                            {label.slice(1)}
                        </span>
                        <span className={`text-[10px] -mt-[2px] ${color === 'red' ? 'text-red-500' : 'text-gray-500'}`}>
                            {label[0]}
                        </span>
                    </>
                )}
            </div>

            {/* Center Decoration (Watermark) */}
            <div className="absolute right-0.5 bottom-0.5 opacity-20 pointer-events-none">
                <span className={`text-2xl ${color === 'red' ? 'text-red-500' : 'text-gray-800'}`}>
                    {isJoker ? '🃏' : label[0]}
                </span>
            </div>
        </button>
    );
}

const MemoizedCardView = React.memo(CardView);

// ── Player Avatar ────────────────────────────

function PlayerAvatar({ name, isLandlord, cardCount, isActive, position }: {
    name: string; isLandlord: boolean; cardCount: number;
    isActive: boolean; position: 'left' | 'right';
}) {
    return (
        <div className={`flex flex-col items-center gap-1.5 ${position === 'left' ? 'items-start' : 'items-end'}`}>
            {/* Avatar circle */}
            <div className={`
                relative w-10 h-10 rounded-full flex items-center justify-center
                ${isActive
                    ? 'bg-gradient-to-br from-yellow-400 to-amber-500 shadow-lg shadow-yellow-500/30 animate-pulse'
                    : 'bg-gradient-to-br from-gray-600 to-gray-700'}
                border-2 ${isActive ? 'border-yellow-300' : 'border-gray-500'}
            `}>
                <User size={18} className="text-white" />
                {isLandlord && (
                    <div className="absolute -top-1 -right-1 w-5 h-5 bg-yellow-400 rounded-full flex items-center justify-center shadow-md">
                        <Crown size={10} className="text-yellow-800" />
                    </div>
                )}
            </div>

            {/* Name + count */}
            <div className={`text-center ${position === 'left' ? 'text-left' : 'text-right'}`}>
                <p className={`text-xs font-semibold ${isActive ? 'text-yellow-300' : 'text-green-200/80'}`}>
                    {name}
                </p>
                <p className="text-[10px] text-green-400/60">{cardCount} 张</p>
            </div>

            {/* Card backs */}
            <div className={`flex gap-px flex-wrap ${position === 'left' ? 'justify-start' : 'justify-end'} max-w-[80px]`}>
                {Array.from({ length: Math.min(cardCount, 10) }).map((_, i) => (
                    <div key={i} className="w-2.5 h-3.5 rounded-sm bg-blue-700/60 border border-blue-500/30" />
                ))}
                {cardCount > 10 && <span className="text-[8px] text-green-400/40">+{cardCount - 10}</span>}
            </div>
        </div>
    );
}

// ── Main component ───────────────────────────

const BOT_NAMES = ['电脑A', '电脑B'];
const AI_DELAY = 800;

export default function DouDiZhuPage({ onClose }: Props) {
    const { t } = useLocale();
    const [game, setGame] = useState<GameState>(createInitialState());
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
    const [message, setMessage] = useState('');
    const [isDealing, setIsDealing] = useState(false);
    const [windowWidth, setWindowWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1200);

    // Track window width for responsive layout
    useEffect(() => {
        const handleResize = () => setWindowWidth(window.innerWidth);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const myIndex = 0;
    const myHand = game.players[myIndex]?.hand ?? [];

    // Calculate dynamic spacing for hand cards
    const cardSpacing = useMemo(() => {
        const cardWidth = 44; // w-11 = 44px
        const containerPadding = 32; // px-4 approx
        const maxWidth = Math.min(windowWidth - containerPadding, 800);
        const count = myHand.length;
        if (count <= 1) return 0;

        const maxVisibleStrip = 35;
        const neededWidth = (count - 1) * maxVisibleStrip + cardWidth;

        if (neededWidth <= maxWidth) {
            return maxVisibleStrip - cardWidth;
        }

        const visibleStrip = (maxWidth - cardWidth) / (count - 1);
        return visibleStrip - cardWidth;
    }, [windowWidth, myHand.length]);
    const isMyTurn = game.currentTurn === myIndex && game.phase === 'PLAYING';
    const isBidding = game.phase === 'BIDDING' && game.currentTurn === myIndex;

    // ── Start game ───────────────────────────
    const startGame = useCallback(() => {
        const d = deal();
        const state: GameState = {
            ...createInitialState(),
            phase: 'BIDDING',
            players: [
                { id: 'me', name: t.ddz_you ?? '你', hand: d.hands[0], role: 'farmer', bid: -1, ready: true },
                { id: 'bot-a', name: BOT_NAMES[0], hand: d.hands[1], role: 'farmer', bid: -1, ready: true },
                { id: 'bot-b', name: BOT_NAMES[1], hand: d.hands[2], role: 'farmer', bid: -1, ready: true },
            ],
            bonus: d.bonus,
            currentTurn: Math.floor(Math.random() * 3),
            bidRound: 0,
            highestBid: 0,
            highestBidder: -1,
        };
        setGame(state);
        setSelectedIds(new Set());
        setMessage('');
        setIsDealing(true);
        setTimeout(() => setIsDealing(false), 2000);
    }, [t]);

    useEffect(() => { startGame(); }, [startGame]);

    // ── AI turn ──────────────────────────────
    useEffect(() => {
        if (game.phase === 'BIDDING' && game.currentTurn !== myIndex) {
            const timer = setTimeout(() => {
                setGame(prev => {
                    const p = prev.players[prev.currentTurn];
                    const bidValue = aiBid(p.hand, prev.highestBid);
                    const newPlayers = prev.players.map((pl, i) =>
                        i === prev.currentTurn ? { ...pl, bid: bidValue } : pl
                    );
                    let next: GameState = {
                        ...prev, players: newPlayers,
                        highestBid: bidValue > prev.highestBid ? bidValue : prev.highestBid,
                        highestBidder: bidValue > prev.highestBid ? prev.currentTurn : prev.highestBidder,
                        bidRound: prev.bidRound + 1,
                    };
                    if (next.bidRound >= 3) next = finalizeBidding(next);
                    else next.currentTurn = (prev.currentTurn + 1) % 3;
                    return next;
                });
            }, AI_DELAY);
            return () => clearTimeout(timer);
        }

        if (game.phase === 'PLAYING' && game.currentTurn !== myIndex) {
            const timer = setTimeout(() => {
                setGame(prev => {
                    const p = prev.players[prev.currentTurn];
                    const isNewRound = prev.passCount >= 2;
                    // New AI signature: aiSelectPlay(playerIndex, state)
                    const played = aiSelectPlay(prev.currentTurn, prev);
                    if (played.length === 0) {
                        return {
                            ...prev, passCount: prev.passCount + 1,
                            currentTurn: (prev.currentTurn + 1) % 3,
                            lastPlay: prev.passCount + 1 >= 2 ? null : prev.lastPlay,
                        };
                    }
                    const result = classifyHand(played);
                    const playedIds = new Set(played.map(c => c.id));
                    const newHand = p.hand.filter(c => !playedIds.has(c.id));
                    const newPlayers = prev.players.map((pl, i) =>
                        i === prev.currentTurn ? { ...pl, hand: newHand } : pl
                    );
                    if (newHand.length === 0) {
                        return {
                            ...prev, players: newPlayers,
                            lastPlay: { cards: played, playerIndex: prev.currentTurn, result },
                            phase: 'FINISHED' as const, winner: prev.currentTurn, passCount: 0,
                        };
                    }
                    return {
                        ...prev, players: newPlayers,
                        lastPlay: { cards: played, playerIndex: prev.currentTurn, result },
                        passCount: 0, currentTurn: (prev.currentTurn + 1) % 3,
                    };
                });
            }, AI_DELAY);
            return () => clearTimeout(timer);
        }
    }, [game.phase, game.currentTurn, game.bidRound, myIndex]);

    // ── Bidding finalization ──────────────────
    function finalizeBidding(state: GameState): GameState {
        const landlordIdx = state.highestBidder >= 0 ? state.highestBidder : Math.floor(Math.random() * 3);
        const landlordHand = sortCards([...state.players[landlordIdx].hand, ...state.bonus]);
        const newPlayers = state.players.map((p, i) => ({
            ...p,
            hand: i === landlordIdx ? landlordHand : p.hand,
            role: (i === landlordIdx ? 'landlord' : 'farmer') as 'landlord' | 'farmer',
        }));
        return {
            ...state, phase: 'PLAYING', players: newPlayers,
            landlordIndex: landlordIdx, currentTurn: landlordIdx,
            lastPlay: null, passCount: 0,
        };
    }

    // ── Player actions ───────────────────────
    const handleBid = (value: number) => {
        setGame(prev => {
            const newPlayers = prev.players.map((p, i) => i === myIndex ? { ...p, bid: value } : p);
            let next: GameState = {
                ...prev, players: newPlayers,
                highestBid: value > prev.highestBid ? value : prev.highestBid,
                highestBidder: value > prev.highestBid ? myIndex : prev.highestBidder,
                bidRound: prev.bidRound + 1, currentTurn: (prev.currentTurn + 1) % 3,
            };
            if (next.bidRound >= 3) next = finalizeBidding(next);
            return next;
        });
    };

    const toggleCard = (id: number) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    };

    const handlePlay = () => {
        const cards = myHand.filter(c => selectedIds.has(c.id));
        if (cards.length === 0) return;
        const result = classifyHand(cards);
        if (result.type === HandType.Invalid) { setMessage(t.ddz_invalidHand ?? '无效牌型'); return; }
        const isNewRound = game.passCount >= 2 || !game.lastPlay;
        if (!isNewRound && game.lastPlay && !canBeat(game.lastPlay.result, result)) {
            setMessage(t.ddz_cantBeat ?? '打不过上家'); return;
        }
        const playedIds = new Set(cards.map(c => c.id));
        const newHand = myHand.filter(c => !playedIds.has(c.id));
        setGame(prev => {
            const newPlayers = prev.players.map((p, i) => i === myIndex ? { ...p, hand: newHand } : p);
            if (newHand.length === 0) {
                return { ...prev, players: newPlayers, lastPlay: { cards, playerIndex: myIndex, result }, phase: 'FINISHED' as const, winner: myIndex, passCount: 0 };
            }
            return { ...prev, players: newPlayers, lastPlay: { cards, playerIndex: myIndex, result }, passCount: 0, currentTurn: (prev.currentTurn + 1) % 3 };
        });
        setSelectedIds(new Set());
        setMessage('');
    };

    const handlePass = () => {
        if (!game.lastPlay || game.passCount >= 2) { setMessage(t.ddz_mustPlay ?? '你必须出牌'); return; }
        setGame(prev => ({
            ...prev, passCount: prev.passCount + 1,
            currentTurn: (prev.currentTurn + 1) % 3,
            lastPlay: prev.passCount + 1 >= 2 ? null : prev.lastPlay,
        }));
        setSelectedIds(new Set());
        setMessage('');
    };

    // ── Derived ──────────────────────────────
    const leftPlayer = game.players[1];
    const rightPlayer = game.players[2];

    const winnerMessage = useMemo(() => {
        if (game.phase !== 'FINISHED' || game.winner === null) return '';
        if (game.winner === myIndex) return t.ddz_youWin ?? '🎉 你赢了！';
        return `${game.players[game.winner]?.name ?? '?'} ${t.ddz_wins ?? '赢了'}`;
    }, [game.phase, game.winner, game.players, myIndex, t]);

    // ── Render ────────────────────────────────
    return (
        <div
            className="fixed inset-0 z-50 flex flex-col overflow-hidden"
            style={{
                paddingTop: 'env(safe-area-inset-top, 0px)',
                paddingBottom: 'env(safe-area-inset-bottom, 0px)',
                background: 'radial-gradient(ellipse at 50% 40%, #1a4a2e 0%, #0f2e1a 50%, #081a0f 100%)',
            }}
        >
            {/* Felt texture overlay */}
            <div className="absolute inset-0 opacity-[0.03]" style={{
                backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'40\' height=\'40\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cpath d=\'M0 0h40v40H0z\' fill=\'none\'/%3E%3Ccircle cx=\'20\' cy=\'20\' r=\'1\' fill=\'white\'/%3E%3C/svg%3E")',
            }} />

            {/* Header */}
            <header className="relative z-10 flex items-center justify-between px-4 py-2 shrink-0">
                <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg transition-colors">
                    <ArrowLeft size={20} className="text-green-200" />
                </button>
                <div className="flex items-center gap-2">
                    <h1 className="text-base font-bold text-green-100">{t.ddz_title ?? '斗地主'}</h1>
                    {game.phase === 'PLAYING' && game.players[myIndex]?.role === 'landlord' && (
                        <span className="px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-300 text-[10px] font-bold border border-yellow-500/30">
                            👑 地主
                        </span>
                    )}
                    {game.phase === 'PLAYING' && game.players[myIndex]?.role === 'farmer' && (
                        <span className="px-2 py-0.5 rounded-full bg-green-500/20 text-green-300 text-[10px] font-bold border border-green-500/30">
                            🌾 农民
                        </span>
                    )}
                </div>
                <button onClick={startGame} className="p-2 hover:bg-white/10 rounded-lg transition-colors">
                    <RotateCcw size={18} className="text-green-200" />
                </button>
            </header>

            {/* Main table */}
            <div className="relative z-10 flex-1 flex flex-col min-h-0">
                {/* Opponents row */}
                <div className="flex items-start justify-between px-3 pt-1 shrink-0">
                    {/* Left player */}
                    <PlayerAvatar
                        name={leftPlayer?.name ?? '...'}
                        isLandlord={leftPlayer?.role === 'landlord'}
                        cardCount={leftPlayer?.hand.length ?? 0}
                        isActive={game.currentTurn === 1 && game.phase === 'PLAYING'}
                        position="left"
                    />

                    {/* Bonus cards */}
                    {game.phase !== 'WAITING' && (
                        <div className="flex flex-col items-center gap-1">
                            <span className="text-[10px] text-green-400/50 font-medium">底牌</span>
                            <div className="flex items-center gap-1">
                                {game.bonus.map(card => (
                                    <CardView key={card.id} card={card} small faceDown={game.phase === 'BIDDING'} />
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Right player */}
                    <PlayerAvatar
                        name={rightPlayer?.name ?? '...'}
                        isLandlord={rightPlayer?.role === 'landlord'}
                        cardCount={rightPlayer?.hand.length ?? 0}
                        isActive={game.currentTurn === 2 && game.phase === 'PLAYING'}
                        position="right"
                    />
                </div>

                {/* Center play area */}
                <div className="flex-1 flex items-center justify-center px-4">
                    {/* OPTIMIZED: Removed backdrop-blur-sm, used solid semi-transparent bg. Added will-change-transform. */}
                    <div className="w-full max-w-sm min-h-[120px] rounded-2xl bg-green-900/80 border border-green-600/30 flex flex-col items-center justify-center p-4 gap-2 shadow-sm will-change-transform">
                        {/* Bidding */}
                        {game.phase === 'BIDDING' && (
                            <div className="text-center space-y-3">
                                <div className="text-sm text-green-300/80 font-medium">
                                    {game.currentTurn === myIndex
                                        ? (t.ddz_yourBid ?? '轮到你叫分')
                                        : `${game.players[game.currentTurn]?.name ?? '...'} ${t.ddz_thinking ?? '思考中...'}`}
                                </div>
                                {game.highestBid > 0 && (
                                    <div className="text-xs text-yellow-300/60">当前最高：{game.highestBid} 分</div>
                                )}
                                {game.currentTurn === myIndex && (
                                    <div className="flex items-center gap-2 justify-center">
                                        <button onClick={() => handleBid(0)}
                                            className="px-4 py-2 rounded-xl bg-white/10 text-gray-300 text-sm font-medium hover:bg-white/15 active:scale-95 transition-all">
                                            {t.ddz_noBid ?? '不叫'}
                                        </button>
                                        {[1, 2, 3].filter(v => v > game.highestBid).map(v => (
                                            <button key={v} onClick={() => handleBid(v)}
                                                className="px-4 py-2 rounded-xl bg-gradient-to-r from-yellow-500 to-amber-500 text-gray-900 text-sm font-bold hover:from-yellow-400 hover:to-amber-400 active:scale-95 transition-all shadow-md shadow-yellow-500/20">
                                                {v === 3 ? '👑 抢地主' : `${v} 分`}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Last played cards */}
                        {game.phase === 'PLAYING' && game.lastPlay && (
                            <div className="text-center space-y-1.5">
                                <p className="text-[10px] text-green-400/60 font-medium">
                                    {game.players[game.lastPlay.playerIndex]?.name ?? '?'}
                                </p>
                                <div className="flex items-center gap-0.5 justify-center flex-wrap">
                                    {game.lastPlay.cards.map(card => (
                                        <CardView key={card.id} card={card} small />
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Turn indicator */}
                        {game.phase === 'PLAYING' && !game.lastPlay && (
                            <p className="text-sm text-green-400/60 font-medium">
                                {game.currentTurn === myIndex
                                    ? (t.ddz_yourTurn ?? '轮到你出牌')
                                    : `${game.players[game.currentTurn]?.name ?? '...'} ${t.ddz_thinking ?? '思考中...'}`}
                            </p>
                        )}

                        {game.phase === 'PLAYING' && game.lastPlay && (
                            <p className="text-[10px] text-green-400/40 mt-1">
                                {game.currentTurn === myIndex
                                    ? `⬇️ ${t.ddz_yourTurn ?? '轮到你'}`
                                    : `${game.players[game.currentTurn]?.name ?? '...'} ${t.ddz_thinking ?? '思考中...'}`}
                            </p>
                        )}

                        {/* Finished */}
                        {game.phase === 'FINISHED' && (
                            <div className="text-center space-y-3">
                                <p className="text-2xl font-bold">{winnerMessage}</p>
                                <p className="text-xs text-green-300/60">
                                    {game.winner !== null && game.players[game.winner]?.role === 'landlord'
                                        ? '👑 地主获胜' : '🌾 农民获胜'}
                                </p>
                                <button onClick={startGame}
                                    className="px-6 py-2 rounded-xl bg-gradient-to-r from-yellow-500 to-amber-500 text-gray-900 font-bold text-sm shadow-lg shadow-yellow-500/20 hover:from-yellow-400 hover:to-amber-400 active:scale-95 transition-all">
                                    {t.ddz_playAgain ?? '再来一局'}
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* Message toast */}
                {message && (
                    <div className="absolute bottom-[160px] left-1/2 -translate-x-1/2 z-20 px-4 py-2 bg-red-500/90 text-white text-xs rounded-xl shadow-lg backdrop-blur-sm border border-red-400/30">
                        {message}
                    </div>
                )}

                {/* Bottom: hand + controls */}
                <div className="shrink-0 pb-2 px-2">
                    {/* Role badge */}
                    {game.phase === 'PLAYING' && (
                        <div className="flex items-center justify-center gap-3 mb-1.5">
                            <span className="text-[10px] text-green-400/60">{myHand.length} 张</span>
                        </div>
                    )}

                    {/* Action buttons */}
                    {isMyTurn && (
                        <div className="flex items-center justify-center gap-3 mb-2">
                            <button onClick={handlePass}
                                disabled={!game.lastPlay || game.passCount >= 2}
                                className="px-5 py-2 rounded-xl bg-white/10 text-gray-300 text-sm font-medium hover:bg-white/15 active:scale-95 transition-all disabled:opacity-30 disabled:active:scale-100">
                                {t.ddz_pass ?? '不出'}
                            </button>
                            <button onClick={handlePlay}
                                disabled={selectedIds.size === 0}
                                className="px-6 py-2 rounded-xl bg-gradient-to-r from-yellow-500 to-amber-500 text-gray-900 text-sm font-bold shadow-md shadow-yellow-500/20 hover:from-yellow-400 hover:to-amber-400 active:scale-95 transition-all disabled:opacity-30 disabled:active:scale-100">
                                {t.ddz_play ?? '出牌'}
                            </button>
                        </div>
                    )}

                    {/* Card fan - Dynamic Spacing */}
                    <div className="flex items-end justify-center pb-1 px-2 h-[72px] relative w-full">
                        <div className="flex items-end transition-all duration-300 ease-out" style={{ height: '100%' }}>
                            {myHand.map((card, i) => (
                                <CardView
                                    key={card.id}
                                    card={card}
                                    selected={selectedIds.has(card.id)}
                                    onClick={() => isMyTurn && toggleCard(card.id)}
                                    animationDelay={isDealing ? `${i * 0.05}s` : undefined}
                                    style={{ marginLeft: i === 0 ? 0 : cardSpacing }}
                                />
                            ))}
                        </div>
                    </div>
                </div>
            </div>
            {game.phase === 'FINISHED' && game.winner === myIndex && <VictoryConfetti />}
            <style>{`
                @keyframes deal-enter {
                    from { opacity: 0; transform: translateY(50%) scale(0.8); }
                    to { opacity: 1; transform: translateY(0) scale(1); }
                }
            `}</style>
        </div>
    );
}
