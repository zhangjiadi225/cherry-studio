import type { AgentPresentationEvent } from '@shared/ai/agentPresentationEvents'
import type {
  PetAnimalInstance,
  PetMouseState,
  PetPermissionPromptSnapshot,
  PetTaskBinding,
  PetWindowBounds
} from '@shared/pet'
import {
  getPetDimensions,
  PET_PASTURE_MAX_WIDTH,
  PET_PASTURE_MIN_WIDTH,
  PET_VRM_STAGE_DEFAULT_SCENE_SETTINGS
} from '@shared/pet'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement, useEffect } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  buildPetTaskBindingByAnimalId,
  getPetBackgroundOffsetX,
  getPetWindowRelativeMousePoint,
  isPetHitTarget,
  isPetMouseInHorizontalResizeZone,
  isPetMouseInVerticalResizeZone
} from '../PetWindowApp'
import PetWindowApp from '../PetWindowApp'
import { buildPetPastureContexts } from '../sprite/spriteBehaviorContext'
import {
  buildPetControlIslandViewModel,
  buildPetOverlayItems,
  formatPetControlSourceTitle,
  getPetTaskPreview,
  layoutPetOverlays,
  PetPermissionPromptLayer,
  PetSpriteControlIslandLayer,
  PetSpriteTaskOverlayLayer,
  reconcileOpenTaskPanelKeys
} from '../sprite/SpriteTaskLayers'
import type { PetPanelSnapshot, PetQueueSummary, PetSourceGroupSnapshot } from '../sprite/spriteTaskUi'
import { getPetSpriteResizeRequest } from '../sprite/spriteWindowController'
import { createPetVrmStageModelProfile } from '../vrm/vrmModelLibrary'
import { getPetVrmResizeRequest } from '../vrm/vrmWindowController'

const reportedAnimalPositions = vi.hoisted(() => new Set<string>())

function MockPastureAnimal({
  animal,
  onPositionChange
}: {
  animal: PetAnimalInstance
  onPositionChange: (position: unknown) => void
}) {
  useEffect(() => {
    if (reportedAnimalPositions.has(animal.id)) return
    reportedAnimalPositions.add(animal.id)
    onPositionChange({ animalId: animal.id, mode: 'walking', xRatio: 0.82 })
  }, [animal.id, onPositionChange])
  return createElement('div', { 'data-testid': `pasture-animal-${animal.id}` })
}

vi.mock('../sprite/PastureAnimal', () => ({
  default: MockPastureAnimal
}))

function MockVrmPastureScene({
  hitTestPoint,
  models,
  onHitTestTransparencyChange,
  presentationMotionStates,
  sceneSettings,
  stageHeight,
  stageWidth
}: {
  hitTestPoint?: { x: number; y: number } | null
  models: Array<{ id: string; modelId: string }>
  onHitTestTransparencyChange?: (transparent: boolean) => void
  presentationMotionStates?: ReadonlyMap<string, { phase: string }>
  sceneSettings?: { keyLightIntensity?: number }
  stageHeight: number
  stageWidth: number
}) {
  useEffect(() => {
    if (hitTestPoint) onHitTestTransparencyChange?.(false)
    else onHitTestTransparencyChange?.(true)
  }, [hitTestPoint, onHitTestTransparencyChange])

  return createElement('div', {
    'data-hit-test-point': hitTestPoint ? `${hitTestPoint.x},${hitTestPoint.y}` : '',
    'data-key-light': sceneSettings?.keyLightIntensity == null ? '' : String(sceneSettings.keyLightIntensity),
    'data-model-ids': models.map((model) => model.modelId).join(','),
    'data-motion-phases': models
      .map((model) => `${model.modelId}:${presentationMotionStates?.get(model.modelId)?.phase ?? 'idle'}`)
      .join(','),
    'data-stage-height': String(stageHeight),
    'data-stage-width': String(stageWidth),
    'data-testid': 'pet-vrm-scene'
  })
}

vi.mock('../vrm/VrmPastureScene', () => ({
  default: MockVrmPastureScene
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number; title?: string }) => {
      const value =
        {
          'settings.pet.bubble.quick_reply': 'Quick reply',
          'settings.pet.bubble.reply': 'Reply',
          'settings.pet.bubble.send': 'Send',
          'settings.pet.bubble.close': 'Close',
          'settings.pet.bubble.generating': 'Thinking...',
          'settings.pet.bubble.status.aborted': 'Stopped',
          'settings.pet.bubble.status.done': 'Ready',
          'settings.pet.bubble.status.failed': 'Failed',
          'settings.pet.bubble.status.review': 'Reviewing',
          'settings.pet.bubble.status.running': 'Responding',
          'settings.pet.bubble.status.waiting': 'Approval needed',
          'settings.pet.controlIsland.collapse': 'Collapse pet control island',
          'settings.pet.controlIsland.dismissTask': 'Hide {{title}}',
          'settings.pet.controlIsland.drag': 'Drag pet controls',
          'settings.pet.controlIsland.expand': 'Expand pet control island',
          'settings.pet.controlIsland.failed': '{{count}} failed',
          'settings.pet.controlIsland.hide': 'Hide pet controls',
          'settings.pet.controlIsland.openTask': 'Open {{title}}',
          'settings.pet.controlIsland.permission': '{{count}} permission',
          'settings.pet.controlIsland.queued': '{{count}} queued',
          'settings.pet.controlIsland.running': '{{count}} running',
          'settings.pet.controlIsland.show': 'Show pet controls',
          'settings.pet.controlIsland.sources': '{{count}} sources',
          'settings.pet.controlIsland.taskGroup': 'Task group {{count}}',
          'settings.pet.permission.allow_once': 'Allow once',
          'settings.pet.permission.deny': 'Deny',
          'settings.pet.permission.deny_reason': 'Denied from pet permission prompt',
          'settings.pet.permission.dismiss': 'Dismiss permission prompt',
          'settings.pet.permission.open_in_cherry': 'Open in Cherry',
          'settings.pet.permission.quiet_pending': 'Permission pending',
          'settings.pet.permission.redacted': 'Redacted',
          'settings.pet.permission.title': 'Cherry needs permission',
          'settings.pet.permission.truncated': 'Truncated',
          'settings.pet.queue.approvals_waiting': '{{count}} approvals waiting',
          'settings.pet.queue.collapse': 'Collapse queue',
          'settings.pet.queue.expand': 'Expand queue',
          'settings.pet.queue.failures': '{{count}} failed',
          'settings.pet.queue.tasks_queued': '{{count}} queued',
          'settings.pet.queue.tasks_running': '{{count}} running'
        }[key] ?? key
      return value.replace('{{count}}', String(options?.count ?? '')).replace('{{title}}', options?.title ?? '')
    }
  })
}))

Object.defineProperty(window, 'api', {
  configurable: true,
  value: {
    pet: {
      dismissPermissionPrompt: vi.fn(),
      dismissTaskBubble: vi.fn(),
      getPastureSnapshot: vi.fn(),
      getWindowBounds: vi.fn(),
      onMouseStateChanged: vi.fn(() => vi.fn()),
      moveWindow: vi.fn(),
      onPastureChanged: vi.fn(() => vi.fn()),
      openTask: vi.fn(),
      resizePasture: vi.fn(),
      window: {
        resize: vi.fn()
      },
      vrm: {
        deleteStageModelProfile: vi.fn(),
        getStageConfig: vi.fn(),
        setStageModelProfile: vi.fn(),
        setStageSceneSettings: vi.fn()
      },
      setMouseEventsIgnored: vi.fn(),
      setTaskBubbleHold: vi.fn(),
      sendQuickReply: vi.fn(),
      setPin: vi.fn(),
      startDraggingWindow: vi.fn(),
      startMouseTracking: vi.fn(),
      stopMouseTracking: vi.fn(),
      close: vi.fn()
    },
    ai: {
      agentPresentation: {
        getReplay: vi.fn(),
        onEvent: vi.fn(() => vi.fn())
      },
      toolApproval: {
        respond: vi.fn()
      }
    },
    windowManager: {
      openSettings: vi.fn()
    }
  }
})

const preferenceMocks = vi.hoisted(() => ({
  petDndEnabled: false,
  petMode: 'sprite-pasture',
  petScale: 0.42,
  vrmFadeOnHoverEnabled: false,
  vrmModelProfiles: {},
  vrmSceneSettings: {
    ambientLightIntensity: 2.2,
    cameraFar: 2000,
    cameraFov: 40,
    cameraNear: 0.1,
    cameraPositionX: 0,
    cameraPositionY: 0,
    cameraPositionZ: -1,
    cameraTargetX: 0,
    cameraTargetY: 0,
    cameraTargetZ: 0,
    fillLightIntensity: 1.2,
    keyLightIntensity: 2.8,
    lookAtTargetX: 0,
    lookAtTargetY: 0,
    lookAtTargetZ: -100
  }
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: (key: string) => [
    key === 'feature.pet.dnd_enabled'
      ? preferenceMocks.petDndEnabled
      : key === 'feature.pet.mode'
        ? preferenceMocks.petMode
        : key === 'feature.pet.scale'
          ? preferenceMocks.petScale
          : key === 'feature.pet.vrm.fade_on_hover_enabled'
            ? preferenceMocks.vrmFadeOnHoverEnabled
            : undefined,
    vi.fn()
  ]
}))

const bounds: PetWindowBounds = {
  x: 120,
  y: 700,
  width: 640,
  height: 320
}
let mouseStateChanged: ((state: PetMouseState) => void) | null = null
const offMouseStateChanged = vi.fn()
const elementFromPointMock = vi.fn((): Element | null => null)

Object.defineProperty(document, 'elementFromPoint', {
  configurable: true,
  value: elementFromPointMock
})
Object.defineProperty(window, 'PointerEvent', {
  configurable: true,
  value: MouseEvent
})

function emitPetMouseState(cursor: { x: number; y: number }, nextBounds: PetWindowBounds = bounds): void {
  act(() => {
    mouseStateChanged?.({
      cursor,
      bounds: nextBounds,
      updatedAt: Date.now()
    })
  })
}

describe('PetWindowApp helpers', () => {
  beforeEach(() => {
    preferenceMocks.petDndEnabled = false
    preferenceMocks.petMode = 'sprite-pasture'
    preferenceMocks.petScale = 0.42
    preferenceMocks.vrmFadeOnHoverEnabled = false
    preferenceMocks.vrmModelProfiles = {}
    preferenceMocks.vrmSceneSettings = { ...PET_VRM_STAGE_DEFAULT_SCENE_SETTINGS }
    reportedAnimalPositions.clear()
    mouseStateChanged = null
    offMouseStateChanged.mockClear()
    elementFromPointMock.mockReset()
    elementFromPointMock.mockReturnValue(null)
    vi.mocked(window.api.pet.getPastureSnapshot).mockResolvedValue({
      animals: [],
      bindings: [],
      bubbles: [],
      bounds: { x: -1, y: -1, width: 640 },
      packages: [],
      permissionPrompts: [],
      queuedTasks: [],
      vrmModelProfiles: preferenceMocks.vrmModelProfiles,
      vrmSceneSettings: preferenceMocks.vrmSceneSettings
    })
    vi.mocked(window.api.pet.getWindowBounds).mockResolvedValue(bounds)
    vi.mocked(window.api.pet.moveWindow).mockResolvedValue(bounds)
    vi.mocked(window.api.pet.resizePasture).mockResolvedValue(bounds)
    vi.mocked(window.api.pet.startDraggingWindow).mockResolvedValue(false)
    vi.mocked(window.api.pet.startMouseTracking).mockResolvedValue(undefined)
    vi.mocked(window.api.pet.stopMouseTracking).mockResolvedValue(undefined)
    vi.mocked(window.api.pet.onMouseStateChanged).mockImplementation((callback) => {
      mouseStateChanged = callback
      return offMouseStateChanged
    })
    vi.mocked(window.api.pet.onPastureChanged).mockReturnValue(vi.fn())
    vi.mocked(window.api.pet.setMouseEventsIgnored).mockResolvedValue(undefined)
    vi.mocked(window.api.pet.setPin).mockResolvedValue(undefined)
    vi.mocked(window.api.pet.close).mockResolvedValue(false)
    vi.mocked(window.api.pet.vrm.getStageConfig).mockImplementation(async () => ({
      modelProfiles: preferenceMocks.vrmModelProfiles,
      sceneSettings: preferenceMocks.vrmSceneSettings
    }))
    vi.mocked(window.api.pet.vrm.setStageModelProfile).mockImplementation(async (profile) => profile)
    vi.mocked(window.api.pet.vrm.deleteStageModelProfile).mockResolvedValue(undefined)
    vi.mocked(window.api.pet.vrm.setStageSceneSettings).mockImplementation(async (settings) => settings)
    vi.mocked(window.api.ai.agentPresentation.getReplay).mockResolvedValue([])
    vi.mocked(window.api.ai.agentPresentation.onEvent).mockReturnValue(vi.fn())
    vi.mocked(window.api.windowManager.openSettings).mockResolvedValue('')
  })

  it('keeps right-edge resize anchored on the left', () => {
    expect(getPetSpriteResizeRequest('right', bounds, 80)).toEqual({
      edge: 'right',
      x: 120,
      width: 720
    })
  })

  it('moves x while keeping the right edge stable during left-edge resize', () => {
    expect(getPetSpriteResizeRequest('left', bounds, 80)).toEqual({
      edge: 'left',
      x: 200,
      width: 560
    })
  })

  it('clamps left-edge resize at the minimum width', () => {
    expect(getPetSpriteResizeRequest('left', bounds, 400)).toEqual({
      edge: 'left',
      x: bounds.x + bounds.width - PET_PASTURE_MIN_WIDTH,
      width: PET_PASTURE_MIN_WIDTH
    })
  })

  it('resizes the VRM stage in width and height from the corner', () => {
    expect(getPetVrmResizeRequest('bottom-right', bounds, 80, 40)).toEqual({
      edge: 'bottom-right',
      height: bounds.height + 40,
      mode: 'vrm-stage',
      width: bounds.width + 80,
      x: bounds.x,
      y: bounds.y
    })
  })

  it('resizes the VRM stage from left and top edges without using pasture limits', () => {
    const tallBounds = { ...bounds, height: 520 }

    expect(getPetVrmResizeRequest('left', bounds, 80, 0)).toEqual({
      edge: 'left',
      height: bounds.height,
      mode: 'vrm-stage',
      width: bounds.width - 80,
      x: bounds.x + 80,
      y: bounds.y
    })
    expect(getPetVrmResizeRequest('top', tallBounds, 0, 40)).toEqual({
      edge: 'top',
      height: tallBounds.height - 40,
      mode: 'vrm-stage',
      width: tallBounds.width,
      x: tallBounds.x,
      y: tallBounds.y + 40
    })
  })

  it('maps the window x position to a clamped long-background crop offset', () => {
    expect(getPetBackgroundOffsetX(480, 640)).toBe(480)
    expect(getPetBackgroundOffsetX(-120, 640)).toBe(0)
    expect(getPetBackgroundOffsetX(3000, 640)).toBe(PET_PASTURE_MAX_WIDTH - 640)
    expect(getPetBackgroundOffsetX(120, PET_PASTURE_MAX_WIDTH)).toBe(0)
    expect(getPetBackgroundOffsetX(Number.POSITIVE_INFINITY, 640)).toBe(0)
  })

  it('maps global cursor state into pet-window coordinates', () => {
    expect(
      getPetWindowRelativeMousePoint({
        bounds,
        cursor: { x: 180, y: 760 },
        updatedAt: 1000
      })
    ).toEqual({ x: 60, y: 60 })
    expect(getPetWindowRelativeMousePoint(null)).toBeNull()
  })

  it('detects left and right resize edge zones from window-relative mouse coordinates', () => {
    expect(isPetMouseInHorizontalResizeZone({ x: 3, y: 120 }, 640, 320)).toBe(true)
    expect(isPetMouseInHorizontalResizeZone({ x: 638, y: 120 }, 640, 320)).toBe(true)
    expect(isPetMouseInHorizontalResizeZone({ x: -8, y: 120 }, 640, 320)).toBe(true)
    expect(isPetMouseInHorizontalResizeZone({ x: 80, y: 120 }, 640, 320)).toBe(false)
    expect(isPetMouseInHorizontalResizeZone({ x: 3, y: -40 }, 640, 320)).toBe(false)
  })

  it('detects top and bottom resize edge zones from window-relative mouse coordinates', () => {
    expect(isPetMouseInVerticalResizeZone({ x: 120, y: 3 }, 640, 320)).toBe(true)
    expect(isPetMouseInVerticalResizeZone({ x: 120, y: -8 }, 640, 320)).toBe(true)
    expect(isPetMouseInVerticalResizeZone({ x: 120, y: 318 }, 640, 320)).toBe(true)
    expect(isPetMouseInVerticalResizeZone({ x: 120, y: 328 }, 640, 320)).toBe(true)
    expect(isPetMouseInVerticalResizeZone({ x: 120, y: 40 }, 640, 320)).toBe(false)
    expect(isPetMouseInVerticalResizeZone({ x: -40, y: 318 }, 640, 320)).toBe(false)
  })

  it('detects pet hit-zone targets', () => {
    const root = document.createElement('div')
    const handle = document.createElement('div')
    const child = document.createElement('button')
    const thoughtBubble = document.createElement('button')
    handle.dataset.petHitZone = 'true'
    thoughtBubble.dataset.petHitZone = 'true'
    root.append(handle)
    handle.append(child)
    root.append(thoughtBubble)

    expect(isPetHitTarget(child)).toBe(true)
    expect(isPetHitTarget(thoughtBubble)).toBe(true)
    expect(isPetHitTarget(root)).toBe(false)
  })

  it('starts global mouse tracking and exposes horizontal resize handles', async () => {
    const { unmount } = render(createElement(PetWindowApp))

    await waitFor(() => {
      expect(window.api.pet.startMouseTracking).toHaveBeenCalled()
      expect(window.api.pet.getPastureSnapshot).toHaveBeenCalled()
    })

    expect(screen.getByTestId('pet-resize-left')).toBeInTheDocument()
    expect(screen.getByTestId('pet-resize-right')).toBeInTheDocument()
    expect(window.api.pet.resizePasture).not.toHaveBeenCalled()

    unmount()

    expect(offMouseStateChanged).toHaveBeenCalled()
    expect(window.api.pet.stopMouseTracking).toHaveBeenCalled()
  })

  it('switches VRM stage to enabled model data without rendering 2D pasture assets', async () => {
    const profile = createPetVrmStageModelProfile({
      enabled: true,
      modelId: 'model-a',
      order: 0
    })
    preferenceMocks.petMode = 'vrm-stage'
    preferenceMocks.vrmModelProfiles = {
      [profile.modelId]: profile
    }
    vi.mocked(window.api.pet.getPastureSnapshot).mockResolvedValue({
      animals: [createAnimal('animal-a', 0.5)],
      bindings: [createBinding('animal-a', 'running')],
      bubbles: [],
      bounds: { x: -1, y: -1, width: 640 },
      packages: [createPackage()],
      permissionPrompts: [],
      queuedTasks: [],
      vrmModelProfiles: preferenceMocks.vrmModelProfiles,
      vrmSceneSettings: preferenceMocks.vrmSceneSettings
    })

    render(createElement(PetWindowApp))

    const vrmScene = await screen.findByTestId('pet-vrm-scene')

    expect(vrmScene).toHaveAttribute('data-model-ids', 'model-a')
    expect(vrmScene).toHaveAttribute('data-key-light', '2.8')
    expect(vrmScene).toHaveAttribute('data-motion-phases', 'model-a:idle')
    expect(screen.queryByTestId('pet-pasture-background')).toBeNull()
    expect(screen.queryByTestId('pasture-animal-animal-a')).toBeNull()
    expect(screen.queryByLabelText('Show pet controls')).toBeNull()
    expect(screen.getByTestId('pet-resize-vrm-left')).toBeInTheDocument()
    expect(screen.getByTestId('pet-resize-vrm-right')).toBeInTheDocument()
    expect(screen.getByTestId('pet-resize-vrm-top')).toBeInTheDocument()
    expect(screen.getByTestId('pet-resize-vrm-bottom')).toBeInTheDocument()
    expect(screen.getByTestId('pet-resize-vrm-top-left')).toBeInTheDocument()
    expect(screen.getByTestId('pet-resize-vrm-top-right')).toBeInTheDocument()
    expect(screen.getByTestId('pet-resize-vrm-bottom-left')).toBeInTheDocument()
    expect(screen.getByTestId('pet-resize-vrm-bottom-right')).toBeInTheDocument()
    expect(screen.getByTestId('pet-vrm-resize-frame')).toHaveAttribute('data-visible', 'false')
    expect(screen.getByTestId('pet-vrm-stage-layer')).toHaveStyle({ opacity: '1' })
  })

  it('shows VRM-target agent status and permission prompts without local approval actions', async () => {
    const profile = createPetVrmStageModelProfile({
      agentId: 'agent-a',
      enabled: true,
      modelId: 'model-a',
      order: 0
    })
    preferenceMocks.petMode = 'vrm-stage'
    preferenceMocks.vrmModelProfiles = {
      [profile.modelId]: profile
    }
    vi.mocked(window.api.pet.getPastureSnapshot).mockResolvedValue({
      animals: [createAnimal('animal-a', 0.5)],
      bindings: [],
      bubbles: [],
      bounds: { x: -1, y: -1, width: 640 },
      packages: [createPackage()],
      permissionPrompts: [],
      queuedTasks: [],
      vrmModelProfiles: preferenceMocks.vrmModelProfiles,
      vrmSceneSettings: preferenceMocks.vrmSceneSettings
    })
    vi.mocked(window.api.ai.agentPresentation.getReplay).mockResolvedValue([
      createAgentEvent('stream.started', { agentId: 'agent-a', sessionId: 'vrm-session-a', timestamp: 1000 }),
      createAgentEvent('message.delta', {
        agentId: 'agent-a',
        delta: 'Checking the VRM model stream.',
        sessionId: 'vrm-session-a',
        timestamp: 1100
      }),
      createAgentEvent('approval.required', {
        agentId: 'agent-a',
        approvalId: 'approval-vrm',
        safePreview: '{ command: "inspect-vrm" }',
        sessionId: 'vrm-session-a',
        timestamp: 1200,
        toolCallId: 'tool-call-vrm',
        toolName: 'Bash'
      })
    ])
    const openTask = vi.spyOn(window.api.pet, 'openTask').mockResolvedValue(undefined)
    const respond = vi.spyOn(window.api.ai.toolApproval, 'respond').mockResolvedValue({ ok: true })

    render(createElement(PetWindowApp))

    await waitFor(() => {
      expect(screen.getByTestId('pet-vrm-presentation-layer')).toBeInTheDocument()
    })

    expect(screen.getByTestId('pet-vrm-scene')).toHaveAttribute('data-motion-phases', 'model-a:waiting-permission')
    expect(screen.getByTestId('pet-vrm-presentation-model-a')).toHaveAttribute('data-status', 'pending')
    expect(screen.getByText('Permission pending')).toBeInTheDocument()
    expect(screen.getByText('Cherry needs permission')).toBeInTheDocument()
    expect(screen.getByText('{ command: "inspect-vrm" }')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Allow once' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Deny' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Open in Cherry' }))

    await waitFor(() => {
      expect(openTask).toHaveBeenCalledWith('session:vrm-session-a')
    })
    expect(respond).not.toHaveBeenCalled()
  })

  it('passes speaking runtime motion to the VRM scene for a streaming bound agent', async () => {
    const profile = createPetVrmStageModelProfile({
      agentId: 'agent-a',
      enabled: true,
      modelId: 'model-a',
      order: 0
    })
    preferenceMocks.petMode = 'vrm-stage'
    preferenceMocks.vrmModelProfiles = {
      [profile.modelId]: profile
    }
    vi.mocked(window.api.pet.getPastureSnapshot).mockResolvedValue({
      animals: [createAnimal('animal-a', 0.5)],
      bindings: [],
      bubbles: [],
      bounds: { x: -1, y: -1, width: 640 },
      packages: [createPackage()],
      permissionPrompts: [],
      queuedTasks: [],
      vrmModelProfiles: preferenceMocks.vrmModelProfiles,
      vrmSceneSettings: preferenceMocks.vrmSceneSettings
    })
    vi.mocked(window.api.ai.agentPresentation.getReplay).mockResolvedValue([
      createAgentEvent('stream.started', { agentId: 'agent-a', sessionId: 'vrm-session-a', timestamp: 1000 }),
      createAgentEvent('message.delta', {
        agentId: 'agent-a',
        delta: 'The VRM model is speaking now.',
        sessionId: 'vrm-session-a',
        timestamp: 1100
      })
    ])

    render(createElement(PetWindowApp))

    await waitFor(() => {
      expect(screen.getByTestId('pet-vrm-scene')).toHaveAttribute('data-motion-phases', 'model-a:speaking')
    })
  })

  it('keeps VRM-target tasks out of the sprite pasture bubbles and control island', async () => {
    const profile = createPetVrmStageModelProfile({
      agentId: 'agent-a',
      enabled: true,
      modelId: 'model-a',
      order: 0
    })
    preferenceMocks.petMode = 'sprite-pasture'
    preferenceMocks.vrmModelProfiles = {
      [profile.modelId]: profile
    }
    vi.mocked(window.api.pet.getPastureSnapshot).mockResolvedValue({
      animals: [createAnimal('animal-a', 0.5)],
      bindings: [],
      bubbles: [],
      bounds: { x: -1, y: -1, width: 640 },
      packages: [createPackage()],
      permissionPrompts: [],
      queuedTasks: [],
      vrmModelProfiles: preferenceMocks.vrmModelProfiles,
      vrmSceneSettings: preferenceMocks.vrmSceneSettings
    })
    vi.mocked(window.api.ai.agentPresentation.getReplay).mockResolvedValue([
      createAgentEvent('stream.started', { agentId: 'agent-a', sessionId: 'vrm-session-a', timestamp: 1000 }),
      createAgentEvent('approval.required', {
        agentId: 'agent-a',
        approvalId: 'approval-vrm',
        safePreview: 'VRM-only preview',
        sessionId: 'vrm-session-a',
        timestamp: 1100,
        toolCallId: 'tool-call-vrm',
        toolName: 'Bash'
      }),
      createAgentEvent('stream.started', { agentId: 'agent-b', sessionId: 'animal-session-b', timestamp: 1200 })
    ])

    render(createElement(PetWindowApp))

    await waitFor(() => {
      expect(screen.getByTestId('pet-thought-bubble-session-animal-session-b')).toBeInTheDocument()
    })

    expect(screen.queryByTestId('pet-thought-bubble-session-vrm-session-a')).toBeNull()
    fireEvent.mouseEnter(screen.getByTestId('pet-control-island'))
    expect(screen.queryByText('VRM-only preview')).toBeNull()
    expect(screen.queryByText('Cherry needs permission')).toBeNull()
  })

  it('shows the VRM resize frame after hovering near a window edge', async () => {
    const profile = createPetVrmStageModelProfile({
      enabled: true,
      modelId: 'model-a',
      order: 0
    })
    preferenceMocks.petMode = 'vrm-stage'
    preferenceMocks.vrmModelProfiles = {
      [profile.modelId]: profile
    }

    render(createElement(PetWindowApp))

    await waitFor(() => {
      expect(mouseStateChanged).toBeTruthy()
    })

    expect(screen.getByTestId('pet-vrm-resize-frame')).toHaveAttribute('data-visible', 'false')
    emitPetMouseState({ x: bounds.x + 2, y: bounds.y + 120 })

    await waitFor(
      () => {
        expect(screen.getByTestId('pet-vrm-resize-frame')).toHaveAttribute('data-visible', 'true')
      },
      { timeout: 600 }
    )

    emitPetMouseState({ x: bounds.x + 120, y: bounds.y + 120 })

    await waitFor(() => {
      expect(screen.getByTestId('pet-vrm-resize-frame')).toHaveAttribute('data-visible', 'false')
    })
  })

  it('syncs VRM stage dimensions from the current pet window bounds', async () => {
    const profile = createPetVrmStageModelProfile({
      enabled: true,
      modelId: 'model-a',
      order: 0
    })
    preferenceMocks.petMode = 'vrm-stage'
    preferenceMocks.vrmModelProfiles = {
      [profile.modelId]: profile
    }

    render(createElement(PetWindowApp))

    await waitFor(() => {
      expect(mouseStateChanged).toBeTruthy()
    })

    emitPetMouseState({ x: bounds.x + 20, y: bounds.y + 30 }, { ...bounds, width: 480, height: 720 })

    await waitFor(() => {
      expect(screen.getByTestId('pet-vrm-scene')).toHaveAttribute('data-stage-width', '480')
      expect(screen.getByTestId('pet-vrm-scene')).toHaveAttribute('data-stage-height', '720')
    })
  })

  it('keeps VRM window interactive when fade-on-hover is disabled', async () => {
    const profile = createPetVrmStageModelProfile({
      enabled: true,
      modelId: 'model-a',
      order: 0
    })
    preferenceMocks.petMode = 'vrm-stage'
    preferenceMocks.vrmModelProfiles = {
      [profile.modelId]: profile
    }

    render(createElement(PetWindowApp))

    await waitFor(() => {
      expect(mouseStateChanged).toBeTruthy()
    })

    emitPetMouseState({ x: bounds.x + 120, y: bounds.y + 120 })

    await waitFor(() => {
      expect(window.api.pet.setMouseEventsIgnored).toHaveBeenLastCalledWith(false)
    })
    expect(screen.getByTestId('pet-vrm-stage-layer')).toHaveStyle({ opacity: '1' })
  })

  it('matches VRM fade-on-hover click-through on opaque VRM pixels', async () => {
    const profile = createPetVrmStageModelProfile({
      enabled: true,
      modelId: 'model-a',
      order: 0
    })
    preferenceMocks.petMode = 'vrm-stage'
    preferenceMocks.vrmModelProfiles = {
      [profile.modelId]: profile
    }
    preferenceMocks.vrmFadeOnHoverEnabled = true

    render(createElement(PetWindowApp))

    await waitFor(() => {
      expect(mouseStateChanged).toBeTruthy()
    })

    emitPetMouseState({ x: bounds.x + 120, y: bounds.y + 120 })

    await waitFor(() => {
      expect(window.api.pet.setMouseEventsIgnored).toHaveBeenLastCalledWith(true)
    })
    expect(screen.getByTestId('pet-vrm-stage-layer')).toHaveStyle({ opacity: '0' })

    emitPetMouseState({ x: bounds.x + 2, y: bounds.y + 120 })

    await waitFor(() => {
      expect(window.api.pet.setMouseEventsIgnored).toHaveBeenLastCalledWith(false)
    })
  })

  it('keeps the pet window interactive over hit zones and horizontal resize edges', async () => {
    const hitZone = document.createElement('button')
    hitZone.dataset.petHitZone = 'true'
    render(createElement(PetWindowApp))

    await waitFor(() => {
      expect(mouseStateChanged).toBeTruthy()
    })

    elementFromPointMock.mockReturnValue(hitZone)
    emitPetMouseState({ x: bounds.x + 120, y: bounds.y + 120 })

    await waitFor(() => {
      expect(window.api.pet.setMouseEventsIgnored).toHaveBeenLastCalledWith(false)
    })

    elementFromPointMock.mockReturnValue(null)
    emitPetMouseState({ x: bounds.x + 2, y: bounds.y + 120 })

    await waitFor(() => {
      expect(window.api.pet.setMouseEventsIgnored).toHaveBeenLastCalledWith(false)
    })
  })

  it('starts native dragging from the ground drag zone before falling back to manual movement', async () => {
    vi.mocked(window.api.pet.startDraggingWindow).mockResolvedValue(true)
    render(createElement(PetWindowApp))

    await waitFor(() => {
      expect(screen.getByTestId('pet-ground-drag')).toBeInTheDocument()
    })

    fireEvent.pointerDown(screen.getByTestId('pet-ground-drag'), {
      button: 0,
      clientX: 320,
      clientY: 900,
      pointerId: 1,
      screenX: 320,
      screenY: 900
    })

    await waitFor(() => {
      expect(window.api.pet.startDraggingWindow).toHaveBeenCalled()
    })
    expect(window.api.pet.moveWindow).not.toHaveBeenCalled()
  })

  it('falls back to manual ground dragging when native dragging is unavailable', async () => {
    vi.mocked(window.api.pet.startDraggingWindow).mockResolvedValue(false)
    vi.mocked(window.api.pet.moveWindow).mockResolvedValue({ ...bounds, x: 160 })
    render(createElement(PetWindowApp))

    const ground = await screen.findByTestId('pet-ground-drag')

    fireEvent.pointerDown(ground, {
      button: 0,
      clientX: 320,
      clientY: 900,
      pointerId: 1,
      screenX: 320,
      screenY: 900
    })
    await waitFor(() => {
      expect(window.api.pet.getWindowBounds).toHaveBeenCalled()
    })

    fireEvent.pointerUp(ground, {
      clientX: 360,
      clientY: 900,
      pointerId: 1,
      screenX: 360,
      screenY: 900
    })

    await waitFor(() => {
      expect(window.api.pet.moveWindow).toHaveBeenCalledWith({ x: 160, y: bounds.y })
    })
  })

  it('resizes from the right edge using the shared pasture resize request', async () => {
    render(createElement(PetWindowApp))

    const rightHandle = await screen.findByTestId('pet-resize-right')

    fireEvent.pointerDown(rightHandle, {
      button: 0,
      clientX: 760,
      clientY: 800,
      pointerId: 2,
      screenX: 760,
      screenY: 800
    })
    await waitFor(() => {
      expect(window.api.pet.getWindowBounds).toHaveBeenCalled()
    })

    fireEvent.pointerUp(rightHandle, {
      clientX: 820,
      clientY: 800,
      pointerId: 2,
      screenX: 820,
      screenY: 800
    })

    await waitFor(() => {
      expect(window.api.pet.resizePasture).toHaveBeenCalledWith({
        edge: 'right',
        x: bounds.x,
        width: bounds.width + 60
      })
    })
  })

  it('builds nearby context from live enabled pet positions without waking bound pets', () => {
    const animals: PetAnimalInstance[] = [
      createAnimal('animal-a', 0.5),
      createAnimal('animal-b', 0.55),
      createAnimal('animal-c', 0.9, false)
    ]
    const bindings = new Map<string, PetTaskBinding>([
      [
        'animal-a',
        {
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
          title: 'Session A',
          updatedAt: 1000
        }
      ]
    ])

    const contexts = buildPetPastureContexts({
      animals,
      bindingByAnimalId: bindings,
      bubbleByAnimalId: new Map(),
      livePositions: new Map([
        ['animal-a', { animalId: 'animal-a', mode: 'walking', xRatio: 0.5 }],
        ['animal-b', { animalId: 'animal-b', mode: 'playing', xRatio: 0.54 }]
      ])
    })

    expect(contexts.get('animal-b')?.nearbyPets).toEqual([
      expect.objectContaining({ animalId: 'animal-a', mode: 'walking', xRatio: 0.5 })
    ])
    expect(contexts.get('animal-a')?.task).toBe('running')
    expect(contexts.get('animal-a')?.suppressReason).toBe('task-bound')
    expect(contexts.has('animal-c')).toBe(false)
  })

  it('keeps task context scoped to the assigned pet', () => {
    const animals: PetAnimalInstance[] = [createAnimal('animal-a', 0.3), createAnimal('animal-b', 0.6)]
    const bindings = new Map<string, PetTaskBinding>([
      ['animal-a', { ...createBinding('animal-a', 'running'), taskKey: 'session:shared-task' }]
    ])
    const livePositions = new Map([
      ['animal-a', { animalId: 'animal-a', mode: 'observing' as const, xRatio: 0.3 }],
      ['animal-b', { animalId: 'animal-b', mode: 'observing' as const, xRatio: 0.6 }]
    ])

    const contexts = buildPetPastureContexts({
      animals,
      bindingByAnimalId: bindings,
      bubbleByAnimalId: new Map(),
      livePositions
    })
    const overlays = buildPetOverlayItems({
      animals,
      bindingByAnimalId: bindings,
      bubbleByAnimalId: new Map(),
      livePositions,
      stageWidth: 640
    })

    expect(contexts.get('animal-b')).toMatchObject({
      task: 'idle',
      suppressReason: undefined
    })
    expect(contexts.get('animal-a')).toMatchObject({
      task: 'running',
      suppressReason: 'task-bound'
    })
    expect(overlays).toHaveLength(1)
    expect(overlays[0]).toMatchObject({ animalId: 'animal-a', taskKey: 'session:shared-task' })
  })

  it('keeps one stable highest-priority binding per animal when multiple tasks share a pet', () => {
    const waiting = {
      ...createBinding('animal-a', 'waiting'),
      startedAt: 2000,
      taskKey: 'session:waiting',
      title: 'Waiting task'
    }
    const running = {
      ...createBinding('animal-a', 'running'),
      startedAt: 1000,
      taskKey: 'session:running',
      title: 'Running task'
    }

    const bindingByAnimalId = buildPetTaskBindingByAnimalId([running, waiting])
    const overlays = buildPetOverlayItems({
      animals: [createAnimal('animal-a', 0.3)],
      bindingByAnimalId,
      bubbleByAnimalId: new Map(),
      livePositions: new Map(),
      stageWidth: 640
    })

    expect(bindingByAnimalId.get('animal-a')).toMatchObject({ taskKey: 'session:waiting', status: 'waiting' })
    expect(overlays).toHaveLength(1)
    expect(overlays[0]).toMatchObject({ taskKey: 'session:waiting', title: 'Waiting task' })
  })

  it('adds scene balancing hints when most visible pets are already walking', () => {
    const animals: PetAnimalInstance[] = [
      createAnimal('animal-a', 0.2),
      createAnimal('animal-b', 0.4),
      createAnimal('animal-c', 0.6),
      createAnimal('animal-d', 0.8)
    ]

    const contexts = buildPetPastureContexts({
      animals,
      bindingByAnimalId: new Map(),
      bubbleByAnimalId: new Map(),
      livePositions: new Map([
        ['animal-a', { animalId: 'animal-a', mode: 'walking', xRatio: 0.2 }],
        ['animal-b', { animalId: 'animal-b', mode: 'walking', xRatio: 0.4 }],
        ['animal-c', { animalId: 'animal-c', mode: 'walking', xRatio: 0.6 }],
        ['animal-d', { animalId: 'animal-d', mode: 'observing', xRatio: 0.8 }]
      ])
    })

    expect(contexts.get('animal-d')?.sceneEnergy).toBeGreaterThan(0.5)
    expect(contexts.get('animal-d')?.sceneActivityHint).toBe('quiet')
  })

  it('calculates scene energy from nearby pets without counting the current pet', () => {
    const animals: PetAnimalInstance[] = [createAnimal('animal-a', 0.2), createAnimal('animal-b', 0.4)]

    const contexts = buildPetPastureContexts({
      animals,
      bindingByAnimalId: new Map(),
      bubbleByAnimalId: new Map(),
      livePositions: new Map([
        ['animal-a', { animalId: 'animal-a', mode: 'walking', xRatio: 0.2 }],
        ['animal-b', { animalId: 'animal-b', mode: 'observing', xRatio: 0.4 }]
      ])
    })

    expect(contexts.get('animal-a')?.sceneEnergy).toBe(0)
    expect(contexts.get('animal-a')?.sceneActivityHint).toBe('active')
    expect(contexts.get('animal-b')?.sceneEnergy).toBe(1)
    expect(contexts.get('animal-b')?.sceneActivityHint).toBe('quiet')
  })

  it('anchors task overlays to the configured pet size', () => {
    const [defaultItem] = buildPetOverlayItems({
      animals: [createAnimal('animal-a', 0.5)],
      bindingByAnimalId: new Map([['animal-a', createBinding('animal-a', 'running')]]),
      bubbleByAnimalId: new Map(),
      livePositions: new Map(),
      stageWidth: 640
    })
    const [largeItem] = buildPetOverlayItems({
      animals: [createAnimal('animal-a', 0.5)],
      bindingByAnimalId: new Map([['animal-a', createBinding('animal-a', 'running')]]),
      bubbleByAnimalId: new Map(),
      livePositions: new Map(),
      petDimensions: getPetDimensions(0.64),
      stageWidth: 640
    })

    expect(largeItem.anchorY).toBeLessThan(defaultItem.anchorY)
  })

  it('builds task overlay items by priority from active pet tasks', () => {
    const animals: PetAnimalInstance[] = [
      createAnimal('animal-running', 0.2),
      createAnimal('animal-waiting', 0.4),
      createAnimal('animal-done', 0.6)
    ]
    const bindings = new Map<string, PetTaskBinding>([
      ['animal-running', createBinding('animal-running', 'running')],
      ['animal-waiting', createBinding('animal-waiting', 'waiting')]
    ])

    const items = buildPetOverlayItems({
      animals,
      bindingByAnimalId: bindings,
      bubbleByAnimalId: new Map([
        [
          'animal-done',
          {
            ...createBinding('animal-done', 'done'),
            endedAt: 1300,
            status: 'done'
          }
        ]
      ]),
      livePositions: new Map([
        ['animal-running', { animalId: 'animal-running', mode: 'observing', xRatio: 0.2 }],
        ['animal-waiting', { animalId: 'animal-waiting', mode: 'observing', xRatio: 0.4 }],
        ['animal-done', { animalId: 'animal-done', mode: 'observing', xRatio: 0.6 }]
      ]),
      stageWidth: 640
    })

    expect(items.map((item) => item.status)).toEqual(['waiting', 'running', 'done'])
    expect(items[0]).toMatchObject({ animalId: 'animal-waiting', priority: 100, variant: 'panel' })
  })

  it('keeps task overlays as compact status bubbles even when selected', () => {
    const items = [createOverlayItem('a', 220, 100), createOverlayItem('b', 245, 90), createOverlayItem('c', 270, 80)]

    const placements = layoutPetOverlays(items, 640, new Set(['session:a', 'session:b', 'session:c']))

    expect(placements).toHaveLength(3)
    expect(placements.every((placement) => !placement.expanded)).toBe(true)
    expect(placements.every((placement) => placement.rect.width <= 92 && placement.rect.height <= 28)).toBe(true)
  })

  it('derives a single control island view model from sources, queue, and selection', () => {
    const permission = permissionPromptToPanel(createPermissionPrompt({ approvalId: 'approval-a' }))
    const running = createPanel({ id: 'task:session:a', taskKey: 'session:a', title: 'Session A', status: 'running' })
    const sourceGroup = createSourceGroup({
      sourceKey: 'agent:agent-a',
      sourceTitle: 'Research Assistant',
      tasks: [permission, running]
    })

    const viewModel = buildPetControlIslandViewModel({
      panels: sourceGroup.tasks,
      queueSummary: queueSummaryFromPanels(sourceGroup.tasks),
      selectedTaskKey: 'session:a',
      sourceGroups: [sourceGroup]
    })

    expect(viewModel.groups).toHaveLength(1)
    expect(viewModel.priorityPanel?.id).toBe('permission:approval-a')
    expect(viewModel.selectedGroupId).toBe('source:agent:agent-a')
    expect(viewModel.selectedPanelId).toBe('task:session:a')
    expect(viewModel.summary).toMatchObject({
      approvalsWaiting: 1,
      sourceCount: 1,
      tasksRunning: 1
    })
  })

  it('keeps opened task panels through a short transient snapshot gap', () => {
    const now = 10_000
    const missingOnce = reconcileOpenTaskPanelKeys({
      currentOpenKeys: new Set(['session:a']),
      liveTaskKeys: new Set(),
      missingSinceByTaskKey: new Map(),
      now,
      retentionMs: 1200
    })

    expect(missingOnce.openKeys.has('session:a')).toBe(true)
    expect(missingOnce.missingSinceByTaskKey.get('session:a')).toBe(now)

    const restored = reconcileOpenTaskPanelKeys({
      currentOpenKeys: missingOnce.openKeys,
      liveTaskKeys: new Set(['session:a']),
      missingSinceByTaskKey: missingOnce.missingSinceByTaskKey,
      now: now + 400,
      retentionMs: 1200
    })

    expect(restored.openKeys.has('session:a')).toBe(true)
    expect(restored.missingSinceByTaskKey.has('session:a')).toBe(false)

    const expired = reconcileOpenTaskPanelKeys({
      currentOpenKeys: missingOnce.openKeys,
      liveTaskKeys: new Set(),
      missingSinceByTaskKey: missingOnce.missingSinceByTaskKey,
      now: now + 1300,
      retentionMs: 1200
    })

    expect(expired.openKeys.has('session:a')).toBe(false)
  })

  it('keeps a running task with no streamed text as a compact bubble', () => {
    const [item] = buildPetOverlayItems({
      animals: [createAnimal('animal-running', 0.3)],
      bindingByAnimalId: new Map([['animal-running', createBinding('animal-running', 'running')]]),
      bubbleByAnimalId: new Map(),
      livePositions: new Map([['animal-running', { animalId: 'animal-running', mode: 'observing', xRatio: 0.3 }]]),
      stageWidth: 640
    })

    expect(item).toMatchObject({ status: 'running' })
    expect(layoutPetOverlays([item], 640, new Set([item.taskKey]))[0]?.expanded).toBe(false)
  })

  it('creates compact task previews from safe tail content', () => {
    const preview = getPetTaskPreview({
      ...createBinding('animal-a', 'running'),
      streamText: [
        'Preparing files',
        '```ts',
        'const token = "secret"',
        '```',
        '',
        'Final answer is ready with a concise summary for the user.'
      ].join('\n')
    })

    expect(preview).toContain('Final answer')
    expect(preview).not.toContain('const token')
    expect(preview.length).toBeLessThanOrEqual(140)
  })

  it('redacts secrets from task previews before rendering bubble text', () => {
    const preview = getPetTaskPreview({
      ...createBinding('animal-a', 'done'),
      messages: [
        {
          id: 'message-a',
          role: 'assistant',
          text: 'Done. api_key=sk-proj-abcdefghijklmnopqrstuvwxyz123456 and Bearer ghp_abcdefghijklmnopqrstuvwxyz1234567890'
        }
      ]
    })

    expect(preview).toContain('[REDACTED]')
    expect(preview).not.toContain('sk-proj-')
    expect(preview).not.toContain('ghp_')
  })

  it('shows a compact status bubble for a running task before streamed content arrives', () => {
    const item = createOverlayItem('a', 220, 100)
    item.summary = ''

    render(
      createElement(PetSpriteTaskOverlayLayer, {
        onSelectTask: vi.fn(),
        placements: layoutPetOverlays([item], 640, new Set([item.taskKey]))
      })
    )

    expect(screen.getByTestId('pet-thought-bubble-session-a')).toBeInTheDocument()
    expect(screen.getByText('Responding')).toBeInTheDocument()
    expect(screen.queryByTestId('pet-stream-panel-session-a')).toBeNull()
  })

  it('selects the task from the compact bubble without rendering a local peek panel', () => {
    const item = createOverlayItem('a', 220, 100)
    const onSelectTask = vi.fn()

    render(
      createElement(PetSpriteTaskOverlayLayer, {
        onSelectTask,
        placements: layoutPetOverlays([item], 640, new Set([item.taskKey]))
      })
    )

    fireEvent.click(screen.getByTestId('pet-thought-bubble-session-a'))
    expect(onSelectTask).toHaveBeenLastCalledWith('session:a')
    expect(screen.queryByTestId('pet-stream-panel-session-a')).toBeNull()
    expect(screen.getByTestId('pet-thought-bubble-session-a')).toBeInTheDocument()
  })

  it('keeps quick reply controls out of the pet-local status bubble', () => {
    const item = createOverlayItem('a', 220, 100)

    render(
      createElement(PetSpriteTaskOverlayLayer, {
        onSelectTask: vi.fn(),
        placements: layoutPetOverlays([item], 640, new Set([item.taskKey]))
      })
    )

    expect(screen.queryByLabelText('Quick reply')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reply' })).toBeNull()
    expect(window.api.pet.setTaskBubbleHold).not.toHaveBeenCalled()
  })

  it('keeps permission work inside the control island and opens the source session', async () => {
    const prompt = createPermissionPrompt({ approvalId: 'approval-a', animalId: 'animal-a' })
    const openTask = vi.spyOn(window.api.pet, 'openTask').mockResolvedValue(undefined)
    const respond = vi.spyOn(window.api.ai.toolApproval, 'respond').mockResolvedValue({ ok: true })

    render(
      createElement(PetSpriteControlIslandLayer, {
        animals: [createAnimal('animal-a', 0.5)],
        dndEnabled: false,
        panels: [permissionPromptToPanel(prompt)],
        queueSummary: queueSummaryFromPanels([permissionPromptToPanel(prompt)]),
        stageWidth: 640
      })
    )

    expect(screen.getByTestId('pet-control-island')).toBeInTheDocument()
    expect(screen.queryByTestId('pet-control-priority-panel')).toBeNull()
    expect(screen.queryByTestId('pet-command-panel-permission-approval-a')).toBeNull()

    fireEvent.mouseEnter(screen.getByTestId('pet-control-island'))

    expect(screen.getByTestId('pet-control-priority-panel')).toBeInTheDocument()
    expect(screen.getByText('Cherry needs permission')).toBeInTheDocument()
    expect(screen.getAllByText('Bash').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('{ command: [REDACTED] }')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open in Cherry' })).toBeNull()

    fireEvent.click(screen.getByLabelText('Open Session A'))

    await waitFor(() => {
      expect(openTask).toHaveBeenCalledWith('session:session-a')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Deny' }))
    await waitFor(() => {
      expect(respond).toHaveBeenCalledWith({
        approvalId: 'approval-a',
        approved: false,
        reason: 'Denied from pet permission prompt',
        topicId: 'agent-session:session-a',
        anchorId: 'tool-call-a'
      })
    })

    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }))
    await waitFor(() => {
      expect(respond).toHaveBeenLastCalledWith({
        approvalId: 'approval-a',
        approved: true,
        topicId: 'agent-session:session-a',
        anchorId: 'tool-call-a'
      })
    })

    fireEvent.mouseLeave(screen.getByTestId('pet-control-island'))
    expect(screen.queryByTestId('pet-control-priority-panel')).toBeNull()
  })

  it('dismisses permission prompts without sending an approval response', async () => {
    const prompt = createPermissionPrompt({ approvalId: 'approval-a' })
    const dismissPermissionPrompt = vi.spyOn(window.api.pet, 'dismissPermissionPrompt').mockResolvedValue(undefined)
    const respond = vi.spyOn(window.api.ai.toolApproval, 'respond').mockResolvedValue({ ok: true })

    render(
      createElement(PetPermissionPromptLayer, {
        prompts: [prompt],
        stageWidth: 640
      })
    )

    fireEvent.click(screen.getByLabelText('Dismiss permission prompt'))

    await waitFor(() => {
      expect(dismissPermissionPrompt).toHaveBeenCalledWith('approval-a')
    })
    expect(respond).not.toHaveBeenCalled()
  })

  it('sends allow once and deny decisions through the approval bridge only', async () => {
    const prompt = createPermissionPrompt({ approvalId: 'approval-a' })
    const dismissPermissionPrompt = vi.spyOn(window.api.pet, 'dismissPermissionPrompt').mockResolvedValue(undefined)
    const respond = vi.spyOn(window.api.ai.toolApproval, 'respond').mockResolvedValue({ ok: true })

    render(
      createElement(PetPermissionPromptLayer, {
        prompts: [prompt],
        stageWidth: 640
      })
    )

    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }))
    await waitFor(() => {
      expect(respond).toHaveBeenCalledWith({
        approvalId: 'approval-a',
        approved: true,
        topicId: 'agent-session:session-a',
        anchorId: 'tool-call-a'
      })
    })

    fireEvent.click(screen.getByRole('button', { name: 'Deny' }))
    await waitFor(() => {
      expect(respond).toHaveBeenLastCalledWith({
        approvalId: 'approval-a',
        approved: false,
        reason: 'Denied from pet permission prompt',
        topicId: 'agent-session:session-a',
        anchorId: 'tool-call-a'
      })
    })
    expect(dismissPermissionPrompt).not.toHaveBeenCalled()
  })

  it('hides passive task overlays during pet DND while keeping permission prompts actionable', async () => {
    preferenceMocks.petDndEnabled = true
    const respond = vi.spyOn(window.api.ai.toolApproval, 'respond').mockResolvedValue({ ok: true })
    vi.mocked(window.api.pet.getPastureSnapshot).mockResolvedValue({
      animals: [createAnimal('animal-a', 0.5)],
      bindings: [],
      bubbles: [],
      bounds: { x: -1, y: -1, width: 640 },
      packages: [createPackage()],
      permissionPrompts: [],
      queuedTasks: [],
      vrmModelProfiles: preferenceMocks.vrmModelProfiles,
      vrmSceneSettings: preferenceMocks.vrmSceneSettings
    })
    vi.mocked(window.api.ai.agentPresentation.getReplay).mockResolvedValue([
      createAgentEvent('stream.started'),
      createAgentEvent('approval.required')
    ])

    render(createElement(PetWindowApp))

    await waitFor(() => {
      expect(screen.getByTestId('pet-control-island')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('pet-thought-bubble-session-animal-a')).toBeNull()
    expect(screen.queryByTestId('pet-control-priority-panel')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Allow once' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Deny' })).toBeNull()

    fireEvent.mouseEnter(screen.getByTestId('pet-control-island'))
    expect(screen.getByTestId('pet-control-priority-panel')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText(/Open Session/))
    await waitFor(() => {
      expect(window.api.pet.openTask).toHaveBeenCalledWith('session:session-a')
    })
    expect(respond).not.toHaveBeenCalled()
  })

  it('shows one control island queue summary without stacking every permission panel', () => {
    const panels = [
      permissionPromptToPanel(createPermissionPrompt({ approvalId: 'approval-a', createdAt: 1000 })),
      permissionPromptToPanel(createPermissionPrompt({ approvalId: 'approval-b', createdAt: 2000 })),
      createPanel({
        id: 'task:queued',
        status: 'queued',
        taskKey: 'session:queued',
        title: 'Queued task',
        priority: 300
      })
    ]

    render(
      createElement(PetSpriteControlIslandLayer, {
        animals: [createAnimal('animal-a', 0.5)],
        dndEnabled: false,
        panels,
        queueSummary: queueSummaryFromPanels(panels),
        stageWidth: 640
      })
    )

    expect(screen.getAllByTestId('pet-control-island')).toHaveLength(1)
    expect(screen.queryByTestId('pet-control-priority-panel')).toBeNull()
    expect(screen.queryByTestId('pet-command-panel-permission-approval-b')).toBeNull()
    expect(screen.queryByText('Session A')).toBeNull()

    fireEvent.mouseEnter(screen.getByTestId('pet-control-island'))

    expect(screen.getByTestId('pet-control-priority-panel')).toBeInTheDocument()
    expect(screen.getByTestId('pet-control-queue')).toHaveTextContent('2 approvals waiting')
    expect(screen.getByTestId('pet-control-queue')).toHaveTextContent('1 queued')
    expect(screen.getAllByText('Session A').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Queued task').length).toBeGreaterThanOrEqual(1)

    fireEvent.mouseLeave(screen.getByTestId('pet-control-island'))
    expect(screen.queryByText('Session A')).toBeNull()
  })

  it('shows regular task details only while hovering the control island', () => {
    const panel = createPanel({ id: 'task:session:a', taskKey: 'session:a', title: 'Session A', status: 'running' })

    render(
      createElement(PetSpriteControlIslandLayer, {
        animals: [createAnimal('animal-a', 0.5)],
        dndEnabled: false,
        panels: [panel],
        queueSummary: emptyQueueSummary(),
        stageWidth: 640
      })
    )

    expect(screen.getByTestId('pet-control-island')).toBeInTheDocument()
    expect(screen.queryByTestId('pet-control-task-row-task-session-a')).toBeNull()

    fireEvent.mouseEnter(screen.getByTestId('pet-control-island'))
    expect(screen.getByTestId('pet-control-task-row-task-session-a')).toBeInTheDocument()

    fireEvent.mouseLeave(screen.getByTestId('pet-control-island'))
    expect(screen.queryByTestId('pet-control-task-row-task-session-a')).toBeNull()
  })

  it('renders one control island with source rows for multiple tasks', async () => {
    const sourceGroup = createSourceGroup({
      animalId: 'animal-a',
      sourceKey: 'agent:e4d1842b-6e05-4181-b0fe-092d839ab111',
      sourceTitle: 'Agent e4d1842b-6e05-4181-b0fe-092d839ab111',
      tasks: [
        createPanel({ id: 'task:session:a', taskKey: 'session:a', title: 'Write 100 words', status: 'running' }),
        createPanel({ id: 'task:session:b', taskKey: 'session:b', title: 'Session B', status: 'queued' })
      ]
    })
    const openTask = vi.spyOn(window.api.pet, 'openTask').mockResolvedValue(undefined)

    render(
      createElement(PetSpriteControlIslandLayer, {
        animals: [createAnimal('animal-a', 0.5)],
        dndEnabled: false,
        panels: sourceGroup.tasks,
        queueSummary: queueSummaryFromPanels(sourceGroup.tasks),
        sourceGroups: [sourceGroup],
        stageWidth: 640
      })
    )

    expect(screen.getAllByTestId('pet-control-island')).toHaveLength(1)
    expect(screen.queryByTestId('pet-control-source-row-agent-agent-a')).toBeNull()
    expect(screen.queryByTestId('pet-command-panel-task-session-a')).toBeNull()

    fireEvent.mouseEnter(screen.getByTestId('pet-control-island'))

    expect(screen.getByTestId('pet-control-source-row-agent-e4d1842b-6e05-4181-b0fe-092d839ab111')).toBeInTheDocument()
    expect(
      screen.getByTestId('pet-control-group-details-agent-e4d1842b-6e05-4181-b0fe-092d839ab111')
    ).toBeInTheDocument()
    expect(screen.getAllByText('Write 100 words').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText(/e4d1842b/)).toBeNull()
    expect(screen.getAllByText('Session B').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByLabelText('Copy Write 100 words')).toBeNull()
    expect(screen.getByLabelText('Open Write 100 words').tagName).toBe('DIV')

    fireEvent.click(screen.getByLabelText('Open Write 100 words'))
    await waitFor(() => {
      expect(openTask).toHaveBeenCalledWith('session:a')
    })

    fireEvent.mouseLeave(screen.getByTestId('pet-control-island'))
    expect(screen.queryByTestId('pet-control-group-details-agent-e4d1842b-6e05-4181-b0fe-092d839ab111')).toBeNull()
  })

  it('keeps the control island lowered in the right-side safe area by default', () => {
    const sourceGroup = createSourceGroup({
      animalId: 'animal-a',
      sourceKey: 'agent:agent-a',
      sourceTitle: 'Research Assistant',
      tasks: [createPanel({ id: 'task:session:a', taskKey: 'session:a', title: 'Session A', status: 'running' })]
    })

    render(
      createElement(PetSpriteControlIslandLayer, {
        animals: [createAnimal('animal-a', 0.5)],
        dndEnabled: false,
        panels: sourceGroup.tasks,
        queueSummary: queueSummaryFromPanels(sourceGroup.tasks),
        sourceGroups: [sourceGroup],
        stageWidth: 640
      })
    )

    expect(screen.getByTestId('pet-control-island')).toHaveStyle({ left: '324px', top: '36px' })
    expect(screen.queryByTestId('pet-command-queue-summary')).toBeNull()
  })

  it('drags the sprite control island within the current window session', async () => {
    const panel = createPanel({ id: 'task:session:a', taskKey: 'session:a', title: 'Session A', status: 'running' })

    render(
      createElement(PetSpriteControlIslandLayer, {
        animals: [createAnimal('animal-a', 0.5)],
        dndEnabled: false,
        panels: [panel],
        queueSummary: queueSummaryFromPanels([panel]),
        stageWidth: 640
      })
    )

    const handle = screen.getByTestId('pet-control-island-handle')
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, screenX: 340, screenY: 50 })
    fireEvent.pointerMove(screen.getByTestId('pet-control-island'), { pointerId: 1, screenX: 240, screenY: 76 })
    fireEvent.pointerUp(screen.getByTestId('pet-control-island'), { pointerId: 1, screenX: 240, screenY: 76 })

    await waitFor(() => {
      expect(screen.getByTestId('pet-control-island')).toHaveStyle({ left: '224px', top: '62px' })
    })
  })

  it('hides to a left edge icon tab after drag and waits for re-hover before expanding', async () => {
    const panel = createPanel({ id: 'task:session:a', taskKey: 'session:a', title: 'Session A', status: 'running' })

    render(
      createElement(PetSpriteControlIslandLayer, {
        animals: [createAnimal('animal-a', 0.5)],
        dndEnabled: false,
        panels: [panel],
        queueSummary: queueSummaryFromPanels([panel]),
        stageWidth: 640
      })
    )

    const handle = screen.getByTestId('pet-control-island-handle')
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, screenX: 340, screenY: 50 })
    fireEvent.pointerMove(screen.getByTestId('pet-control-island'), { pointerId: 1, screenX: 20, screenY: 64 })
    fireEvent.pointerUp(screen.getByTestId('pet-control-island'), { pointerId: 1, screenX: 20, screenY: 64 })

    await waitFor(() => {
      expect(screen.getByTestId('pet-control-island-tab')).toBeInTheDocument()
    })
    expect(screen.getByTestId('pet-control-island')).toHaveStyle({ left: '0px', top: '50px', width: '32px' })
    fireEvent.mouseEnter(screen.getByTestId('pet-control-island'))
    expect(screen.queryByTestId('pet-control-island-panel')).toBeNull()

    fireEvent.mouseLeave(screen.getByTestId('pet-control-island'))
    fireEvent.mouseEnter(screen.getByTestId('pet-control-island'))
    expect(screen.getByTestId('pet-control-island-panel')).toBeInTheDocument()
  })

  it('hides to a right edge icon tab and can be revealed by click', async () => {
    const panel = createPanel({ id: 'task:session:a', taskKey: 'session:a', title: 'Session A', status: 'running' })

    render(
      createElement(PetSpriteControlIslandLayer, {
        animals: [createAnimal('animal-a', 0.5)],
        dndEnabled: false,
        panels: [panel],
        queueSummary: queueSummaryFromPanels([panel]),
        stageWidth: 640
      })
    )

    const handle = screen.getByTestId('pet-control-island-handle')
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, screenX: 340, screenY: 50 })
    fireEvent.pointerMove(screen.getByTestId('pet-control-island'), { pointerId: 1, screenX: 350, screenY: 50 })
    fireEvent.pointerUp(screen.getByTestId('pet-control-island'), { pointerId: 1, screenX: 350, screenY: 50 })

    await waitFor(() => {
      expect(screen.getByTestId('pet-control-island-tab')).toBeInTheDocument()
    })
    expect(screen.getByTestId('pet-control-island')).toHaveStyle({ left: '608px', width: '32px' })

    fireEvent.click(screen.getByTestId('pet-control-island-tab'))
    await waitFor(() => {
      expect(screen.queryByTestId('pet-control-island-tab')).toBeNull()
    })
    expect(screen.getByTestId('pet-control-island')).toHaveStyle({ left: '336px' })
  })

  it('formats generated source ids into readable task titles or task groups', () => {
    const t = (key: string, options?: { count: number }) =>
      key === 'settings.pet.controlIsland.taskGroup' ? `Task group ${options?.count}` : key
    const readable = createSourceGroup({
      sourceKey: 'agent:e4d1842b-6e05-4181-b0fe-092d839ab111',
      sourceTitle: 'Agent e4d1842b-6e05-4181-b0fe-092d839ab111',
      tasks: [
        createPanel({
          id: 'task:session:a',
          taskKey: 'session:a',
          title: 'Write 100 words'
        })
      ]
    })
    const fallback = createSourceGroup({
      sourceKey: 'agent:99fdf57e-f028-4bfc-92c3-6f2fa972222',
      sourceTitle: 'Agent 99fdf57e-f028-4bfc-92c3-6f2fa972222',
      tasks: [
        createPanel({
          id: 'task:session:b',
          taskKey: 'session:b',
          title: 'Agent 99fdf57e-f028-4bfc-92c3-6f2fa972222'
        })
      ]
    })

    expect(formatPetControlSourceTitle(readable, 0, t)).toBe('Write 100 words')
    expect(formatPetControlSourceTitle(fallback, 1, t)).toBe('Task group 2')
  })

  it('clears live positions for disabled or deleted animals before they can affect overlays again', async () => {
    const initialSnapshot = {
      animals: [createAnimal('animal-a', 0.2)],
      bindings: [],
      bubbles: [],
      bounds: { x: -1, y: -1, width: 640 },
      packages: [createPackage()],
      permissionPrompts: [],
      queuedTasks: [],
      vrmModelProfiles: preferenceMocks.vrmModelProfiles,
      vrmSceneSettings: preferenceMocks.vrmSceneSettings
    }
    const pastureChangedCallbacks: Array<(snapshot: typeof initialSnapshot) => void> = []
    let agentPresentationChanged: ((event: AgentPresentationEvent) => void) | undefined
    vi.mocked(window.api.pet.getPastureSnapshot).mockResolvedValue(initialSnapshot)
    vi.mocked(window.api.pet.onPastureChanged).mockImplementation((callback) => {
      pastureChangedCallbacks.push(callback as (snapshot: typeof initialSnapshot) => void)
      return vi.fn()
    })
    vi.mocked(window.api.ai.agentPresentation.getReplay).mockResolvedValue([
      createAgentEvent('stream.started', { sessionId: 'animal-a' })
    ])
    vi.mocked(window.api.ai.agentPresentation.onEvent).mockImplementation((callback) => {
      agentPresentationChanged = callback
      return vi.fn()
    })

    render(createElement(PetWindowApp))

    await waitFor(() => {
      expect(screen.getByTestId('pet-thought-bubble-session-animal-a')).toHaveStyle({ left: '453px' })
    })

    act(() => {
      const snapshot = {
        ...initialSnapshot,
        animals: [{ ...initialSnapshot.animals[0], enabled: false }],
        bindings: []
      }
      pastureChangedCallbacks.forEach((callback) => callback(snapshot))
    })

    await waitFor(() => {
      expect(screen.queryByTestId('pet-thought-bubble-session-animal-a')).toBeNull()
    })

    act(() => {
      const snapshot = {
        ...initialSnapshot,
        animals: [createAnimal('animal-a', 0.2)]
      }
      pastureChangedCallbacks.forEach((callback) => callback(snapshot))
      agentPresentationChanged?.(
        createAgentEvent('message.delta', { delta: 'again', sessionId: 'animal-a', timestamp: 1400 })
      )
    })

    await waitFor(() => {
      expect(screen.getByTestId('pet-thought-bubble-session-animal-a')).toHaveStyle({ left: '106px' })
    })
  })
})

function createAgentEvent<TType extends AgentPresentationEvent['type']>(
  type: TType,
  overrides: Partial<Extract<AgentPresentationEvent, { type: TType }>> = {}
): Extract<AgentPresentationEvent, { type: TType }> {
  return {
    agentId: 'agent-a',
    approvalId: 'approval-a',
    delta: 'hello',
    messageId: 'message-a',
    previewRedacted: true,
    previewTruncated: false,
    safePreview: '{ command: [REDACTED] }',
    sessionId: 'session-a',
    streamId: 'turn-a',
    timestamp: 1000,
    toolCallId: 'tool-call-a',
    toolName: 'Bash',
    type,
    ...overrides
  } as unknown as Extract<AgentPresentationEvent, { type: TType }>
}

function createAnimal(id: string, homeXRatio: number, enabled = true): PetAnimalInstance {
  return {
    createdAt: '2026-01-01T00:00:00.000Z',
    enabled,
    homeXRatio,
    id,
    name: id,
    order: 0,
    packageId: 'test-pet',
    personality: 'watcher'
  }
}

function createPackage() {
  return {
    description: 'Test pet',
    displayName: 'Test Pet',
    id: 'test-pet',
    imported: true,
    spriteUrl: 'file:///test-pet.png',
    spritesheetPath: 'spritesheet.png'
  }
}

function createBinding(animalId: string, status: PetTaskBinding['status']): PetTaskBinding {
  return {
    animalId,
    kind: 'session',
    startedAt: 1000,
    status,
    sourceKey: 'agent:agent-a',
    sourceKind: 'agent',
    sourceId: 'agent-a',
    sourceTitle: 'Agent A',
    targetId: `${animalId}-session`,
    taskKey: `session:${animalId}`,
    title: animalId,
    updatedAt: 1200
  }
}

function createOverlayItem(
  animalId: string,
  anchorX: number,
  priority: number
): ReturnType<typeof buildPetOverlayItems>[number] {
  return {
    animalId,
    anchorX,
    anchorY: 48,
    priority,
    status: 'running' as const,
    summary: `Summary ${animalId}`,
    taskKey: `session:${animalId}`,
    title: animalId,
    variant: 'panel' as const
  }
}

function createPermissionPrompt(overrides: Partial<PetPermissionPromptSnapshot> = {}): PetPermissionPromptSnapshot {
  return {
    animalId: 'animal-a',
    approvalId: 'approval-a',
    createdAt: 1000,
    dismissed: false,
    kind: 'session',
    previewRedacted: true,
    previewTruncated: false,
    safePreview: '{ command: [REDACTED] }',
    sessionId: 'session-a',
    sourceKey: 'agent:agent-a',
    sourceKind: 'agent',
    sourceId: 'agent-a',
    sourceTitle: 'Agent A',
    status: 'pending',
    targetId: 'session-a',
    taskKey: 'session:session-a',
    title: 'Session A',
    toolCallId: 'tool-call-a',
    toolName: 'Bash',
    updatedAt: 1000,
    ...overrides
  }
}

function createPanel(overrides: Partial<PetPanelSnapshot> = {}): PetPanelSnapshot {
  return {
    actions: ['open-task', 'copy', 'dismiss'],
    animalId: 'animal-a',
    createdAt: 1000,
    id: 'task:session:animal-a',
    kind: 'task',
    priority: 300,
    status: 'running',
    summary: 'Summary',
    taskKey: 'session:animal-a',
    title: 'Panel title',
    updatedAt: 1200,
    ...overrides
  }
}

function permissionPromptToPanel(prompt: PetPermissionPromptSnapshot): PetPanelSnapshot {
  return {
    actions: ['allow-once', 'deny', 'open-in-cherry', 'dismiss'],
    animalId: prompt.animalId,
    approvalId: prompt.approvalId,
    createdAt: prompt.createdAt,
    id: `permission:${prompt.approvalId}`,
    kind: 'permission',
    previewRedacted: prompt.previewRedacted,
    previewTruncated: prompt.previewTruncated,
    priority: 700,
    safePreview: prompt.safePreview,
    sessionId: prompt.sessionId,
    status: 'pending',
    summary: prompt.safePreview,
    taskKey: prompt.taskKey,
    title: prompt.title,
    toolCallId: prompt.toolCallId,
    toolName: prompt.toolName,
    updatedAt: prompt.updatedAt
  }
}

function createSourceGroup(overrides: Partial<PetSourceGroupSnapshot> = {}): PetSourceGroupSnapshot {
  const tasks = overrides.tasks ?? [createPanel()]
  return {
    animalId: 'animal-a',
    highestPriority: Math.max(...tasks.map((task) => task.priority)),
    id: 'source:agent:agent-a',
    sourceId: 'agent-a',
    sourceKey: 'agent:agent-a',
    sourceKind: 'agent',
    sourceTitle: 'Agent A',
    status: tasks[0]?.status ?? 'running',
    taskCount: tasks.length,
    tasks,
    updatedAt: Math.max(...tasks.map((task) => task.updatedAt)),
    ...overrides
  }
}

function emptyQueueSummary(): PetQueueSummary {
  return {
    approvalsWaiting: 0,
    failures: 0,
    items: [],
    tasksQueued: 0,
    tasksRunning: 0
  }
}

function queueSummaryFromPanels(panels: PetPanelSnapshot[]): PetQueueSummary {
  return {
    approvalsWaiting: panels.filter((panel) => panel.kind === 'permission').length,
    failures: panels.filter((panel) => panel.status === 'failed').length,
    items: panels.map((panel) => ({
      animalId: panel.animalId,
      createdAt: panel.createdAt,
      id: panel.id,
      kind: panel.kind,
      priority: panel.priority,
      status: panel.status,
      taskKey: panel.taskKey,
      title: panel.title
    })),
    tasksQueued: panels.filter((panel) => panel.status === 'queued').length,
    tasksRunning: panels.filter((panel) => panel.status === 'running').length
  }
}
