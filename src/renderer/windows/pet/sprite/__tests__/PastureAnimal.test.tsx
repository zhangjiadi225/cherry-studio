import type {
  PetAnimalInstance,
  PetPackageInfo,
  PetRuntimeClip,
  PetTaskBinding,
  PetTaskBubbleSnapshot
} from '@shared/pet'
import { getPetDimensions, PET_ANIMAL_WIDTH } from '@shared/pet'
import { act, fireEvent, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import PastureAnimal from '../PastureAnimal'

const spriteAnimatorMock = vi.hoisted(() =>
  vi.fn(({ clip }: { clip: PetRuntimeClip; scale?: number }) => (
    <div data-animation={clip.phaseKey} data-testid="pet-sprite" />
  ))
)

vi.mock('../SpriteAnimator', () => ({
  default: spriteAnimatorMock
}))

const packageInfo: PetPackageInfo = {
  description: 'Test pet',
  displayName: 'Test Pet',
  id: 'test-pet',
  imported: true,
  spriteUrl: 'file:///test-pet.png',
  spritesheetPath: 'spritesheet.png'
}

function createAnimal(overrides: Partial<PetAnimalInstance> = {}): PetAnimalInstance {
  return {
    createdAt: '2026-01-01T00:00:00.000Z',
    enabled: true,
    homeXRatio: 0.5,
    id: 'animal-a',
    name: 'Animal A',
    order: 0,
    packageId: packageInfo.id,
    personality: 'watcher',
    ...overrides
  }
}

function createBinding(overrides: Partial<PetTaskBinding> = {}): PetTaskBinding {
  return {
    animalId: 'animal-a',
    kind: 'session',
    startedAt: 1000,
    status: 'running',
    sourceKey: 'agent:agent-a',
    sourceKind: 'agent',
    sourceId: 'agent-a',
    sourceTitle: 'Agent A',
    targetId: 'session-a',
    taskKey: 'session:session-a',
    title: 'Session',
    updatedAt: 1000,
    ...overrides
  }
}

function createBubble(overrides: Partial<PetTaskBubbleSnapshot> = {}): PetTaskBubbleSnapshot {
  return {
    animalId: 'animal-a',
    endedAt: Date.now(),
    kind: 'session',
    sourceKey: 'agent:agent-a',
    sourceKind: 'agent',
    sourceId: 'agent-a',
    sourceTitle: 'Agent A',
    startedAt: Date.now() - 1000,
    status: 'done',
    targetId: 'session-a',
    taskKey: 'session:session-a',
    title: 'Session',
    updatedAt: Date.now(),
    ...overrides
  }
}

describe('PastureAnimal behavior loop', () => {
  const petApi = {
    dismissPermissionPrompt: vi.fn(),
    dismissTaskBubble: vi.fn(),
    openTask: vi.fn(),
    setTaskBubbleHold: vi.fn(),
    upsertAnimal: vi.fn()
  }

  let rafCallbacks: FrameRequestCallback[]

  beforeEach(() => {
    spriteAnimatorMock.mockClear()
    vi.clearAllMocks()
    rafCallbacks = []
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        pet: petApi
      }
    })
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      rafCallbacks.push(callback)
      return rafCallbacks.length
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
  })

  it('runs idle pets through a calm animation frame loop before roaming', () => {
    const { container } = render(<PastureAnimal animal={createAnimal()} packageInfo={packageInfo} stageWidth={640} />)
    const root = container.querySelector('[data-pet-hit-zone="true"]') as HTMLElement

    expect(window.requestAnimationFrame).toHaveBeenCalled()
    const initialLeft = root.style.left
    const start = performance.now() + 100

    act(() => {
      rafCallbacks.shift()?.(start)
      rafCallbacks.shift()?.(start + 400)
    })

    expect(root.style.left).toBe(initialLeft)
    expect(spriteAnimatorMock.mock.calls.at(-1)?.[0].clip.phaseKey).toBe('codex-atlas:observe')
    expect(root.style.transform).toBe('translateY(-1px) scale(1.02)')
  })

  it('keeps task bindings in task animation mode without rendering the old full bubble', () => {
    const { container } = render(
      <PastureAnimal animal={createAnimal()} binding={createBinding()} packageInfo={packageInfo} stageWidth={640} />
    )

    expect(window.requestAnimationFrame).not.toHaveBeenCalled()
    expect(spriteAnimatorMock.mock.calls.at(-1)?.[0].clip.phaseKey).toBe('codex-atlas:run')
    expect(container.querySelector('[data-pet-bubble="true"]')).toBeNull()
  })

  it('uses rich package clips when available for the current semantic action', () => {
    render(
      <PastureAnimal
        animal={createAnimal()}
        binding={createBinding()}
        packageInfo={{
          ...packageInfo,
          multiAssetClips: {
            run: {
              frames: [{ durationMs: 200, height: 96, imageUrl: 'file:///rich/run.webp', width: 96 }],
              loop: true
            }
          }
        }}
        stageWidth={640}
      />
    )

    expect(spriteAnimatorMock.mock.calls.at(-1)?.[0].clip).toMatchObject({
      frames: [{ height: 96, imageUrl: 'file:///rich/run.webp', width: 96 }],
      frameDurations: [200],
      phaseKey: 'multi-asset:run:run'
    })
  })

  it('uses configured pet scale for sprite size and movement bounds', () => {
    const onPositionChange = vi.fn()
    const petScale = 0.64
    const { container } = render(
      <PastureAnimal
        animal={createAnimal({ homeXRatio: 0.25 })}
        onPositionChange={onPositionChange}
        packageInfo={packageInfo}
        petScale={petScale}
        stageWidth={640}
      />
    )
    const root = container.querySelector('[data-pet-hit-zone="true"]') as HTMLElement
    root.setPointerCapture = vi.fn()

    expect(root.style.width).toBe(`${getPetDimensions(petScale).width}px`)
    expect(spriteAnimatorMock.mock.calls.at(-1)?.[0].scale).toBe(petScale)

    act(() => {
      dispatchPointer(root, 'pointerdown', { button: 0, pointerId: 1, screenX: 100 })
      dispatchPointer(root, 'pointermove', { pointerId: 1, screenX: 260 })
      dispatchPointer(root, 'pointerup', { button: 0, pointerId: 1, screenX: 260 })
    })

    const expectedRatio = 0.25 + 160 / (640 - getPetDimensions(petScale).width)
    expect(petApi.upsertAnimal).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'animal-a', homeXRatio: expectedRatio })
    )
  })

  it('persists manual drag position through the pet API', () => {
    const { container } = render(<PastureAnimal animal={createAnimal()} packageInfo={packageInfo} stageWidth={640} />)
    const root = container.querySelector('[data-pet-hit-zone="true"]') as HTMLElement
    root.setPointerCapture = vi.fn()

    dispatchPointer(root, 'pointerdown', { button: 0, pointerId: 1, screenX: 100 })
    dispatchPointer(root, 'pointermove', { pointerId: 1, screenX: 180 })
    dispatchPointer(root, 'pointerup', { button: 0, pointerId: 1, screenX: 180 })

    expect(petApi.upsertAnimal).toHaveBeenCalledWith(expect.objectContaining({ homeXRatio: expect.any(Number) }))
  })

  it('persists the latest drag position when pointerup happens before React rerenders', () => {
    const onPositionChange = vi.fn()
    const { container } = render(
      <PastureAnimal
        animal={createAnimal({ homeXRatio: 0.25 })}
        onPositionChange={onPositionChange}
        packageInfo={packageInfo}
        stageWidth={640}
      />
    )
    const root = container.querySelector('[data-pet-hit-zone="true"]') as HTMLElement
    root.setPointerCapture = vi.fn()

    act(() => {
      dispatchPointer(root, 'pointerdown', { button: 0, pointerId: 1, screenX: 100 })
      dispatchPointer(root, 'pointermove', { pointerId: 1, screenX: 260 })
      dispatchPointer(root, 'pointerup', { button: 0, pointerId: 1, screenX: 260 })
    })

    const expectedRatio = 0.25 + 160 / (640 - PET_ANIMAL_WIDTH)
    expect(petApi.upsertAnimal).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'animal-a', homeXRatio: expectedRatio })
    )
    expect(onPositionChange).toHaveBeenCalledWith(
      expect.objectContaining({ animalId: 'animal-a', xRatio: expectedRatio })
    )
  })

  it('does not open a task overlay from the click emitted after dragging a pet', () => {
    const onFocusRequest = vi.fn()
    const { container } = render(
      <PastureAnimal
        animal={createAnimal()}
        binding={createBinding()}
        hasTaskOverlay
        onFocusRequest={onFocusRequest}
        packageInfo={packageInfo}
        stageWidth={640}
      />
    )
    const root = container.querySelector('[data-pet-hit-zone="true"]') as HTMLElement
    root.setPointerCapture = vi.fn()

    dispatchPointer(root, 'pointerdown', { button: 0, pointerId: 1, screenX: 100 })
    dispatchPointer(root, 'pointermove', { pointerId: 1, screenX: 180 })
    dispatchPointer(root, 'pointerup', { button: 0, pointerId: 1, screenX: 180 })
    fireEvent.click(root)

    expect(onFocusRequest).not.toHaveBeenCalled()
    expect(petApi.openTask).not.toHaveBeenCalled()
  })

  it('cleans up canceled drags without persisting or opening task overlays', () => {
    const onFocusRequest = vi.fn()
    const { container } = render(
      <PastureAnimal
        animal={createAnimal()}
        binding={createBinding()}
        hasTaskOverlay
        onFocusRequest={onFocusRequest}
        packageInfo={packageInfo}
        stageWidth={640}
      />
    )
    const root = container.querySelector('[data-pet-hit-zone="true"]') as HTMLElement
    root.setPointerCapture = vi.fn()

    dispatchPointer(root, 'pointerdown', { button: 0, pointerId: 1, screenX: 100 })
    dispatchPointer(root, 'pointermove', { pointerId: 1, screenX: 180 })
    dispatchPointer(root, 'pointercancel', { pointerId: 1, screenX: 180 })
    fireEvent.click(root)

    expect(petApi.upsertAnimal).not.toHaveBeenCalled()
    expect(onFocusRequest).not.toHaveBeenCalled()
    expect(petApi.openTask).not.toHaveBeenCalled()
  })

  it('keeps the ambient behavior frame running when an unrelated task binding object is recreated', () => {
    const { rerender } = render(
      <PastureAnimal
        animal={createAnimal({ id: 'animal-b' })}
        binding={undefined}
        packageInfo={packageInfo}
        stageWidth={640}
      />
    )

    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1)

    rerender(
      <PastureAnimal
        animal={createAnimal({ id: 'animal-b' })}
        binding={undefined}
        packageInfo={packageInfo}
        stageWidth={640}
      />
    )

    expect(window.cancelAnimationFrame).not.toHaveBeenCalled()
    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1)
  })

  it('does not reset a task pet animation when the same task binding snapshot is recreated', () => {
    const { container, rerender } = render(
      <PastureAnimal animal={createAnimal()} binding={createBinding()} packageInfo={packageInfo} stageWidth={640} />
    )
    const root = container.querySelector('[data-pet-hit-zone="true"]') as HTMLElement

    fireEvent.click(root)
    expect(spriteAnimatorMock.mock.calls.at(-1)?.[0].clip.phaseKey).toBe('codex-atlas:wave')

    rerender(
      <PastureAnimal
        animal={createAnimal()}
        binding={createBinding({ updatedAt: 2000 })}
        packageInfo={packageInfo}
        stageWidth={640}
      />
    )

    expect(spriteAnimatorMock.mock.calls.at(-1)?.[0].clip.phaseKey).toBe('codex-atlas:wave')
  })

  it('reports ambient position changes without persisting them', () => {
    const onPositionChange = vi.fn()
    render(
      <PastureAnimal
        animal={createAnimal()}
        onPositionChange={onPositionChange}
        packageInfo={packageInfo}
        stageWidth={640}
      />
    )
    const start = performance.now() + 100

    act(() => {
      rafCallbacks.shift()?.(start)
      rafCallbacks.shift()?.(start + 2500)
    })

    expect(onPositionChange).toHaveBeenCalledWith(
      expect.objectContaining({ animalId: 'animal-a', mode: expect.any(String), xRatio: expect.any(Number) })
    )
    expect(petApi.upsertAnimal).not.toHaveBeenCalled()
  })

  it('pauses ambient movement while a terminal quick-reply bubble is visible', () => {
    render(<PastureAnimal animal={createAnimal()} bubble={createBubble()} packageInfo={packageInfo} stageWidth={640} />)

    expect(window.requestAnimationFrame).not.toHaveBeenCalled()
    expect(spriteAnimatorMock.mock.calls.at(-1)?.[0].clip.phaseKey).toBe('codex-atlas:celebrate')
  })

  it('keeps ambient movement paused while the task panel is open', () => {
    render(
      <PastureAnimal
        animal={createAnimal()}
        bubble={createBubble({
          endedAt: Date.now() - 31_000,
          startedAt: Date.now() - 40_000,
          updatedAt: Date.now() - 31_000
        })}
        isTaskFocused
        packageInfo={packageInfo}
        stageWidth={640}
      />
    )

    expect(window.requestAnimationFrame).not.toHaveBeenCalled()
  })

  it('enters a settling ambient frame after a terminal bubble is dismissed', () => {
    const bubble = createBubble()
    const { rerender } = render(
      <PastureAnimal animal={createAnimal()} bubble={bubble} packageInfo={packageInfo} stageWidth={640} />
    )

    rerender(
      <PastureAnimal
        animal={createAnimal()}
        bubble={{ ...bubble, bubbleDismissed: true }}
        packageInfo={packageInfo}
        stageWidth={640}
      />
    )

    expect(window.requestAnimationFrame).toHaveBeenCalled()
    act(() => {
      rafCallbacks.shift()?.(performance.now() + 100)
    })
    expect(spriteAnimatorMock.mock.calls.at(-1)?.[0].clip.phaseKey).toBe('codex-atlas:observe')
  })
})

function dispatchPointer(target: Element, type: string, props: Record<string, unknown>): void {
  const event = new Event(type, { bubbles: true, cancelable: true })
  for (const [key, value] of Object.entries(props)) {
    Object.defineProperty(event, key, { configurable: true, value })
  }
  fireEvent(target, event)
}
