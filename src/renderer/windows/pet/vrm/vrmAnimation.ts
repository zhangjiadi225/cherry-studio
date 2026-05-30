import type { VRM } from '@pixiv/three-vrm'
import { VRMExpressionPresetName } from '@pixiv/three-vrm'
import type { VRMAnimation } from '@pixiv/three-vrm-animation'
import { createVRMAnimationClip, VRMAnimationLoaderPlugin } from '@pixiv/three-vrm-animation'
import type { AnimationClip } from 'three'
import { Object3D, Vector3, VectorKeyframeTrack } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

export type PetVrmBlinkRuntime = {
  blinkProgress: number
  isBlinking: boolean
  nextBlinkTime: number
  timeSinceLastBlink: number
}

export type PetVrmIdleEyeSaccadeRuntime = {
  fixationTarget: Vector3
  nextSaccadeAfter: number
  timeSinceLastSaccade: number
}

type GltfWithVrmAnimations = {
  userData: {
    vrmAnimations?: VRMAnimation[]
  }
}

const PET_VRM_BLINK_DURATION_SECONDS = 0.2
const PET_VRM_BLINK_INTERVAL_MIN_SECONDS = 1
const PET_VRM_BLINK_INTERVAL_MAX_SECONDS = 6
const PET_VRM_EYE_SACCADE_TARGET_OFFSET = 0.25
const PET_VRM_EYE_SACCADE_INTERVAL_STEP_MS = 400
const PET_VRM_EYE_SACCADE_INTERVAL_PROBABILITIES: Array<[number, number]> = [
  [0.075, 800],
  [0.11, 0],
  [0.125, 0],
  [0.14, 0],
  [0.125, 0],
  [0.05, 0],
  [0.04, 0],
  [0.03, 0],
  [0.02, 0],
  [1, 0]
]

for (let index = 1; index < PET_VRM_EYE_SACCADE_INTERVAL_PROBABILITIES.length; index += 1) {
  PET_VRM_EYE_SACCADE_INTERVAL_PROBABILITIES[index][0] += PET_VRM_EYE_SACCADE_INTERVAL_PROBABILITIES[index - 1][0]
  PET_VRM_EYE_SACCADE_INTERVAL_PROBABILITIES[index][1] =
    PET_VRM_EYE_SACCADE_INTERVAL_PROBABILITIES[index - 1][1] + PET_VRM_EYE_SACCADE_INTERVAL_STEP_MS
}

export async function loadPetVrmAnimation(url: string): Promise<VRMAnimation | undefined> {
  const loader = new GLTFLoader()
  loader.register((parser) => new VRMAnimationLoaderPlugin(parser))

  const gltf = (await loader.loadAsync(url)) as GltfWithVrmAnimations
  const animations = gltf.userData.vrmAnimations
  if (!animations || animations.length === 0) return undefined

  return animations[0]
}

export function createPetVrmAnimationClip(vrm: VRM, animation: VRMAnimation): AnimationClip {
  return createVRMAnimationClip(animation, vrm)
}

export function reAnchorRootPositionTrack(clip: AnimationClip, vrm: VRM): void {
  const hipNode = vrm.humanoid?.getNormalizedBoneNode('hips')
  if (!hipNode) return

  hipNode.updateMatrixWorld(true)
  const defaultHipPosition = new Vector3()
  hipNode.getWorldPosition(defaultHipPosition)

  const hipsTrack = clip.tracks.find(
    (track) => track instanceof VectorKeyframeTrack && track.name === `${hipNode.name}.position`
  )
  if (!(hipsTrack instanceof VectorKeyframeTrack)) return

  const animatedHipPosition = new Vector3(hipsTrack.values[0], hipsTrack.values[1], hipsTrack.values[2])
  const animationDelta = new Vector3().subVectors(animatedHipPosition, defaultHipPosition)

  for (const track of clip.tracks) {
    if (!track.name.endsWith('.position') || !(track instanceof VectorKeyframeTrack)) continue

    for (let index = 0; index < track.values.length; index += 3) {
      track.values[index] -= animationDelta.x
      track.values[index + 1] -= animationDelta.y
      track.values[index + 2] -= animationDelta.z
    }
  }
}

export function createPetVrmBlinkRuntime(): PetVrmBlinkRuntime {
  return {
    blinkProgress: 0,
    isBlinking: false,
    nextBlinkTime: getNextPetVrmBlinkInterval(),
    timeSinceLastBlink: 0
  }
}

export function updatePetVrmBlink(
  vrm: VRM | undefined,
  runtime: PetVrmBlinkRuntime,
  enabled: boolean,
  delta: number
): void {
  const expressionManager = vrm?.expressionManager
  if (!expressionManager) return

  if (!enabled) {
    resetBlinkExpression(expressionManager)
    runtime.isBlinking = false
    runtime.blinkProgress = 0
    runtime.timeSinceLastBlink = 0
    return
  }

  runtime.timeSinceLastBlink += delta

  if (!runtime.isBlinking && runtime.timeSinceLastBlink >= runtime.nextBlinkTime) {
    runtime.isBlinking = true
    runtime.blinkProgress = 0
  }

  if (!runtime.isBlinking) return

  runtime.blinkProgress += delta / PET_VRM_BLINK_DURATION_SECONDS
  const blinkValue = Math.sin(Math.PI * runtime.blinkProgress)
  expressionManager.setValue(VRMExpressionPresetName.Blink, blinkValue)

  if (runtime.blinkProgress < 1) return

  runtime.isBlinking = false
  runtime.blinkProgress = 0
  runtime.timeSinceLastBlink = 0
  runtime.nextBlinkTime = getNextPetVrmBlinkInterval()
  resetBlinkExpression(expressionManager)
}

export function createPetVrmIdleEyeSaccadeRuntime(): PetVrmIdleEyeSaccadeRuntime {
  return {
    fixationTarget: new Vector3(),
    nextSaccadeAfter: -1,
    timeSinceLastSaccade: 0
  }
}

export function updatePetVrmIdleEyeSaccades(
  vrm: VRM | undefined,
  runtime: PetVrmIdleEyeSaccadeRuntime,
  lookAtTarget: Object3D,
  enabled: boolean,
  delta: number
): void {
  if (!vrm?.expressionManager || !vrm.lookAt) return

  if (!enabled) {
    runtime.timeSinceLastSaccade += delta
    vrm.lookAt.reset()
    return
  }

  if (runtime.timeSinceLastSaccade >= runtime.nextSaccadeAfter) {
    updateFixationTarget(runtime.fixationTarget, lookAtTarget.position, PET_VRM_EYE_SACCADE_TARGET_OFFSET)
    runtime.timeSinceLastSaccade = 0
    runtime.nextSaccadeAfter = getNextPetVrmEyeSaccadeInterval() / 1000
  }

  if (!vrm.lookAt.target) {
    vrm.lookAt.target = new Object3D()
  }

  vrm.lookAt.target.position.lerp(runtime.fixationTarget, 1)
  vrm.lookAt.update(delta)
  runtime.timeSinceLastSaccade += delta
}

export function updatePetVrmIdleEyeSaccadesImmediately(
  vrm: VRM | undefined,
  runtime: PetVrmIdleEyeSaccadeRuntime,
  lookAtTarget: Object3D
): void {
  runtime.fixationTarget.copy(lookAtTarget.position)
  if (!vrm?.expressionManager || !vrm.lookAt) return

  if (!vrm.lookAt.target) {
    vrm.lookAt.target = new Object3D()
  }

  vrm.lookAt.target.position.lerp(runtime.fixationTarget, 1)
  vrm.lookAt.update(0.016)
}

export function getNextPetVrmEyeSaccadeInterval(): number {
  const value = Math.random()
  for (const [probability, interval] of PET_VRM_EYE_SACCADE_INTERVAL_PROBABILITIES) {
    if (value <= probability) return interval + Math.random() * PET_VRM_EYE_SACCADE_INTERVAL_STEP_MS
  }

  return PET_VRM_EYE_SACCADE_INTERVAL_PROBABILITIES.at(-1)![1] + Math.random() * PET_VRM_EYE_SACCADE_INTERVAL_STEP_MS
}

function updateFixationTarget(target: Vector3, lookAtTarget: Vector3, offset: number): void {
  target.set(lookAtTarget.x + randomOffset(offset), lookAtTarget.y + randomOffset(offset), lookAtTarget.z)
}

function randomOffset(offset: number): number {
  return Math.random() * offset * 2 - offset
}

function getNextPetVrmBlinkInterval(): number {
  return (
    Math.random() * (PET_VRM_BLINK_INTERVAL_MAX_SECONDS - PET_VRM_BLINK_INTERVAL_MIN_SECONDS) +
    PET_VRM_BLINK_INTERVAL_MIN_SECONDS
  )
}

function resetBlinkExpression(expressionManager: NonNullable<VRM['expressionManager']>): void {
  expressionManager.setValue(VRMExpressionPresetName.Blink, 0)
}
