// ──────────────────────────────────────────────
//  中国象棋 (Chinese Chess / Xiangqi) Engine
// ──────────────────────────────────────────────

export type PieceType = 'king' | 'advisor' | 'elephant' | 'horse' | 'rook' | 'cannon' | 'pawn';
export type Side = 'red' | 'black';

export interface Piece {
    type: PieceType;
    side: Side;
}

export interface Position {
    row: number; // 0-9 (0=top=black side)
    col: number; // 0-8
}

// Serialization for WASM
export function serializeBoard(board: Board): number[] {
    const flat = new Array(90).fill(0);
    for (let r = 0; r < 10; r++) {
        for (let c = 0; c < 9; c++) {
            const p = board[r][c];
            if (p) {
                let val = 0;
                switch (p.type) {
                    case 'king': val = 1; break;
                    case 'advisor': val = 2; break;
                    case 'elephant': val = 3; break;
                    case 'horse': val = 4; break;
                    case 'rook': val = 5; break;
                    case 'cannon': val = 6; break;
                    case 'pawn': val = 7; break;
                }
                if (p.side === 'black') val += 7;
                flat[r * 9 + c] = val;
            }
        }
    }
    return flat;
}

export type Board = (Piece | null)[][];    // 10 rows × 9 cols

export interface Move {
    from: Position;
    to: Position;
    captured?: Piece;
}

export type GamePhase = 'PLAYING' | 'FINISHED';

export interface ChessGameState {
    board: Board;
    currentSide: Side;
    phase: GamePhase;
    winner: Side | null;
    moveHistory: Move[];
    selectedPos: Position | null;
    check: boolean;
}

// ── Piece labels ─────────────────────────────

const RED_LABELS: Record<PieceType, string> = {
    king: '帅', advisor: '仕', elephant: '相', horse: '馬',
    rook: '車', cannon: '炮', pawn: '兵',
};

const BLACK_LABELS: Record<PieceType, string> = {
    king: '将', advisor: '士', elephant: '象', horse: '馬',
    rook: '車', cannon: '砲', pawn: '卒',
};

export function pieceLabel(piece: Piece): string {
    return piece.side === 'red' ? RED_LABELS[piece.type] : BLACK_LABELS[piece.type];
}

// ── Initial board ────────────────────────────

export function createInitialBoard(): Board {
    const board: Board = Array.from({ length: 10 }, () => Array(9).fill(null));

    // Black pieces (top, rows 0-4)
    const b = (type: PieceType): Piece => ({ type, side: 'black' });
    board[0][0] = b('rook'); board[0][1] = b('horse'); board[0][2] = b('elephant');
    board[0][3] = b('advisor'); board[0][4] = b('king'); board[0][5] = b('advisor');
    board[0][6] = b('elephant'); board[0][7] = b('horse'); board[0][8] = b('rook');
    board[2][1] = b('cannon'); board[2][7] = b('cannon');
    board[3][0] = b('pawn'); board[3][2] = b('pawn'); board[3][4] = b('pawn');
    board[3][6] = b('pawn'); board[3][8] = b('pawn');

    // Red pieces (bottom, rows 5-9)
    const r = (type: PieceType): Piece => ({ type, side: 'red' });
    board[9][0] = r('rook'); board[9][1] = r('horse'); board[9][2] = r('elephant');
    board[9][3] = r('advisor'); board[9][4] = r('king'); board[9][5] = r('advisor');
    board[9][6] = r('elephant'); board[9][7] = r('horse'); board[9][8] = r('rook');
    board[7][1] = r('cannon'); board[7][7] = r('cannon');
    board[6][0] = r('pawn'); board[6][2] = r('pawn'); board[6][4] = r('pawn');
    board[6][6] = r('pawn'); board[6][8] = r('pawn');

    return board;
}

export function createChessGame(): ChessGameState {
    return {
        board: createInitialBoard(),
        currentSide: 'red',
        phase: 'PLAYING',
        winner: null,
        moveHistory: [],
        selectedPos: null,
        check: false,
    };
}

// ── Board helpers ────────────────────────────

function inBounds(r: number, c: number): boolean {
    return r >= 0 && r <= 9 && c >= 0 && c <= 8;
}

function getPiece(board: Board, pos: Position): Piece | null {
    return board[pos.row]?.[pos.col] ?? null;
}

function cloneBoard(board: Board): Board {
    return board.map(row => [...row]);
}

// Number of pieces between two positions on same row/col
function countBetween(board: Board, from: Position, to: Position): number {
    let count = 0;
    if (from.row === to.row) {
        const minC = Math.min(from.col, to.col) + 1;
        const maxC = Math.max(from.col, to.col);
        for (let c = minC; c < maxC; c++) {
            if (board[from.row][c]) count++;
        }
    } else if (from.col === to.col) {
        const minR = Math.min(from.row, to.row) + 1;
        const maxR = Math.max(from.row, to.row);
        for (let r = minR; r < maxR; r++) {
            if (board[r][from.col]) count++;
        }
    }
    return count;
}

// ── Legal moves per piece ────────────────────

function isOwnSide(board: Board, pos: Position, side: Side): boolean {
    const p = getPiece(board, pos);
    return p !== null && p.side === side;
}

function getKingMoves(board: Board, pos: Position, side: Side): Position[] {
    const moves: Position[] = [];
    const { row, col } = pos;
    const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
    const rowMin = side === 'red' ? 7 : 0;
    const rowMax = side === 'red' ? 9 : 2;

    for (const [dr, dc] of dirs) {
        const nr = row + dr, nc = col + dc;
        if (nr >= rowMin && nr <= rowMax && nc >= 3 && nc <= 5 && !isOwnSide(board, { row: nr, col: nc }, side)) {
            moves.push({ row: nr, col: nc });
        }
    }

    // Flying general (对面将帅) - can capture opposing king if same col, nothing between
    const opponentKingRow = side === 'red' ? [0, 1, 2] : [7, 8, 9];
    for (const r of opponentKingRow) {
        for (let c = 3; c <= 5; c++) {
            const p = board[r][c];
            if (p && p.type === 'king' && p.side !== side && c === col) {
                if (countBetween(board, pos, { row: r, col: c }) === 0) {
                    moves.push({ row: r, col: c });
                }
            }
        }
    }

    return moves;
}

function getAdvisorMoves(board: Board, pos: Position, side: Side): Position[] {
    const moves: Position[] = [];
    const { row, col } = pos;
    const dirs = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
    const rowMin = side === 'red' ? 7 : 0;
    const rowMax = side === 'red' ? 9 : 2;

    for (const [dr, dc] of dirs) {
        const nr = row + dr, nc = col + dc;
        if (nr >= rowMin && nr <= rowMax && nc >= 3 && nc <= 5 && !isOwnSide(board, { row: nr, col: nc }, side)) {
            moves.push({ row: nr, col: nc });
        }
    }
    return moves;
}

function getElephantMoves(board: Board, pos: Position, side: Side): Position[] {
    const moves: Position[] = [];
    const { row, col } = pos;
    const patterns = [[2, 2, 1, 1], [2, -2, 1, -1], [-2, 2, -1, 1], [-2, -2, -1, -1]];
    const rowMin = side === 'red' ? 5 : 0;
    const rowMax = side === 'red' ? 9 : 4;

    for (const [dr, dc, br, bc] of patterns) {
        const nr = row + dr, nc = col + dc;
        const blockR = row + br, blockC = col + bc;
        if (inBounds(nr, nc) && nr >= rowMin && nr <= rowMax &&
            !isOwnSide(board, { row: nr, col: nc }, side) &&
            !board[blockR][blockC]) { // eye not blocked
            moves.push({ row: nr, col: nc });
        }
    }
    return moves;
}

function getHorseMoves(board: Board, pos: Position, side: Side): Position[] {
    const moves: Position[] = [];
    const { row, col } = pos;
    // 日字: first move one step orthogonally (check blocker), then diagonal
    const legs: [number, number, number, number][] = [
        [-1, 0, -2, -1], [-1, 0, -2, 1],
        [1, 0, 2, -1], [1, 0, 2, 1],
        [0, -1, -1, -2], [0, -1, 1, -2],
        [0, 1, -1, 2], [0, 1, 1, 2],
    ];
    for (const [lr, lc, dr, dc] of legs) {
        const legR = row + lr, legC = col + lc;
        const nr = row + dr, nc = col + dc;
        if (inBounds(nr, nc) && !board[legR]?.[legC] && !isOwnSide(board, { row: nr, col: nc }, side)) {
            moves.push({ row: nr, col: nc });
        }
    }
    return moves;
}

function getRookMoves(board: Board, pos: Position, side: Side): Position[] {
    const moves: Position[] = [];
    const { row, col } = pos;
    const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
    for (const [dr, dc] of dirs) {
        let r = row + dr, c = col + dc;
        while (inBounds(r, c)) {
            if (isOwnSide(board, { row: r, col: c }, side)) break;
            moves.push({ row: r, col: c });
            if (board[r][c]) break; // capture and stop
            r += dr; c += dc;
        }
    }
    return moves;
}

function getCannonMoves(board: Board, pos: Position, side: Side): Position[] {
    const moves: Position[] = [];
    const { row, col } = pos;
    const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
    for (const [dr, dc] of dirs) {
        let r = row + dr, c = col + dc;
        let jumped = false;
        while (inBounds(r, c)) {
            const target = board[r][c];
            if (!jumped) {
                if (!target) {
                    moves.push({ row: r, col: c }); // move freely
                } else {
                    jumped = true; // found the mount
                }
            } else {
                if (target) {
                    if (target.side !== side) {
                        moves.push({ row: r, col: c }); // capture after mount
                    }
                    break;
                }
            }
            r += dr; c += dc;
        }
    }
    return moves;
}

function getPawnMoves(board: Board, pos: Position, side: Side): Position[] {
    const moves: Position[] = [];
    const { row, col } = pos;
    const forward = side === 'red' ? -1 : 1;
    const crossedRiver = side === 'red' ? row <= 4 : row >= 5;

    // Forward
    const nr = row + forward;
    if (inBounds(nr, col) && !isOwnSide(board, { row: nr, col }, side)) {
        moves.push({ row: nr, col });
    }

    // Sideways (only after crossing river)
    if (crossedRiver) {
        for (const dc of [-1, 1]) {
            const nc = col + dc;
            if (inBounds(row, nc) && !isOwnSide(board, { row, col: nc }, side)) {
                moves.push({ row, col: nc });
            }
        }
    }
    return moves;
}

// ── Get all legal moves for a piece ──────────

export function getLegalMoves(board: Board, pos: Position): Position[] {
    const piece = getPiece(board, pos);
    if (!piece) return [];

    let moves: Position[];
    switch (piece.type) {
        case 'king': moves = getKingMoves(board, pos, piece.side); break;
        case 'advisor': moves = getAdvisorMoves(board, pos, piece.side); break;
        case 'elephant': moves = getElephantMoves(board, pos, piece.side); break;
        case 'horse': moves = getHorseMoves(board, pos, piece.side); break;
        case 'rook': moves = getRookMoves(board, pos, piece.side); break;
        case 'cannon': moves = getCannonMoves(board, pos, piece.side); break;
        case 'pawn': moves = getPawnMoves(board, pos, piece.side); break;
        default: moves = [];
    }

    // Filter out moves that leave own king in check
    return moves.filter(to => {
        const newBoard = cloneBoard(board);
        newBoard[to.row][to.col] = newBoard[pos.row][pos.col];
        newBoard[pos.row][pos.col] = null;
        return !isInCheck(newBoard, piece.side);
    });
}

// ── Check detection ──────────────────────────

function findKing(board: Board, side: Side): Position | null {
    for (let r = 0; r < 10; r++) {
        for (let c = 0; c < 9; c++) {
            const p = board[r][c];
            if (p && p.type === 'king' && p.side === side) return { row: r, col: c };
        }
    }
    return null;
}

export function isInCheck(board: Board, side: Side): boolean {
    const kingPos = findKing(board, side);
    if (!kingPos) return true; // king captured = in check

    const opponent = side === 'red' ? 'black' : 'red';
    // Check if any opponent piece can reach the king
    for (let r = 0; r < 10; r++) {
        for (let c = 0; c < 9; c++) {
            const p = board[r][c];
            if (!p || p.side !== opponent) continue;

            let rawMoves: Position[];
            const pos = { row: r, col: c };
            switch (p.type) {
                case 'king': rawMoves = getKingMoves(board, pos, p.side); break;
                case 'advisor': rawMoves = getAdvisorMoves(board, pos, p.side); break;
                case 'elephant': rawMoves = getElephantMoves(board, pos, p.side); break;
                case 'horse': rawMoves = getHorseMoves(board, pos, p.side); break;
                case 'rook': rawMoves = getRookMoves(board, pos, p.side); break;
                case 'cannon': rawMoves = getCannonMoves(board, pos, p.side); break;
                case 'pawn': rawMoves = getPawnMoves(board, pos, p.side); break;
                default: rawMoves = [];
            }
            if (rawMoves.some(m => m.row === kingPos.row && m.col === kingPos.col)) {
                return true;
            }
        }
    }
    return false;
}

// ── Checkmate detection ──────────────────────

export function isCheckmate(board: Board, side: Side): boolean {
    for (let r = 0; r < 10; r++) {
        for (let c = 0; c < 9; c++) {
            const p = board[r][c];
            if (!p || p.side !== side) continue;
            if (getLegalMoves(board, { row: r, col: c }).length > 0) return false;
        }
    }
    return true; // no legal moves
}

// ── Make move (Immutable for React State) ────

export function makeMove(state: ChessGameState, from: Position, to: Position): ChessGameState {
    // For UI state updates, we still strictly clone to satisfy React immutability
    const board = cloneBoard(state.board);
    const captured = board[to.row][to.col];
    board[to.row][to.col] = board[from.row][from.col];
    board[from.row][from.col] = null;

    const nextSide: Side = state.currentSide === 'red' ? 'black' : 'red';
    const check = isInCheck(board, nextSide);
    const checkmate = check && isCheckmate(board, nextSide);

    return {
        board,
        currentSide: nextSide,
        phase: checkmate || (captured?.type === 'king') ? 'FINISHED' : 'PLAYING',
        winner: checkmate || (captured?.type === 'king') ? state.currentSide : null,
        moveHistory: [...state.moveHistory, { from, to, captured: captured ?? undefined }],
        selectedPos: null,
        check,
    };
}

// ── AI Optimized Helpers (Mutable) ───────────
// Removed (was 3-ply Minimax for fallback)

