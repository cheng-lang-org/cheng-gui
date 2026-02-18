import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { ArrowLeft, RotateCcw } from 'lucide-react';
import VictoryConfetti from './VictoryConfetti';
import { useLocale } from '../i18n/LocaleContext';
import {
    type ChessGameState, type Position,
    createChessGame, getLegalMoves, makeMove, pieceLabel,
    isInCheck, isCheckmate, serializeBoard
} from '../games/chess/engine';

interface Props {
    roomId?: string;
    onClose: () => void;
}

export default function ChessPage({ roomId, onClose }: Props) {
    const { t } = useLocale();
    const [game, setGame] = useState<ChessGameState>(createChessGame());
    const [legalMoves, setLegalMoves] = useState<Position[]>([]);
    const [thinking, setThinking] = useState(false);

    const playerSide = 'red' as const;

    const restart = useCallback(() => {
        setGame(createChessGame());
        setLegalMoves([]);
        setThinking(false);
    }, []);

    const handleClick = useCallback((row: number, col: number) => {
        if (game.phase === 'FINISHED' || game.currentSide !== playerSide || thinking) return;
        const clickedPos = { row, col };
        const clickedPiece = game.board[row][col];

        if (game.selectedPos) {
            const isLegal = legalMoves.some(m => m.row === row && m.col === col);
            if (isLegal) {
                setGame(makeMove(game, game.selectedPos, clickedPos));
                setLegalMoves([]);
                return;
            }
            if (clickedPiece && clickedPiece.side === playerSide) {
                setGame(prev => ({ ...prev, selectedPos: clickedPos }));
                setLegalMoves(getLegalMoves(game.board, clickedPos));
                return;
            }
            setGame(prev => ({ ...prev, selectedPos: null }));
            setLegalMoves([]);
            return;
        }

        if (clickedPiece && clickedPiece.side === playerSide) {
            setGame(prev => ({ ...prev, selectedPos: clickedPos }));
            setLegalMoves(getLegalMoves(game.board, clickedPos));
        }
    }, [game, legalMoves, playerSide, thinking]);

    const [difficulty, setDifficulty] = useState<6 | 8>(6);

    const workerRef = useRef<Worker | null>(null);

    // Initialize Worker
    useEffect(() => {
        // Create worker
        const worker = new Worker(new URL('../games/chess/worker.ts', import.meta.url), { type: 'module' });
        workerRef.current = worker;

        worker.postMessage({ type: 'init' });

        worker.onmessage = (e) => {
            const { type, move } = e.data;
            if (type === 'bestMove' && move) {
                // Apply move
                // Move from WASM is { from: index, to: index }
                const fromRow = Math.floor(move.from / 9);
                const fromCol = move.from % 9;
                const toRow = Math.floor(move.to / 9);
                const toCol = move.to % 9;

                setGame(prev => makeMove(prev, { row: fromRow, col: fromCol }, { row: toRow, col: toCol }));
                setThinking(false);
            }
        };

        return () => {
            worker.terminate();
        };
    }, []);

    // AI turn
    useEffect(() => {
        if (game.currentSide !== 'black' || game.phase === 'FINISHED') return;
        setThinking(true);

        if (workerRef.current) {
            const flat = serializeBoard(game.board);
            // Verify serialization
            // console.log('Serialized Board:', flat);

            workerRef.current.postMessage({
                type: 'search',
                payload: {
                    boardFlat: flat,
                    turn: 'black',
                    depth: difficulty // Use selected difficulty
                }
            });
        }
    }, [game.currentSide, game.phase, game.board, difficulty]);

    const statusText = useMemo(() => {
        if (game.phase === 'FINISHED') {
            return game.winner === playerSide
                ? (t.xq_youWin ?? '🎉 你赢了！') : (t.xq_youLose ?? '😢 你输了');
        }
        if (thinking) return t.xq_aiThinking ?? 'AI 思考中...';
        if (game.check) return '⚠️ 将军！';
        return game.currentSide === playerSide
            ? (t.xq_yourTurn ?? '你的回合') : (t.xq_opponentTurn ?? '对方回合');
    }, [game.phase, game.winner, game.currentSide, game.check, thinking, playerSide, t]);

    const lastMove = game.moveHistory[game.moveHistory.length - 1];

    return (
        <div
            className="fixed inset-0 z-50 flex flex-col text-gray-100"
            style={{
                paddingTop: 'env(safe-area-inset-top, 0px)',
                paddingBottom: 'env(safe-area-inset-bottom, 0px)',
                background: 'linear-gradient(180deg, #2c1810 0%, #3d2317 30%, #2c1810 100%)',
            }}
        >
            {/* Header */}
            <header className="relative z-10 flex items-center justify-between px-4 py-2 shrink-0">
                <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg transition-colors">
                    <ArrowLeft size={20} className="text-amber-200" />
                </button>
                <div className="flex-1 flex justify-center">
                    <span className="font-bold text-lg text-amber-900 tracking-wider">中国象棋</span>
                    {roomId && <span className="ml-2 text-xs text-amber-700 self-center font-mono bg-amber-200 px-1 rounded">Room: {roomId.slice(0, 8)}...</span>}
                </div>
                <button onClick={restart} className="p-2 hover:bg-white/10 rounded-lg transition-colors">
                    <RotateCcw size={18} className="text-amber-200" />
                </button>
            </header>

            {/* Difficulty Selector */}
            <div className="relative z-20 px-4 py-1 flex justify-end">
                <div className="bg-black/20 backdrop-blur-sm p-1 rounded-lg flex gap-1 border border-white/10">
                    <button
                        onClick={() => setDifficulty(6)}
                        className={`px-3 py-1 text-xs rounded-md transition-all ${difficulty === 6
                            ? 'bg-amber-500 text-gray-900 font-bold shadow-sm'
                            : 'text-amber-200/70 hover:bg-white/5'
                            }`}
                    >
                        高手
                    </button>
                    <button
                        onClick={() => setDifficulty(8)}
                        className={`px-3 py-1 text-xs rounded-md transition-all ${difficulty === 8
                            ? 'bg-amber-500 text-gray-900 font-bold shadow-sm'
                            : 'text-amber-200/70 hover:bg-white/5'
                            }`}
                    >
                        大师
                    </button>
                </div>
            </div>

            {/* Player info - Black (top) */}
            <div className="relative z-10 flex items-center justify-between px-4 py-1 shrink-0">
                <div className="flex items-center gap-2">
                    <div className={`
                        w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold
                        bg-gradient-to-br from-gray-600 to-gray-800 border-2
                        ${game.currentSide === 'black' && game.phase !== 'FINISHED'
                            ? 'border-yellow-400 shadow-lg shadow-yellow-400/30' : 'border-gray-500'}
                    `}>
                        <span className="text-gray-100">黑</span>
                    </div>
                    <span className={`text-xs font-medium ${game.currentSide === 'black' ? 'text-yellow-300' : 'text-gray-400'}`}>
                        AI · 黑方
                    </span>
                    {thinking && (
                        <span className="text-[10px] text-yellow-400/60 animate-pulse">思考中...</span>
                    )}
                </div>
            </div>

            {/* Status bar */}
            <div className="relative z-10 text-center py-1 shrink-0">
                <span className={`inline-flex items-center gap-1 px-4 py-1 rounded-full text-sm font-semibold border ${game.phase === 'FINISHED'
                    ? game.winner === playerSide
                        ? 'bg-green-500/20 text-green-200 border-green-500/30'
                        : 'bg-red-500/20 text-red-200 border-red-500/30'
                    : game.check
                        ? 'bg-yellow-500/20 text-yellow-200 border-yellow-500/30 animate-pulse'
                        : 'bg-black/20 text-amber-200 border-amber-500/20'
                    }`}>
                    {statusText}
                </span>
            </div>

            {/* Board */}
            <div className="relative z-10 flex-1 flex items-center justify-center px-3">
                <div
                    className="relative rounded-xl overflow-hidden shadow-2xl"
                    style={{
                        width: 'min(92vw, 380px)',
                        aspectRatio: '9 / 10',
                        background: 'linear-gradient(135deg, #e8c88a 0%, #d4a94a 50%, #c89840 100%)',
                        border: '3px solid #8b6914',
                        boxShadow: '0 0 0 2px #5a4510, 0 8px 32px rgba(0,0,0,0.5), inset 0 0 20px rgba(139,105,20,0.3)',
                    }}
                >
                    {/* Wood grain texture */}
                    <div className="absolute inset-0 opacity-[0.06]" style={{
                        backgroundImage: 'repeating-linear-gradient(90deg, transparent, transparent 2px, rgba(100,60,20,0.3) 2px, rgba(100,60,20,0.3) 3px)',
                    }} />

                    {/* SVG grid */}
                    <svg
                        viewBox="-0.5 -0.5 9 10"
                        className="absolute inset-0 w-full h-full"
                        preserveAspectRatio="xMidYMid meet"
                    >
                        {/* Horizontal lines */}
                        {Array.from({ length: 10 }, (_, i) => (
                            <line key={`h${i}`} x1={0} y1={i} x2={8} y2={i}
                                stroke="#5a3a1a" strokeWidth={0.04} />
                        ))}
                        {/* Vertical lines */}
                        {Array.from({ length: 9 }, (_, i) => {
                            if (i === 0 || i === 8) {
                                return <line key={`v${i}`} x1={i} y1={0} x2={i} y2={9} stroke="#5a3a1a" strokeWidth={0.04} />;
                            }
                            return (
                                <g key={`v${i}`}>
                                    <line x1={i} y1={0} x2={i} y2={4} stroke="#5a3a1a" strokeWidth={0.04} />
                                    <line x1={i} y1={5} x2={i} y2={9} stroke="#5a3a1a" strokeWidth={0.04} />
                                </g>
                            );
                        })}
                        {/* Palace diagonals */}
                        <line x1={3} y1={0} x2={5} y2={2} stroke="#5a3a1a" strokeWidth={0.04} />
                        <line x1={5} y1={0} x2={3} y2={2} stroke="#5a3a1a" strokeWidth={0.04} />
                        <line x1={3} y1={7} x2={5} y2={9} stroke="#5a3a1a" strokeWidth={0.04} />
                        <line x1={5} y1={7} x2={3} y2={9} stroke="#5a3a1a" strokeWidth={0.04} />

                        {/* Star / cannon markers */}
                        {[[1, 2], [7, 2], [0, 3], [2, 3], [4, 3], [6, 3], [8, 3], [0, 6], [2, 6], [4, 6], [6, 6], [8, 6], [1, 7], [7, 7]].map(([x, y], idx) => (
                            <g key={`star${idx}`}>
                                {x > 0 && (<><line x1={x - 0.15} y1={y - 0.05} x2={x - 0.15} y2={y - 0.15} stroke="#5a3a1a" strokeWidth={0.03} />
                                    <line x1={x - 0.15} y1={y - 0.15} x2={x - 0.05} y2={y - 0.15} stroke="#5a3a1a" strokeWidth={0.03} />
                                    <line x1={x - 0.15} y1={y + 0.05} x2={x - 0.15} y2={y + 0.15} stroke="#5a3a1a" strokeWidth={0.03} />
                                    <line x1={x - 0.15} y1={y + 0.15} x2={x - 0.05} y2={y + 0.15} stroke="#5a3a1a" strokeWidth={0.03} /></>)}
                                {x < 8 && (<><line x1={x + 0.15} y1={y - 0.05} x2={x + 0.15} y2={y - 0.15} stroke="#5a3a1a" strokeWidth={0.03} />
                                    <line x1={x + 0.15} y1={y - 0.15} x2={x + 0.05} y2={y - 0.15} stroke="#5a3a1a" strokeWidth={0.03} />
                                    <line x1={x + 0.15} y1={y + 0.05} x2={x + 0.15} y2={y + 0.15} stroke="#5a3a1a" strokeWidth={0.03} />
                                    <line x1={x + 0.15} y1={y + 0.15} x2={x + 0.05} y2={y + 0.15} stroke="#5a3a1a" strokeWidth={0.03} /></>)}
                            </g>
                        ))}

                        {/* River text */}
                        <text x={2} y={4.7} textAnchor="middle" fontSize={0.45} fill="#5a3a1a" fontWeight="bold" opacity={0.4}
                            style={{ fontFamily: 'serif' }}>
                            楚 河
                        </text>
                        <text x={6} y={4.7} textAnchor="middle" fontSize={0.45} fill="#5a3a1a" fontWeight="bold" opacity={0.4}
                            style={{ fontFamily: 'serif' }}>
                            漢 界
                        </text>
                    </svg>

                    {/* Pieces */}
                    {Array.from({ length: 10 }, (_, row) =>
                        Array.from({ length: 9 }, (_, col) => {
                            const piece = game.board[row][col];
                            const isSelected = game.selectedPos?.row === row && game.selectedPos?.col === col;
                            const isLegal = legalMoves.some(m => m.row === row && m.col === col);
                            const isLastFrom = lastMove?.from.row === row && lastMove?.from.col === col;
                            const isLastTo = lastMove?.to.row === row && lastMove?.to.col === col;
                            const isLast = isLastFrom || isLastTo;

                            // Map 0..8 to -0.5..8.5 (total 9 units)
                            // center x = col
                            // pct = (col - (-0.5)) / 9 * 100 = (col + 0.5) / 9 * 100
                            const leftPct = (col + 0.5) / 9 * 100;

                            // Map 0..9 to -0.5..9.5 (total 10 units)
                            // center y = row
                            // pct = (row - (-0.5)) / 10 * 100 = (row + 0.5) / 10 * 100
                            const topPct = (row + 0.5) / 10 * 100;

                            const sizePct = 10; // Slightly larger to fill cell

                            return (
                                <button
                                    key={`${row}-${col}`}
                                    onClick={() => handleClick(row, col)}
                                    className="absolute flex items-center justify-center"
                                    style={{
                                        left: `${leftPct}%`, top: `${topPct}%`,
                                        width: `${sizePct}%`, height: `${sizePct}%`,
                                        transform: 'translate(-50%, -50%)',
                                    }}
                                >
                                    {/* Legal move dot */}
                                    {isLegal && !piece && (
                                        <div className="absolute w-3.5 h-3.5 rounded-full bg-green-500/50 shadow-sm shadow-green-500/30 z-10" />
                                    )}

                                    {/* Last move from ghost ring */}
                                    {isLastFrom && !piece && (
                                        <div className="absolute w-5 h-5 rounded-full ring-2 ring-yellow-500/40 z-0" />
                                    )}

                                    {/* Piece */}
                                    {piece && (
                                        <div
                                            className={`
                                                w-full h-full rounded-full flex items-center justify-center
                                                font-bold select-none z-10 transition-all duration-150
                                                ${piece.side === 'red'
                                                    ? `bg-gradient-to-br from-red-50 to-red-100 text-red-700 
                                                       border-[2.5px] border-red-600 
                                                       shadow-[inset_0_1px_2px_rgba(255,255,255,0.6),0_2px_4px_rgba(0,0,0,0.3)]`
                                                    : `bg-gradient-to-br from-gray-700 to-gray-900 text-gray-100 
                                                       border-[2.5px] border-gray-400 
                                                       shadow-[inset_0_1px_2px_rgba(255,255,255,0.1),0_2px_4px_rgba(0,0,0,0.3)]`
                                                }
                                                ${isSelected
                                                    ? 'ring-[3px] ring-blue-400 scale-110 shadow-lg shadow-blue-400/30'
                                                    : ''}
                                                ${isLegal && piece
                                                    ? 'ring-2 ring-green-400 shadow-md shadow-green-400/20'
                                                    : ''}
                                                ${isLastTo
                                                    ? 'ring-2 ring-yellow-400/70'
                                                    : ''}
                                            `}
                                            style={{ fontSize: 'min(3.8vw, 15px)' }}
                                        >
                                            {pieceLabel(piece)}
                                        </div>
                                    )}
                                </button>
                            );
                        })
                    )}
                </div>
            </div>

            {/* Player info - Red (bottom) */}
            <div className="relative z-10 flex items-center justify-between px-4 py-1 shrink-0">
                <div className="flex items-center gap-2">
                    <div className={`
                        w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold
                        bg-gradient-to-br from-red-100 to-red-200 border-2
                        ${game.currentSide === 'red' && game.phase !== 'FINISHED'
                            ? 'border-yellow-400 shadow-lg shadow-yellow-400/30' : 'border-red-500'}
                    `}>
                        <span className="text-red-700">红</span>
                    </div>
                    <span className={`text-xs font-medium ${game.currentSide === 'red' ? 'text-yellow-300' : 'text-gray-400'}`}>
                        你 · 红方
                    </span>
                </div>
                <div className="flex items-center gap-3 text-[10px] text-amber-400/50">
                    <span>步数 {game.moveHistory.length}</span>
                </div>
            </div>

            {/* Bottom controls */}
            <div className="relative z-10 shrink-0 px-4 py-2 flex items-center justify-center">
                {game.phase === 'FINISHED' && (
                    <button onClick={restart}
                        className="px-8 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-500 text-gray-900 font-bold text-sm shadow-lg shadow-amber-500/20 hover:from-amber-400 hover:to-yellow-400 active:scale-95 transition-all">
                        {t.xq_playAgain ?? '再来一局'}
                    </button>
                )}
            </div>
            {game.phase === 'FINISHED' && game.winner === playerSide && <VictoryConfetti />}
        </div>
    );
}
