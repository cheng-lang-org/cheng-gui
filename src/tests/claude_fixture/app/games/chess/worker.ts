import init, { ChessEngine } from './pkg/chess_wasm';

let engine: ChessEngine | null = null;

self.onmessage = async (e: MessageEvent) => {
    const { type, payload } = e.data;

    try {
        if (type === 'init') {
            await init();
            engine = new ChessEngine();
            postMessage({ type: 'ready' });
            console.log('WASM Chess Engine Initialized');
        }
        else if (type === 'reset') {
            if (engine) engine.reset_board();
        }
        else if (type === 'search') {
            if (!engine) {
                console.error('Engine not initialized');
                return;
            }
            const { boardFlat, turn, depth } = payload;

            // Sync board
            engine.update_board(new Int32Array(boardFlat), turn === 'red' ? 0 : 1);

            const start = performance.now();
            const bestMove = engine.get_best_move(depth);
            const end = performance.now();

            console.log(`AI Search Depth ${depth} finished in ${(end - start).toFixed(2)}ms`);

            postMessage({
                type: 'bestMove',
                move: bestMove,
                metrics: { time: end - start, nodes: 0, depth: depth }
            });
        }
    } catch (err) {
        console.error('Worker Error:', err);
    }
};
