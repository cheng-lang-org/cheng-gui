import { useState, useEffect, useRef, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Sky, Stars } from '@react-three/drei';
import { Physics, useBox, useSphere } from '@react-three/cannon';
import * as THREE from 'three';
import { Vector3, Euler, Quaternion } from 'three';
import { ArrowLeft, RotateCcw } from 'lucide-react';

// --- Assets ---
const TEXTURES = {
    dirt: '#5d4037',     // Deep brown
    grass: '#388e3c',    // Forest green
    glass: '#81d4fa',    // Light blue transparent
    wood: '#795548',     // Brown
    log: '#4e342e',      // Dark wood
    stone: '#757575',    // Grey
    brick: '#bf360c',    // Reddish brick
};

type MaterialType = keyof typeof TEXTURES;

// --- Constants ---
const PLAYER_HEIGHT = 1.8;
const PLAYER_SPEED = 5;
const JUMP_FORCE = 5;

// --- Components ---

function Player({
    moveInput,
    lookInput,
    jumpPressed,
    onPosChange
}: {
    moveInput: { x: number, y: number },
    lookInput: { x: number, y: number },
    jumpPressed: boolean,
    onPosChange?: (pos: [number, number, number]) => void
}) {
    const { camera } = useThree();
    const [ref, api] = useSphere<THREE.Mesh>(() => ({
        mass: 1,
        type: 'Dynamic',
        position: [0, 5, 0],
        args: [0.4], // Radius
        fixedRotation: true,
        linearDamping: 0.1
    }));

    const velocity = useRef([0, 0, 0]);
    useEffect(() => api.velocity.subscribe((v) => (velocity.current = v)), [api.velocity]);

    const pos = useRef([0, 0, 0]);
    useEffect(() => api.position.subscribe((p) => {
        pos.current = p;
        if (onPosChange) onPosChange(p as [number, number, number]);
    }), [api.position, onPosChange]);

    const cameraAngle = useRef(new Euler(0, 0, 0, 'YXZ'));

    useFrame((state, delta) => {
        // 1. Handle Look (Camera Rotation)
        const SENSITIVITY = 1.5; // Touch look sensitivity
        cameraAngle.current.setFromQuaternion(camera.quaternion);

        // Update yaw (y-axis rotation) and pitch (x-axis rotation) based on input
        cameraAngle.current.y -= lookInput.x * SENSITIVITY * delta;
        cameraAngle.current.x -= lookInput.y * SENSITIVITY * delta;

        // Clamp pitch to avoid flipping
        cameraAngle.current.x = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, cameraAngle.current.x));

        camera.quaternion.setFromEuler(cameraAngle.current);

        // 2. Sync Camera Position
        camera.position.set(pos.current[0], pos.current[1] + 0.6, pos.current[2]);

        // 3. Handle Movement
        const frontVector = new Vector3(0, 0, (moveInput.y)); // Forward/Back
        const sideVector = new Vector3((moveInput.x), 0, 0);   // Left/Right

        const direction = new Vector3();
        direction.subVectors(frontVector, sideVector).normalize().multiplyScalar(PLAYER_SPEED);
        direction.applyEuler(cameraAngle.current); // Apply camera rotation means we move relative to view

        api.velocity.set(direction.x, velocity.current[1], direction.z);

        // 4. Handle Jump
        if (jumpPressed && Math.abs(velocity.current[1]) < 0.05) {
            api.velocity.set(velocity.current[0], JUMP_FORCE, velocity.current[2]);
        }
    });

    return <mesh ref={ref} />;
}

// --- Ground Component ---
function Ground() {
    const [ref] = useBox<THREE.Mesh>(() => ({ rotation: [-Math.PI / 2, 0, 0], position: [0, -0.5, 0], args: [1000, 1000, 1], type: 'Static' }));
    return (
        <mesh ref={ref} receiveShadow>
            <planeGeometry args={[1000, 1000]} />
            <meshStandardMaterial color="#388e3c" roughness={1} />
        </mesh>
    );
}

function Voxel({ position, type, onClick }: { position: [number, number, number], type: MaterialType, onClick: (e: any) => void }) {
    const [hover, setHover] = useState(false);
    const [ref] = useBox<THREE.Mesh>(() => ({ type: 'Static', position, args: [1, 1, 1] }));
    const color = TEXTURES[type];

    return (
        <mesh
            ref={ref}
            onClick={e => {
                e.stopPropagation();
                // Check distance
                if (e.distance < 10) { // Max reach distance 10 units
                    onClick(e);
                }
            }}
            onPointerOver={(e) => { e.stopPropagation(); setHover(true) }}
            onPointerOut={(e) => { e.stopPropagation(); setHover(false) }}
            castShadow
            receiveShadow
        >
            <boxGeometry />
            <meshStandardMaterial
                color={color}
                opacity={type === 'glass' ? 0.6 : 1}
                transparent={type === 'glass'}
                roughness={0.8}
            />
            {/* Edge Highlight */}
            {hover && (
                <lineSegments>
                    <edgesGeometry args={[new THREE.BoxGeometry(1.02, 1.02, 1.02)]} />
                    <lineBasicMaterial color="white" linewidth={2} />
                </lineSegments>
            )}
        </mesh>
    );
}

// --- Main Component ---

export default function MinecraftPage({ onClose }: { onClose: () => void }) {
    // Game State
    const [cubes, setCubes] = useState<Array<{ key: string, pos: [number, number, number], type: MaterialType }>>([]);
    const [activeMaterial, setActiveMaterial] = useState<MaterialType>('dirt');
    const [mode, setMode] = useState<'build' | 'break'>('build');

    // Controls State
    const [moveInput, setMoveInput] = useState({ x: 0, y: 0 });
    const [lookInput, setLookInput] = useState({ x: 0, y: 0 }); // Delta per frame
    const [jumpPressed, setJumpPressed] = useState(false);

    // Touch Refs
    const touchStartRef = useRef<{ id: number, x: number, y: number } | null>(null); // For joystick
    const lookTouchRef = useRef<{ id: number, x: number, y: number } | null>(null); // For looking
    const joystickCenter = useRef({ x: 0, y: 0 });
    const joystickRadius = 50;

    // --- Interaction ---
    const handleBlockClick = useCallback((e: any) => {
        if (!e) return;
        const { point, face } = e;

        if (mode === 'build') {
            // Calculate adjacent position
            const x = Math.floor(point.x + face.normal.x * 0.5);
            const y = Math.floor(point.y + face.normal.y * 0.5);
            const z = Math.floor(point.z + face.normal.z * 0.5);

            // Prevent placing inside player (simple check)
            // ... for now allow it, real checks are harder without player pos in this scope easily

            const key = `${x},${y},${z}`;
            if (!cubes.some(c => c.key === key)) {
                setCubes(prev => [...prev, { key, pos: [x, y, z], type: activeMaterial }]);
            }
        } else {
            // Break
            // We need to identify WHICH cube was clicked.
            // In a real voxel engine, we raycast against a chunk mesh.
            // Here each Voxel is an object. e.object is the mesh.

            // However, Cannon physics mesh doesn't map directly back to index without user data.
            // But we render `cubes.map(...)`.

            // To simplify: we can use the position from map to identify.
            // Center of the cube clicked:
            const cx = Math.floor(point.x - face.normal.x * 0.5);
            const cy = Math.floor(point.y - face.normal.y * 0.5);
            const cz = Math.floor(point.z - face.normal.z * 0.5);

            setCubes(prev => prev.filter(c => c.pos[0] !== cx || c.pos[1] !== cy || c.pos[2] !== cz));
        }
    }, [activeMaterial, cubes, mode]);

    const handleGroundClick = useCallback((e: any) => {
        // e.point is precise impact point
        // e.face.normal tells us direction
        if (mode === 'build') {
            const x = Math.floor(e.point.x + e.face.normal.x * 0.5);
            const y = Math.floor(e.point.y + e.face.normal.y * 0.5);
            const z = Math.floor(e.point.z + e.face.normal.z * 0.5);
            const key = `${x},${y},${z}`;
            setCubes(prev => [...prev, { key, pos: [x, y, z], type: activeMaterial }]);
        }
    }, [activeMaterial, mode]);


    // --- Touch Handlers (Joystick & Look) ---
    const handleTouchStart = (e: React.TouchEvent) => {
        for (let i = 0; i < e.changedTouches.length; i++) {
            const t = e.changedTouches[i];
            const x = t.clientX;
            const y = t.clientY;

            // Left half = Joystick
            if (x < window.innerWidth / 2) {
                if (!touchStartRef.current) {
                    touchStartRef.current = { id: t.identifier, x, y };
                    joystickCenter.current = { x, y };
                }
            }
            // Right half = Look
            else {
                if (!lookTouchRef.current) {
                    lookTouchRef.current = { id: t.identifier, x, y };
                }
            }
        }
    };

    const handleTouchMove = (e: React.TouchEvent) => {
        let nextMove = { ...moveInput };
        let nextLook = { x: 0, y: 0 };

        for (let i = 0; i < e.changedTouches.length; i++) {
            const t = e.changedTouches[i];

            // Joystick Move
            if (touchStartRef.current && t.identifier === touchStartRef.current.id) {
                const dx = t.clientX - joystickCenter.current.x;
                const dy = t.clientY - joystickCenter.current.y;

                // Normalize
                const dist = Math.sqrt(dx * dx + dy * dy);
                const maxDist = joystickRadius;
                const clampedDist = Math.min(dist, maxDist);
                const angle = Math.atan2(dy, dx);

                // Map to -1..1
                // y is inverted for screen coords vs 3D z-forward
                // Forward (screen up) should be negative Y in input? No, typically UP is negative screen Y.
                // 3D: -Z is forward. +X is right.
                // Joystick: up (-y) -> move.y = 1 (forward)

                // normalized x/y
                const nx = (Math.cos(angle) * clampedDist) / maxDist;
                const ny = (Math.sin(angle) * clampedDist) / maxDist;

                setMoveInput({ x: nx, y: ny });
            }

            // Look Move
            if (lookTouchRef.current && t.identifier === lookTouchRef.current.id) {
                const dx = t.clientX - lookTouchRef.current.x;
                const dy = t.clientY - lookTouchRef.current.y;

                // Sensitivity factor
                setLookInput({ x: dx * 0.005, y: dy * 0.005 });

                // Reset ref for continuous delta
                lookTouchRef.current = { id: t.identifier, x: t.clientX, y: t.clientY };
            }
        }
    };

    const handleTouchEnd = (e: React.TouchEvent) => {
        for (let i = 0; i < e.changedTouches.length; i++) {
            const t = e.changedTouches[i];
            if (touchStartRef.current && t.identifier === touchStartRef.current.id) {
                touchStartRef.current = null;
                setMoveInput({ x: 0, y: 0 });
            }
            if (lookTouchRef.current && t.identifier === lookTouchRef.current.id) {
                lookTouchRef.current = null;
                setLookInput({ x: 0, y: 0 });
            }
        }
    };

    // --- Reset Look Input Frame-by-Frame if not touching ---
    // Actually, useFrame in player handles using the state. 
    // If we use 'delta' approach, we need to reset lookInput to 0 after applied?
    // or keep it if finger moving?
    // In React state, setting it every frame is expensive.
    // Better: Player component reads from a Ref for look delta.
    // Ref updated by touch move directly.
    // But for now, let's try strict state.
    // *Correction*: State update on every touchmove is fine, 
    // but we need to reset look delta to 0 when finger stops? 
    // Interaction: touchmove fires continuously? No, only on move. 
    // Player useFrame runs 60fps. If touchmove doesn't fire, lookInput remains? 
    // That means "spinning" if you hold finger still?
    // YES. We want "drag to look". So we process delta then reset it.
    // To do this cleanly, let's just zero it out in a timeout or effect? 
    // Or simpler: Player consumes it and sets it back? No, player is child.
    // Let's use a ref for lookInput passed to Player.

    useEffect(() => {
        const reset = () => setLookInput({ x: 0, y: 0 });
        const t = setTimeout(reset, 50); // Reset if no move event for 50ms
        return () => clearTimeout(t);
    }, [lookInput]);


    const [isLandscape, setIsLandscape] = useState(window.innerWidth > window.innerHeight);
    useEffect(() => {
        const handleResize = () => setIsLandscape(window.innerWidth > window.innerHeight);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    if (!isLandscape) {
        return (
            <div className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-center text-white text-center p-4">
                <div className="text-6xl mb-6 animate-pulse">⟳</div>
                <h2 className="text-xl font-bold mb-2">请旋转手机屏幕</h2>
                <p className="text-sm text-gray-400">为了最佳游戏体验，请横屏游玩</p>
                <button onClick={onClose} className="mt-12 px-8 py-3 bg-white/10 rounded-full text-sm backdrop-blur">
                    退出游戏
                </button>
            </div>
        );
    }

    return (
        <div
            className="fixed inset-0 z-50 bg-sky-300 select-none touch-none"
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
        >
            <Canvas shadows camera={{ fov: 70 }}>
                <Sky sunPosition={[100, 20, 100]} />
                <Stars />
                <ambientLight intensity={0.4} />
                <pointLight castShadow intensity={0.7} position={[50, 50, 50]} shadow-mapSize={[2048, 2048]} />
                <Physics gravity={[0, -15, 0]}>
                    <Ground />
                    <Player
                        moveInput={moveInput}
                        lookInput={lookInput}
                        jumpPressed={jumpPressed}
                    />
                    {cubes.map(cube => (
                        <Voxel
                            key={cube.key}
                            position={cube.pos}
                            type={cube.type}
                            onClick={handleBlockClick}
                        />
                    ))}
                    {/* Add invisible plane on ground level to catch clicks for building */}
                    <mesh
                        rotation={[-Math.PI / 2, 0, 0]}
                        position={[0, -0.4, 0]}
                        onClick={handleGroundClick}
                        visible={false}
                    >
                        <planeGeometry args={[1000, 1000]} />
                    </mesh>
                </Physics>
            </Canvas>

            {/* UI Overlay */}
            {/* Crosshair */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none opacity-60">
                <div className="w-4 h-4 text-white">+</div>
            </div>

            {/* Top Left Menu */}
            <div className="absolute top-4 left-4 z-20 flex gap-2 pointer-events-auto">
                <button onClick={onClose} className="p-2 bg-black/40 rounded-lg text-white backdrop-blur active:scale-95">
                    <ArrowLeft size={20} />
                </button>
                <button onClick={() => setCubes([])} className="p-2 bg-black/40 rounded-lg text-white backdrop-blur active:scale-95">
                    <RotateCcw size={20} />
                </button>
            </div>

            {/* Jump Button (Right Thumb) */}
            <div className="absolute bottom-24 right-8 z-20 pointer-events-auto">
                <button
                    className={`w-16 h-16 rounded-full bg-white/20 backdrop-blur border-2 border-white/30 flex items-center justify-center active:bg-white/40 transition-colors ${jumpPressed ? 'bg-white/40' : ''}`}
                    onTouchStart={() => setJumpPressed(true)}
                    onTouchEnd={() => setJumpPressed(false)}
                >
                    <span className="text-white font-bold text-xs">JUMP</span>
                </button>
            </div>

            {/* Mode Switcher */}
            <div className="absolute top-4 right-4 z-20 pointer-events-auto flex items-center bg-black/40 rounded-lg p-1 backdrop-blur">
                <button
                    onClick={() => setMode('build')}
                    className={`px-3 py-1.5 rounded text-xs font-bold transition-colors ${mode === 'build' ? 'bg-green-500 text-white' : 'text-gray-300'}`}
                >
                    建造
                </button>
                <div className="w-px h-4 bg-white/20 mx-1"></div>
                <button
                    onClick={() => setMode('break')}
                    className={`px-3 py-1.5 rounded text-xs font-bold transition-colors ${mode === 'break' ? 'bg-red-500 text-white' : 'text-gray-300'}`}
                >
                    破坏
                </button>
            </div>

            {/* Hotbar (Bottom Center) */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 bg-black/40 p-1.5 rounded-xl backdrop-blur flex gap-1.5 pointer-events-auto overflow-x-auto max-w-[90vw]">
                {(Object.keys(TEXTURES) as MaterialType[]).map((mat) => (
                    <button
                        key={mat}
                        onClick={() => setActiveMaterial(mat)}
                        className={`w-10 h-10 rounded border-[3px] transition-transform active:scale-95 flex-shrink-0 ${activeMaterial === mat ? 'border-white scale-110' : 'border-transparent opacity-70 hover:opacity-100'}`}
                        style={{ backgroundColor: TEXTURES[mat] }}
                    />
                ))}
            </div>

            {/* Joystick Visual (Left Thumb Area Info) */}
            <div className="absolute bottom-16 left-16 w-24 h-24 rounded-full border-2 border-white/10 pointer-events-none flex items-center justify-center opacity-30">
                <div className="text-[10px] text-white">MOVE</div>
            </div>
            <div className="absolute bottom-40 left-16 text-[10px] text-white/30 pointer-events-none">
                Touch & Drag
            </div>
        </div>
    );
}
