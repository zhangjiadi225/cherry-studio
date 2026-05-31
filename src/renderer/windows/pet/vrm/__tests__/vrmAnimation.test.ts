import { AnimationClip, Object3D, Vector3, VectorKeyframeTrack } from 'three'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createPetVrmBlinkRuntime,
  createPetVrmIdleEyeSaccadeRuntime,
  getNextPetVrmEyeSaccadeInterval,
  reAnchorRootPositionTrack,
  updatePetVrmBlink,
  updatePetVrmIdleEyeSaccades
} from '../vrmAnimation'

vi.mock('@pixiv/three-vrm-animation', () => ({
  createVRMAnimationClip: vi.fn(),
  VRMAnimationLoaderPlugin: class VRMAnimationLoaderPlugin {}
}))

describe('vrmAnimation', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('re-anchors every position track by the VRM hips offset', () => {
    const hipNode = new Object3D()
    hipNode.name = 'hips'
    hipNode.position.set(1, 2, 3)
    const hipsTrack = new VectorKeyframeTrack('hips.position', [0, 1], [4, 6, 8, 5, 7, 9])
    const headTrack = new VectorKeyframeTrack('head.position', [0], [10, 11, 12])
    const clip = new AnimationClip('idle', 1, [hipsTrack, headTrack])
    const vrm = {
      humanoid: {
        getNormalizedBoneNode: vi.fn(() => hipNode)
      }
    }

    reAnchorRootPositionTrack(clip, vrm as never)

    expect(Array.from(hipsTrack.values)).toEqual([1, 2, 3, 2, 3, 4])
    expect(Array.from(headTrack.values)).toEqual([7, 7, 7])
  })

  it('re-anchors position tracks from a cached rest hips position', () => {
    const hipNode = new Object3D()
    hipNode.name = 'hips'
    hipNode.position.set(50, 60, 70)
    const hipsTrack = new VectorKeyframeTrack('hips.position', [0, 1], [4, 6, 8, 5, 7, 9])
    const clip = new AnimationClip('idle', 1, [hipsTrack])
    const vrm = {
      humanoid: {
        getNormalizedBoneNode: vi.fn(() => hipNode)
      }
    }

    reAnchorRootPositionTrack(clip, vrm as never, {
      nodeName: 'hips',
      position: new Vector3(1, 2, 3)
    })

    expect(Array.from(hipsTrack.values)).toEqual([1, 2, 3, 2, 3, 4])
  })

  it('uses pet VRM blink timing and sine weight', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const runtime = createPetVrmBlinkRuntime()
    const setValue = vi.fn()
    const vrm = { expressionManager: { setValue } }

    updatePetVrmBlink(vrm as never, runtime, true, 0.9)
    expect(setValue).not.toHaveBeenCalled()

    updatePetVrmBlink(vrm as never, runtime, true, 0.1)
    expect(setValue).toHaveBeenLastCalledWith('blink', 1)

    updatePetVrmBlink(vrm as never, runtime, true, 0.1)
    expect(setValue).toHaveBeenLastCalledWith('blink', 0)
  })

  it('uses pet VRM idle eye saccade intervals and look-at target updates', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    expect(getNextPetVrmEyeSaccadeInterval()).toBe(800)

    const runtime = createPetVrmIdleEyeSaccadeRuntime()
    const lookAtTarget = new Object3D()
    lookAtTarget.position.set(1, 2, -100)
    const vrm = {
      expressionManager: {},
      lookAt: {
        target: undefined as Object3D | undefined,
        reset: vi.fn(),
        update: vi.fn()
      }
    }

    updatePetVrmIdleEyeSaccades(vrm as never, runtime, lookAtTarget, true, 0.016)

    expect(vrm.lookAt.target?.position).toEqual(new Vector3(0.75, 1.75, -100))
    expect(vrm.lookAt.update).toHaveBeenCalledWith(0.016)
  })
})
