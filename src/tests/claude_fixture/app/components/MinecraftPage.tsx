import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Sky, Stars } from '@react-three/drei';
import * as THREE from 'three';
import { ArrowLeft, RotateCcw } from 'lucide-react';

// ─────────────────────────────────────────────
//  Noise - Simple 2D value noise for terrain
// ─────────────────────────────────────────────
function hashNoise(x: number, y: number, seed: number): number {
    let n = Math.sin(x * 127.1 + y * 311.7 + seed * 113.5) * 43758.5453;
    return n - Math.floor(n);
}

function smoothNoise(x: number, y: number, seed: number): number {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = hashNoise(ix, iy, seed);
    const b = hashNoise(ix + 1, iy, seed);
    const c = hashNoise(ix, iy + 1, seed);
    const d = hashNoise(ix + 1, iy + 1, seed);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function terrainHeight(x: number, z: number, seed: number): number {
    let h = 0;
    h += smoothNoise(x * 0.05, z * 0.05, seed) * 8;
    h += smoothNoise(x * 0.1, z * 0.1, seed + 100) * 4;
    h += smoothNoise(x * 0.2, z * 0.2, seed + 200) * 2;
    return Math.floor(h);
}

// ─────────────────────────────────────────────
//  Block types
// ─────────────────────────────────────────────
type BlockType = 'grass' | 'dirt' | 'stone' | 'log' | 'leaves' | 'planks' | 'brick' | 'sand' | 'glass' | 'water';

const BLOCK_COLORS: Record<BlockType, string> = {
    grass: '#4a8c2a', dirt: '#6b4226', stone: '#7a7a7a', log: '#4e342e',
    leaves: '#2d6b1e', planks: '#b38b5d', brick: '#964b38', sand: '#d4c27a',
    glass: '#a8d8ea', water: '#3b7dd8',
};

const BLOCK_LABELS: Record<BlockType, string> = {
    grass: '草地', dirt: '泥土', stone: '石头', log: '原木',
    leaves: '树叶', planks: '木板', brick: '砖块', sand: '沙子',
    glass: '玻璃', water: '水',
};

const ALL_BLOCKS: BlockType[] = ['grass', 'dirt', 'stone', 'log', 'leaves', 'planks', 'brick', 'sand', 'glass', 'water'];

// ─────────────────────────────────────────────
//  World Generation
// ─────────────────────────────────────────────
const WORLD_SIZE = 20;
const WATER_LEVEL = 2;

interface WorldBlock { x: number; y: number; z: number; type: BlockType; }

function generateWorld(seed: number): Map<string, WorldBlock> {
    const blocks = new Map<string, WorldBlock>();
    const k = (x: number, y: number, z: number) => `${x},${y},${z}`;

    for (let x = -WORLD_SIZE / 2; x < WORLD_SIZE / 2; x++) {
        for (let z = -WORLD_SIZE / 2; z < WORLD_SIZE / 2; z++) {
            const h = terrainHeight(x, z, seed);

            // Stone layer
            for (let y = h - 2; y < h; y++) {
                if (y >= -3) blocks.set(k(x, y, z), { x, y, z, type: 'stone' });
            }

            if (h > WATER_LEVEL) {
                blocks.set(k(x, h, z), { x, y: h, z, type: 'grass' });
            } else {
                blocks.set(k(x, h, z), { x, y: h, z, type: 'sand' });
                for (let wy = h + 1; wy <= WATER_LEVEL; wy++) {
                    blocks.set(k(x, wy, z), { x, y: wy, z, type: 'water' });
                }
            }
        }
    }

    // Trees
    for (let x = -WORLD_SIZE / 2 + 3; x < WORLD_SIZE / 2 - 3; x += 5) {
        for (let z = -WORLD_SIZE / 2 + 3; z < WORLD_SIZE / 2 - 3; z += 5) {
            const ox = x + Math.floor(hashNoise(x, z, seed + 500) * 2);
            const oz = z + Math.floor(hashNoise(x, z, seed + 600) * 2);
            const h = terrainHeight(ox, oz, seed);
            if (h > WATER_LEVEL + 1 && hashNoise(ox, oz, seed + 700) > 0.4) {
                const treeH = 3 + Math.floor(hashNoise(ox, oz, seed + 800) * 2);
                for (let ty = 1; ty <= treeH; ty++) {
                    blocks.set(k(ox, h + ty, oz), { x: ox, y: h + ty, z: oz, type: 'log' });
                }
                const top = h + treeH;
                for (let ly = top - 1; ly <= top + 1; ly++) {
                    const r = ly <= top - 1 ? 2 : 1;
                    for (let lx = -r; lx <= r; lx++) {
                        for (let lz = -r; lz <= r; lz++) {
                            if (lx === 0 && lz === 0 && ly < top + 1) continue;
                            blocks.set(k(ox + lx, ly, oz + lz), { x: ox + lx, y: ly, z: oz + lz, type: 'leaves' });
                        }
                    }
                }
            }
        }
    }

    return blocks;
}

// Get the surface height at a given x,z for collision
function getSurfaceHeight(blocks: Map<string, WorldBlock>, x: number, z: number): number {
    const bx = Math.floor(x), bz = Math.floor(z);
    for (let y = 20; y >= -5; y--) {
        const b = blocks.get(`${bx},${y},${bz}`);
        if (b && b.type !== 'water' && b.type !== 'leaves') {
            return y + 1; // Stand on top of the block
        }
    }
    return 0;
}

// ─────────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────────
const PLAYER_SPEED = 5;
const GRAVITY = 18;
const JUMP_VEL = 7;
const DAY_LENGTH = 120;

// ─────────────────────────────────────────────
//  Player Controller (No Physics Engine)
// ─────────────────────────────────────────────
function PlayerController({
    moveInput,
    lookInput,
    jumpPressed,
    spawnY,
    blocks,
    onPosChange,
}: {
    moveInput: React.MutableRefObject<{ x: number; y: number }>;
    lookInput: React.MutableRefObject<{ x: number; y: number }>;
    jumpPressed: React.MutableRefObject<boolean>;
    spawnY: number;
    blocks: Map<string, WorldBlock>;
    onPosChange: (pos: [number, number, number]) => void;
}) {
    const { camera } = useThree();
    const pos = useRef(new THREE.Vector3(0, spawnY + 3, 0));
    const vel = useRef(new THREE.Vector3(0, 0, 0));
    const yaw = useRef(0);
    const pitch = useRef(-0.3);
    const onGround = useRef(false);

    useFrame((_s, dt) => {
        dt = Math.min(dt, 0.05); // Cap delta

        // ── Look ──
        const look = lookInput.current;
        yaw.current -= look.x * 2.0 * dt;
        pitch.current -= look.y * 2.0 * dt;
        pitch.current = Math.max(-1.4, Math.min(1.4, pitch.current));

        // ── Movement direction ──
        const move = moveInput.current;
        const forward = new THREE.Vector3(-Math.sin(yaw.current), 0, -Math.cos(yaw.current));
        const right = new THREE.Vector3(forward.z, 0, -forward.x);

        const moveDir = new THREE.Vector3();
        moveDir.addScaledVector(forward, -move.y); // joystick up = forward
        moveDir.addScaledVector(right, move.x);
        if (moveDir.length() > 0.01) moveDir.normalize();

        // Apply horizontal velocity
        vel.current.x = moveDir.x * PLAYER_SPEED;
        vel.current.z = moveDir.z * PLAYER_SPEED;

        // ── Gravity ──
        vel.current.y -= GRAVITY * dt;

        // ── Jump ──
        if (jumpPressed.current && onGround.current) {
            vel.current.y = JUMP_VEL;
            onGround.current = false;
        }

        // ── Integrate position ──
        pos.current.x += vel.current.x * dt;
        pos.current.y += vel.current.y * dt;
        pos.current.z += vel.current.z * dt;

        // ── Ground collision ──
        const groundY = getSurfaceHeight(blocks, pos.current.x, pos.current.z);
        if (pos.current.y <= groundY) {
            pos.current.y = groundY;
            vel.current.y = 0;
            onGround.current = true;
        }

        // ── Respawn ──
        if (pos.current.y < -20) {
            pos.current.set(0, spawnY + 5, 0);
            vel.current.set(0, 0, 0);
        }

        // ── Camera ──
        camera.position.copy(pos.current);
        camera.position.y += 1.5; // Eye height
        camera.rotation.order = 'YXZ';
        camera.rotation.set(pitch.current, yaw.current, 0);

        onPosChange([pos.current.x, pos.current.y, pos.current.z]);
    });

    return null;
}

// ─────────────────────────────────────────────
//  Terrain Visual (InstancedMesh per type)
// ─────────────────────────────────────────────
function TerrainMesh({ blocks, onBlockClick }: {
    blocks: Map<string, WorldBlock>;
    onBlockClick: (e: any) => void;
}) {
    const blocksByType = useMemo(() => {
        const map = new Map<BlockType, WorldBlock[]>();
        blocks.forEach(b => {
            if (!map.has(b.type)) map.set(b.type, []);
            map.get(b.type)!.push(b);
        });
        return map;
    }, [blocks]);

    const geo = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);

    return (
        <group>
            {Array.from(blocksByType.entries()).map(([type, typeBlocks]) => {
                const isWater = type === 'water';
                const isTransparent = type === 'glass' || type === 'water' || type === 'leaves';
                return (
                    <instancedMesh
                        key={type}
                        args={[geo, undefined, typeBlocks.length]}
                        castShadow={!isWater}
                        receiveShadow={!isWater}
                        onClick={isWater ? undefined : (e: any) => { e.stopPropagation(); onBlockClick(e); }}
                        ref={(mesh: THREE.InstancedMesh | null) => {
                            if (!mesh) return;
                            mesh.material = new THREE.MeshLambertMaterial({
                                color: BLOCK_COLORS[type],
                                transparent: isTransparent,
                                opacity: type === 'glass' ? 0.4 : type === 'water' ? 0.6 : type === 'leaves' ? 0.85 : 1,
                            });
                            const matrix = new THREE.Matrix4();
                            typeBlocks.forEach((b, i) => {
                                matrix.setPosition(b.x, b.y, b.z);
                                mesh.setMatrixAt(i, matrix);
                            });
                            mesh.instanceMatrix.needsUpdate = true;
                        }}
                    />
                );
            })}
        </group>
    );
}

// ─────────────────────────────────────────────
//  Mob (simple walking box animal)
// ─────────────────────────────────────────────
function Mob({ startPos, mobSeed, worldSeed }: {
    startPos: [number, number, number];
    mobSeed: number;
    worldSeed: number;
}) {
    const groupRef = useRef<THREE.Group>(null!);
    const posRef = useRef(new THREE.Vector3(...startPos));
    const dirRef = useRef(Math.random() * Math.PI * 2);
    const timeRef = useRef(Math.random() * 100);

    const bodyColor = mobSeed % 2 === 0 ? '#f0a0a0' : '#f0f0f0';

    useFrame((_s, delta) => {
        timeRef.current += delta;

        if (Math.sin(timeRef.current * 0.5 + mobSeed) > 0.7) {
            dirRef.current += (hashNoise(timeRef.current, mobSeed, 42) - 0.5) * 3;
        }

        const nx = posRef.current.x + Math.cos(dirRef.current) * 0.6 * delta;
        const nz = posRef.current.z + Math.sin(dirRef.current) * 0.6 * delta;

        if (Math.abs(nx) < WORLD_SIZE / 2 - 2 && Math.abs(nz) < WORLD_SIZE / 2 - 2) {
            const h = terrainHeight(Math.floor(nx), Math.floor(nz), worldSeed);
            if (h > WATER_LEVEL) {
                posRef.current.x = nx;
                posRef.current.z = nz;
                posRef.current.y = h + 1.0;
            } else {
                dirRef.current += Math.PI;
            }
        } else {
            dirRef.current += Math.PI;
        }

        if (groupRef.current) {
            const bob = Math.sin(timeRef.current * 3) * 0.05;
            groupRef.current.position.set(posRef.current.x, posRef.current.y + bob, posRef.current.z);
            groupRef.current.rotation.y = -dirRef.current + Math.PI / 2;
        }
    });

    return (
        <group ref={groupRef} position={startPos}>
            <mesh position={[0, 0.3, 0]} castShadow>
                <boxGeometry args={[0.6, 0.5, 0.9]} />
                <meshLambertMaterial color={bodyColor} />
            </mesh>
            <mesh position={[0, 0.55, 0.45]} castShadow>
                <boxGeometry args={[0.45, 0.4, 0.4]} />
                <meshLambertMaterial color={bodyColor} />
            </mesh>
            <mesh position={[-0.12, 0.63, 0.66]}>
                <boxGeometry args={[0.07, 0.07, 0.02]} />
                <meshBasicMaterial color="#222" />
            </mesh>
            <mesh position={[0.12, 0.63, 0.66]}>
                <boxGeometry args={[0.07, 0.07, 0.02]} />
                <meshBasicMaterial color="#222" />
            </mesh>
            {[[-0.18, 0, -0.25], [0.18, 0, -0.25], [-0.18, 0, 0.25], [0.18, 0, 0.25]].map((lp, i) => (
                <mesh key={i} position={lp as [number, number, number]} castShadow>
                    <boxGeometry args={[0.12, 0.25, 0.12]} />
                    <meshLambertMaterial color={bodyColor} />
                </mesh>
            ))}
        </group>
    );
}

// ─────────────────────────────────────────────
//  Day/Night
// ─────────────────────────────────────────────
function DayNightCycle({ dayTime }: { dayTime: number }) {
    const sunAngle = (dayTime / DAY_LENGTH) * Math.PI * 2;
    const sunY = Math.sin(sunAngle) * 100;
    const sunX = Math.cos(sunAngle) * 100;
    const isDay = sunAngle % (Math.PI * 2) < Math.PI;
    const dayBlend = Math.max(0, Math.sin(sunAngle));

    return (
        <>
            <Sky
                sunPosition={[sunX, Math.max(sunY, -20), 50]}
                turbidity={isDay ? 8 : 1}
                rayleigh={isDay ? 2 : 0.1}
            />
            {!isDay && <Stars radius={100} depth={50} count={1500} factor={4} />}
            <ambientLight intensity={0.2 + dayBlend * 0.4} />
            <directionalLight
                castShadow
                intensity={0.3 + dayBlend * 0.6}
                position={[sunX * 0.3, Math.max(sunY * 0.3, 5), 15]}
                shadow-mapSize={[512, 512]}
            />
        </>
    );
}

// ─────────────────────────────────────────────
//  User-placed block (simple mesh, no cannon)
// ─────────────────────────────────────────────
function PlacedBlock({ position, type, onClick }: {
    position: [number, number, number];
    type: BlockType;
    onClick: (e: any) => void;
}) {
    return (
        <mesh
            position={position}
            onClick={(e: any) => { e.stopPropagation(); if (e.distance < 10) onClick(e); }}
            castShadow
            receiveShadow
        >
            <boxGeometry />
            <meshLambertMaterial
                color={BLOCK_COLORS[type]}
                transparent={type === 'glass' || type === 'water'}
                opacity={type === 'glass' ? 0.4 : type === 'water' ? 0.6 : 1}
            />
        </mesh>
    );
}

// ─────────────────────────────────────────────
//  Break Particles
// ─────────────────────────────────────────────
function BreakParticles({ position, color, onDone }: {
    position: [number, number, number]; color: string; onDone: () => void;
}) {
    const groupRef = useRef<THREE.Group>(null!);
    const parts = useRef(Array.from({ length: 6 }, () => ({
        p: new THREE.Vector3((Math.random() - 0.5) * 0.2, Math.random() * 0.2, (Math.random() - 0.5) * 0.2),
        v: new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 3 + 1, (Math.random() - 0.5) * 3),
        s: 0.05 + Math.random() * 0.08,
    })));
    const life = useRef(0);

    useFrame((_s, dt) => {
        life.current += dt;
        if (life.current > 0.6) { onDone(); return; }
        parts.current.forEach((p, i) => {
            p.p.add(p.v.clone().multiplyScalar(dt));
            p.v.y -= 10 * dt;
            const child = groupRef.current?.children[i];
            if (child) {
                child.position.copy(p.p);
                child.scale.setScalar(Math.max(0, 1 - life.current * 2));
            }
        });
    });

    return (
        <group ref={groupRef} position={position}>
            {parts.current.map((p, i) => (
                <mesh key={i} position={p.p}>
                    <boxGeometry args={[p.s, p.s, p.s]} />
                    <meshBasicMaterial color={color} />
                </mesh>
            ))}
        </group>
    );
}

// ─────────────────────────────────────────────
//  Main Component
// ─────────────────────────────────────────────
export default function MinecraftPage({ onClose }: { onClose: () => void }) {
    const [seed] = useState(() => Math.floor(Math.random() * 10000));
    const worldBlocks = useMemo(() => generateWorld(seed), [seed]);

    // User-placed / removed
    const [placedCubes, setPlacedCubes] = useState<Array<{ key: string; pos: [number, number, number]; type: BlockType }>>([]);
    const [removedKeys, setRemovedKeys] = useState<Set<string>>(new Set());
    const [activeMaterial, setActiveMaterial] = useState<BlockType>('dirt');
    const [mode, setMode] = useState<'build' | 'break'>('build');

    // Using REFS for input to avoid re-renders
    const moveInputRef = useRef({ x: 0, y: 0 });
    const lookInputRef = useRef({ x: 0, y: 0 });
    const jumpPressedRef = useRef(false);

    // Touch tracking
    const moveTouchId = useRef<number | null>(null);
    const lookTouchId = useRef<number | null>(null);
    const moveCenter = useRef({ x: 0, y: 0 });
    const lookPrev = useRef({ x: 0, y: 0 });

    // Player pos for HUD
    const [playerPos, setPlayerPos] = useState<[number, number, number]>([0, 10, 0]);

    // Day/Night
    const [dayTime, setDayTime] = useState(30);
    useEffect(() => {
        const iv = setInterval(() => setDayTime(p => (p + 0.1) % DAY_LENGTH), 100);
        return () => clearInterval(iv);
    }, []);

    // Particles
    const [particles, setParticles] = useState<Array<{ id: number; pos: [number, number, number]; color: string }>>([]);
    const pidRef = useRef(0);

    const spawnY = useMemo(() => Math.max(terrainHeight(0, 0, seed), WATER_LEVEL) + 2, [seed]);

    // Mobs
    const mobs = useMemo(() => {
        const result: Array<{ pos: [number, number, number]; seed: number }> = [];
        for (let i = 0; i < 3; i++) {
            const mx = Math.floor((hashNoise(i, 0, seed + 1000) - 0.5) * WORLD_SIZE * 0.5);
            const mz = Math.floor((hashNoise(0, i, seed + 2000) - 0.5) * WORLD_SIZE * 0.5);
            const h = terrainHeight(mx, mz, seed);
            if (h > WATER_LEVEL) result.push({ pos: [mx, h + 1.5, mz], seed: seed + i });
        }
        return result;
    }, [seed]);

    // Visible blocks
    const visibleWorldBlocks = useMemo(() => {
        const filtered = new Map(worldBlocks);
        removedKeys.forEach(k => filtered.delete(k));
        // Also add placed cubes for collision
        placedCubes.forEach(c => {
            filtered.set(c.key, { x: c.pos[0], y: c.pos[1], z: c.pos[2], type: c.type });
        });
        return filtered;
    }, [worldBlocks, removedKeys, placedCubes]);

    // Block click
    const handleBlockClick = useCallback((e: any) => {
        if (!e?.face) return;
        const { point, face } = e;

        if (mode === 'build') {
            const x = Math.floor(point.x + face.normal.x * 0.5);
            const y = Math.floor(point.y + face.normal.y * 0.5);
            const z = Math.floor(point.z + face.normal.z * 0.5);
            const key = `${x},${y},${z}`;
            if (!visibleWorldBlocks.has(key)) {
                setPlacedCubes(prev => [...prev, { key, pos: [x, y, z], type: activeMaterial }]);
            }
        } else {
            const cx = Math.floor(point.x - face.normal.x * 0.5);
            const cy = Math.floor(point.y - face.normal.y * 0.5);
            const cz = Math.floor(point.z - face.normal.z * 0.5);
            const key = `${cx},${cy},${cz}`;

            const placedIdx = placedCubes.findIndex(c => c.key === key);
            if (placedIdx >= 0) {
                const block = placedCubes[placedIdx];
                setParticles(prev => [...prev, { id: pidRef.current++, pos: block.pos, color: BLOCK_COLORS[block.type] }]);
                setPlacedCubes(prev => prev.filter((_, i) => i !== placedIdx));
            } else {
                const wb = worldBlocks.get(key);
                if (wb && wb.type !== 'water') {
                    setParticles(prev => [...prev, { id: pidRef.current++, pos: [wb.x, wb.y, wb.z], color: BLOCK_COLORS[wb.type] }]);
                    setRemovedKeys(prev => new Set(prev).add(key));
                }
            }
        }
    }, [activeMaterial, placedCubes, mode, visibleWorldBlocks, worldBlocks]);

    // ── Touch handlers using native events for reliability ──
    useEffect(() => {
        const el = document.getElementById('mc-touch-layer');
        if (!el) return;

        const JOYSTICK_R = 50;

        const onStart = (e: TouchEvent) => {
            e.preventDefault();
            const w = window.innerWidth;
            for (let i = 0; i < e.changedTouches.length; i++) {
                const t = e.changedTouches[i];
                if (t.clientX < w * 0.4) {
                    // Left side → joystick
                    if (moveTouchId.current === null) {
                        moveTouchId.current = t.identifier;
                        moveCenter.current = { x: t.clientX, y: t.clientY };
                    }
                } else if (t.clientX > w * 0.6) {
                    // Right side → look
                    if (lookTouchId.current === null) {
                        lookTouchId.current = t.identifier;
                        lookPrev.current = { x: t.clientX, y: t.clientY };
                    }
                }
            }
        };

        const onMove = (e: TouchEvent) => {
            e.preventDefault();
            for (let i = 0; i < e.changedTouches.length; i++) {
                const t = e.changedTouches[i];

                if (t.identifier === moveTouchId.current) {
                    const dx = t.clientX - moveCenter.current.x;
                    const dy = t.clientY - moveCenter.current.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    const clamped = Math.min(dist, JOYSTICK_R);
                    const angle = Math.atan2(dy, dx);
                    moveInputRef.current = {
                        x: (Math.cos(angle) * clamped) / JOYSTICK_R,
                        y: (Math.sin(angle) * clamped) / JOYSTICK_R,
                    };
                }

                if (t.identifier === lookTouchId.current) {
                    const dx = t.clientX - lookPrev.current.x;
                    const dy = t.clientY - lookPrev.current.y;
                    lookInputRef.current = { x: dx * 0.08, y: dy * 0.08 };
                    lookPrev.current = { x: t.clientX, y: t.clientY };
                }
            }
        };

        const onEnd = (e: TouchEvent) => {
            for (let i = 0; i < e.changedTouches.length; i++) {
                const t = e.changedTouches[i];
                if (t.identifier === moveTouchId.current) {
                    moveTouchId.current = null;
                    moveInputRef.current = { x: 0, y: 0 };
                }
                if (t.identifier === lookTouchId.current) {
                    lookTouchId.current = null;
                    lookInputRef.current = { x: 0, y: 0 };
                }
            }
        };

        el.addEventListener('touchstart', onStart, { passive: false });
        el.addEventListener('touchmove', onMove, { passive: false });
        el.addEventListener('touchend', onEnd);
        el.addEventListener('touchcancel', onEnd);

        return () => {
            el.removeEventListener('touchstart', onStart);
            el.removeEventListener('touchmove', onMove);
            el.removeEventListener('touchend', onEnd);
            el.removeEventListener('touchcancel', onEnd);
        };
    }, []);

    // Reset look each frame (consumed by PlayerController via ref)
    // PlayerController reads lookInputRef directly, so we zero it after a short delay
    useEffect(() => {
        const iv = setInterval(() => {
            if (lookTouchId.current === null) {
                lookInputRef.current = { x: 0, y: 0 };
            }
        }, 60);
        return () => clearInterval(iv);
    }, []);

    const resetWorld = useCallback(() => {
        setPlacedCubes([]);
        setRemovedKeys(new Set());
        setParticles([]);
    }, []);

    const timeStr = (() => {
        const hour = Math.floor((dayTime / DAY_LENGTH) * 24);
        const min = Math.floor(((dayTime / DAY_LENGTH) * 24 - hour) * 60);
        return `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    })();

    return (
        <div className="fixed inset-0 z-50 bg-sky-300 select-none" style={{ touchAction: 'none' }}>
            {/* Touch capture layer - sits above Canvas */}
            <div
                id="mc-touch-layer"
                className="absolute inset-0 z-10"
                style={{ touchAction: 'none' }}
            />

            <Canvas
                shadows
                camera={{ fov: 70, near: 0.1, far: 150 }}
                gl={{ antialias: false, powerPreference: 'high-performance' }}
                style={{ position: 'absolute', inset: 0, zIndex: 0 }}
            >
                <fog attach="fog" args={['#b0d0ff', 30, 60]} />
                <DayNightCycle dayTime={dayTime} />

                <PlayerController
                    moveInput={moveInputRef}
                    lookInput={lookInputRef}
                    jumpPressed={jumpPressedRef}
                    spawnY={spawnY}
                    blocks={visibleWorldBlocks}
                    onPosChange={setPlayerPos}
                />

                <TerrainMesh blocks={visibleWorldBlocks} onBlockClick={handleBlockClick} />

                {placedCubes.map(cube => (
                    <PlacedBlock key={cube.key} position={cube.pos} type={cube.type} onClick={handleBlockClick} />
                ))}

                {mobs.map((mob, i) => (
                    <Mob key={i} startPos={mob.pos} mobSeed={mob.seed} worldSeed={seed} />
                ))}

                {particles.map(p => (
                    <BreakParticles
                        key={p.id} position={p.pos} color={p.color}
                        onDone={() => setParticles(prev => prev.filter(pp => pp.id !== p.id))}
                    />
                ))}
            </Canvas>

            {/* ── HUD ── */}

            {/* Crosshair */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-30">
                <svg width="24" height="24" viewBox="0 0 24 24">
                    <line x1="12" y1="5" x2="12" y2="10" stroke="white" strokeWidth="2" opacity="0.6" />
                    <line x1="12" y1="14" x2="12" y2="19" stroke="white" strokeWidth="2" opacity="0.6" />
                    <line x1="5" y1="12" x2="10" y2="12" stroke="white" strokeWidth="2" opacity="0.6" />
                    <line x1="14" y1="12" x2="19" y2="12" stroke="white" strokeWidth="2" opacity="0.6" />
                </svg>
            </div>

            {/* Top-Left: Menu + Coords */}
            <div className="absolute top-3 left-3 z-30 flex gap-2 items-start">
                <button onClick={onClose} className="p-2 bg-black/50 rounded-lg text-white backdrop-blur-sm active:scale-95 pointer-events-auto">
                    <ArrowLeft size={18} />
                </button>
                <button onClick={resetWorld} className="p-2 bg-black/50 rounded-lg text-white backdrop-blur-sm active:scale-95 pointer-events-auto">
                    <RotateCcw size={18} />
                </button>
                <div className="bg-black/50 backdrop-blur-sm rounded-lg px-2.5 py-1.5 text-[10px] text-green-300 font-mono leading-relaxed pointer-events-none">
                    <div>X:{Math.floor(playerPos[0])} Y:{Math.floor(playerPos[1])} Z:{Math.floor(playerPos[2])}</div>
                    <div>🕐 {timeStr}</div>
                </div>
            </div>

            {/* Top-Right: Mode */}
            <div className="absolute top-3 right-3 z-30 flex items-center bg-black/50 rounded-lg p-1 backdrop-blur-sm pointer-events-auto">
                <button
                    onClick={() => setMode('build')}
                    className={`px-3 py-1.5 rounded text-xs font-bold transition-colors ${mode === 'build' ? 'bg-green-500 text-white' : 'text-gray-300'}`}
                >⛏ 建造</button>
                <div className="w-px h-4 bg-white/20 mx-0.5" />
                <button
                    onClick={() => setMode('break')}
                    className={`px-3 py-1.5 rounded text-xs font-bold transition-colors ${mode === 'break' ? 'bg-red-500 text-white' : 'text-gray-300'}`}
                >💥 破坏</button>
            </div>

            {/* Jump Button */}
            <div className="absolute bottom-20 right-6 z-30 pointer-events-auto">
                <button
                    className="w-14 h-14 rounded-full bg-white/15 backdrop-blur-sm border-2 border-white/25 flex items-center justify-center active:bg-white/30"
                    onTouchStart={(e) => { e.stopPropagation(); jumpPressedRef.current = true; }}
                    onTouchEnd={(e) => { e.stopPropagation(); jumpPressedRef.current = false; }}
                >
                    <span className="text-white text-lg">⬆</span>
                </button>
            </div>

            {/* Hotbar */}
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 bg-black/60 p-1 rounded-xl backdrop-blur-sm flex gap-1 pointer-events-auto overflow-x-auto max-w-[85vw]">
                {ALL_BLOCKS.map((mat) => (
                    <button
                        key={mat}
                        onClick={() => setActiveMaterial(mat)}
                        className={`relative w-10 h-10 rounded-md border-2 transition-all active:scale-95 flex-shrink-0 ${activeMaterial === mat
                            ? 'border-yellow-400 scale-110 shadow-lg shadow-yellow-400/30'
                            : 'border-transparent opacity-60'}`}
                        style={{ backgroundColor: BLOCK_COLORS[mat] }}
                    >
                        {activeMaterial === mat && (
                            <div className="absolute -top-5 left-1/2 -translate-x-1/2 text-[8px] text-yellow-300 font-bold whitespace-nowrap bg-black/60 px-1 rounded">
                                {BLOCK_LABELS[mat]}
                            </div>
                        )}
                    </button>
                ))}
            </div>

            {/* Visual hints */}
            <div className="absolute bottom-14 left-12 w-20 h-20 rounded-full border-2 border-white/10 pointer-events-none flex items-center justify-center z-20">
                <div className="text-[9px] text-white/30">移动</div>
            </div>
            <div className="absolute bottom-36 right-6 text-[9px] text-white/20 pointer-events-none z-20">
                视角
            </div>
        </div>
    );
}
