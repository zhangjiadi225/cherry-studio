import { Group, Vector3 } from 'three'
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
})
