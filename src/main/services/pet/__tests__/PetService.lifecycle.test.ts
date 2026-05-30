import { IpcChannel } from '@shared/IpcChannel'
import type { PetActivityState, PetAnimalInstance } from '@shared/pet'
import {
  PET_PASTURE_MAX_WIDTH,
  PET_PASTURE_MIN_WIDTH,
  PET_VRM_STAGE_MIN_HEIGHT,
  PET_VRM_STAGE_MIN_WIDTH
} from '@shared/pet'
import { defaultServiceInstances } from '@test-mocks/main/application'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { screen } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BaseService } from '../../../core/lifecycle/BaseService'
import { PetService } from '../PetService'

const aiStreamManagerMock = vi.hoisted(() => ({
  addListener: vi.fn(() => true),
  removeListener: vi.fn()
}))

const agentPresentationEventBridgeMock = vi.hoisted(() => ({
  onAgentPresentationEvent: vi.fn(() => ({ dispose: vi.fn() }))
}))

const petPackageStoreMock = vi.hoisted(() => ({
  deleteImportedPackage: vi.fn(),
  findImportedPackage: vi.fn(),
  importPetPackage: vi.fn(),
  listImportedPetPackages: vi.fn(async () => []),
  toPetPackageInfo: vi.fn()
}))

const mainWindowServiceMock = vi.hoisted(() => ({
  getMainWindow: vi.fn<() => Electron.BrowserWindow | null>(() => null),
  showMainWindow: vi.fn()
}))

const display = {
  id: 1,
  bounds: { x: 0, y: 0, width: 1440, height: 900 },
  workArea: { x: 0, y: 24, width: 1440, height: 876 },
  scaleFactor: 1,
  rotation: 0,
  touchSupport: 'unknown',
  accelerometerSupport: 'unknown',
  monochrome: false,
  colorDepth: 24,
  colorSpace: '{primaries:BT709, transfer:SRGB, matrix:RGB, range:FULL}',
  depthPerComponent: 8,
  displayFrequency: 60,
  internal: false,
  label: '',
  maximumCursorSize: { width: 0, height: 0 },
  nativeOrigin: { x: 0, y: 0 },
  size: { width: 1440, height: 900 },
  workAreaSize: { width: 1440, height: 876 }
} as Electron.Display

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    AgentPresentationEventBridge: agentPresentationEventBridgeMock,
    AiStreamManager: aiStreamManagerMock,
    MainWindowService: mainWindowServiceMock,
    PetAssetService: {
      deleteSpritePackage: petPackageStoreMock.deleteImportedPackage,
      findSpritePackage: petPackageStoreMock.findImportedPackage,
      importSpritePackage: petPackageStoreMock.importPetPackage,
      listSpritePackages: petPackageStoreMock.listImportedPetPackages
    }
  } as never)
})

vi.mock('@main/ai/streamManager/context/dispatch', () => ({
  dispatchStreamRequest: vi.fn()
}))

describe('PetService platform boundary', () => {
  beforeEach(() => {
    BaseService.resetInstances()
    MockMainPreferenceServiceUtils.resetMocks()
    vi.clearAllMocks()
    vi.mocked(screen.getPrimaryDisplay).mockReturnValue(display)
    vi.mocked(screen.getDisplayNearestPoint).mockReturnValue(display)
    vi.mocked(screen.getAllDisplays).mockReturnValue([display])
    mainWindowServiceMock.getMainWindow.mockReturnValue(null)
    petPackageStoreMock.listImportedPetPackages.mockResolvedValue([])
  })

  it('does not subscribe to the agent presentation bridge on init', async () => {
    const service = createService()

    await service._doInit()

    expect(agentPresentationEventBridgeMock.onAgentPresentationEvent).not.toHaveBeenCalled()
  })

  it('returns pasture packages, animals, and bounds without main-owned presentation state', async () => {
    const service = createService()
    const animals = [createAnimal('animal-a')]
    petPackageStoreMock.listImportedPetPackages.mockResolvedValue([{ displayName: 'Test Pet', id: 'test-pet' }])
    vi.spyOn(service as unknown as { getAnimals: () => Promise<PetAnimalInstance[]> }, 'getAnimals').mockResolvedValue(
      animals
    )
    vi.spyOn(
      service as unknown as { getPasturePreferenceBounds: () => { x: number; y: number; width: number } },
      'getPasturePreferenceBounds'
    ).mockReturnValue({ x: -1, y: -1, width: 640 })

    const snapshot = await service.getPastureSnapshot()

    expect(snapshot).toMatchObject({
      animals,
      bindings: [],
      bounds: { x: -1, y: -1, width: 640 },
      bubbles: [],
      permissionPrompts: [],
      queuedTasks: []
    })
    expect(snapshot.packages).toEqual([{ displayName: 'Test Pet', id: 'test-pet' }])
  })

  it('opens agent sessions directly from a renderer-owned session task key', async () => {
    const executeJavaScript = vi.fn()
    mainWindowServiceMock.getMainWindow.mockReturnValue({
      isDestroyed: vi.fn(() => false),
      webContents: { executeJavaScript }
    } as unknown as Electron.BrowserWindow)
    const service = createService()

    await service.openTask('session:session-a')

    expect(executeJavaScript).toHaveBeenCalledWith(
      'window.navigate?.({ to: "/app/agents", search: {"sessionId":"session-a","view":"message"}, replace: false })'
    )
    expect(mainWindowServiceMock.showMainWindow).toHaveBeenCalledTimes(1)
  })

  it('dispatches quick replies from a renderer-owned session task key', async () => {
    const { dispatchStreamRequest } = await import('@main/ai/streamManager/context/dispatch')
    vi.mocked(dispatchStreamRequest).mockResolvedValue({ mode: 'started' })
    const service = createService()

    await service.sendQuickReply(createWebContents(), { taskKey: 'session:session-a', text: 'continue' })

    expect(dispatchStreamRequest).toHaveBeenCalledWith(
      aiStreamManagerMock,
      expect.objectContaining({ topicId: 'agent-session:session-a' }),
      expect.objectContaining({
        topicId: 'agent-session:session-a',
        trigger: 'submit-message',
        userMessageParts: [{ text: 'continue', type: 'text' }]
      })
    )
  })

  it('rejects task commands that are not agent session task keys', async () => {
    const service = createService()

    await expect(service.openTask('topic:topic-a')).rejects.toThrow(/agent session/)
    await expect(
      service.sendQuickReply(createWebContents(), { taskKey: 'topic:topic-a', text: 'continue' })
    ).rejects.toThrow(/agent session/)
  })

  it('keeps renderer-owned dismiss and hold commands as validated main-side no-ops', async () => {
    const service = createService()
    const broadcastPastureChanged = vi.mocked(
      (service as unknown as { broadcastPastureChanged: () => Promise<void> }).broadcastPastureChanged
    )

    await service.dismissTaskBubble('session:session-a')
    await service.dismissPermissionPrompt('approval-a')
    service.setTaskBubbleHold({ hasDraft: true, held: true, taskKey: 'session:session-a' })

    expect(broadcastPastureChanged).not.toHaveBeenCalled()
  })

  it('rejects deleting a package while an animal still uses it', async () => {
    const service = createService()
    vi.spyOn(service as unknown as { getAnimals: () => Promise<PetAnimalInstance[]> }, 'getAnimals').mockResolvedValue([
      createAnimal('animal-a')
    ])

    await expect(service.deletePackage('test-pet')).rejects.toThrow(/still used/)

    expect(petPackageStoreMock.deleteImportedPackage).not.toHaveBeenCalled()
  })

  it('broadcasts semantic play animation requests', () => {
    const service = createService()
    const windowManager = defaultServiceInstances.WindowManager
    windowManager.broadcastToType.mockClear()
    vi.spyOn(service as unknown as { getPetWindow: () => null }, 'getPetWindow').mockReturnValue(null)

    service.playAnimation('wave', true, 'manual')

    expect(windowManager.broadcastToType).toHaveBeenCalledWith(
      expect.any(String),
      IpcChannel.Pet_ActivityChanged,
      expect.objectContaining({
        animation: 'wave',
        playOnce: true,
        reason: 'manual'
      })
    )
  })

  it('broadcasts pasture updates when the pet scale preference changes', async () => {
    const service = createService()

    await service._doInit()
    MockMainPreferenceServiceUtils.simulateExternalPreferenceChange('feature.pet.scale', 0.64)

    expect(
      vi.mocked(service as unknown as { broadcastPastureChanged: () => Promise<void> }).broadcastPastureChanged
    ).toHaveBeenCalled()
  })

  it('switches window size limits between 2D pasture and VRM stage modes', async () => {
    const service = createService()
    const window = createPetWindow({ x: 0, y: 580, width: 640, height: 320 })
    vi.spyOn(
      service as unknown as { getPetWindow: () => Electron.BrowserWindow | null },
      'getPetWindow'
    ).mockReturnValue(window)
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.pet.mode', 'vrm-stage')

    await callPrivateWithArgs(service, 'applyCurrentBounds')

    expect(window.setMinimumSize).toHaveBeenLastCalledWith(PET_VRM_STAGE_MIN_WIDTH, PET_VRM_STAGE_MIN_HEIGHT)
    expect(window.setMaximumSize).toHaveBeenLastCalledWith(display.workArea.width, display.workArea.height)
    expect(window.setBounds).toHaveBeenLastCalledWith({ x: 495, y: 162, width: 450, height: 600 }, false)

    MockMainPreferenceServiceUtils.setPreferenceValue('feature.pet.mode', 'sprite-pasture')

    await callPrivateWithArgs(service, 'applyCurrentBounds')

    expect(window.setMinimumSize).toHaveBeenLastCalledWith(PET_PASTURE_MIN_WIDTH, 320)
    expect(window.setMaximumSize).toHaveBeenLastCalledWith(PET_PASTURE_MAX_WIDTH, 320)
    expect(window.setBounds).toHaveBeenLastCalledWith({ x: 400, y: 580, width: 640, height: 320 }, false)
  })

  it('stores manual stream activity as semantic animation names', () => {
    const service = createService()

    service.playAnimation('failed', false, 'manual')

    expect(getPrivateValue<PetActivityState>(service, 'activityState')).toMatchObject({
      animation: 'failed',
      reason: 'manual'
    })
  })
})

function createService(): PetService {
  const service = new PetService()
  vi.spyOn(
    service as unknown as { broadcastPastureChanged: () => Promise<void> },
    'broadcastPastureChanged'
  ).mockResolvedValue()
  return service
}

function createPetWindow(bounds: Electron.Rectangle): Electron.BrowserWindow {
  return {
    getBounds: vi.fn(() => bounds),
    isDestroyed: vi.fn(() => false),
    setBounds: vi.fn(),
    setMaximumSize: vi.fn(),
    setMinimumSize: vi.fn()
  } as unknown as Electron.BrowserWindow
}

function createAnimal(id: string, overrides: Partial<PetAnimalInstance> = {}): PetAnimalInstance {
  return {
    agentId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    enabled: true,
    homeXRatio: id === 'animal-a' ? 0.3 : 0.7,
    id,
    name: id,
    order: id === 'animal-a' ? 0 : 1,
    packageId: 'test-pet',
    personality: 'watcher',
    ...overrides
  }
}

function getPrivateValue<T>(service: PetService, key: string): T {
  return (service as unknown as Record<string, T>)[key]
}

async function callPrivateWithArgs(service: PetService, method: string, ...args: unknown[]): Promise<void> {
  await (service as unknown as Record<string, (...values: unknown[]) => Promise<void>>)[method](...args)
}

function createWebContents(): Electron.WebContents {
  return {
    id: 1,
    isDestroyed: vi.fn(() => false),
    once: vi.fn(),
    send: vi.fn()
  } as unknown as Electron.WebContents
}
