import create from 'zustand';

export const generateId = () => Math.random().toString(36).substring(2, 9);

type CubeType = {
    key: string;
    pos: [number, number, number];
    texture: string;
};

interface MinecraftState {
    texture: string;
    cubes: CubeType[];
    addCube: (x: number, y: number, z: number) => void;
    removeCube: (x: number, y: number, z: number) => void;
    setTexture: (texture: string) => void;
    saveWorld: () => void;
    resetWorld: () => void;
}

export const useStore = create<MinecraftState>((set) => ({
    texture: 'dirt',
    cubes: [
        { key: generateId(), pos: [0, 0, 0], texture: 'dirt' },
        { key: generateId(), pos: [1, 0, 0], texture: 'wood' },
        { key: generateId(), pos: [0, 1, 0], texture: 'grass' },
    ],
    addCube: (x, y, z) => set((state) => ({
        cubes: [...state.cubes, { key: generateId(), pos: [x, y, z], texture: state.texture }]
    })),
    removeCube: (x, y, z) => set((state) => ({
        cubes: state.cubes.filter(cube => {
            const [cx, cy, cz] = cube.pos;
            return cx !== x || cy !== y || cz !== z;
        })
    })),
    setTexture: (texture) => set(() => ({ texture })),
    saveWorld: () => {
        // LocalStorage logic can be added here
    },
    resetWorld: () => set(() => ({
        cubes: []
    })),
}));
