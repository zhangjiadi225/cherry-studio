import { VRMExpressionPresetName } from '@pixiv/three-vrm'
import {
  normalizePetVrmStageSceneSettings,
  PET_VRM_STAGE_DEFAULT_SCENE_SETTINGS,
  type PetVrmStageAnimationPreset
} from '@shared/pet'
import type { FC } from 'react'
import { useEffect, useRef } from 'react'
import {
  ACESFilmicToneMapping,
  AmbientLight,
  AnimationMixer,
  Box3,
  Clock,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MOUSE,
  Object3D,
  PerspectiveCamera,
  Raycaster,
  Scene,
  TOUCH,
  Vector2,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

import type {
  PetVrmStageLookAtPoint,
  PetVrmStageModel,
  PetVrmStageModelLoadState,
  PetVrmStageSceneSettings
} from './types'
import {
  createPetVrmAnimationClip,
  createPetVrmBlinkRuntime,
  createPetVrmIdleEyeSaccadeRuntime,
  loadPetVrmAnimation,
  type PetVrmBlinkRuntime,
  type PetVrmIdleEyeSaccadeRuntime,
  reAnchorRootPositionTrack,
  updatePetVrmBlink,
  updatePetVrmIdleEyeSaccadesImmediately
} from './vrmAnimation'
import { getPetVrmStageAnimationPresetUrl } from './vrmAnimationPresets'
import { disposePetVrmModel, type LoadedPetVrm, loadPetVrmModel } from './vrmLoader'
import { createPetVrmModelObjectUrl } from './vrmModelLibrary'

type VrmPastureSceneProps = {
  hitTestPoint?: PetVrmStageLookAtPoint | null
  lookAtPoint?: PetVrmStageLookAtPoint | null
  models: PetVrmStageModel[]
  onHitTestTransparencyChange?: (transparent: boolean) => void
  onModelLoadStateChange?: (state: PetVrmStageModelLoadState) => void
  onSceneSettingsChange?: (settings: PetVrmStageSceneSettings) => void
  sceneSettings?: PetVrmStageSceneSettings
  stageHeight: number
  stageWidth: number
}

type SceneRuntime = {
  ambientLight: AmbientLight
  applyingCameraState: boolean
  camera: PerspectiveCamera
  cameraDistance: number
  cameraDirection: Vector3
  clock: Clock
  controls: OrbitControls
  directionalLight: DirectionalLight
  frameId: number | null
  gazeTarget: Object3D
  hemisphereLight: HemisphereLight
  lastCameraSettingsKey: string
  lastHitTestKey: string | null
  lastHitTestTransparent: boolean | null
  modelOrigin: Vector3
  modelSize: Vector3
  models: Map<string, VrmModelRuntime>
  onSceneSettingsChange?: (settings: PetVrmStageSceneSettings) => void
  raycaster: Raycaster
  renderTarget: WebGLRenderTarget | null
  renderTargetSize: Vector2
  renderer: WebGLRenderer
  scene: Scene
  sceneSettings: PetVrmStageSceneSettings
}

type VrmModelRuntime = {
  animationMixer?: AnimationMixer
  animationPreset?: PetVrmStageAnimationPreset
  blinkRuntime: PetVrmBlinkRuntime
  bootstrapped: boolean
  eyeSaccadeRuntime: PetVrmIdleEyeSaccadeRuntime
  lastLookAtKey: string | null
  loaded?: LoadedPetVrm
  loading: boolean
  loadGeneration: number
  modelId: string
  objectUrlRevoke?: () => void
  order: number
  positionX: number
  positionY: number
  positionZ: number
}

export type VrmStageSceneBootstrap = {
  cameraDistance: number
  cameraPosition: Vector3
  eyeHeight: number
  lookAtTarget: Vector3
  modelOffset: Vector3
  modelOrigin: Vector3
  modelSize: Vector3
}

export type RenderTargetRegionRead = {
  centerX: number
  centerY: number
  data: Uint8Array
  readHeight: number
  readWidth: number
  scaleX: number
  scaleY: number
  startX: number
  startY: number
}

const VRM_MAX_PIXEL_RATIO = 2
const VRM_STAGE_DEFAULT_CAMERA_DISTANCE = 1
const VRM_STAGE_FALLBACK_CAMERA_DIRECTION = new Vector3(0, 0, -1)
const VRM_STAGE_KEY_LIGHT_POSITION = new Vector3(0, 0, -1)
const VRM_STAGE_KEY_LIGHT_TARGET = new Vector3(0, 0, 0)
const VRM_STAGE_KEY_LIGHT_INTENSITY = 2.02
const VRM_STAGE_AMBIENT_LIGHT_INTENSITY = 0.6
const VRM_STAGE_HEMISPHERE_LIGHT_INTENSITY = 0.4
const VRM_STAGE_KEY_LIGHT_COLOR = 0xfffbf5
const VRM_STAGE_AMBIENT_LIGHT_COLOR = 0xffffff
const VRM_STAGE_HEMISPHERE_SKY_COLOR = 0xffffff
const VRM_STAGE_HEMISPHERE_GROUND_COLOR = 0x222222
const VRM_STAGE_HIT_TEST_ALPHA_THRESHOLD = 10
const VRM_STAGE_HIT_TEST_REGION_RADIUS = 25
const DEFAULT_LOOK_AT_TARGET = getSceneSettingsLookAtTarget(PET_VRM_STAGE_DEFAULT_SCENE_SETTINGS)
const MIN_MODEL_DEPTH_FOR_DISTANCE_BOUNDS = 1e-6

const VrmPastureScene: FC<VrmPastureSceneProps> = ({
  hitTestPoint,
  lookAtPoint,
  models,
  onHitTestTransparencyChange,
  onModelLoadStateChange,
  onSceneSettingsChange,
  sceneSettings = PET_VRM_STAGE_DEFAULT_SCENE_SETTINGS,
  stageHeight,
  stageWidth
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const runtimeRef = useRef<SceneRuntime | null>(null)
  const latestPropsRef = useRef({
    hitTestPoint,
    lookAtPoint,
    models,
    onHitTestTransparencyChange,
    onModelLoadStateChange,
    onSceneSettingsChange,
    sceneSettings,
    stageHeight,
    stageWidth
  })

  latestPropsRef.current = {
    hitTestPoint,
    lookAtPoint,
    models,
    onHitTestTransparencyChange,
    onModelLoadStateChange,
    onSceneSettingsChange,
    sceneSettings,
    stageHeight,
    stageWidth
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const initialProps = latestPropsRef.current
    const initialSceneSettings = normalizePetVrmStageSceneSettings(initialProps.sceneSettings)

    const renderer = new WebGLRenderer({
      alpha: true,
      antialias: true,
      canvas,
      powerPreference: 'high-performance',
      premultipliedAlpha: false
    })
    renderer.toneMapping = ACESFilmicToneMapping
    renderer.toneMappingExposure = 1
    renderer.setClearColor(0x000000, 0)

    const scene = new Scene()
    const hemisphereLight = new HemisphereLight(
      VRM_STAGE_HEMISPHERE_SKY_COLOR,
      VRM_STAGE_HEMISPHERE_GROUND_COLOR,
      VRM_STAGE_HEMISPHERE_LIGHT_INTENSITY
    )
    hemisphereLight.position.set(0, 1, 0)
    scene.add(hemisphereLight)

    const ambientLight = new AmbientLight(VRM_STAGE_AMBIENT_LIGHT_COLOR, VRM_STAGE_AMBIENT_LIGHT_INTENSITY)
    scene.add(ambientLight)

    const directionalLight = new DirectionalLight(VRM_STAGE_KEY_LIGHT_COLOR, VRM_STAGE_KEY_LIGHT_INTENSITY)
    directionalLight.position.copy(VRM_STAGE_KEY_LIGHT_POSITION)
    directionalLight.target.position.copy(VRM_STAGE_KEY_LIGHT_TARGET)
    scene.add(directionalLight)
    scene.add(directionalLight.target)

    const gazeTarget = new Object3D()
    gazeTarget.position.copy(DEFAULT_LOOK_AT_TARGET)
    scene.add(gazeTarget)

    const camera = new PerspectiveCamera(
      initialSceneSettings.cameraFov,
      getCameraAspect(initialProps.stageWidth, initialProps.stageHeight),
      initialSceneSettings.cameraNear,
      initialSceneSettings.cameraFar
    )
    const initialCameraPosition = getSceneSettingsCameraPosition(initialSceneSettings)
    const initialCameraTarget = getSceneSettingsCameraTarget(initialSceneSettings)
    camera.position.copy(initialCameraPosition)
    camera.lookAt(initialCameraTarget)

    const controls = new OrbitControls(camera, canvas)
    controls.enablePan = false
    controls.enableRotate = false
    controls.enableZoom = false
    controls.mouseButtons = {
      LEFT: MOUSE.ROTATE,
      MIDDLE: MOUSE.DOLLY,
      RIGHT: MOUSE.PAN
    }
    controls.touches = {
      ONE: TOUCH.ROTATE,
      TWO: TOUCH.DOLLY_PAN
    }

    const runtime: SceneRuntime = {
      ambientLight,
      applyingCameraState: false,
      camera,
      cameraDistance: getCameraDistance(initialCameraPosition, initialCameraTarget),
      cameraDirection: getSceneSettingsCameraDirection(initialSceneSettings),
      clock: new Clock(),
      controls,
      directionalLight,
      frameId: null,
      gazeTarget,
      hemisphereLight,
      lastCameraSettingsKey: getSceneCameraSettingsKey(initialSceneSettings),
      lastHitTestKey: null,
      lastHitTestTransparent: null,
      modelOrigin: initialCameraTarget.clone(),
      modelSize: new Vector3(),
      models: new Map(),
      onSceneSettingsChange: initialProps.onSceneSettingsChange,
      raycaster: new Raycaster(),
      renderer,
      renderTarget: null,
      renderTargetSize: new Vector2(),
      scene,
      sceneSettings: initialSceneSettings
    }
    runtimeRef.current = runtime

    const handleControlsChange = () => syncCameraStateFromOrbitControls(runtime)
    const handleControlsEnd = () => emitCameraSceneSettings(runtime)
    controls.addEventListener('change', handleControlsChange)
    controls.addEventListener('end', handleControlsEnd)

    applySceneSettings(runtime, initialProps.sceneSettings)
    resizeSceneRuntime(runtime, initialProps.stageWidth, initialProps.stageHeight)
    syncVrmStageModels(runtime, latestPropsRef.current)

    const tick = (timestamp: number) => {
      renderVrmSceneFrame(runtime, timestamp, latestPropsRef.current)
      runtime.frameId = requestAnimationFrame(tick)
    }
    runtime.frameId = requestAnimationFrame(tick)

    return () => {
      if (runtime.frameId !== null) cancelAnimationFrame(runtime.frameId)
      controls.removeEventListener('change', handleControlsChange)
      controls.removeEventListener('end', handleControlsEnd)
      disposeSceneRuntime(runtime)
      runtimeRef.current = null
    }
  }, [])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime) return
    applySceneSettings(runtime, sceneSettings)
  }, [sceneSettings])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime) return
    resizeSceneRuntime(runtime, stageWidth, stageHeight)
  }, [stageHeight, stageWidth])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime) return
    runtime.onSceneSettingsChange = onSceneSettingsChange
  }, [onSceneSettingsChange])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime) return
    syncVrmStageModels(runtime, latestPropsRef.current)
  }, [models, onModelLoadStateChange])

  return (
    <canvas
      ref={canvasRef}
      data-testid="pet-vrm-scene"
      style={{
        bottom: 0,
        height: stageHeight,
        left: 0,
        pointerEvents: 'auto',
        position: 'absolute',
        touchAction: 'none',
        width: stageWidth,
        zIndex: 1
      }}
    />
  )
}

function syncVrmStageModels(runtime: SceneRuntime, props: VrmPastureSceneProps): void {
  const incomingIds = new Set(props.models.map((model) => model.id))

  for (const [id, modelRuntime] of runtime.models) {
    if (!incomingIds.has(id)) {
      disposeVrmModelRuntime(runtime, modelRuntime)
      runtime.models.delete(id)
    }
  }

  const desiredOrder = new Map(props.models.map((model, index) => [model.id, index]))
  let orderChanged = false
  for (const [id, modelRuntime] of runtime.models) {
    const nextOrder = desiredOrder.get(id)
    if (nextOrder !== undefined && modelRuntime.order !== nextOrder) {
      modelRuntime.order = nextOrder
      orderChanged = true
    }
  }
  if (orderChanged) {
    const ordered = [...runtime.models.entries()].sort((left, right) => left[1].order - right[1].order)
    runtime.models.clear()
    for (const [id, modelRuntime] of ordered) {
      runtime.models.set(id, modelRuntime)
    }
  }

  props.models.forEach((model, index) => {
    let modelRuntime = runtime.models.get(model.id)
    if (!modelRuntime) {
      modelRuntime = createVrmModelRuntime(model)
      modelRuntime.order = index
      runtime.models.set(model.id, modelRuntime)
    }

    if (modelRuntime.modelId === model.modelId && modelRuntime.animationPreset !== model.profile.animationPreset) {
      modelRuntime.animationPreset = model.profile.animationPreset
      modelRuntime.loadGeneration += 1
      if (modelRuntime.loaded) {
        const loaded = modelRuntime.loaded
        modelRuntime.animationMixer?.stopAllAction()
        void replaceStageModelAnimation(modelRuntime, loaded, modelRuntime.loadGeneration)
      } else if (model.modelId) {
        modelRuntime.loading = true
        emitLoadState(props, { modelId: model.modelId, phase: 'loading' })
        void loadStageModel(runtime, modelRuntime, model.modelId, props)
      }
    }

    if (modelRuntime.modelId !== model.modelId) {
      modelRuntime.modelId = model.modelId
      modelRuntime.animationPreset = model.profile.animationPreset
      modelRuntime.loadGeneration += 1
      modelRuntime.loading = Boolean(model.modelId)
      modelRuntime.blinkRuntime = createPetVrmBlinkRuntime()
      modelRuntime.eyeSaccadeRuntime = createPetVrmIdleEyeSaccadeRuntime()
      modelRuntime.lastLookAtKey = null
      modelRuntime.bootstrapped = false
      if (modelRuntime.loaded) {
        disposeVrmModelRuntime(runtime, modelRuntime)
      }
      if (model.modelId) {
        emitLoadState(props, { modelId: model.modelId, phase: 'loading' })
        void loadStageModel(runtime, modelRuntime, model.modelId, props)
      }
    }
  })
}

function createVrmModelRuntime(model: PetVrmStageModel): VrmModelRuntime {
  return {
    animationPreset: model.profile.animationPreset,
    blinkRuntime: createPetVrmBlinkRuntime(),
    bootstrapped: false,
    eyeSaccadeRuntime: createPetVrmIdleEyeSaccadeRuntime(),
    lastLookAtKey: null,
    loadGeneration: 0,
    loading: false,
    modelId: '',
    order: 0,
    positionX: model.positionX,
    positionY: model.positionY,
    positionZ: model.positionZ
  }
}

async function loadStageModel(
  runtime: SceneRuntime,
  modelRuntime: VrmModelRuntime,
  modelId: string,
  props: VrmPastureSceneProps
): Promise<void> {
  const generation = modelRuntime.loadGeneration
  let revokeObjectUrl: (() => void) | undefined
  let loadedModel: LoadedPetVrm | undefined
  try {
    const objectUrl = await createPetVrmModelObjectUrl(modelId)
    const stale = modelRuntime.loadGeneration !== generation
    if (!objectUrl || stale) {
      objectUrl?.revoke()
      if (!stale) {
        modelRuntime.loading = false
        emitLoadState(props, { error: 'VRM model asset was not found', modelId, phase: 'error' })
      }
      return
    }
    revokeObjectUrl = objectUrl.revoke

    const loaded = await loadPetVrmModel(objectUrl.url)
    loadedModel = loaded
    if (modelRuntime.loadGeneration !== generation) {
      disposePetVrmModel(loaded)
      loadedModel = undefined
      objectUrl.revoke()
      return
    }

    modelRuntime.animationMixer = await createStageModelAnimationMixer(loaded, modelRuntime.animationPreset)
    if (modelRuntime.loadGeneration !== generation) {
      modelRuntime.animationMixer.stopAllAction()
      disposePetVrmModel(loaded)
      loadedModel = undefined
      objectUrl.revoke()
      return
    }

    modelRuntime.loaded = loaded
    modelRuntime.objectUrlRevoke = objectUrl.revoke
    modelRuntime.loading = false
    runtime.scene.add(loaded.root)
    loadedModel = undefined
    setOrbitControlsEnabled(runtime, true)
    emitLoadState(props, { modelId, phase: 'ready' })
  } catch (error) {
    modelRuntime.animationMixer?.stopAllAction()
    modelRuntime.animationMixer = undefined
    if (loadedModel) {
      disposePetVrmModel(loadedModel)
    }
    revokeObjectUrl?.()
    if (modelRuntime.loadGeneration === generation) {
      modelRuntime.loading = false
      emitLoadState(props, { error: formatVrmLoadError(error), modelId, phase: 'error' })
    }
  }
}

async function replaceStageModelAnimation(
  modelRuntime: VrmModelRuntime,
  loaded: LoadedPetVrm,
  generation: number
): Promise<void> {
  try {
    const mixer = await createStageModelAnimationMixer(loaded, modelRuntime.animationPreset)
    if (modelRuntime.loadGeneration !== generation || modelRuntime.loaded !== loaded) {
      mixer.stopAllAction()
      return
    }
    modelRuntime.animationMixer?.stopAllAction()
    modelRuntime.animationMixer = mixer
  } catch {
    if (modelRuntime.loadGeneration === generation && modelRuntime.loaded === loaded) {
      modelRuntime.animationMixer = undefined
    }
  }
}

async function createStageModelAnimationMixer(
  loaded: LoadedPetVrm,
  animationPreset: PetVrmStageAnimationPreset | undefined
): Promise<AnimationMixer> {
  const animation = await loadPetVrmAnimation(getPetVrmStageAnimationPresetUrl(animationPreset))
  if (!animation) throw new Error('No VRM animation loaded')

  const clip = createPetVrmAnimationClip(loaded.vrm, animation)
  if (loaded.animationAnchor) {
    reAnchorRootPositionTrack(clip, loaded.vrm, loaded.animationAnchor)
  } else {
    reAnchorRootPositionTrack(clip, loaded.vrm)
  }

  const mixer = new AnimationMixer(loaded.vrm.scene)
  mixer.clipAction(clip).play()
  mixer.update(0)
  return mixer
}

function renderVrmSceneFrame(runtime: SceneRuntime, _timestamp: number, props: VrmPastureSceneProps): void {
  const delta = runtime.clock.getDelta()
  const modelById = new Map(props.models.map((model) => [model.id, model]))
  const lookAtTarget = getSceneLookAtTarget(runtime, props)
  const lookAtKey = getLookAtKey(lookAtTarget)
  runtime.gazeTarget.position.copy(lookAtTarget)

  for (const [id, modelRuntime] of runtime.models) {
    const model = modelById.get(id)
    if (!model) continue

    updateVrmModelTransform(modelRuntime, model, props, runtime.gazeTarget, lookAtKey, delta)
    modelRuntime.loaded?.vrm.update(delta)
  }

  bootstrapFirstReadyModel(runtime)
  runtime.controls.update()
  runtime.renderer.clear()
  runtime.renderer.render(runtime.scene, runtime.camera)
  updateHitTestTransparency(runtime, props)
}

function getLookAtKey(target: Vector3): string {
  return `${target.x.toFixed(3)}:${target.y.toFixed(3)}:${target.z.toFixed(3)}`
}

function updateVrmModelTransform(
  modelRuntime: VrmModelRuntime,
  model: PetVrmStageModel,
  props: VrmPastureSceneProps,
  gazeTarget: Object3D,
  lookAtKey: string,
  delta: number
): void {
  const loaded = modelRuntime.loaded
  if (!loaded || modelRuntime.loading) return

  modelRuntime.positionX = model.positionX
  modelRuntime.positionY = model.positionY
  modelRuntime.positionZ = model.positionZ
  loaded.root.scale.setScalar(1)
  loaded.root.position.set(model.positionX, model.positionY, model.positionZ)
  modelRuntime.animationMixer?.update(delta)
  applyVrmModelPose(modelRuntime, loaded, model, gazeTarget, lookAtKey, delta)
}

function bootstrapFirstReadyModel(runtime: SceneRuntime): void {
  for (const modelRuntime of [...runtime.models.values()].sort((left, right) => left.order - right.order)) {
    if (!modelRuntime.loaded || modelRuntime.loading) continue
    if (!modelRuntime.bootstrapped) {
      const bootstrap = buildVrmStageSceneBootstrap(modelRuntime.loaded.vrm, runtime.camera, runtime.sceneSettings)
      applyVrmStageSceneBootstrap(runtime, bootstrap)
      modelRuntime.bootstrapped = true
    }
    return
  }
  setOrbitControlsEnabled(runtime, false)
}

export function buildVrmStageSceneBootstrap(
  activeVrm: LoadedPetVrm['vrm'],
  camera: PerspectiveCamera,
  settings: PetVrmStageSceneSettings = PET_VRM_STAGE_DEFAULT_SCENE_SETTINGS
): VrmStageSceneBootstrap {
  const sceneSettings = normalizePetVrmStageSceneSettings(settings)
  const bootstrapRoot = activeVrm.scene.parent ?? activeVrm.scene
  const box = computeVrmModelBoundingBox(bootstrapRoot)
  const modelSize = new Vector3()
  const modelCenter = new Vector3()
  box.getSize(modelSize)
  box.getCenter(modelCenter)
  modelCenter.y += modelSize.y / 5

  const fov = Number.isFinite(camera.fov) ? camera.fov : sceneSettings.cameraFov
  const radians = (fov / 2) * (Math.PI / 180)
  const cameraDistance = modelSize.y / 3 / Math.tan(radians)
  const initialCameraOffset = new Vector3(modelSize.x / 16, modelSize.y / 8, 0).addScaledVector(
    getSceneSettingsCameraDirection(sceneSettings),
    cameraDistance
  )

  const eyeHeight = getEyePosition(activeVrm) ?? modelCenter.y
  const cameraPoseIsDefault = getSceneCameraPoseSettingsKey(sceneSettings) === getSceneCameraPoseSettingsKey()
  const modelOrigin = cameraPoseIsDefault ? modelCenter : getSceneSettingsCameraTarget(sceneSettings)
  const cameraPosition = cameraPoseIsDefault
    ? modelCenter.clone().add(initialCameraOffset)
    : getSceneSettingsCameraPosition(sceneSettings)
  const lookAtTarget = getSceneSettingsLookAtTarget(sceneSettings)
  lookAtTarget.y += eyeHeight

  return {
    cameraDistance: getCameraDistance(cameraPosition, modelOrigin),
    cameraPosition,
    eyeHeight,
    lookAtTarget,
    modelOffset: bootstrapRoot.position.clone(),
    modelOrigin,
    modelSize
  }
}

export function computeVrmModelBoundingBox(root: Object3D): Box3 {
  const box = new Box3()
  const childBox = new Box3()

  root.updateMatrixWorld(true)
  root.traverse((object) => {
    if (!object.visible) return

    const mesh = object as Mesh
    if (!mesh.isMesh || !mesh.geometry) return
    if (mesh.name.startsWith('VRMC_springBone_collider')) return

    if (!mesh.geometry.boundingBox) {
      mesh.geometry.computeBoundingBox()
    }

    childBox.copy(mesh.geometry.boundingBox!)
    childBox.applyMatrix4(mesh.matrixWorld)
    box.union(childBox)
  })

  return box
}

function getEyePosition(activeVrm: LoadedPetVrm['vrm']): number | null {
  const eye = activeVrm.humanoid?.getNormalizedBoneNode('head')
  if (!eye) return null

  const eyePosition = new Vector3()
  eye.getWorldPosition(eyePosition)
  return eyePosition.y
}

function applyVrmStageSceneBootstrap(runtime: SceneRuntime, bootstrap: VrmStageSceneBootstrap): void {
  runtime.modelOrigin.copy(bootstrap.modelOrigin)
  runtime.modelSize.copy(bootstrap.modelSize)
  runtime.cameraDistance = bootstrap.cameraDistance
  runtime.cameraDirection.copy(bootstrap.cameraPosition).sub(bootstrap.modelOrigin)
  if (runtime.cameraDirection.lengthSq() <= 1e-6) {
    runtime.cameraDirection.copy(VRM_STAGE_FALLBACK_CAMERA_DIRECTION)
  }
  runtime.cameraDirection.normalize()
  runtime.gazeTarget.position.copy(bootstrap.lookAtTarget)
  applyOrbitDistanceBounds(runtime, bootstrap.modelSize)
  applyCameraPosition(runtime)
  emitCameraSceneSettings(runtime)
}

function applyOrbitDistanceBounds(runtime: SceneRuntime, modelSize: Vector3): void {
  const modelDepth = modelSize.z
  if (!Number.isFinite(modelDepth) || modelDepth <= MIN_MODEL_DEPTH_FOR_DISTANCE_BOUNDS) return

  runtime.controls.minDistance = modelDepth
  runtime.controls.maxDistance = modelDepth * 20
}

function resizeSceneRuntime(runtime: SceneRuntime, width: number, height: number): void {
  const boundedWidth = Math.max(1, width)
  const boundedHeight = Math.max(1, height)
  const pixelRatio = Math.min(window.devicePixelRatio || 1, VRM_MAX_PIXEL_RATIO)
  runtime.renderer.setPixelRatio(pixelRatio)
  runtime.renderer.setSize(boundedWidth, boundedHeight, false)
  runtime.camera.aspect = getCameraAspect(boundedWidth, boundedHeight)
  runtime.camera.updateProjectionMatrix()
  runtime.lastHitTestKey = null
}

function getCameraAspect(width: number, height: number): number {
  return Math.max(1, width) / Math.max(1, height)
}

function getSceneSettingsCameraPosition(settings: PetVrmStageSceneSettings): Vector3 {
  return new Vector3(settings.cameraPositionX, settings.cameraPositionY, settings.cameraPositionZ)
}

function getSceneSettingsCameraTarget(settings: PetVrmStageSceneSettings): Vector3 {
  return new Vector3(settings.cameraTargetX, settings.cameraTargetY, settings.cameraTargetZ)
}

function getSceneSettingsCameraDirection(settings: PetVrmStageSceneSettings): Vector3 {
  const direction = getSceneSettingsCameraPosition(settings).sub(getSceneSettingsCameraTarget(settings))
  if (direction.lengthSq() <= 1e-6) {
    return VRM_STAGE_FALLBACK_CAMERA_DIRECTION.clone()
  }
  return direction.normalize()
}

function getSceneSettingsLookAtTarget(settings: PetVrmStageSceneSettings): Vector3 {
  return new Vector3(settings.lookAtTargetX, settings.lookAtTargetY, settings.lookAtTargetZ)
}

function getCameraDistance(cameraPosition: Vector3, cameraTarget: Vector3): number {
  const distance = cameraPosition.distanceTo(cameraTarget)
  return Number.isFinite(distance) && distance > 1e-6 ? distance : VRM_STAGE_DEFAULT_CAMERA_DISTANCE
}

function getSceneCameraSettingsKey(settings = PET_VRM_STAGE_DEFAULT_SCENE_SETTINGS): string {
  return [
    settings.cameraFov,
    settings.cameraNear,
    settings.cameraFar,
    settings.cameraPositionX,
    settings.cameraPositionY,
    settings.cameraPositionZ,
    settings.cameraTargetX,
    settings.cameraTargetY,
    settings.cameraTargetZ,
    settings.lookAtTargetX,
    settings.lookAtTargetY,
    settings.lookAtTargetZ
  ]
    .map(formatSceneSettingsNumber)
    .join(':')
}

function getSceneCameraPoseSettingsKey(settings = PET_VRM_STAGE_DEFAULT_SCENE_SETTINGS): string {
  return [
    settings.cameraPositionX,
    settings.cameraPositionY,
    settings.cameraPositionZ,
    settings.cameraTargetX,
    settings.cameraTargetY,
    settings.cameraTargetZ
  ]
    .map(formatSceneSettingsNumber)
    .join(':')
}

function formatSceneSettingsNumber(value: number): string {
  return Number.isFinite(value) ? value.toFixed(4) : '0.0000'
}

function disposeSceneRuntime(runtime: SceneRuntime): void {
  for (const modelRuntime of runtime.models.values()) {
    disposeVrmModelRuntime(runtime, modelRuntime)
  }
  runtime.controls.dispose()
  runtime.renderTarget?.dispose()
  runtime.renderer.dispose()
}

function disposeVrmModelRuntime(runtime: SceneRuntime, modelRuntime: VrmModelRuntime): void {
  modelRuntime.loadGeneration += 1
  modelRuntime.loading = false
  modelRuntime.bootstrapped = false
  if (modelRuntime.loaded) {
    modelRuntime.animationMixer?.stopAllAction()
    modelRuntime.animationMixer = undefined
    runtime.scene.remove(modelRuntime.loaded.root)
    disposePetVrmModel(modelRuntime.loaded)
    modelRuntime.loaded = undefined
  }
  modelRuntime.objectUrlRevoke?.()
  modelRuntime.objectUrlRevoke = undefined
}

function applySceneSettings(runtime: SceneRuntime, settings: PetVrmStageSceneSettings): void {
  const sceneSettings = normalizePetVrmStageSceneSettings(settings)
  runtime.sceneSettings = sceneSettings
  runtime.ambientLight.intensity = sceneSettings.ambientLightIntensity
  runtime.hemisphereLight.intensity = sceneSettings.fillLightIntensity
  runtime.directionalLight.intensity = sceneSettings.keyLightIntensity
  runtime.scene.background = null
  runtime.renderer.setClearColor(0x000000, 0)

  const cameraSettingsKey = getSceneCameraSettingsKey(sceneSettings)
  if (cameraSettingsKey === runtime.lastCameraSettingsKey) return

  runtime.lastCameraSettingsKey = cameraSettingsKey
  applyCameraSettings(runtime, sceneSettings)
}

function applyCameraSettings(runtime: SceneRuntime, settings: PetVrmStageSceneSettings): void {
  const cameraPosition = getSceneSettingsCameraPosition(settings)
  const cameraTarget = getSceneSettingsCameraTarget(settings)
  runtime.camera.fov = settings.cameraFov
  runtime.camera.near = settings.cameraNear
  runtime.camera.far = settings.cameraFar
  runtime.cameraDistance = getCameraDistance(cameraPosition, cameraTarget)
  runtime.cameraDirection.copy(cameraPosition).sub(cameraTarget)
  if (runtime.cameraDirection.lengthSq() <= 1e-6) {
    runtime.cameraDirection.copy(VRM_STAGE_FALLBACK_CAMERA_DIRECTION)
  }
  runtime.cameraDirection.normalize()
  runtime.modelOrigin.copy(cameraTarget)
  runtime.gazeTarget.position.copy(getSceneSettingsLookAtTarget(settings))
  applyCameraPosition(runtime)
}

function applyCameraPosition(runtime: SceneRuntime): void {
  runtime.applyingCameraState = true
  try {
    runtime.camera.position.copy(runtime.modelOrigin).addScaledVector(runtime.cameraDirection, runtime.cameraDistance)
    runtime.camera.lookAt(runtime.modelOrigin)
    runtime.camera.updateProjectionMatrix()
    runtime.controls.target.copy(runtime.modelOrigin)
    runtime.controls.update()
  } finally {
    runtime.applyingCameraState = false
  }
}

function syncCameraStateFromOrbitControls(runtime: SceneRuntime): void {
  if (runtime.applyingCameraState || !runtime.controls.enabled) return
  runtime.modelOrigin.copy(runtime.controls.target)
  runtime.cameraDirection.copy(runtime.camera.position).sub(runtime.modelOrigin)
  if (runtime.cameraDirection.lengthSq() <= 1e-6) return
  runtime.cameraDirection.normalize()
  runtime.cameraDistance = runtime.controls.getDistance()
}

function emitCameraSceneSettings(runtime: SceneRuntime): void {
  if (runtime.applyingCameraState || !runtime.controls.enabled) return

  const nextSettings = normalizePetVrmStageSceneSettings({
    ...runtime.sceneSettings,
    cameraFar: runtime.camera.far,
    cameraFov: runtime.camera.fov,
    cameraNear: runtime.camera.near,
    cameraPositionX: runtime.camera.position.x,
    cameraPositionY: runtime.camera.position.y,
    cameraPositionZ: runtime.camera.position.z,
    cameraTargetX: runtime.controls.target.x,
    cameraTargetY: runtime.controls.target.y,
    cameraTargetZ: runtime.controls.target.z
  })
  const nextCameraSettingsKey = getSceneCameraSettingsKey(nextSettings)
  if (nextCameraSettingsKey === runtime.lastCameraSettingsKey) return

  runtime.sceneSettings = nextSettings
  runtime.lastCameraSettingsKey = nextCameraSettingsKey
  runtime.onSceneSettingsChange?.(nextSettings)
}

function setOrbitControlsEnabled(runtime: SceneRuntime, enabled: boolean): void {
  runtime.controls.enabled = enabled
  runtime.controls.enableRotate = enabled
  runtime.controls.enableZoom = enabled
}

function applyVrmModelPose(
  modelRuntime: VrmModelRuntime,
  loaded: LoadedPetVrm,
  model: PetVrmStageModel,
  gazeTarget: Object3D,
  lookAtKey: string,
  delta: number
): void {
  const idleMotion = model.profile.idleMotion ?? true
  const expressionManager = loaded.vrm.expressionManager

  if (modelRuntime.animationMixer) {
    modelRuntime.animationMixer.timeScale = idleMotion ? 1 : 0
  }

  applyExpression(model, expressionManager)
  updatePetVrmBlink(loaded.vrm, modelRuntime.blinkRuntime, model.profile.blink ?? true, delta)

  const lookAtEnabled = model.profile.lookAtCursor ?? true
  if (lookAtEnabled && modelRuntime.lastLookAtKey !== lookAtKey) {
    updatePetVrmIdleEyeSaccadesImmediately(loaded.vrm, modelRuntime.eyeSaccadeRuntime, gazeTarget)
    modelRuntime.lastLookAtKey = lookAtKey
  }
  if (!lookAtEnabled) {
    loaded.vrm.lookAt?.reset()
    modelRuntime.lastLookAtKey = null
  }
}

function applyExpression(model: PetVrmStageModel, expressionManager: LoadedPetVrm['vrm']['expressionManager']): void {
  if (!expressionManager) return

  for (const expression of PET_VRM_EXPRESSION_PRESETS) {
    if (expression !== VRMExpressionPresetName.Blink) expressionManager.setValue(expression, 0)
  }

  const expression = model.profile.expression ?? 'neutral'
  if (expression === 'neutral' && model.profile.expressionIntensity == null) return

  const preset = PET_VRM_EXPRESSION_PRESET_BY_NAME[expression]
  if (preset) {
    expressionManager.setValue(preset, model.profile.expressionIntensity ?? 0.65)
  }
}

function getSceneLookAtTarget(runtime: SceneRuntime, props: VrmPastureSceneProps): Vector3 {
  const point = props.lookAtPoint
  if (!point || props.stageWidth <= 0 || props.stageHeight <= 0) {
    return runtime.gazeTarget.position.clone()
  }

  runtime.raycaster.setFromCamera(
    new Vector2((point.x / props.stageWidth) * 2 - 1, -(point.y / props.stageHeight) * 2 + 1),
    runtime.camera
  )
  const direction = runtime.raycaster.ray.direction.clone().normalize().multiplyScalar(8)
  return runtime.raycaster.ray.origin.clone().add(direction.multiplyScalar(runtime.camera.near))
}

function updateHitTestTransparency(runtime: SceneRuntime, props: VrmPastureSceneProps): void {
  if (!props.onHitTestTransparencyChange) return

  const point = props.hitTestPoint
  const key = point
    ? `${Math.round(point.x)}:${Math.round(point.y)}:${Math.round(props.stageWidth)}:${Math.round(props.stageHeight)}`
    : 'outside'
  if (runtime.lastHitTestKey === key) return
  runtime.lastHitTestKey = key

  const transparent = point
    ? isThreeSceneTransparentAtPoint(runtime, point.x, point.y, VRM_STAGE_HIT_TEST_REGION_RADIUS)
    : true
  if (runtime.lastHitTestTransparent === transparent) return
  runtime.lastHitTestTransparent = transparent
  props.onHitTestTransparencyChange(transparent)
}

function isThreeSceneTransparentAtPoint(
  runtime: SceneRuntime,
  clientX: number,
  clientY: number,
  radius: number
): boolean {
  const result = readRenderTargetRegionAtClientPoint(runtime, clientX, clientY, radius)
  if (!result) return true
  return isRenderTargetRegionTransparent(result, radius, VRM_STAGE_HIT_TEST_ALPHA_THRESHOLD)
}

function readRenderTargetRegionAtClientPoint(
  runtime: SceneRuntime,
  clientX: number,
  clientY: number,
  radius: number
): RenderTargetRegionRead | null {
  const canvas = runtime.renderer.domElement
  const rect = canvas.getBoundingClientRect()
  const xIn = clientX - rect.left
  const yIn = clientY - rect.top
  const inCanvas = xIn >= 0 && yIn >= 0 && xIn < rect.width && yIn < rect.height
  if (!inCanvas) return null

  const renderTarget = ensureRenderTarget(runtime)
  const scaleX = renderTarget.width / rect.width
  const scaleY = renderTarget.height / rect.height
  if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY)) return null

  const centerX = Math.floor(xIn * scaleX)
  const centerY = Math.floor(renderTarget.height - 1 - yIn * scaleY)
  const radiusX = Math.ceil(radius * scaleX)
  const radiusY = Math.ceil(radius * scaleY)
  const startX = clampInt(centerX - radiusX, 0, renderTarget.width - 1)
  const endX = clampInt(centerX + radiusX, 0, renderTarget.width - 1)
  const startY = clampInt(centerY - radiusY, 0, renderTarget.height - 1)
  const endY = clampInt(centerY + radiusY, 0, renderTarget.height - 1)
  const readWidth = endX - startX + 1
  const readHeight = endY - startY + 1
  const data = new Uint8Array(readWidth * readHeight * 4)
  const previousTarget = runtime.renderer.getRenderTarget()

  runtime.renderer.setRenderTarget(renderTarget)
  runtime.renderer.clear()
  runtime.renderer.render(runtime.scene, runtime.camera)
  runtime.renderer.readRenderTargetPixels(renderTarget, startX, startY, readWidth, readHeight, data)
  runtime.renderer.setRenderTarget(previousTarget)

  return {
    centerX,
    centerY,
    data,
    readHeight,
    readWidth,
    scaleX,
    scaleY,
    startX,
    startY
  }
}

function ensureRenderTarget(runtime: SceneRuntime): WebGLRenderTarget {
  runtime.renderer.getDrawingBufferSize(runtime.renderTargetSize)
  const width = Math.max(1, Math.floor(runtime.renderTargetSize.x))
  const height = Math.max(1, Math.floor(runtime.renderTargetSize.y))

  if (!runtime.renderTarget || runtime.renderTarget.width !== width || runtime.renderTarget.height !== height) {
    runtime.renderTarget?.dispose()
    runtime.renderTarget = new WebGLRenderTarget(width, height, { depthBuffer: false })
  }

  return runtime.renderTarget
}

export function isRenderTargetRegionTransparent(
  result: RenderTargetRegionRead,
  radius: number,
  threshold = VRM_STAGE_HIT_TEST_ALPHA_THRESHOLD
): boolean {
  const radiusSq = radius * radius

  for (let y = 0; y < result.readHeight; y += 1) {
    const gy = result.startY + y
    const dy = (gy - result.centerY) / result.scaleY
    const dySq = dy * dy

    for (let x = 0; x < result.readWidth; x += 1) {
      const gx = result.startX + x
      const dx = (gx - result.centerX) / result.scaleX
      if (dx * dx + dySq > radiusSq) continue

      const index = (y * result.readWidth + x) * 4
      if (result.data[index + 3] >= threshold) return false
    }
  }

  return true
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

function emitLoadState(props: VrmPastureSceneProps, state: PetVrmStageModelLoadState): void {
  props.onModelLoadStateChange?.(state)
}

function formatVrmLoadError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const PET_VRM_EXPRESSION_PRESETS = [
  VRMExpressionPresetName.Neutral,
  VRMExpressionPresetName.Happy,
  VRMExpressionPresetName.Relaxed,
  VRMExpressionPresetName.Surprised,
  VRMExpressionPresetName.Angry,
  VRMExpressionPresetName.Sad,
  VRMExpressionPresetName.Blink
] as const

const PET_VRM_EXPRESSION_PRESET_BY_NAME = {
  neutral: VRMExpressionPresetName.Neutral,
  happy: VRMExpressionPresetName.Happy,
  relaxed: VRMExpressionPresetName.Relaxed,
  surprised: VRMExpressionPresetName.Surprised,
  angry: VRMExpressionPresetName.Angry,
  sad: VRMExpressionPresetName.Sad
} as const

export default VrmPastureScene
