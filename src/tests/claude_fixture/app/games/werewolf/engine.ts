// ──────────────────────────────────────────────
//  狼人杀 (Werewolf) Engine
// ──────────────────────────────────────────────

export type Role = 'werewolf' | 'villager' | 'seer' | 'witch' | 'hunter';

export interface Player {
    id: number;
    name: string;
    role: Role;
    alive: boolean;
    isHuman: boolean;
}

export type GamePhase =
    | 'ROLE_REVEAL'
    | 'NIGHT_WOLF'
    | 'NIGHT_SEER'
    | 'NIGHT_WITCH'
    | 'DAY_ANNOUNCE'
    | 'DAY_VOTE'
    | 'FINISHED';

export interface WerewolfGameState {
    players: Player[];
    phase: GamePhase;
    day: number;
    // Night state
    wolfTarget: number | null;     // player id targeted by wolves
    seerTarget: number | null;     // player id checked by seer
    seerResult: boolean | null;    // is the seer target a wolf?
    witchSaved: boolean;           // has witch used antidote this game?
    witchPoisoned: boolean;        // has witch used poison this game?
    witchSaveTarget: number | null;
    witchPoisonTarget: number | null;
    // Day state
    killedLastNight: number[];     // player ids killed during night
    votedOut: number | null;       // player voted out today
    // Results
    winner: 'wolf' | 'village' | null;
    // Log
    log: string[];
    // Human player
    humanId: number;
}

// ── Role display names ───────────────────────

const ROLE_NAMES: Record<Role, string> = {
    werewolf: '狼人',
    villager: '村民',
    seer: '预言家',
    witch: '女巫',
    hunter: '猎人',
};

export function roleName(role: Role): string {
    return ROLE_NAMES[role];
}

const ROLE_EMOJI: Record<Role, string> = {
    werewolf: '🐺',
    villager: '👤',
    seer: '🔮',
    witch: '🧙‍♀️',
    hunter: '🎯',
};

export function roleEmoji(role: Role): string {
    return ROLE_EMOJI[role];
}

// ── Initialize game (9 players) ──────────────

function shuffleArr<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

export function createWerewolfGame(): WerewolfGameState {
    // 9 players: 3 wolves, 1 seer, 1 witch, 1 hunter, 3 villagers
    const roles: Role[] = [
        'werewolf', 'werewolf', 'werewolf',
        'seer', 'witch', 'hunter',
        'villager', 'villager', 'villager',
    ];
    const shuffled = shuffleArr(roles);
    const names = ['你', '玩家2', '玩家3', '玩家4', '玩家5', '玩家6', '玩家7', '玩家8', '玩家9'];

    const players: Player[] = shuffled.map((role, i) => ({
        id: i,
        name: names[i],
        role,
        alive: true,
        isHuman: i === 0,
    }));

    return {
        players,
        phase: 'ROLE_REVEAL',
        day: 1,
        wolfTarget: null,
        seerTarget: null,
        seerResult: null,
        witchSaved: false,
        witchPoisoned: false,
        witchSaveTarget: null,
        witchPoisonTarget: null,
        killedLastNight: [],
        votedOut: null,
        winner: null,
        log: ['游戏开始，天黑请闭眼。'],
        humanId: 0,
    };
}

// ── Helpers ──────────────────────────────────

export function alivePlayers(state: WerewolfGameState): Player[] {
    return state.players.filter(p => p.alive);
}

export function aliveWolves(state: WerewolfGameState): Player[] {
    return state.players.filter(p => p.alive && p.role === 'werewolf');
}

export function aliveVillagers(state: WerewolfGameState): Player[] {
    return state.players.filter(p => p.alive && p.role !== 'werewolf');
}

function getHuman(state: WerewolfGameState): Player {
    return state.players[state.humanId];
}

// ── Win condition check ──────────────────────

export function checkWin(state: WerewolfGameState): 'wolf' | 'village' | null {
    const wolves = aliveWolves(state).length;
    const villagers = aliveVillagers(state).length;
    if (wolves === 0) return 'village';
    if (wolves >= villagers) return 'wolf';
    return null;
}

// ── Confirm role reveal ──────────────────────

export function confirmRole(state: WerewolfGameState): WerewolfGameState {
    return { ...state, phase: 'NIGHT_WOLF' };
}

// ── Night: Wolf kills ────────────────────────

export function wolfKill(state: WerewolfGameState, targetId: number): WerewolfGameState {
    const human = getHuman(state);
    const isHumanWolf = human.role === 'werewolf' && human.alive;

    let target = targetId;
    if (!isHumanWolf) {
        // AI wolves pick a random non-wolf alive player
        const targets = alivePlayers(state).filter(p => p.role !== 'werewolf');
        if (targets.length > 0) {
            target = targets[Math.floor(Math.random() * targets.length)].id;
        }
    }

    return {
        ...state,
        wolfTarget: target,
        phase: 'NIGHT_SEER',
        log: [...state.log, `第${state.day}夜：狼人选择了目标。`],
    };
}

// ── Night: Seer checks ──────────────────────

export function seerCheck(state: WerewolfGameState, targetId: number): WerewolfGameState {
    const human = getHuman(state);
    const isHumanSeer = human.role === 'seer' && human.alive;

    let target = targetId;
    let result = false;

    if (isHumanSeer) {
        const p = state.players.find(pl => pl.id === targetId);
        result = p?.role === 'werewolf';
    } else {
        // AI seer picks randomly
        const seer = state.players.find(p => p.role === 'seer' && p.alive);
        if (seer) {
            const targets = alivePlayers(state).filter(p => p.id !== seer.id);
            const pick = targets[Math.floor(Math.random() * targets.length)];
            if (pick) {
                target = pick.id;
                result = pick.role === 'werewolf';
            }
        }
    }

    return {
        ...state,
        seerTarget: target,
        seerResult: result,
        phase: 'NIGHT_WITCH',
    };
}

// ── Night: Witch acts ───────────────────────

export function witchAct(
    state: WerewolfGameState,
    action: 'save' | 'poison' | 'skip',
    poisonTarget?: number
): WerewolfGameState {
    let witchSaved = state.witchSaved;
    let witchPoisoned = state.witchPoisoned;
    let witchSaveTarget = state.witchSaveTarget;
    let witchPoisonTarget = state.witchPoisonTarget;

    const human = getHuman(state);
    const isHumanWitch = human.role === 'witch' && human.alive;

    if (isHumanWitch) {
        if (action === 'save' && !witchSaved && state.wolfTarget !== null) {
            witchSaved = true;
            witchSaveTarget = state.wolfTarget;
        } else if (action === 'poison' && !witchPoisoned && poisonTarget !== undefined) {
            witchPoisoned = true;
            witchPoisonTarget = poisonTarget;
        }
    } else {
        // AI witch logic
        const witch = state.players.find(p => p.role === 'witch' && p.alive);
        if (witch) {
            if (!witchSaved && state.wolfTarget !== null && Math.random() > 0.5) {
                witchSaved = true;
                witchSaveTarget = state.wolfTarget;
            }
        }
    }

    // Resolve night
    const killed: number[] = [];
    if (state.wolfTarget !== null && witchSaveTarget !== state.wolfTarget) {
        killed.push(state.wolfTarget);
    }
    if (witchPoisonTarget !== null) {
        killed.push(witchPoisonTarget);
    }

    // Kill players
    const newPlayers = state.players.map(p =>
        killed.includes(p.id) ? { ...p, alive: false } : { ...p }
    );

    const killedNames = killed.map(id => newPlayers.find(p => p.id === id)?.name ?? '?');
    const logMsg = killed.length > 0
        ? `第${state.day}天：昨晚 ${killedNames.join('、')} 被杀害。`
        : `第${state.day}天：昨晚无人死亡。`;

    const newState: WerewolfGameState = {
        ...state,
        players: newPlayers,
        witchSaved,
        witchPoisoned,
        witchSaveTarget,
        witchPoisonTarget,
        killedLastNight: killed,
        phase: 'DAY_ANNOUNCE',
        log: [...state.log, logMsg],
    };

    // Check win
    const winner = checkWin(newState);
    if (winner) {
        return {
            ...newState,
            phase: 'FINISHED',
            winner,
            log: [...newState.log, winner === 'wolf' ? '🐺 狼人获胜！' : '🏠 好人获胜！'],
        };
    }

    return newState;
}

// ── Day: Vote ────────────────────────────────

export function dayVote(state: WerewolfGameState, targetId: number): WerewolfGameState {
    const target = state.players.find(p => p.id === targetId);
    if (!target || !target.alive) return state;

    const newPlayers = state.players.map(p =>
        p.id === targetId ? { ...p, alive: false } : { ...p }
    );

    const logMsg = `第${state.day}天：${target.name} 被投票处决。`;

    const newState: WerewolfGameState = {
        ...state,
        players: newPlayers,
        votedOut: targetId,
        log: [...state.log, logMsg],
    };

    // Check win
    const winner = checkWin(newState);
    if (winner) {
        return {
            ...newState,
            phase: 'FINISHED',
            winner,
            log: [...newState.log, winner === 'wolf' ? '🐺 狼人获胜！' : '🏠 好人获胜！'],
        };
    }

    // Go to next night
    return {
        ...newState,
        phase: 'NIGHT_WOLF',
        day: state.day + 1,
        wolfTarget: null,
        seerTarget: null,
        seerResult: null,
        witchSaveTarget: null,
        witchPoisonTarget: null,
        killedLastNight: [],
        votedOut: null,
    };
}

// ── Proceed to vote phase ────────────────────

export function proceedToVote(state: WerewolfGameState): WerewolfGameState {
    return { ...state, phase: 'DAY_VOTE' };
}

// ── AI vote (wolves vote together against villagers, villagers random) ──

export function aiVote(state: WerewolfGameState): number {
    const alive = alivePlayers(state);
    // Simple: random alive player (not self)
    const candidates = alive.filter(p => !p.isHuman);
    if (candidates.length > 0) {
        return candidates[Math.floor(Math.random() * candidates.length)].id;
    }
    return alive[0].id;
}
