import { usePlane } from '@react-three/cannon';
import { useStore } from '../store';

export const Ground = () => {
    const [ref] = usePlane(() => ({
        rotation: [-Math.PI / 2, 0, 0],
        position: [0, -0.5, 0],
        type: 'Static',
    }));

    const addCube = useStore((state: any) => state.addCube);

    const handleClick = (e: any) => {
        e.stopPropagation();
        // Place cube on ground
        const [x, y, z] = Object.values(e.point).map((val: any) => Math.ceil(val));
        addCube(x, y, z);
    }

    return (
        <mesh
            onClick={handleClick}
            ref={ref as any}
            rotation={[-Math.PI / 2, 0, 0]}
            position={[0, -0.5, 0]}
        >
            <planeGeometry attach="geometry" args={[100, 100]} />
            <meshStandardMaterial attach="material" color="green" />
        </mesh>
    );
};
