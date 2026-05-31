import { Box3, BoxGeometry, Group, Mesh, MeshBasicMaterial, Object3D, Vector3 } from 'three'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { loadPetVrmModel } from '../vrmLoader'

const mocks = vi.hoisted(() => ({
  combineSkeletons: vi.fn(),
  deepDispose: vi.fn(),
  loadAsync: vi.fn(),
  register: vi.fn(),
  removeUnnecessaryVertices: vi.fn(),
  rotateVRM0: vi.fn()
}))

vi.mock('@pixiv/three-vrm', () => ({
  VRM: class VRM {},
  VRMLoaderPlugin: class VRMLoaderPlugin {},
  VRMUtils: {
    combineSkeletons: mocks.combineSkeletons,
    deepDispose: mocks.deepDispose,
    removeUnnecessaryVertices: mocks.removeUnnecessaryVertices,
    rotateVRM0: mocks.rotateVRM0
  }
}))

vi.mock('three/addons/loaders/GLTFLoader.js', () => ({
  GLTFLoader: class GLTFLoader {
    public loadAsync = mocks.loadAsync
    public register = mocks.register
  }
}))

describe('loadPetVrmModel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses the VRM faceFront group rotation without applying rotateVRM0 or an extra scene Y flip', async () => {
    const vrmScene = new Group()
    vrmScene.rotation.y = 0.25
    const vrm = {
      lookAt: { faceFront: new Vector3(0, 0, 1) },
      scene: vrmScene,
      springBoneManager: { reset: vi.fn() }
    }
    mocks.loadAsync.mockResolvedValue({
      scene: new Group(),
      userData: { vrm }
    })

    const loaded = await loadPetVrmModel('blob:model')

    expect(mocks.removeUnnecessaryVertices).toHaveBeenCalledWith(vrmScene)
    expect(mocks.combineSkeletons).toHaveBeenCalledWith(vrmScene)
    expect(mocks.rotateVRM0).not.toHaveBeenCalled()
    expect(vrmScene.rotation.y).toBe(0.25)
    expect(loaded.root.children).toContain(vrmScene)
    expect(loaded.root.quaternion.equals(new Group().quaternion)).toBe(false)
    expect(vrm.springBoneManager.reset).toHaveBeenCalled()
  })

  it('normalizes the visible VRM model bottom to the root ground plane', async () => {
    const vrmScene = new Group()
    const mesh = new Mesh(new BoxGeometry(1, 2, 1), new MeshBasicMaterial())
    const hips = new Object3D()
    hips.name = 'hips'
    hips.position.y = 0.8
    mesh.position.y = -0.5
    vrmScene.add(mesh)
    vrmScene.add(hips)
    const vrm = {
      humanoid: {
        getNormalizedBoneNode: vi.fn(() => hips)
      },
      lookAt: { faceFront: new Vector3(0, 0, -1) },
      scene: vrmScene,
      springBoneManager: { reset: vi.fn() }
    }
    mocks.loadAsync.mockResolvedValue({
      scene: new Group(),
      userData: { vrm }
    })

    const loaded = await loadPetVrmModel('blob:model')
    const bounds = new Box3().setFromObject(loaded.root)

    expect(bounds.min.y).toBeCloseTo(0)
    expect(vrmScene.position.y).toBeCloseTo(1.5)
    expect(loaded.groundOffsetY).toBeCloseTo(1.5)
    expect(loaded.animationAnchor).toMatchObject({
      nodeName: 'hips',
      position: expect.objectContaining({ y: 0.8 })
    })
  })
})
