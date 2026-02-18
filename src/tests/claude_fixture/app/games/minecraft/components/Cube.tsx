import { useBox } from '@react-three/cannon';
import { useState } from 'react';
import { useStore } from '../store';

const TEXTURES = {
    dirt: 'brown',
    grass: 'green',
    glass: 'skyblue',
    wood: 'burlywood',
    log: 'saddlebrown',
};

export const Cube = ({ position, texture }: { position: [number, number, number], texture: string }) => {
    const [ref] = useBox(() => ({
        type: 'Static',
        position,
    }));

    const addCube = useStore((state: any) => state.addCube);
    const removeCube = useStore((state: any) => state.removeCube);

    const [isHovered, setIsHovered] = useState(false);

    const handleClick = (e: any) => {
        e.stopPropagation();
        const clickedFace = Math.floor(e.faceIndex / 2);
        const { x, y, z } = ref.current!.position;

        if (e.altKey) {
            removeCube(x, y, z);
            return;
        }

        // Add cube logic based on face index
        if (clickedFace === 0) {
            addCube(x + 1, y, z);
        } else if (clickedFace === 1) {
            addCube(x - 1, y, z);
        } else if (clickedFace === 2) {
            addCube(x, y + 1, z);
        } else if (clickedFace === 3) {
            addCube(x, y - 1, z);
        } else if (clickedFace === 4) {
            addCube(x, y, z + 1);
        } else if (clickedFace === 5) {
            addCube(x, y, z - 1);
        }
    };

    return (
        <mesh
            ref={ref as any}
            onClick={handleClick}
            onPointerMove={(e) => {
                e.stopPropagation();
                setIsHovered(true);
            }}
            onPointerOut={(e) => {
                e.stopPropagation();
                setIsHovered(false);
            }}
        >
            <boxGeometry attach="geometry" />
            <meshStandardMaterial
                attach="material"
                color={isHovered ? 'grey' : (TEXTURES[texture as keyof typeof TEXTURES] || 'white')}
                transparent={texture === 'glass'}
                opacity={texture === 'glass' ? 0.6 : 1}
            />
        </mesh>
    );
};
