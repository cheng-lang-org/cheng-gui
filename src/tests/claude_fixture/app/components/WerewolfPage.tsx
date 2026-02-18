import { useState, useCallback, useMemo } from 'react';
import { ArrowLeft, RotateCcw, Moon, Sun, Skull, Eye, Shield } from 'lucide-react';
import VictoryConfetti from './VictoryConfetti';
import { useLocale } from '../i18n/LocaleContext';
import {
    type WerewolfGameState, type Player, type Role,
    createWerewolfGame, confirmRole, wolfKill, seerCheck,
    witchAct, proceedToVote, dayVote, aiVote,
    roleName, roleEmoji, alivePlayers,
} from '../games/werewolf/engine';

interface Props { onClose: () => void; }

// ── Player avatars / colors per seat ─────────
const SEAT_COLORS = [
    'from-blue-500 to-blue-600',    // 0 - you
    'from-amber-500 to-amber-600',  // 1
    'from-emerald-500 to-emerald-600', // 2
    'from-rose-500 to-rose-600',    // 3
    'from-violet-500 to-violet-600', // 4
    'from-cyan-500 to-cyan-600',    // 5
    'from-orange-500 to-orange-600', // 6
    'from-pink-500 to-pink-600',    // 7
    'from-teal-500 to-teal-600',    // 8
];

const ROLE_COLOR: Record<Role, string> = {
    werewolf: 'text-red-400',
    villager: 'text-blue-300',
    seer: 'text-purple-300',
    witch: 'text-green-300',
    hunter: 'text-amber-300',
};

// ── Is night phase ───────────────────────────
function isNight(phase: string): boolean {
    return phase.startsWith('NIGHT_') || phase === 'ROLE_REVEAL';
}

// ── Player Card Component ────────────────────
function PlayerCard({ player, selected, onClick, showRole, isTarget, isDead, compact }: {
    player: Player;
    selected?: boolean;
    onClick?: () => void;
    showRole?: boolean;
    isTarget?: boolean;
    isDead?: boolean;
    compact?: boolean;
}) {
    const dead = isDead ?? !player.alive;
    return (
        <button
            onClick={onClick}
            disabled={dead && !onClick}
            className={`
        relative flex flex-col items-center gap-1 rounded-xl transition-all duration-200
        ${compact ? 'p-1.5 min-w-[52px]' : 'p-2.5 min-w-[64px]'}
        ${dead ? 'opacity-40 grayscale' : 'hover:scale-105 active:scale-95'}
        ${selected ? 'ring-2 ring-yellow-400 bg-yellow-400/10 shadow-lg shadow-yellow-400/20' : 'bg-white/5 hover:bg-white/10'}
        ${isTarget ? 'ring-2 ring-red-500 bg-red-500/10' : ''}
      `}
        >
            {/* Avatar circle */}
            <div className={`
        ${compact ? 'w-8 h-8 text-xs' : 'w-10 h-10 text-sm'}
        rounded-full bg-gradient-to-br ${SEAT_COLORS[player.id] ?? SEAT_COLORS[0]}
        flex items-center justify-center font-bold text-white shadow-md
        ${dead ? 'relative' : ''}
      `}>
                {dead ? <Skull size={compact ? 14 : 16} className="text-white/80" /> : (player.isHuman ? '你' : player.id + 1)}
            </div>

            {/* Name */}
            <span className={`${compact ? 'text-[10px]' : 'text-xs'} font-medium ${dead ? 'line-through text-gray-500' : 'text-gray-300'}`}>
                {player.isHuman ? '你' : `玩家${player.id + 1}`}
            </span>

            {/* Role badge (shown when game ends or for self) */}
            {showRole && (
                <span className={`text-[10px] font-bold ${ROLE_COLOR[player.role]}`}>
                    {roleEmoji(player.role)} {roleName(player.role)}
                </span>
            )}

            {/* Dead marker */}
            {dead && (
                <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-8 h-[2px] bg-red-500/60 rotate-45 absolute" />
                </div>
            )}
        </button>
    );
}

// ── Main Component ───────────────────────────
export default function WerewolfPage({ onClose }: Props) {
    const { t } = useLocale();
    const [game, setGame] = useState<WerewolfGameState>(createWerewolfGame());
    const [selectedTarget, setSelectedTarget] = useState<number | null>(null);
    const [poisonTarget, setPoisonTarget] = useState<number | null>(null);
    const [showPoisonPicker, setShowPoisonPicker] = useState(false);
    const [isRevealed, setIsRevealed] = useState(false);

    const human = game.players[game.humanId];
    const alive = alivePlayers(game);
    const night = isNight(game.phase);

    const restart = useCallback(() => {
        setGame(createWerewolfGame());
        setSelectedTarget(null);
        setPoisonTarget(null);
        setShowPoisonPicker(false);
        setIsRevealed(false);
    }, []);

    // ── Background based on phase ──────────────
    const bgClass = night
        ? 'from-[#0a0a1a] via-[#0f0e2a] to-[#0a0a1a]'
        : game.phase === 'FINISHED'
            ? game.winner === 'wolf' ? 'from-red-950 via-gray-950 to-red-950' : 'from-blue-950 via-gray-950 to-blue-950'
            : 'from-[#1a1520] via-[#1e1a30] to-[#1a1520]';

    // ── Phase icon & title ─────────────────────
    const phaseInfo = useMemo(() => {
        switch (game.phase) {
            case 'ROLE_REVEAL': return { icon: <Eye size={16} />, text: t.ww_roleReveal ?? '身份揭晓', color: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30' };
            case 'NIGHT_WOLF': return { icon: <Moon size={16} />, text: `🐺 ${t.ww_nightWolf ?? '狼人行动'}`, color: 'bg-red-500/20 text-red-300 border-red-500/30' };
            case 'NIGHT_SEER': return { icon: <Eye size={16} />, text: `🔮 ${t.ww_nightSeer ?? '预言家行动'}`, color: 'bg-purple-500/20 text-purple-300 border-purple-500/30' };
            case 'NIGHT_WITCH': return { icon: <Shield size={16} />, text: `🧙‍♀️ ${t.ww_nightWitch ?? '女巫行动'}`, color: 'bg-green-500/20 text-green-300 border-green-500/30' };
            case 'DAY_ANNOUNCE': return { icon: <Sun size={16} />, text: `☀️ ${t.ww_dayAnnounce ?? '天亮了'}`, color: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30' };
            case 'DAY_VOTE': return { icon: <Sun size={16} />, text: `🗳️ ${t.ww_dayVote ?? '投票处决'}`, color: 'bg-orange-500/20 text-orange-300 border-orange-500/30' };
            case 'FINISHED': return {
                icon: game.winner === 'wolf' ? <Moon size={16} /> : <Sun size={16} />,
                text: game.winner === 'wolf' ? (t.ww_wolfWin ?? '🐺 狼人获胜') : (t.ww_villageWin ?? '🏠 好人获胜'),
                color: game.winner === 'wolf' ? 'bg-red-500/20 text-red-300 border-red-500/30' : 'bg-green-500/20 text-green-300 border-green-500/30',
            };
            default: return { icon: null, text: '', color: '' };
        }
    }, [game.phase, game.winner, t]);

    // ── Role Reveal ────────────────────────────
    const renderRoleReveal = () => (
        <div className="flex flex-col items-center gap-8 animate-fadeIn" style={{ perspective: '1000px' }}>
            {/* 3D Card */}
            <div
                className={`relative w-56 h-80 transition-transform duration-700 cursor-pointer`}
                style={{ transformStyle: 'preserve-3d', transform: isRevealed ? 'rotateY(180deg)' : 'rotateY(0deg)' }}
                onClick={() => !isRevealed && setIsRevealed(true)}
            >
                {/* Front (Back of card) */}
                <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-indigo-950 to-purple-950 border-2 border-indigo-500/30 shadow-2xl flex items-center justify-center backface-hidden">
                    <div className="w-48 h-72 border border-indigo-500/20 rounded-xl flex items-center justify-center bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMSIgY3k9IjEiIHI9IjEiIGZpbGw9InJnYmEoMjU1LDI1NSwyNTUsMC4wNSkiLz48L3N2Zz4=')]">
                        <div className="w-24 h-24 rounded-full bg-indigo-500/10 flex items-center justify-center border border-indigo-500/30">
                            <span className="text-4xl opacity-50 grayscale">🐺</span>
                        </div>
                    </div>
                    <p className="absolute bottom-6 text-xs text-indigo-300/40 animate-pulse tracking-widest">点击查看身份</p>
                </div>

                {/* Back (Role Content) */}
                <div
                    className="absolute inset-0 rounded-2xl bg-gradient-to-br from-indigo-900/90 to-purple-900/90 border-2 border-indigo-400 shadow-2xl flex flex-col items-center justify-center gap-3 backdrop-blur-sm backface-hidden"
                    style={{ transform: 'rotateY(180deg)' }}
                >
                    <div className="absolute inset-0 rounded-2xl bg-[radial-gradient(ellipse_at_center,rgba(99,102,241,0.15),transparent_70%)]" />
                    <span className="text-6xl" style={{ filter: 'drop-shadow(0 0 12px rgba(255,255,255,0.3))' }}>
                        {roleEmoji(human.role)}
                    </span>
                    <div className="text-center z-10">
                        <p className="text-xs text-indigo-300/70 mb-1">{t.ww_youAre ?? '你的身份是'}</p>
                        <p className={`text-3xl font-bold ${ROLE_COLOR[human.role]}`}>{roleName(human.role)}</p>
                    </div>
                    {/* Decorative corners */}
                    <div className="absolute top-3 left-3 w-4 h-4 border-t-2 border-l-2 border-indigo-400/40 rounded-tl-md" />
                    <div className="absolute top-3 right-3 w-4 h-4 border-t-2 border-r-2 border-indigo-400/40 rounded-tr-md" />
                    <div className="absolute bottom-3 left-3 w-4 h-4 border-b-2 border-l-2 border-indigo-400/40 rounded-bl-md" />
                    <div className="absolute bottom-3 right-3 w-4 h-4 border-b-2 border-r-2 border-indigo-400/40 rounded-br-md" />
                </div>
            </div>

            <div className={`transition-all duration-500 ${isRevealed ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'}`}>
                <button onClick={() => setGame(confirmRole(game))}
                    className="px-10 py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-bold shadow-lg shadow-indigo-500/30 hover:from-indigo-500 hover:to-purple-500 active:scale-95 transition-all flex items-center gap-2">
                    {t.ww_confirm ?? '确认身份'} <ArrowLeft size={16} className="rotate-180" />
                </button>
            </div>

            <style>{`.backface-hidden { backface-visibility: hidden; }`}</style>
        </div>
    );

    // ── Player selection grid (reusable) ───────
    const renderPlayerGrid = (
        targets: Player[],
        accent: string,
        onSelect: (id: number) => void,
        actionLabel: string,
        onAction: () => void,
    ) => (
        <div className="space-y-3">
            <div className="grid grid-cols-4 gap-2 justify-items-center">
                {targets.map(p => (
                    <PlayerCard
                        key={p.id}
                        player={p}
                        selected={selectedTarget === p.id}
                        onClick={() => { setSelectedTarget(p.id); onSelect(p.id); }}
                    />
                ))}
            </div>
            {selectedTarget !== null && (
                <button
                    onClick={onAction}
                    className={`w-full py-2.5 rounded-xl font-bold text-white shadow-lg transition-all active:scale-95 ${accent}`}
                >
                    {actionLabel} {game.players.find(p => p.id === selectedTarget)?.name.replace('你', '')}
                </button>
            )}
        </div>
    );

    // ── Night Wolf ─────────────────────────────
    const renderNightWolf = () => {
        const isWolf = human.role === 'werewolf' && human.alive;
        if (!isWolf) {
            return (
                <div className="text-center space-y-4">
                    <Moon size={40} className="mx-auto text-indigo-400/40 animate-pulse" />
                    <p className="text-gray-400 text-sm">{t.ww_waiting ?? '天黑了，闭上眼睛...'}</p>
                    <button onClick={() => setGame(wolfKill(game, -1))}
                        className="px-8 py-2 rounded-xl bg-white/10 text-gray-300 hover:bg-white/15 transition-all active:scale-95">
                        继续 →
                    </button>
                </div>
            );
        }
        const targets = alive.filter(p => p.role !== 'werewolf');
        return (
            <div className="space-y-4">
                <div className="text-center">
                    <p className="text-sm text-red-300/80 mb-1">{t.ww_selectKill ?? '选择要杀害的目标'}</p>
                    <p className="text-[11px] text-gray-500">点击选中玩家，然后确认击杀</p>
                </div>
                {renderPlayerGrid(
                    targets,
                    'bg-gradient-to-r from-red-600 to-red-700 shadow-red-500/30',
                    () => { },
                    `🔪 ${t.ww_kill ?? '击杀'}`,
                    () => { setGame(wolfKill(game, selectedTarget!)); setSelectedTarget(null); }
                )}
            </div>
        );
    };

    // ── Night Seer ─────────────────────────────
    const renderNightSeer = () => {
        const isSeer = human.role === 'seer' && human.alive;
        if (!isSeer) {
            return (
                <div className="text-center space-y-4">
                    <Moon size={40} className="mx-auto text-purple-400/40 animate-pulse" />
                    <p className="text-gray-400 text-sm">{t.ww_waiting ?? '等待中...'}</p>
                    <button onClick={() => setGame(seerCheck(game, -1))}
                        className="px-8 py-2 rounded-xl bg-white/10 text-gray-300 hover:bg-white/15 transition-all active:scale-95">
                        继续 →
                    </button>
                </div>
            );
        }

        if (game.seerResult !== null) {
            const checkedPlayer = game.players.find(p => p.id === game.seerTarget);
            return (
                <div className="text-center space-y-4">
                    <div className={`
            mx-auto w-28 h-28 rounded-2xl flex items-center justify-center text-5xl
            ${game.seerResult
                            ? 'bg-red-900/40 border-2 border-red-500/50 shadow-lg shadow-red-500/20 animate-pulse'
                            : 'bg-green-900/40 border-2 border-green-500/50 shadow-lg shadow-green-500/20'}
          `}>
                        {game.seerResult ? '🐺' : '👤'}
                    </div>
                    <div>
                        <p className="text-lg font-bold">{checkedPlayer?.name}</p>
                        <p className={`text-sm font-semibold mt-1 ${game.seerResult ? 'text-red-400' : 'text-green-400'}`}>
                            {game.seerResult ? '⚠️ 是狼人！' : '✅ 不是狼人'}
                        </p>
                    </div>
                    <button onClick={() => setGame(prev => ({ ...prev, phase: 'NIGHT_WITCH', seerResult: null }))}
                        className="px-8 py-2 rounded-xl bg-white/10 text-gray-300 hover:bg-white/15 transition-all active:scale-95">
                        知道了 →
                    </button>
                </div>
            );
        }

        const targets = alive.filter(p => p.id !== human.id);
        return (
            <div className="space-y-4">
                <div className="text-center">
                    <p className="text-sm text-purple-300/80">{t.ww_selectCheck ?? '选择要查验的目标'}</p>
                </div>
                {renderPlayerGrid(
                    targets,
                    'bg-gradient-to-r from-purple-600 to-violet-600 shadow-purple-500/30',
                    () => { },
                    `🔮 ${t.ww_check ?? '查验'}`,
                    () => { setGame(seerCheck(game, selectedTarget!)); setSelectedTarget(null); }
                )}
            </div>
        );
    };

    // ── Night Witch ────────────────────────────
    const renderNightWitch = () => {
        const isWitch = human.role === 'witch' && human.alive;
        if (!isWitch) {
            return (
                <div className="text-center space-y-4">
                    <Moon size={40} className="mx-auto text-green-400/40 animate-pulse" />
                    <p className="text-gray-400 text-sm">{t.ww_waiting ?? '等待中...'}</p>
                    <button onClick={() => setGame(witchAct(game, 'skip'))}
                        className="px-8 py-2 rounded-xl bg-white/10 text-gray-300 hover:bg-white/15 transition-all active:scale-95">
                        继续 →
                    </button>
                </div>
            );
        }

        const killedPlayer = game.wolfTarget !== null
            ? game.players.find(p => p.id === game.wolfTarget)
            : null;

        // Poison target picker
        if (showPoisonPicker) {
            const targets = alive.filter(p => p.id !== human.id);
            return (
                <div className="space-y-4">
                    <div className="text-center">
                        <p className="text-sm text-purple-300/80">选择要毒杀的目标</p>
                    </div>
                    <div className="grid grid-cols-4 gap-2 justify-items-center">
                        {targets.map(p => (
                            <PlayerCard
                                key={p.id}
                                player={p}
                                selected={poisonTarget === p.id}
                                onClick={() => setPoisonTarget(p.id)}
                            />
                        ))}
                    </div>
                    <div className="flex gap-2">
                        <button onClick={() => { setShowPoisonPicker(false); setPoisonTarget(null); }}
                            className="flex-1 py-2 rounded-xl bg-white/10 text-gray-300 hover:bg-white/15 transition-all active:scale-95">
                            取消
                        </button>
                        {poisonTarget !== null && (
                            <button onClick={() => { setGame(witchAct(game, 'poison', poisonTarget)); setShowPoisonPicker(false); setPoisonTarget(null); }}
                                className="flex-1 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-purple-700 text-white font-bold shadow-lg shadow-purple-500/30 transition-all active:scale-95">
                                ☠️ 确认毒杀
                            </button>
                        )}
                    </div>
                </div>
            );
        }

        return (
            <div className="space-y-4">
                {/* Killed announcement */}
                {killedPlayer && (
                    <div className="text-center p-4 rounded-xl bg-red-900/20 border border-red-500/20">
                        <Skull size={24} className="mx-auto text-red-400 mb-2" />
                        <p className="text-sm text-red-300">
                            <strong>{killedPlayer.name}</strong> {t.ww_beingKilled ?? '被狼人杀害了'}
                        </p>
                    </div>
                )}

                {/* Action buttons */}
                <div className="space-y-2">
                    {!game.witchSaved && killedPlayer && (
                        <button onClick={() => setGame(witchAct(game, 'save'))}
                            className="w-full py-3 rounded-xl bg-gradient-to-r from-green-600 to-emerald-600 text-white font-bold text-sm shadow-lg shadow-green-500/20 hover:from-green-500 hover:to-emerald-500 active:scale-95 transition-all flex items-center justify-center gap-2">
                            <span className="text-lg">💊</span>
                            <span>{t.ww_save ?? '使用解药'} — 救活 {killedPlayer.name}</span>
                        </button>
                    )}

                    {!game.witchPoisoned && (
                        <button onClick={() => setShowPoisonPicker(true)}
                            className="w-full py-3 rounded-xl bg-gradient-to-r from-purple-700 to-indigo-700 text-white font-bold text-sm shadow-lg shadow-purple-500/20 hover:from-purple-600 hover:to-indigo-600 active:scale-95 transition-all flex items-center justify-center gap-2">
                            <span className="text-lg">☠️</span>
                            <span>{t.ww_poison ?? '使用毒药'}</span>
                        </button>
                    )}

                    <button onClick={() => setGame(witchAct(game, 'skip'))}
                        className="w-full py-2.5 rounded-xl bg-white/10 text-gray-300 hover:bg-white/15 active:scale-95 transition-all text-sm">
                        {t.ww_skip ?? '什么都不做'} →
                    </button>
                </div>

                {/* Potions status */}
                <div className="flex justify-center gap-4 pt-2">
                    <div className={`flex items-center gap-1 text-xs ${game.witchSaved ? 'text-gray-600' : 'text-green-400'}`}>
                        💊 解药 {game.witchSaved ? '(已用)' : '(可用)'}
                    </div>
                    <div className={`flex items-center gap-1 text-xs ${game.witchPoisoned ? 'text-gray-600' : 'text-purple-400'}`}>
                        ☠️ 毒药 {game.witchPoisoned ? '(已用)' : '(可用)'}
                    </div>
                </div>
            </div>
        );
    };

    // ── Day Announce ───────────────────────────
    const renderDayAnnounce = () => (
        <div className="text-center space-y-5">
            <Sun size={48} className="mx-auto text-yellow-400/60" />
            {game.killedLastNight.length > 0 ? (
                <div className="space-y-2">
                    <p className="text-sm text-gray-400">昨晚的受害者</p>
                    {game.killedLastNight.map(id => {
                        const p = game.players.find(pl => pl.id === id);
                        return (
                            <div key={id} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-red-900/30 border border-red-500/20">
                                <Skull size={16} className="text-red-400" />
                                <span className="text-red-300 font-bold">{p?.name}</span>
                            </div>
                        );
                    })}
                </div>
            ) : (
                <div className="space-y-2">
                    <p className="text-2xl">🎉</p>
                    <p className="text-green-300 font-medium">昨晚是平安夜，无人死亡！</p>
                </div>
            )}
            <button onClick={() => setGame(proceedToVote(game))}
                className="px-8 py-2.5 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 text-white font-bold shadow-lg shadow-orange-500/30 hover:from-orange-400 hover:to-amber-400 active:scale-95 transition-all">
                🗳️ 进入投票
            </button>
        </div>
    );

    // ── Day Vote ───────────────────────────────
    const renderDayVote = () => {
        if (!human.alive) {
            return (
                <div className="text-center space-y-4">
                    <Skull size={40} className="mx-auto text-gray-500" />
                    <p className="text-gray-400 text-sm">{t.ww_youDead ?? '你已死亡，无法投票'}</p>
                    <button onClick={() => { setGame(dayVote(game, aiVote(game))); }}
                        className="px-8 py-2 rounded-xl bg-white/10 text-gray-300 hover:bg-white/15 transition-all active:scale-95">
                        继续 →
                    </button>
                </div>
            );
        }
        const targets = alive.filter(p => p.id !== human.id);
        return (
            <div className="space-y-4">
                <div className="text-center">
                    <p className="text-sm text-orange-300/80">{t.ww_selectVote ?? '投票处决一位玩家'}</p>
                    <p className="text-[11px] text-gray-500 mt-1">选出你怀疑的狼人</p>
                </div>
                {renderPlayerGrid(
                    targets,
                    'bg-gradient-to-r from-orange-500 to-amber-600 shadow-orange-500/30',
                    () => { },
                    `🗳️ ${t.ww_vote ?? '投票处决'}`,
                    () => { setGame(dayVote(game, selectedTarget!)); setSelectedTarget(null); }
                )}
            </div>
        );
    };

    // ── Finished ───────────────────────────────
    const renderFinished = () => (
        <div className="text-center space-y-5">
            <div className="text-6xl" style={{ filter: 'drop-shadow(0 0 20px rgba(255,255,255,0.2))' }}>
                {game.winner === 'wolf' ? '🐺' : '🏠'}
            </div>
            <p className="text-xl font-bold">
                {game.winner === 'wolf' ? (t.ww_wolfWin ?? '狼人获胜！') : (t.ww_villageWin ?? '好人获胜！')}
            </p>
            {((game.winner === 'wolf' && human.role === 'werewolf') || (game.winner === 'village' && human.role !== 'werewolf')) && <VictoryConfetti />}

            {/* Reveal all roles */}
            <div className="grid grid-cols-3 gap-2 pt-2">
                {game.players.map(p => (
                    <PlayerCard key={p.id} player={p} showRole compact />
                ))}
            </div>

            <button onClick={restart}
                className="px-8 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-bold shadow-lg shadow-indigo-500/30 hover:from-indigo-500 hover:to-purple-500 active:scale-95 transition-all">
                {t.ww_playAgain ?? '再来一局'}
            </button>
        </div>
    );

    // ── Phase content switch ───────────────────
    const renderPhaseContent = () => {
        switch (game.phase) {
            case 'ROLE_REVEAL': return renderRoleReveal();
            case 'NIGHT_WOLF': return renderNightWolf();
            case 'NIGHT_SEER': return renderNightSeer();
            case 'NIGHT_WITCH': return renderNightWitch();
            case 'DAY_ANNOUNCE': return renderDayAnnounce();
            case 'DAY_VOTE': return renderDayVote();
            case 'FINISHED': return renderFinished();
            default: return null;
        }
    };

    return (
        <div
            className={`fixed inset-0 z-50 flex flex-col bg-gradient-to-b ${bgClass} text-gray-100 transition-colors duration-700`}
            style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
            {/* Animated starfield for night */}
            {night && (
                <div className="absolute inset-0 pointer-events-none overflow-hidden">
                    {Array.from({ length: 20 }, (_, i) => (
                        <div
                            key={i}
                            className="absolute w-[2px] h-[2px] bg-white rounded-full animate-pulse"
                            style={{
                                left: `${(i * 37 + 13) % 100}%`,
                                top: `${(i * 23 + 7) % 60}%`,
                                animationDelay: `${i * 0.3}s`,
                                opacity: 0.3 + (i % 3) * 0.2,
                            }}
                        />
                    ))}
                </div>
            )}

            {/* Header */}
            <header className="flex items-center justify-between px-4 py-2 shrink-0 relative z-10">
                <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg transition-colors">
                    <ArrowLeft size={20} />
                </button>
                <h1 className="text-base font-bold">{t.ww_title ?? '狼人杀'}</h1>
                <button onClick={restart} className="p-2 hover:bg-white/10 rounded-lg transition-colors">
                    <RotateCcw size={18} />
                </button>
            </header>

            {/* Phase banner */}
            <div className="text-center py-2 shrink-0 relative z-10">
                <span className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-semibold border ${phaseInfo.color}`}>
                    {phaseInfo.icon}
                    第{game.day}天 · {phaseInfo.text}
                </span>
            </div>

            {/* Player seats (circular layout at top) */}
            <div className="flex justify-center gap-1.5 px-4 py-2 shrink-0 relative z-10 flex-wrap">
                {game.players.map(p => (
                    <div key={p.id}
                        className={`
              w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold
              transition-all duration-300
              ${!p.alive
                                ? 'bg-gray-800/50 border border-gray-700/50 text-gray-600'
                                : p.isHuman
                                    ? 'bg-indigo-500/30 border-2 border-indigo-400/60 text-indigo-200 shadow-sm shadow-indigo-500/20'
                                    : 'bg-white/10 border border-white/20 text-gray-300'}
            `}
                    >
                        {p.alive ? (p.isHuman ? '你' : p.id + 1) : '✕'}
                    </div>
                ))}
            </div>

            {/* Your role reminder (small badge) */}
            {game.phase !== 'ROLE_REVEAL' && game.phase !== 'FINISHED' && human.alive && (
                <div className="text-center shrink-0 relative z-10">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-black/20 border border-white/10 ${ROLE_COLOR[human.role]}`}>
                        {roleEmoji(human.role)} {roleName(human.role)}
                    </span>
                </div>
            )}

            {/* Main content */}
            <div className="flex-1 flex items-center justify-center px-5 relative z-10 overflow-y-auto">
                <div className="w-full max-w-sm py-4">
                    {renderPhaseContent()}
                </div>
            </div>

            {/* Game log */}
            <div className="shrink-0 px-4 pb-3 relative z-10">
                <details className="bg-black/30 rounded-xl border border-white/5 backdrop-blur-sm">
                    <summary className="px-3 py-2 text-xs text-gray-400 cursor-pointer flex items-center justify-between">
                        <span>📜 {t.ww_logEmpty ?? '游戏日志'}</span>
                        <span className="text-gray-600">{game.log.length}</span>
                    </summary>
                    <div className="px-3 pb-2 max-h-28 overflow-y-auto space-y-0.5">
                        {game.log.map((msg, i) => (
                            <p key={i} className="text-[11px] text-gray-500 py-0.5 border-b border-white/5 last:border-0">{msg}</p>
                        ))}
                    </div>
                </details>
            </div>

            {/* CSS animations */}
            <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fadeIn { animation: fadeIn 0.4s ease-out; }
      `}</style>
        </div>
    );
}
