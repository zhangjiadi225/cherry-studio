import { PET_VRM_STAGE_DEFAULT_SCENE_SETTINGS } from '@shared/pet'
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { disposePetVrmModel, loadPetVrmModel } from '../vrmLoader'
import { createPetVrmModelObjectUrl } from '../vrmModelLibrary'
import VrmPastureScene, { isRenderTargetRegionTransparent, type RenderTargetRegionRead } from '../VrmPastureScene'

const threeMocks = vi.hoisted(() => ({
  animationMixers: [] as Array<Record<string, unknown>>,
  cameras: [] as Array<Record<string, unknown>>,
  controls: [] as Array<Record<string, unknown>>,
  defaultVrmAnimation: { name: 'idle-loop-vrma' },
  defaultVrmClip: { name: 'idle-loop-clip', tracks: [] },
  renderers: [] as Array<Record<string, ReturnType<typeof vi.fn>>>
}))

vi.mock('@pixiv/three-vrm', () => ({
  VRMExpressionPresetName: {
    Angry: 'angry',
    Blink: 'blink',
    Happy: 'happy',
    Neutral: 'neutral',
    Relaxed: 'relaxed',
    Sad: 'sad',
    Surprised: 'surprised'
  }
}))

vi.mock('three', () => {
  class Vector2 {
    public x: number
    public y: number

    constructor(x = 0, y = 0) {
      this.x = x
      this.y = y
    }
  }

  class Vector3 {
    public x: number
    public y: number
    public z: number

    constructor(x = 0, y = 0, z = 0) {
      this.x = x
      this.y = y
      this.z = z
    }

    add(vector: Vector3): this {
      this.x += vector.x
      this.y += vector.y
      this.z += vector.z
      return this
    }

    addScaledVector(vector: Vector3, scale: number): this {
      this.x += vector.x * scale
      this.y += vector.y * scale
      this.z += vector.z * scale
      return this
    }

    clone(): Vector3 {
      return new Vector3(this.x, this.y, this.z)
    }

    copy(vector: Vector3): this {
      this.x = vector.x
      this.y = vector.y
      this.z = vector.z
      return this
    }

    distanceTo(vector: Vector3): number {
      return Math.hypot(this.x - vector.x, this.y - vector.y, this.z - vector.z)
    }

    lengthSq(): number {
      return this.x * this.x + this.y * this.y + this.z * this.z
    }

    lerp(vector: Vector3, alpha: number): this {
      this.x += (vector.x - this.x) * alpha
      this.y += (vector.y - this.y) * alpha
      this.z += (vector.z - this.z) * alpha
      return this
    }

    multiplyScalar(scale: number): this {
      this.x *= scale
      this.y *= scale
      this.z *= scale
      return this
    }

    normalize(): this {
      const length = Math.sqrt(this.lengthSq()) || 1
      this.x /= length
      this.y /= length
      this.z /= length
      return this
    }

    set(x: number, y: number, z: number): this {
      this.x = x
      this.y = y
      this.z = z
      return this
    }

    setScalar(value: number): this {
      this.x = value
      this.y = value
      this.z = value
      return this
    }

    sub(vector: Vector3): this {
      this.x -= vector.x
      this.y -= vector.y
      this.z -= vector.z
      return this
    }

    subVectors(left: Vector3, right: Vector3): this {
      this.x = left.x - right.x
      this.y = left.y - right.y
      this.z = left.z - right.z
      return this
    }
  }

  class Object3D {
    public children: Object3D[] = []
    public frustumCulled = true
    public isMesh = false
    public name = ''
    public parent: Object3D | null = null
    public position = new Vector3()
    public rotation = { x: 0, y: 0, z: 0 }
    public scale = new Vector3(1, 1, 1)
    public visible = true

    add(object: Object3D): void {
      object.parent = this
      this.children.push(object)
    }

    remove(object: Object3D): void {
      this.children = this.children.filter((child) => child !== object)
      object.parent = null
    }

    getWorldPosition(target: Vector3): Vector3 {
      return target.copy(this.position)
    }

    traverse(callback: (object: Object3D) => void): void {
      callback(this)
      this.children.forEach((child) => child.traverse(callback))
    }

    updateMatrixWorld = vi.fn()
  }

  class Scene extends Object3D {
    public background: unknown = null
  }

  class Box3 {
    copy = vi.fn(() => this)
    getCenter = vi.fn((target: Vector3) => target.set(0, 0, 0))
    getSize = vi.fn((target: Vector3) => target.set(0, 0, 0))
    union = vi.fn(() => this)
  }

  class Clock {
    public getDelta = vi.fn(() => 0.016)
  }

  class Light extends Object3D {
    public intensity: number
    public target = new Object3D()

    constructor(_color: unknown, intensity: number) {
      super()
      this.intensity = intensity
    }
  }

  class PerspectiveCamera extends Object3D {
    public aspect: number
    public far: number
    public fov: number
    public near: number
    public updateProjectionMatrix = vi.fn()

    constructor(fov: number, aspect: number, near: number, far: number) {
      super()
      this.fov = fov
      this.aspect = aspect
      this.near = near
      this.far = far
      threeMocks.cameras.push(this as unknown as Record<string, unknown>)
    }

    public lookAt = vi.fn()
  }

  class Raycaster {
    public ray = {
      direction: new Vector3(0, 0, -1),
      origin: new Vector3()
    }

    public setFromCamera = vi.fn()
  }

  class WebGLRenderer {
    public clear = vi.fn()
    public dispose = vi.fn()
    public domElement: HTMLCanvasElement
    public getDrawingBufferSize = vi.fn((target: Vector2) => {
      target.x = 840
      target.y = 1280
      return target
    })
    public getRenderTarget = vi.fn(() => null)
    public readRenderTargetPixels = vi.fn()
    public render = vi.fn()
    public setClearColor = vi.fn()
    public setPixelRatio = vi.fn()
    public setRenderTarget = vi.fn()
    public setSize = vi.fn()
    public toneMapping: unknown
    public toneMappingExposure = 0

    constructor(options: { canvas: HTMLCanvasElement }) {
      this.domElement = options.canvas
      threeMocks.renderers.push(this as unknown as Record<string, ReturnType<typeof vi.fn>>)
    }
  }

  class WebGLRenderTarget {
    public dispose = vi.fn()

    constructor(
      public width: number,
      public height: number
    ) {}
  }

  class AnimationMixer {
    public clipAction = vi.fn(() => ({ play: vi.fn() }))
    public stopAllAction = vi.fn()
    public timeScale = 1
    public update = vi.fn()

    constructor(public root: Object3D) {
      threeMocks.animationMixers.push(this as unknown as Record<string, unknown>)
    }
  }

  return {
    ACESFilmicToneMapping: 'ACESFilmicToneMapping',
    AmbientLight: Light,
    AnimationMixer,
    Box3,
    Clock,
    Color: class Color {
      constructor(public value: string) {}
    },
    DirectionalLight: Light,
    HemisphereLight: Light,
    MathUtils: { clamp: (value: number, min: number, max: number) => Math.min(Math.max(value, min), max) },
    Mesh: class Mesh extends Object3D {},
    MOUSE: { DOLLY: 1, PAN: 2, ROTATE: 0 },
    Object3D,
    PerspectiveCamera,
    Raycaster,
    Scene,
    TOUCH: { DOLLY_PAN: 1, ROTATE: 0 },
    Vector2,
    Vector3,
    VectorKeyframeTrack: class VectorKeyframeTrack {
      constructor(
        public name: string,
        public times: number[],
        public values: number[]
      ) {}
    },
    WebGLRenderer,
    WebGLRenderTarget
  }
})

vi.mock('three/examples/jsm/controls/OrbitControls.js', async () => {
  const { Vector3 } = await import('three')

  return {
    OrbitControls: class OrbitControls {
      public addEventListener = vi.fn()
      public dispose = vi.fn()
      public enablePan = true
      public enableRotate = true
      public enableZoom = true
      public enabled = true
      public getDistance = vi.fn(() => 1)
      public mouseButtons: unknown
      public removeEventListener = vi.fn()
      public target = new Vector3()
      public touches: unknown
      public update = vi.fn()

      constructor() {
        threeMocks.controls.push(this as unknown as Record<string, unknown>)
      }
    }
  }
})

vi.mock('../vrmModelLibrary', () => ({
  createPetVrmModelObjectUrl: vi.fn()
}))

vi.mock('../vrmLoader', () => ({
  disposePetVrmModel: vi.fn(),
  loadPetVrmModel: vi.fn()
}))

vi.mock('../assets/vroid-official/greeting.vrma?url', () => ({
  default: 'vroid-greeting.vrma'
}))

vi.mock('../assets/vroid-official/model-pose.vrma?url', () => ({
  default: 'vroid-model-pose.vrma'
}))

vi.mock('../assets/vroid-official/peace-sign.vrma?url', () => ({
  default: 'vroid-peace-sign.vrma'
}))

vi.mock('../assets/vroid-official/shoot.vrma?url', () => ({
  default: 'vroid-shoot.vrma'
}))

vi.mock('../assets/vroid-official/show-full-body.vrma?url', () => ({
  default: 'vroid-show-full-body.vrma'
}))

vi.mock('../assets/vroid-official/spin.vrma?url', () => ({
  default: 'vroid-spin.vrma'
}))

vi.mock('../assets/vroid-official/squat.vrma?url', () => ({
  default: 'vroid-squat.vrma'
}))

vi.mock('../vrmAnimation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../vrmAnimation')>()
  return {
    ...actual,
    createPetVrmAnimationClip: vi.fn(() => threeMocks.defaultVrmClip),
    loadPetVrmAnimation: vi.fn(() => Promise.resolve(threeMocks.defaultVrmAnimation)),
    reAnchorRootPositionTrack: vi.fn()
  }
})

describe('VrmPastureScene', () => {
  beforeEach(() => {
    threeMocks.animationMixers.length = 0
    threeMocks.cameras.length = 0
    threeMocks.controls.length = 0
    threeMocks.renderers.length = 0
    vi.mocked(createPetVrmModelObjectUrl).mockReset()
    vi.mocked(disposePetVrmModel).mockReset()
    vi.mocked(loadPetVrmModel).mockReset()
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1)
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
    Object.defineProperty(window, 'devicePixelRatio', {
      configurable: true,
      value: 2.5
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sizes the canvas and renderer from the stage dimensions with VRM stage perspective camera defaults', () => {
    const { unmount } = render(<VrmPastureScene models={[]} stageHeight={640} stageWidth={420} />)

    const canvas = screen.getByTestId('pet-vrm-scene')
    expect(canvas).toHaveStyle({ height: '640px', width: '420px' })

    const renderer = threeMocks.renderers.at(-1)
    expect(renderer?.setPixelRatio).toHaveBeenCalledWith(2)
    expect(renderer?.setSize).toHaveBeenCalledWith(420, 640, false)
    expect(renderer?.setClearColor).toHaveBeenCalledWith(0x000000, 0)
    expect(renderer?.toneMapping).toBe('ACESFilmicToneMapping')
    expect(renderer?.toneMappingExposure).toBe(1)

    const camera = threeMocks.cameras.at(-1)
    expect(camera).toMatchObject({
      aspect: 420 / 640,
      far: 2000,
      fov: 40,
      near: 0.1
    })
    expect(camera?.position).toMatchObject({ x: 0, y: 0, z: -1 })
    expect(camera?.updateProjectionMatrix).toHaveBeenCalled()

    const controls = threeMocks.controls.at(-1)
    expect(controls).toMatchObject({
      enablePan: false,
      enableRotate: false,
      enableZoom: false,
      mouseButtons: { LEFT: 0, MIDDLE: 1, RIGHT: 2 },
      touches: { ONE: 0, TWO: 1 }
    })

    unmount()
  })

  it('updates renderer size and camera aspect when the stage dimensions change', () => {
    const { rerender, unmount } = render(<VrmPastureScene models={[]} stageHeight={640} stageWidth={420} />)

    rerender(<VrmPastureScene models={[]} stageHeight={720} stageWidth={360} />)

    const renderer = threeMocks.renderers.at(-1)
    expect(renderer?.setSize).toHaveBeenLastCalledWith(360, 720, false)

    const camera = threeMocks.cameras.at(-1)
    expect(camera).toMatchObject({ aspect: 0.5 })
    expect(camera?.updateProjectionMatrix).toHaveBeenCalled()

    unmount()
  })

  it('applies VRM scene JSON settings to the perspective camera', () => {
    const { unmount } = render(
      <VrmPastureScene
        models={[]}
        sceneSettings={{
          ...PET_VRM_STAGE_DEFAULT_SCENE_SETTINGS,
          cameraFar: 1200,
          cameraFov: 55,
          cameraNear: 0.2,
          cameraPositionX: 1,
          cameraPositionY: 2,
          cameraPositionZ: -3,
          cameraTargetX: 0.25,
          cameraTargetY: 0.5,
          cameraTargetZ: -0.75
        }}
        stageHeight={640}
        stageWidth={420}
      />
    )

    const camera = threeMocks.cameras.at(-1)
    expect(camera).toMatchObject({
      far: 1200,
      fov: 55,
      near: 0.2
    })
    expect(camera?.position).toMatchObject({ x: 1, y: 2, z: -3 })
    expect(camera?.lookAt).toHaveBeenCalledWith(expect.objectContaining({ x: 0.25, y: 0.5, z: -0.75 }))

    unmount()
  })

  it('checks render-target alpha within the the stage circular hit region', () => {
    const read: RenderTargetRegionRead = {
      centerX: 1,
      centerY: 1,
      data: new Uint8Array(3 * 3 * 4),
      readHeight: 3,
      readWidth: 3,
      scaleX: 1,
      scaleY: 1,
      startX: 0,
      startY: 0
    }

    expect(isRenderTargetRegionTransparent(read, 1, 10)).toBe(true)

    read.data[(1 * 3 + 1) * 4 + 3] = 10
    expect(isRenderTargetRegionTransparent(read, 1, 10)).toBe(false)

    read.data.fill(0)
    read.data[3] = 255
    expect(isRenderTargetRegionTransparent(read, 0.5, 10)).toBe(true)
  })

  it('loads and plays the selected VRMA animation through an AnimationMixer', async () => {
    const { Object3D } = await import('three')
    const { createPetVrmAnimationClip, loadPetVrmAnimation, reAnchorRootPositionTrack } = await import(
      '../vrmAnimation'
    )
    const root = new Object3D()
    const scene = new Object3D()
    const vrm = {
      expressionManager: {
        setValue: vi.fn()
      },
      humanoid: {
        getNormalizedBoneNode: vi.fn(() => null)
      },
      lookAt: {
        reset: vi.fn(),
        target: undefined,
        update: vi.fn()
      },
      scene,
      update: vi.fn()
    }
    vi.mocked(createPetVrmModelObjectUrl).mockResolvedValue({
      record: {
        id: 'model-a',
        importedAt: 1,
        lastModified: 1,
        name: 'Model A',
        size: 1,
        sourceUrl: 'blob:model',
        type: 'model/vrm',
        updatedAt: 1
      },
      revoke: vi.fn(),
      url: 'blob:model'
    })
    vi.mocked(loadPetVrmModel).mockResolvedValue({
      height: 1,
      root,
      vrm,
      width: 1
    } as never)

    const renderModel = (positionX: number, positionY: number, positionZ: number) => (
      <VrmPastureScene
        models={[
          {
            enabled: true,
            id: 'stage-model',
            modelId: 'model-a',
            order: 0,
            positionX,
            positionY,
            positionZ,
            profile: {
              animationPreset: 'vroid-greeting',
              createdAt: 1,
              enabled: true,
              expression: 'neutral',
              expressionIntensity: 0.35,
              modelId: 'model-a',
              order: 0,
              positionX,
              positionY,
              positionZ,
              updatedAt: 1
            }
          }
        ]}
        stageHeight={640}
        stageWidth={420}
      />
    )
    const { rerender } = render(renderModel(-0.35, 0.25, -0.1))

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(loadPetVrmAnimation).toHaveBeenCalledWith('vroid-greeting.vrma')
    expect(createPetVrmAnimationClip).toHaveBeenCalledWith(vrm, threeMocks.defaultVrmAnimation)
    expect(reAnchorRootPositionTrack).toHaveBeenCalledWith(threeMocks.defaultVrmClip, vrm)

    const mixer = threeMocks.animationMixers.at(-1)
    expect(mixer?.root).toBe(scene)
    expect(mixer?.clipAction).toHaveBeenCalledWith(threeMocks.defaultVrmClip)

    act(() => {
      vi.mocked(window.requestAnimationFrame).mock.calls.at(-1)?.[0](16)
    })

    expect(root.position.x).toBeCloseTo(-0.35)
    expect(root.position.y).toBeCloseTo(0.25)
    expect(root.position.z).toBeCloseTo(-0.1)
    expect(mixer?.update).toHaveBeenCalledWith(0.016)
    expect(vrm.expressionManager.setValue).toHaveBeenCalledWith('neutral', 0.35)
    expect(vrm.update).toHaveBeenCalledWith(0.016)

    rerender(renderModel(0.5, -0.2, 0.15))

    act(() => {
      vi.mocked(window.requestAnimationFrame).mock.calls.at(-1)?.[0](32)
    })

    expect(createPetVrmModelObjectUrl).toHaveBeenCalledTimes(1)
    expect(loadPetVrmModel).toHaveBeenCalledTimes(1)
    expect(root.position.x).toBeCloseTo(0.5)
    expect(root.position.y).toBeCloseTo(-0.2)
    expect(root.position.z).toBeCloseTo(0.15)
  })

  it('keeps the first ready model camera bootstrap stable when its animation preset changes', async () => {
    const { Object3D } = await import('three')
    const root = new Object3D()
    const scene = new Object3D()
    const vrm = {
      expressionManager: {
        setValue: vi.fn()
      },
      humanoid: {
        getNormalizedBoneNode: vi.fn(() => null)
      },
      lookAt: {
        reset: vi.fn(),
        target: undefined,
        update: vi.fn()
      },
      scene,
      update: vi.fn()
    }
    vi.mocked(createPetVrmModelObjectUrl).mockResolvedValue({
      record: {
        id: 'model-a',
        importedAt: 1,
        lastModified: 1,
        name: 'Model A',
        size: 1,
        sourceUrl: 'blob:model',
        type: 'model/vrm',
        updatedAt: 1
      },
      revoke: vi.fn(),
      url: 'blob:model'
    })
    vi.mocked(loadPetVrmModel).mockResolvedValue({
      height: 1,
      root,
      vrm,
      width: 1
    } as never)

    const renderModel = (animationPreset: 'vroid-greeting' | 'vroid-spin') => (
      <VrmPastureScene
        models={[
          {
            enabled: true,
            id: 'stage-model',
            modelId: 'model-a',
            order: 0,
            positionX: 0,
            positionY: 0,
            positionZ: 0,
            profile: {
              animationPreset,
              createdAt: 1,
              enabled: true,
              modelId: 'model-a',
              order: 0,
              positionX: 0,
              positionY: 0,
              positionZ: 0,
              updatedAt: 1
            }
          }
        ]}
        stageHeight={640}
        stageWidth={420}
      />
    )

    const { rerender } = render(renderModel('vroid-greeting'))

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    act(() => {
      vi.mocked(window.requestAnimationFrame).mock.calls.at(-1)?.[0](16)
    })

    const camera = threeMocks.cameras.at(-1)
    expect(camera).toBeTruthy()
    const lookAt = camera?.lookAt as ReturnType<typeof vi.fn>
    const lookAtCallCountAfterBootstrap = lookAt.mock.calls.length

    rerender(renderModel('vroid-spin'))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    act(() => {
      vi.mocked(window.requestAnimationFrame).mock.calls.at(-1)?.[0](32)
    })

    expect(loadPetVrmModel).toHaveBeenCalledTimes(1)
    expect(threeMocks.animationMixers).toHaveLength(2)
    expect(lookAt).toHaveBeenCalledTimes(lookAtCallCountAfterBootstrap)
  })
})
