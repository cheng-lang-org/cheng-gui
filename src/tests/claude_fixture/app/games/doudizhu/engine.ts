// ──────────────────────────────────────────────
//  斗地主 (Dou Di Zhu) Game Engine
// ──────────────────────────────────────────────

/** Card suit */
export enum Suit {
    Spade = 'S',
    Heart = 'H',
    Diamond = 'D',
    Club = 'C',
    Joker = 'J',
}

/** Card rank – 3 is lowest, BigJoker is highest */
export enum Rank {
    Three = 3,
    Four = 4,
    Five = 5,
    Six = 6,
    Seven = 7,
    Eight = 8,
    Nine = 9,
    Ten = 10,
    Jack = 11,
    Queen = 12,
    King = 13,
    Ace = 14,
    Two = 15,
    SmallJoker = 16,
    BigJoker = 17,
}

export interface Card {
    suit: Suit;
    rank: Rank;
    id: number; // unique 0-53
}

/** Display helpers */
const RANK_LABEL: Record<number, string> = {
    3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9',
    10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2',
    16: '🃏', 17: '🃏',
};

const SUIT_SYMBOL: Record<string, string> = {
    S: '♠', H: '♥', D: '♦', C: '♣', J: '',
};

export function cardLabel(card: Card): string {
    return `${SUIT_SYMBOL[card.suit]}${RANK_LABEL[card.rank] ?? '?'}`;
}

export function suitColor(card: Card): 'red' | 'black' {
    if (card.rank === Rank.BigJoker) return 'red';
    if (card.rank === Rank.SmallJoker) return 'black';
    return card.suit === Suit.Heart || card.suit === Suit.Diamond ? 'red' : 'black';
}

// ── Deck ──────────────────────────────────────

export function createDeck(): Card[] {
    const cards: Card[] = [];
    let id = 0;
    const suits = [Suit.Spade, Suit.Heart, Suit.Diamond, Suit.Club];
    for (const suit of suits) {
        for (let rank = Rank.Three; rank <= Rank.Two; rank++) {
            cards.push({ suit, rank, id: id++ });
        }
    }
    cards.push({ suit: Suit.Joker, rank: Rank.SmallJoker, id: id++ });
    cards.push({ suit: Suit.Joker, rank: Rank.BigJoker, id: id++ });
    return cards;
}

export function shuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

export function sortCards(cards: Card[]): Card[] {
    return [...cards].sort((a, b) => b.rank - a.rank || a.suit.localeCompare(b.suit));
}

export interface Deal {
    hands: [Card[], Card[], Card[]]; // 17 cards each
    bonus: Card[];                   // 3 landlord bonus cards
}

export function deal(): Deal {
    const deck = shuffle(createDeck());
    return {
        hands: [
            sortCards(deck.slice(0, 17)),
            sortCards(deck.slice(17, 34)),
            sortCards(deck.slice(34, 51)),
        ],
        bonus: sortCards(deck.slice(51, 54)),
    };
}

// ── Hand classification ──────────────────────

export enum HandType {
    Pass = 'PASS',
    Single = 'SINGLE',
    Pair = 'PAIR',
    Triple = 'TRIPLE',
    TriplePlusOne = 'TRIPLE_PLUS_ONE',
    TriplePlusTwo = 'TRIPLE_PLUS_TWO',
    Straight = 'STRAIGHT',         // ≥5 consecutive singles (no 2/joker)
    DoubleStraight = 'DOUBLE_STRAIGHT', // ≥3 consecutive pairs
    Airplane = 'AIRPLANE',         // ≥2 consecutive triples
    AirplanePlusWings = 'AIRPLANE_PLUS_WINGS',
    FourPlusTwo = 'FOUR_PLUS_TWO', // 4 + 2 singles or 2 pairs
    Bomb = 'BOMB',                 // 4 of a kind
    Rocket = 'ROCKET',             // both jokers
    Invalid = 'INVALID',
}

export interface HandResult {
    type: HandType;
    rank: number;    // primary rank for comparison
    length?: number; // for straights/airplanes
}

/** Count occurrences of each rank */
function countRanks(cards: Card[]): Map<number, number> {
    const counts = new Map<number, number>();
    for (const c of cards) {
        counts.set(c.rank, (counts.get(c.rank) ?? 0) + 1);
    }
    return counts;
}

/** Get sorted list of ranks that appear exactly `n` times */
function ranksWithCount(counts: Map<number, number>, n: number): number[] {
    const result: number[] = [];
    for (const [rank, count] of counts) {
        if (count === n) result.push(rank);
    }
    return result.sort((a, b) => a - b);
}

/** Check consecutive sequence (no 2 or jokers allowed) */
function isConsecutive(ranks: number[], minLen: number): boolean {
    if (ranks.length < minLen) return false;
    for (const r of ranks) {
        if (r >= Rank.Two) return false; // 2 and jokers can't be in straights
    }
    for (let i = 1; i < ranks.length; i++) {
        if (ranks[i] - ranks[i - 1] !== 1) return false;
    }
    return true;
}

export function classifyHand(cards: Card[]): HandResult {
    const n = cards.length;
    if (n === 0) return { type: HandType.Pass, rank: 0 };

    const counts = countRanks(cards);
    const uniqueRanks = counts.size;

    // Rocket: both jokers
    if (n === 2 && counts.has(Rank.SmallJoker) && counts.has(Rank.BigJoker)) {
        return { type: HandType.Rocket, rank: Rank.BigJoker };
    }

    // Single card
    if (n === 1) {
        return { type: HandType.Single, rank: cards[0].rank };
    }

    // Pair
    if (n === 2 && uniqueRanks === 1) {
        return { type: HandType.Pair, rank: cards[0].rank };
    }

    // Triple
    if (n === 3 && uniqueRanks === 1) {
        return { type: HandType.Triple, rank: cards[0].rank };
    }

    // Bomb (4 of same rank)
    if (n === 4 && uniqueRanks === 1) {
        return { type: HandType.Bomb, rank: cards[0].rank };
    }

    // Triple + 1
    if (n === 4 && uniqueRanks === 2) {
        const threes = ranksWithCount(counts, 3);
        if (threes.length === 1) {
            return { type: HandType.TriplePlusOne, rank: threes[0] };
        }
    }

    // Triple + 2 (pair)
    if (n === 5 && uniqueRanks === 2) {
        const threes = ranksWithCount(counts, 3);
        const twos = ranksWithCount(counts, 2);
        if (threes.length === 1 && twos.length === 1) {
            return { type: HandType.TriplePlusTwo, rank: threes[0] };
        }
    }

    // Four + 2 singles
    if (n === 6) {
        const fours = ranksWithCount(counts, 4);
        if (fours.length === 1) {
            return { type: HandType.FourPlusTwo, rank: fours[0] };
        }
    }

    // Four + 2 pairs
    if (n === 8) {
        const fours = ranksWithCount(counts, 4);
        const twos = ranksWithCount(counts, 2);
        if (fours.length === 1 && twos.length === 2) {
            return { type: HandType.FourPlusTwo, rank: fours[0] };
        }
    }

    // Straight (≥5 consecutive singles)
    if (n >= 5 && n <= 12 && uniqueRanks === n) {
        const sorted = [...counts.keys()].sort((a, b) => a - b);
        if (isConsecutive(sorted, 5)) {
            return { type: HandType.Straight, rank: sorted[sorted.length - 1], length: n };
        }
    }

    // Double straight (≥3 consecutive pairs, ≥6 cards)
    if (n >= 6 && n % 2 === 0) {
        const pairs = ranksWithCount(counts, 2);
        if (pairs.length === n / 2 && isConsecutive(pairs, 3)) {
            return { type: HandType.DoubleStraight, rank: pairs[pairs.length - 1], length: pairs.length };
        }
    }

    // Airplane (≥2 consecutive triples)
    const threes = ranksWithCount(counts, 3);
    if (threes.length >= 2 && isConsecutive(threes, 2)) {
        const tripleCount = threes.length;
        const kickers = n - tripleCount * 3;

        if (kickers === 0) {
            return { type: HandType.Airplane, rank: threes[threes.length - 1], length: tripleCount };
        }
        // Airplane + single wings
        if (kickers === tripleCount) {
            return { type: HandType.AirplanePlusWings, rank: threes[threes.length - 1], length: tripleCount };
        }
        // Airplane + pair wings
        if (kickers === tripleCount * 2) {
            const nonTriple = [...counts.entries()].filter(([r]) => !threes.includes(r));
            const allPairs = nonTriple.every(([, c]) => c === 2);
            if (allPairs && nonTriple.length === tripleCount) {
                return { type: HandType.AirplanePlusWings, rank: threes[threes.length - 1], length: tripleCount };
            }
        }
    }

    return { type: HandType.Invalid, rank: 0 };
}

// ── Hand comparison ──────────────────────────

export function canBeat(current: HandResult, candidate: HandResult): boolean {
    // Rocket beats everything
    if (candidate.type === HandType.Rocket) return true;
    // Bomb beats non-bomb
    if (candidate.type === HandType.Bomb && current.type !== HandType.Bomb && current.type !== HandType.Rocket) {
        return true;
    }
    // Same type comparison
    if (candidate.type === current.type) {
        // For straights/airplanes, must have same length
        if (current.length !== undefined && candidate.length !== current.length) {
            return false;
        }
        return candidate.rank > current.rank;
    }
    return false;
}

// ── Game state ───────────────────────────────

export type GamePhase = 'WAITING' | 'BIDDING' | 'PLAYING' | 'FINISHED';
export type PlayerRole = 'landlord' | 'farmer';

export interface Player {
    id: string;
    name: string;
    hand: Card[];
    role: PlayerRole;
    bid: number;
    ready: boolean;
}

export interface GameState {
    phase: GamePhase;
    players: Player[];
    landlordIndex: number;
    currentTurn: number;
    lastPlay: { cards: Card[]; playerIndex: number; result: HandResult } | null;
    passCount: number;
    bonus: Card[];
    winner: number | null; // player index
    bidRound: number;
    highestBid: number;
    highestBidder: number;
}

export function createInitialState(): GameState {
    return {
        phase: 'WAITING',
        players: [],
        landlordIndex: -1,
        currentTurn: 0,
        lastPlay: null,
        passCount: 0,
        bonus: [],
        winner: null,
        bidRound: 0,
        highestBid: 0,
        highestBidder: -1,
    };
}

// ── AI logic (Smart Rule-Based) ─────────────────

/** Break down a hand into playable structures (Greedy approach) */
interface HandComposition {
    rocket: Card[];
    bombs: Card[][];
    airplanes: Card[][];
    straights: Card[][];
    doubleStraights: Card[][];
    triples: Card[][];
    pairs: Card[][];
    singles: Card[];
}

function removeCards(source: Card[], toRemove: Card[]): Card[] {
    const removeIds = new Set(toRemove.map(c => c.id));
    return source.filter(c => !removeIds.has(c.id));
}

function decomposeHand(cards: Card[]): HandComposition {
    let current = sortCards([...cards]);
    const comp: HandComposition = {
        rocket: [], bombs: [], airplanes: [], straights: [],
        doubleStraights: [], triples: [], pairs: [], singles: []
    };

    // 1. Extract Rocket
    const smallJoker = current.find(c => c.rank === Rank.SmallJoker);
    const bigJoker = current.find(c => c.rank === Rank.BigJoker);
    if (smallJoker && bigJoker) {
        comp.rocket = [smallJoker, bigJoker];
        current = removeCards(current, comp.rocket);
    }

    // 2. Extract Bombs
    let counts = countRanks(current);
    const bombRanks = ranksWithCount(counts, 4);
    for (const r of bombRanks) {
        const bomb = current.filter(c => c.rank === r);
        comp.bombs.push(bomb);
        current = removeCards(current, bomb);
    }

    // Helper: find longer structures first
    // 3. Airplanes (Triples consecutive)
    counts = countRanks(current);
    let tripleRanks = ranksWithCount(counts, 3);
    // Try to find consecutive triples >= 2
    if (tripleRanks.length >= 2) {
        // Find sequences
        // This is a simplified check for sequences of triples
        for (let len = tripleRanks.length; len >= 2; len--) {
            for (let i = 0; i <= tripleRanks.length - len; i++) {
                const sub = tripleRanks.slice(i, i + len);
                if (isConsecutive(sub, 2)) {
                    const planeCards = current.filter(c => sub.includes(c.rank)).slice(0, len * 3);
                    // Verify we actually grabbed 3 of each? yes filter preserves order but we need strict count
                    // Actually filter returns all cards of those ranks (which are 3 each)
                    comp.airplanes.push(planeCards);
                    current = removeCards(current, planeCards);
                    // Re-evaluate counts
                    counts = countRanks(current);
                    tripleRanks = ranksWithCount(counts, 3);
                    i = -1; // reset inner loop
                    break; // restart length loop
                }
            }
        }
    }

    // 4. Double Straights (Consecutive pairs >= 3)
    counts = countRanks(current);
    let pairRanks = ranksWithCount(counts, 2).concat(ranksWithCount(counts, 3)); // 3s can be used as 2s
    pairRanks = [...new Set(pairRanks)].sort((a, b) => a - b);

    // Find longest sequences
    // (Simplification: just take the first valid double straight >= 3)
    // A better AI would try multiple permutations, but greedy is fine for now
    if (pairRanks.length >= 3) {
        // This logic is tricky, skipping for basic v2 to avoid breaking existing pairs too aggressively
        // If implemented, should ensure we don't break likely triples unless necessary
    }

    // 5. Straights (Consecutive singles >= 5)
    // Only use singles + ranks that are not vital for other structures?
    // For simplicity, let's use all ranks to find straights, but be careful not to break triples if we can avoid it
    // Current simple version: skipping deep search.

    // 6. Triples
    counts = countRanks(current);
    const triples = ranksWithCount(counts, 3);
    for (const r of triples) {
        const t = current.filter(c => c.rank === r).slice(0, 3);
        comp.triples.push(t);
        current = removeCards(current, t);
    }

    // 7. Pairs
    counts = countRanks(current);
    const pairs = ranksWithCount(counts, 2);
    for (const r of pairs) {
        const p = current.filter(c => c.rank === r).slice(0, 2);
        comp.pairs.push(p);
        current = removeCards(current, p);
    }

    // 8. Singles
    comp.singles = current;

    return comp;
}

/** 
 * Select best play using decomposition and role awareness 
 */
export function aiSelectPlay(
    playerIndex: number,
    state: GameState,
): Card[] {
    const player = state.players[playerIndex];
    if (!player) return [];

    const hand = player.hand;
    const isNewRound = state.passCount >= 2 || !state.lastPlay;
    const lastPlay = isNewRound ? null : state.lastPlay;

    // Decomposition
    const comp = decomposeHand(hand);

    // Role logic
    const isLandlord = player.role === 'landlord';
    const isTeammatePlaying = !isNewRound && lastPlay &&
        state.players[lastPlay.playerIndex].role === player.role;

    // ── SCENARIO 1: NEW ROUND (Lead) ─────────────────────
    if (isNewRound) {
        // 1. Try to dump Play Airplane/Straight (Complex)
        if (comp.airplanes.length > 0) return comp.airplanes[0]; // TODO: Add wings if possible
        if (comp.straights.length > 0) return comp.straights[0];

        // 2. Try Triple + wing (if we have a small single/pair)
        if (comp.triples.length > 0) {
            const trip = comp.triples[0];
            // Try to carry a single
            if (comp.singles.length > 0) {
                return [...trip, comp.singles[0]];
            }
            // Try to carry a pair
            if (comp.pairs.length > 0) {
                return [...trip, ...comp.pairs[0]];
            }
            return trip;
        }

        // 3. Try Pair (smallest)
        if (comp.pairs.length > 0) return comp.pairs[0];

        // 4. Try Single (smallest)
        // Avoid breaking bombs/rockets unless necessary
        // Handcomp already separated bombs/rockets, so comp.singles are safe
        if (comp.singles.length > 0) return [comp.singles[0]];

        // If we only have structures left (e.g. only a bomb), play it
        if (comp.bombs.length > 0) return comp.bombs[0];
        if (comp.rocket.length > 0) return comp.rocket;

        // Fallback (shouldn't reach here if hand > 0)
        return [hand[0]];
    }

    // ── SCENARIO 2: FOLLOWING ──────────────────────────
    const toBeat = lastPlay!.result;

    // Teammate check: If teammate played something strong, consider passing
    if (isTeammatePlaying) {
        // If teammate played a high rank or bomb, let them have it
        if (toBeat.rank > Rank.Ace || toBeat.type === HandType.Bomb || toBeat.type === HandType.Rocket) {
            return [];
        }
        // If I have very few cards, I might want to take control, otherwise support
    }

    // Try to beat with matching type first (Smallest valid)
    const validMove = findSmallestBeat(hand, toBeat, comp);
    if (validMove.length > 0) return validMove;

    // Try Bomb/Rocket if we really want to win this turn
    // (Logic: If opponent played, or teammate played low)
    if (!isTeammatePlaying) {
        // Use bomb if opponent has few cards or played high
        const oppHandCount = state.players[lastPlay!.playerIndex].hand.length;
        const isEmergency = oppHandCount <= 5;

        if (toBeat.type !== HandType.Rocket && toBeat.type !== HandType.Bomb) {
            if (comp.bombs.length > 0) return comp.bombs[0];
            if (comp.rocket.length > 0) return comp.rocket;
        }
        else if (toBeat.type === HandType.Bomb) {
            // Beat bomb with bigger bomb
            for (const b of comp.bombs) {
                if (b[0].rank > toBeat.rank) return b;
            }
            if (comp.rocket.length > 0) return comp.rocket;
        }
    }

    return [];
}

/** Find specific card combination to beat target */
function findSmallestBeat(hand: Card[], target: HandResult, comp: HandComposition): Card[] {
    // 1. Single
    if (target.type === HandType.Single) {
        // Prioritize singles list
        for (const c of comp.singles) { if (c.rank > target.rank) return [c]; }
        // Then break pairs
        for (const p of comp.pairs) { if (p[0].rank > target.rank) return [p[0]]; }
        // Then break triples? No, save triples.
        // Actually, sometimes must break
    }

    // 2. Pair
    if (target.type === HandType.Pair) {
        for (const p of comp.pairs) { if (p[0].rank > target.rank) return p; }
        // Break triples?
        for (const t of comp.triples) { if (t[0].rank > target.rank) return t.slice(0, 2); }
    }

    // 3. Triple
    if (target.type === HandType.Triple) {
        for (const t of comp.triples) { if (t[0].rank > target.rank) return t; }
    }

    // 4. Triple + One
    if (target.type === HandType.TriplePlusOne) {
        for (const t of comp.triples) {
            if (t[0].rank > target.rank) {
                // Find a trash single
                if (comp.singles.length > 0) return [...t, comp.singles[0]];
                if (comp.pairs.length > 0) return [...t, comp.pairs[0][0]];
                // Else just pass for now to simplify
            }
        }
    }

    // 5. Triple + Two
    if (target.type === HandType.TriplePlusTwo) {
        for (const t of comp.triples) {
            if (t[0].rank > target.rank) {
                if (comp.pairs.length > 0) return [...t, ...comp.pairs[0]];
            }
        }
    }

    // Default fallback: Try brute force search if structured lookup failed?
    // For now, let's keep it structured.
    // A robust search would iterate all combinations, but that's heavy.
    // Let's at least handle the basic naive search from before as a fallback
    // to ensure we don't miss obvious plays just because they are in "Bombs" or "Triples"

    // --- Fallback to brute force for simple types logic (copied/adapted from previous v1) ---
    // Single
    if (target.type === HandType.Single) {
        const sorted = sortCards(hand);
        for (let i = sorted.length - 1; i >= 0; i--) {
            if (sorted[i].rank > target.rank) return [sorted[i]];
        }
    }
    // Pair
    if (target.type === HandType.Pair) {
        const counts = countRanks(hand);
        const pairs = ranksWithCount(counts, 2).concat(ranksWithCount(counts, 3)).concat(ranksWithCount(counts, 4)).sort((a, b) => a - b);
        for (const r of pairs) { if (r > target.rank) return hand.filter(c => c.rank === r).slice(0, 2); }
    }

    return [];
}

/** AI bid decision: bid higher if hand is strong */
export function aiBid(hand: Card[], currentHighBid: number): number {
    let strength = 0;
    const counts = countRanks(hand);

    // Jokers
    if (hand.some((c) => c.rank === Rank.BigJoker)) strength += 6; // slightly higher weight
    if (hand.some((c) => c.rank === Rank.SmallJoker)) strength += 5;

    // Twos
    strength += (counts.get(Rank.Two) ?? 0) * 3;

    // Aces
    strength += (counts.get(Rank.Ace) ?? 0);

    // Bombs
    for (const [, count] of counts) {
        if (count === 4) strength += 6;
    }

    // Length of cards check (not needed for deal, always 17)

    if (strength >= 12 && currentHighBid < 3) return 3;
    if (strength >= 8 && currentHighBid < 2) return 2;
    if (strength >= 5 && currentHighBid < 1) return 1;
    return 0; // pass
}

