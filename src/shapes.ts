import * as THREE from 'three'

export type ShapeName = 'box' | 'sphere' | 'torus' | 'icosahedron' | 'knot'

export const SHAPES: { value: ShapeName; label: string }[] = [
  { value: 'box', label: 'Cube' },
  { value: 'sphere', label: 'Sphere' },
  { value: 'torus', label: 'Torus' },
  { value: 'icosahedron', label: 'Icosahedron' },
  { value: 'knot', label: 'Torus knot' },
]

// Radii are tuned so every shape occupies roughly the same volume on screen.
export function createGeometry(shape: ShapeName): THREE.BufferGeometry {
  switch (shape) {
    case 'sphere':
      return new THREE.SphereGeometry(0.72, 48, 32)
    case 'torus':
      return new THREE.TorusGeometry(0.55, 0.22, 24, 64)
    case 'icosahedron':
      return new THREE.IcosahedronGeometry(0.78, 0)
    case 'knot':
      return new THREE.TorusKnotGeometry(0.5, 0.16, 128, 24)
    case 'box':
    default:
      return new THREE.BoxGeometry(1, 1, 1)
  }
}
