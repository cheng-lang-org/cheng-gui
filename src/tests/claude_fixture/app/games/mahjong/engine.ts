// ──────────────────────────────────────────────
//  四人麻将 (Mahjong) Engine
// ──────────────────────────────────────────────

// Tile suits
export type Suit = 'wan' | 'tiao' | 'tong' | 'feng' | 'jian';
// 万 (characters), 条 (bamboo), 筒 (dots), 风 (winds), 箭 (dragons)

export interface Tile {
    suit: Suit;
    value: number; // 1-9 for wan/tiao/tong, 1-4 for feng (东南西北), 1-3 for jian (中发白)
    id: number;    // unique ID
}

export type PlayerIndex = 0 | 1 | 2 | 3;

export interface MeldSet {
    type: 'peng' | 'gang' | 'chi';
    tiles: Tile[];
}

export type GamePhase = 'PLAYING' | 'WAITING_ACTION' | 'FINISHED';

export interface MahjongGameState {
    hands: Tile[][];        // 4 players' hands
    melds: MeldSet[][];     // 4 players' exposed melds
    discards: Tile[][];     // 4 players' discard piles
    wall: Tile[];           // remaining wall tiles
    currentPlayer: PlayerIndex;
    phase: GamePhase;
    lastDiscard: Tile | null;
    lastDiscardBy: PlayerIndex | null;
    winner: PlayerIndex | null;
    isDraw: boolean;
    pendingAction: {
        player: PlayerIndex;
        options: ('hu' | 'peng' | 'gang' | 'skip')[];
    } | null;
    playerIndex: PlayerIndex; // human player
}

// ── Tile labels ──────────────────────────────

const SUIT_NAMES: Record<Suit, string[]> = {
    wan: ['一万', '二万', '三万', '四万', '五万', '六万', '七万', '八万', '九万'],
    tiao: ['一条', '二条', '三条', '四条', '五条', '六条', '七条', '八条', '九条'],
    tong: ['一筒', '二筒', '三筒', '四筒', '五筒', '六筒', '七筒', '八筒', '九筒'],
    feng: ['东', '南', '西', '北'],
    jian: ['中', '发', '白'],
};

export function tileLabel(tile: Tile): string {
    return SUIT_NAMES[tile.suit][tile.value - 1] ?? '?';
}

export function tileShort(tile: Tile): string {
    if (tile.suit === 'wan') return `${tile.value}万`;
    if (tile.suit === 'tiao') return `${tile.value}条`;
    if (tile.suit === 'tong') return `${tile.value}筒`;
    if (tile.suit === 'feng') return ['东', '南', '西', '北'][tile.value - 1];
    if (tile.suit === 'jian') return ['中', '发', '白'][tile.value - 1];
    return '?';
}

// ── Create full tile set ─────────────────────

function createAllTiles(): Tile[] {
    const tiles: Tile[] = [];
    let id = 0;
    const numbered: Suit[] = ['wan', 'tiao', 'tong'];
    for (const suit of numbered) {
        for (let v = 1; v <= 9; v++) {
            for (let copy = 0; copy < 4; copy++) {
                tiles.push({ suit, value: v, id: id++ });
            }
        }
    }
    for (let v = 1; v <= 4; v++) {
        for (let copy = 0; copy < 4; copy++) {
            tiles.push({ suit: 'feng', value: v, id: id++ });
        }
    }
    for (let v = 1; v <= 3; v++) {
        for (let copy = 0; copy < 4; copy++) {
            tiles.push({ suit: 'jian', value: v, id: id++ });
        }
    }
    return tiles; // 136 tiles
}

function shuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

export function sortHand(hand: Tile[]): Tile[] {
    const suitOrder: Record<Suit, number> = { wan: 0, tiao: 1, tong: 2, feng: 3, jian: 4 };
    return [...hand].sort((a, b) => {
        if (a.suit !== b.suit) return suitOrder[a.suit] - suitOrder[b.suit];
        return a.value - b.value;
    });
}

// ── Initialize game ──────────────────────────

export function createMahjongGame(): MahjongGameState {
    const allTiles = shuffle(createAllTiles());
    const hands: Tile[][] = [[], [], [], []];
    let idx = 0;
    // Deal 13 tiles each
    for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 13; j++) {
            hands[i].push(allTiles[idx++]);
        }
        hands[i] = sortHand(hands[i]);
    }
    const wall = allTiles.slice(idx);

    return {
        hands,
        melds: [[], [], [], []],
        discards: [[], [], [], []],
        wall,
        currentPlayer: 0,
        phase: 'PLAYING',
        lastDiscard: null,
        lastDiscardBy: null,
        winner: null,
        isDraw: false,
        pendingAction: null,
        playerIndex: 0,
    };
}

// ── Tile matching ────────────────────────────

function sameTile(a: Tile, b: Tile): boolean {
    return a.suit === b.suit && a.value === b.value;
}

function countOf(hand: Tile[], suit: Suit, value: number): number {
    return hand.filter(t => t.suit === suit && t.value === value).length;
}

// ── Win check (simplified) ───────────────────
// Check if 14 tiles form a winning hand (4 sets + 1 pair)

function canWin(tiles: Tile[]): boolean {
    if (tiles.length === 0) return true;
    if (tiles.length % 3 !== 2) return false;

    const sorted = sortHand(tiles);

    // Try each possible pair
    for (let i = 0; i < sorted.length - 1; i++) {
        if (sameTile(sorted[i], sorted[i + 1])) {
            // Try this as the pair
            const remaining = [...sorted];
            remaining.splice(i, 2);
            if (canFormSets(remaining)) return true;
        }
    }
    return false;
}

function canFormSets(tiles: Tile[]): boolean {
    if (tiles.length === 0) return true;

    const sorted = sortHand(tiles);
    const first = sorted[0];

    // Try triplet (刻子)
    if (sorted.length >= 3 && sameTile(sorted[0], sorted[1]) && sameTile(sorted[1], sorted[2])) {
        const rest = sorted.slice(3);
        if (canFormSets(rest)) return true;
    }

    // Try sequence (顺子) - only for numbered suits
    if (['wan', 'tiao', 'tong'].includes(first.suit) && first.value <= 7) {
        const idx2 = sorted.findIndex(t => t.suit === first.suit && t.value === first.value + 1);
        const idx3 = sorted.findIndex(t => t.suit === first.suit && t.value === first.value + 2);
        if (idx2 > 0 && idx3 > 0) {
            const rest = [...sorted];
            // Remove in reverse order to keep indices valid
            const indices = [0, idx2, idx3].sort((a, b) => b - a);
            for (const idx of indices) rest.splice(idx, 1);
            if (canFormSets(rest)) return true;
        }
    }

    return false;
}

// ── Check actions after a discard ────────────

export function canPeng(hand: Tile[], discard: Tile): boolean {
    return countOf(hand, discard.suit, discard.value) >= 2;
}

export function canGang(hand: Tile[], discard: Tile): boolean {
    return countOf(hand, discard.suit, discard.value) >= 3;
}

export function canHu(hand: Tile[], discard: Tile): boolean {
    return canWin([...hand, discard]);
}

// Self-drawn win (自摸)
export function canZimo(hand: Tile[]): boolean {
    return hand.length === 14 && canWin(hand);
}

// ── Draw a tile ──────────────────────────────

export function drawTile(state: MahjongGameState): MahjongGameState {
    if (state.wall.length === 0) {
        return { ...state, phase: 'FINISHED', isDraw: true };
    }

    const newWall = [...state.wall];
    const drawn = newWall.pop()!;
    const newHands = state.hands.map((h, i) =>
        i === state.currentPlayer ? sortHand([...h, drawn]) : [...h]
    );

    // Check zimo
    if (canZimo(newHands[state.currentPlayer])) {
        return {
            ...state,
            hands: newHands,
            wall: newWall,
            phase: 'FINISHED',
            winner: state.currentPlayer,
        };
    }

    return {
        ...state,
        hands: newHands,
        wall: newWall,
        phase: 'PLAYING',
    };
}

// ── Discard a tile ───────────────────────────

export function discardTile(state: MahjongGameState, tileId: number): MahjongGameState {
    const playerHand = state.hands[state.currentPlayer];
    const tileIdx = playerHand.findIndex(t => t.id === tileId);
    if (tileIdx === -1) return state;

    const discarded = playerHand[tileIdx];
    const newHand = [...playerHand];
    newHand.splice(tileIdx, 1);

    const newHands = state.hands.map((h, i) =>
        i === state.currentPlayer ? newHand : [...h]
    );

    const newDiscards = state.discards.map((d, i) =>
        i === state.currentPlayer ? [...d, discarded] : [...d]
    );

    // Check if any other player can act on this discard
    const nextPlayer = ((state.currentPlayer + 1) % 4) as PlayerIndex;
    const actions: ('hu' | 'peng' | 'gang' | 'skip')[] = [];

    // Check each other player for actions (priority: hu > gang > peng)
    for (let offset = 1; offset <= 3; offset++) {
        const p = ((state.currentPlayer + offset) % 4) as PlayerIndex;
        if (canHu(newHands[p], discarded)) actions.push('hu');
        if (canGang(newHands[p], discarded)) actions.push('gang');
        if (canPeng(newHands[p], discarded)) actions.push('peng');
    }

    // If human player can act, show options
    if (state.currentPlayer !== 0) {
        const humanActions: ('hu' | 'peng' | 'gang' | 'skip')[] = ['skip'];
        if (canHu(newHands[0], discarded)) humanActions.unshift('hu');
        if (canGang(newHands[0], discarded)) humanActions.unshift('gang');
        if (canPeng(newHands[0], discarded)) humanActions.unshift('peng');

        if (humanActions.length > 1) {
            return {
                ...state,
                hands: newHands,
                discards: newDiscards,
                lastDiscard: discarded,
                lastDiscardBy: state.currentPlayer,
                phase: 'WAITING_ACTION',
                pendingAction: { player: 0, options: humanActions },
            };
        }
    }

    return {
        ...state,
        hands: newHands,
        discards: newDiscards,
        lastDiscard: discarded,
        lastDiscardBy: state.currentPlayer,
        currentPlayer: nextPlayer,
        phase: 'PLAYING',
        pendingAction: null,
    };
}

// ── Execute peng ─────────────────────────────

export function executePeng(state: MahjongGameState, player: PlayerIndex): MahjongGameState {
    if (!state.lastDiscard) return state;

    const hand = [...state.hands[player]];
    const discard = state.lastDiscard;

    // Remove 2 matching tiles from hand
    const matchIndices: number[] = [];
    for (let i = 0; i < hand.length && matchIndices.length < 2; i++) {
        if (sameTile(hand[i], discard)) matchIndices.push(i);
    }
    if (matchIndices.length < 2) return state;

    const removed = matchIndices.map(i => hand[i]);
    // Remove in reverse order
    for (let i = matchIndices.length - 1; i >= 0; i--) {
        hand.splice(matchIndices[i], 1);
    }

    const meldTiles = [...removed, discard];
    const newMelds = state.melds.map((m, i) =>
        i === player ? [...m, { type: 'peng' as const, tiles: meldTiles }] : [...m]
    );
    const newHands = state.hands.map((h, i) => i === player ? hand : [...h]);

    // Remove from discard pile of the player who discarded
    const newDiscards = state.discards.map((d, i) => {
        if (i === state.lastDiscardBy) {
            const copy = [...d];
            copy.pop();
            return copy;
        }
        return [...d];
    });

    return {
        ...state,
        hands: newHands,
        melds: newMelds,
        discards: newDiscards,
        currentPlayer: player,
        phase: 'PLAYING',
        lastDiscard: null,
        lastDiscardBy: null,
        pendingAction: null,
    };
}

// ── Shanten Calculation (Improvement) ────────

/**
 * Calculate Shanten (Xiangting) number - standard 4 melds + 1 pair
 * Returns minimum tiles needed to win.
 * 0 = Tenpai (Ready), -1 = Agari (Win)
 */
function calculateShanten(tiles: Tile[]): number {
    const counts = new Map<string, number>();
    for (const t of tiles) {
        const key = `${t.suit}-${t.value}`;
        counts.set(key, (counts.get(key) || 0) + 1);
    }

    let minShanten = 8; // Max start is 8

    // We need to form 4 sets (Mentsu) + 1 pair (Jantou)
    // Use recursion to find max sets + max pairs

    // Simplified recursive checker
    // State: (sets, pairs, taatsus)

    // Group tiles by suit for easier processing
    const suitTiles: Record<Suit, number[]> = { wan: [], tiao: [], tong: [], feng: [], jian: [] };
    for (const t of tiles) suitTiles[t.suit].push(t.value);
    for (const s in suitTiles) suitTiles[s as Suit].sort((a, b) => a - b);

    let totalSets = 0;
    let totalPairs = 0; // potential pairs
    let totalTaatsus = 0; // potential sets (2 cards)

    // Analyze each suit independently (valid since suits don't mix)
    // This is a heuristic simplification for speed. Full backtracking is O(N!)

    for (const s of ['wan', 'tiao', 'tong', 'feng', 'jian'] as Suit[]) {
        const values = suitTiles[s];
        const res = analyzeSuit(values, s === 'feng' || s === 'jian');
        totalSets += res.sets;
        totalPairs += res.pairs;
        totalTaatsus += res.taatsus;
    }

    // Adjust for standard form (4 sets + 1 pair)
    // We can use at most 4 sets
    // A pair is useful if we don't have one yet
    // Taatsus are useful up to fill the 4-set quota

    // Start with 8
    // Each set reduces shanten by 2
    // Each taatsu reduces shanten by 1
    // A pair reduces shanten by 1 (if we don't have sets using it?)
    // This heuristic is tricky. Standard formula:
    // shanten = 8 - 2*sets - taatsus - pairs (if pair exists)

    // Let's rely on a simpler counting:
    // Need 4 sets + 1 pair.
    // effective_mentsu = sets + taatsus (max 4)
    // has_pair = pairs > 0 ? 1 : 0
    // shanten = 8 - 2*sets - taatsus(capped) - has_pair...

    // Actually, let's implement a simplified visual check AI instead of full shanten
    // Priority:
    // 1. Keep formed Sets
    // 2. Keep pairs (if < 2 pairs)
    // 3. Keep Taatsus (connected neighbors)
    // 4. Discard isolated winds/dragons
    // 5. Discard isolated terminals (1, 9)
    // 6. Discard isolated simple tiles

    // The previous aiDiscard was RANDOM. We will upgrade it to "Isolated Tile Discard"
    // Which is already better.

    return 0; // placeholder, not used in simple v2
}

interface SuitAnalysis { sets: number; pairs: number; taatsus: number; isolated: number[] }

function analyzeSuit(values: number[], isHonor: boolean): SuitAnalysis {
    // Greedy analysis: matching sets first
    let v = [...values];
    let sets = 0;

    // Find triplets
    let i = 0;
    while (i < v.length - 2) {
        if (v[i] === v[i + 1] && v[i] === v[i + 2]) {
            sets++;
            v.splice(i, 3);
        } else {
            i++;
        }
    }

    // Find sequences (if not honor)
    if (!isHonor) {
        i = 0;
        while (i < v.length) {
            const val = v[i];
            const i2 = v.indexOf(val + 1);
            const i3 = v.indexOf(val + 2);
            if (i2 !== -1 && i3 !== -1) {
                sets++;
                // Remove the 3 tiles carefully
                // We need to remove specifically the ones we found indices for, adjusting indices
                // To be safe, just remove first occurrence of val, val+1, val+2
                v.splice(v.indexOf(val), 1);
                v.splice(v.indexOf(val + 1), 1);
                v.splice(v.indexOf(val + 2), 1);
                i = 0; // restart scan
            } else {
                i++;
            }
        }
    }

    // Find pairs
    let pairs = 0;
    i = 0;
    while (i < v.length - 1) {
        if (v[i] === v[i + 1]) {
            pairs++;
            v.splice(i, 2);
        } else {
            i++;
        }
    }

    // Find taatsus (neighbors)
    let taatsus = 0;
    if (!isHonor) {
        i = 0;
        while (i < v.length - 1) {
            if (v[i + 1] - v[i] === 1 || v[i + 1] - v[i] === 2) {
                taatsus++;
                v.splice(i, 2);
            } else {
                i++;
            }
        }
    }

    return { sets, pairs, taatsus, isolated: v };
}

// ── AI logic (Smart Efficiency) ──────────────

/**
 * Score a hand based on tile efficiency.
 * Higher score = better hand structure.
 */
function evaluateHand(hand: Tile[]): number {
    const suitTiles: Record<Suit, number[]> = { wan: [], tiao: [], tong: [], feng: [], jian: [] };
    for (const t of hand) suitTiles[t.suit].push(t.value);
    for (const s in suitTiles) suitTiles[s as Suit].sort((a, b) => a - b);

    let score = 0;

    for (const s of ['wan', 'tiao', 'tong', 'feng', 'jian'] as Suit[]) {
        const isHonor = s === 'feng' || s === 'jian';
        const res = analyzeSuit(suitTiles[s], isHonor);

        score += res.sets * 100;
        score += res.pairs * 20;
        score += res.taatsus * 10;

        // Penalize isolated tiles
        // Honors are worse if isolated
        if (isHonor) {
            score -= res.isolated.length * 5;
        } else {
            // Terminals (1,9) are worse than central (2-8)
            for (const val of res.isolated) {
                if (val === 1 || val === 9) score -= 4;
                else score -= 2;
            }
        }
    }
    return score;
}

export function aiDiscard(hand: Tile[]): number {
    // Strategy: Simulate discarding each tile, maximize resulting score
    let bestDiscardId = -1;
    let maxScore = -Infinity;

    // Only check unique tiles to save time (opt)
    const uniqueIds = new Set<number>();

    // Group by value to avoid testing identical tiles multiple times
    // But we need to return specific ID.
    // Let's just iterate all, n=14 is small.

    for (let i = 0; i < hand.length; i++) {
        const testHand = [...hand];
        testHand.splice(i, 1);

        const score = evaluateHand(testHand);
        // Add tiny random factor to break ties unpredictably
        const fuzzyScore = score + Math.random();

        if (fuzzyScore > maxScore) {
            maxScore = fuzzyScore;
            bestDiscardId = hand[i].id;
        }
    }

    return bestDiscardId;
}

export function aiShouldPeng(hand: Tile[], discard: Tile): boolean {
    // Only Peng if it improves hand structure score OR creates a set
    // Peng always creates a set, but it costs a pair+discard.
    // If we have 2, Peng makes it a Set (good).
    // But does it destroy a sequence possibility?

    // Calculate score BEFORE peng (with discard added hypothetically to form pair?) - no, compare current state variants.
    // Easier: Compare (Hand with Pairs) vs (Hand with Set - 1 tile).
    // Actually simpler: AI loves to Peng if it has a pair, unless it's breaking a finished hand?
    // Let's be reasonably aggressive: 60% chance to Peng if valid.

    // For smart AI: Calculate score if we SKIP (hand + drawn tile later?) vs PENG (hand - 2 + exposed).
    // Short heuristic: Only peng if it doesn't break a Sequence.
    // Since analyzeSuit prioritizes Triplets over Sequences, Peng fits our logic.
    return Math.random() > 0.3; // Keep aggressive for bots to make game interesting
}

// ── Player names ─────────────────────────────

export function playerName(index: PlayerIndex, youLabel: string): string {
    const names = [youLabel, '东家', '南家', '西家'];
    return names[index];
}
