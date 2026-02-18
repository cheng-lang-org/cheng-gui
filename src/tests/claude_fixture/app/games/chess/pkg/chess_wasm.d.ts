/* tslint:disable */
/* eslint-disable */

export class ChessEngine {
    free(): void;
    [Symbol.dispose](): void;
    get_best_move(max_depth: number): any;
    constructor();
    reset_board(): void;
    update_board(board_flat: Int32Array, turn: number): void;
}

export enum PieceType {
    King = 0,
    Advisor = 1,
    Elephant = 2,
    Horse = 3,
    Rook = 4,
    Cannon = 5,
    Pawn = 6,
}

export enum Side {
    Red = 0,
    Black = 1,
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_chessengine_free: (a: number, b: number) => void;
    readonly chessengine_get_best_move: (a: number, b: number) => any;
    readonly chessengine_new: () => number;
    readonly chessengine_reset_board: (a: number) => void;
    readonly chessengine_update_board: (a: number, b: number, c: number, d: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
