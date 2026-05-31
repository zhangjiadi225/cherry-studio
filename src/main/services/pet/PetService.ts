import { randomUUID } from 'node:crypto'

import { application } from '@application'
import { loggerService } from '@logger'
import { buildAgentSessionTopicId } from '@main/ai/agentSession/topic'
import { dispatchStreamRequest } from '@main/ai/streamManager/context/dispatch'
import { WebContentsListener } from '@main/ai/streamManager/listeners/WebContentsListener'
import { type Activatable, BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { isLinux } from '@main/core/platform'
import { WindowType } from '@main/core/window/types'
import type { CherryMessagePart } from '@shared/data/types/message'
import { IpcChannel } from '@shared/IpcChannel'
import {
  createPetVrmStageModelProfile,
  DEFAULT_PET_PERSONALITY,
  getLegacyAnimationName,
  getPetAnimationDuration,
  isPetAnimationName,
  isPetSemanticAnimationName,
  normalizePetVrmStageModelProfileRecord,
  normalizePetVrmStageSceneSettings,
  PET_PASTURE_DEFAULT_WIDTH,
  PET_PASTURE_HEIGHT,
  PET_PASTURE_MAX_WIDTH,
  PET_PASTURE_MIN_WIDTH,
  PET_VRM_STAGE_DEFAULT_HEIGHT,
  PET_VRM_STAGE_DEFAULT_WIDTH,
  PET_VRM_STAGE_MIN_HEIGHT,
  PET_VRM_STAGE_MIN_WIDTH,
  PET_WINDOW_HEIGHT,
  type PetActivityState,
  type PetAnimalInstance,
  type PetMouseState,
  type PetPackageInfo,
  type PetPastureBounds,
  type PetPastureResizeRequest,
  type PetPastureSnapshot,
  type PetQuickReplyRequest,
  type PetSceneMode,
  type PetSemanticAnimationName,
  type PetTaskBubbleHoldState,
  type PetTaskCommandResult,
  type PetVrmStageConfig,
  type PetVrmStageModelProfile,
  type PetVrmStageSceneSettings,
  type PetVrmWindowBounds,
  type PetWindowBounds,
  type PetWindowPosition,
  type PetWindowResizeEdge,
  type PetWindowResizeRequest
} from '@shared/pet'
import type { BrowserWindow, Display } from 'electron'
import { BrowserWindow as ElectronBrowserWindow, dialog, screen } from 'electron'
import { startDrag } from 'electron-click-drag-plugin'

import { createDefaultPetState, PetStateStore, type StoredPetState } from './PetStateStore'
import { PetTaskController } from './PetTaskController'
import { getPetPastureDisplayPoint, resolvePetPastureBounds } from './PetWindowBounds'

const DEFAULT_BOTTOM_GAP = 0
const PET_MOUSE_TRACKING_INTERVAL_MS = Math.round(1000 / 60)
const PET_BOUNDS_PERSIST_DEBOUNCE_MS = 150
const PET_SERVICE_SEMANTIC_ANIMATIONS = [
  'idle',
  'walkLeft',
  'walkRight',
  'run',
  'wave',
  'jump',
  'sleep',
  'observe',
  'play',
  'celebrate',
  'waiting',
  'review',
  'failed'
] as const satisfies readonly PetSemanticAnimationName[]

const logger = loggerService.withContext('PetService')

@Injectable('PetService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['WindowManager', 'AiStreamManager', 'PetAssetService'])
export class PetService extends BaseService implements Activatable {
  private windowId: string | null = null
  private idleTimer: NodeJS.Timeout | null = null
  private activityState: PetActivityState = {
    animation: 'idle',
    updatedAt: Date.now()
  }
  private readonly taskController = new PetTaskController({
    dismissApproval: (approvalId) => this.dismissPermissionPrompt(approvalId),
    dismissTask: (taskId) => this.dismissTaskBubble(taskId),
    openTask: (taskId) => this.openTask(taskId),
    sendQuickReply: (sender, request) => this.sendQuickReply(sender, request)
  })
  private mouseTrackingTimer: NodeJS.Timeout | null = null
  private mouseTrackingSenderId: number | null = null
  private boundsPersistTimer: NodeJS.Timeout | null = null
  private readonly stateStore = new PetStateStore()
  private stateCache: StoredPetState = createDefaultPetState()
  private stateLoaded = false
  private stateLoadPromise: Promise<StoredPetState> | null = null
  private stateWriteQueue: Promise<void> = Promise.resolve()

  protected async onInit() {
    await this.loadPetState()
    this.registerIpcHandlers()
    this.subscribeWindowLifecycle()
    this.subscribePreferences()
  }

  protected async onReady() {
    if (application.get('PreferenceService').get('feature.pet.enabled')) {
      await this.activate()
    }
  }

  async onActivate(): Promise<void> {
    const focusedBefore = ElectronBrowserWindow.getFocusedWindow()
    await this.showPet()
    if (focusedBefore && !focusedBefore.isDestroyed() && focusedBefore.id !== this.getPetWindow()?.id) {
      focusedBefore.focus()
    }
  }

  async onDeactivate(): Promise<void> {
    this.releaseWindow()
  }

  public async showPet(): Promise<string | null> {
    const packages = await this.listPackages()
    if (packages.length === 0) return null
    await this.ensureDefaultAnimal(packages)

    const wm = application.get('WindowManager')
    const windowId =
      this.windowId && wm.getWindow(this.windowId)
        ? this.windowId
        : wm.open(WindowType.Pet, { options: this.getPreferredBounds() })
    this.windowId = windowId

    await this.applyCurrentBounds()
    this.applyPinPreference()
    this.broadcastPackageChanged(await this.getSelectedPackage())
    this.broadcastActivity()
    void this.broadcastPastureChanged()

    const window = wm.getWindow(windowId)
    if (window && !window.isDestroyed()) {
      window.showInactive()
    }

    return windowId
  }

  public hidePet(): boolean {
    if (!this.windowId) return false
    return application.get('WindowManager').hide(this.windowId)
  }

  public closePet(): boolean {
    if (!this.windowId) return false
    const closed = application.get('WindowManager').close(this.windowId)
    this.windowId = null
    return closed
  }

  public async listPackages(): Promise<PetPackageInfo[]> {
    return application.get('PetAssetService').listSpritePackages()
  }

  public async getSelectedPackage(): Promise<PetPackageInfo | null> {
    const packages = await this.listPackages()
    if (packages.length === 0) return null

    const preferenceService = application.get('PreferenceService')
    const selectedPackageId = preferenceService.get('feature.pet.selected_package_id')
    const selected = selectedPackageId ? packages.find((petPackage) => petPackage.id === selectedPackageId) : null
    if (selected) return selected

    const fallback = packages[0]
    await preferenceService.set('feature.pet.selected_package_id', fallback.id)
    return fallback
  }

  public async selectAndImportPackage(): Promise<PetPackageInfo | null> {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory']
    })
    if (result.canceled || !result.filePaths[0]) return null

    const imported = await application.get('PetAssetService').importSpritePackage(result.filePaths[0])
    await application.get('PreferenceService').set('feature.pet.selected_package_id', imported.id)
    await this.ensurePackageAnimal(imported)
    this.broadcastPackageChanged(imported)
    void this.broadcastPastureChanged()
    if (application.get('PreferenceService').get('feature.pet.enabled')) {
      await this.activate()
      await this.showPet()
    }
    return imported
  }

  public async selectPackage(packageId: string): Promise<PetPackageInfo> {
    const petPackage = await application.get('PetAssetService').findSpritePackage(this.parsePackageId(packageId))
    if (!petPackage) {
      throw new Error(`Pet package "${packageId}" was not found`)
    }

    await application.get('PreferenceService').set('feature.pet.selected_package_id', petPackage.id)
    await this.ensurePackageAnimal(petPackage)
    this.broadcastPackageChanged(petPackage)
    void this.broadcastPastureChanged()
    if (application.get('PreferenceService').get('feature.pet.enabled')) {
      await this.showPet()
    }
    return petPackage
  }

  public async deletePackage(packageId: string): Promise<void> {
    const id = this.parsePackageId(packageId)
    const animals = await this.getAnimals()
    if (animals.some((animal) => animal.packageId === id)) {
      throw new Error(`Pet package "${id}" is still used by one or more pets`)
    }

    await application.get('PetAssetService').deleteSpritePackage(id)
    await this.removeAnimalsByPackage(id)

    const preferenceService = application.get('PreferenceService')
    if (preferenceService.get('feature.pet.selected_package_id') === id) {
      const fallback = (await this.listPackages())[0]
      await preferenceService.set('feature.pet.selected_package_id', fallback?.id ?? null)
      this.broadcastPackageChanged(fallback ?? null)
    }
    void this.broadcastPastureChanged()
  }

  public async listAnimals(): Promise<PetAnimalInstance[]> {
    return this.getAnimals()
  }

  public async upsertAnimal(input: unknown): Promise<PetAnimalInstance> {
    const instance = this.parseAnimalInstance(input)
    const packages = await this.listPackages()
    if (!packages.some((petPackage) => petPackage.id === instance.packageId)) {
      throw new Error(`Pet package "${instance.packageId}" was not found`)
    }

    const animals = await this.getAnimals()
    const existingIndex = animals.findIndex((animal) => animal.id === instance.id)
    const nextAnimal = this.normalizeAnimal(instance, existingIndex >= 0 ? animals[existingIndex] : undefined)
    const nextAnimals =
      existingIndex >= 0
        ? animals.map((animal) => (animal.id === nextAnimal.id ? nextAnimal : animal))
        : [...animals, { ...nextAnimal, order: animals.length }]

    await this.setAnimals(nextAnimals)
    void this.broadcastPastureChanged()
    return nextAnimal
  }

  public async removeAnimal(instanceId: string): Promise<void> {
    const id = this.parseInstanceId(instanceId)
    const animals = await this.getAnimals()
    const nextAnimals = animals.filter((animal) => animal.id !== id)
    if (nextAnimals.length === animals.length) return

    await this.setAnimals(nextAnimals)
    void this.broadcastPastureChanged()
  }

  public async reorderAnimals(instanceIds: unknown): Promise<PetAnimalInstance[]> {
    if (!Array.isArray(instanceIds) || instanceIds.some((id) => typeof id !== 'string')) {
      throw new Error('Animal order must be a string id array')
    }

    const animals = await this.getAnimals()
    const byId = new Map(animals.map((animal) => [animal.id, animal]))
    const ordered: PetAnimalInstance[] = []
    for (const id of instanceIds) {
      const animal = byId.get(id)
      if (animal) ordered.push(animal)
    }
    for (const animal of animals) {
      if (!ordered.some((item) => item.id === animal.id)) ordered.push(animal)
    }

    const nextAnimals = ordered.map((animal, order) => ({ ...animal, order }))
    await this.setAnimals(nextAnimals)
    void this.broadcastPastureChanged()
    return nextAnimals
  }

  public async getPastureSnapshot(): Promise<PetPastureSnapshot> {
    const [packages, state] = await Promise.all([this.listPackages(), this.getPetState()])
    const animals = this.getAnimalsFromState(state)
    return {
      packages,
      animals,
      bindings: [],
      queuedTasks: [],
      bubbles: [],
      permissionPrompts: [],
      bounds: this.getPastureStoredBounds(state),
      vrmModelProfiles: { ...state.vrm.modelProfiles },
      vrmSceneSettings: { ...state.vrm.sceneSettings }
    }
  }

  public async getVrmStageConfig(): Promise<PetVrmStageConfig> {
    const state = await this.getPetState()
    return this.getVrmStageConfigFromState(state)
  }

  public async setVrmStageModelProfile(input: unknown): Promise<PetVrmStageModelProfile> {
    let nextProfile: PetVrmStageModelProfile | null = null

    await this.updatePetState((state) => {
      if (!isRecord(input)) {
        throw new Error('VRM stage model profile must be an object')
      }
      const modelId = typeof input.modelId === 'string' ? input.modelId.trim() : ''
      const previous = modelId ? state.vrm.modelProfiles[modelId] : undefined
      nextProfile = createPetVrmStageModelProfile(input as Partial<PetVrmStageModelProfile>, previous)
      return {
        ...state,
        vrm: {
          ...state.vrm,
          modelProfiles: {
            ...state.vrm.modelProfiles,
            [nextProfile.modelId]: nextProfile
          }
        }
      }
    })
    void this.broadcastPastureChanged()
    if (!nextProfile) {
      throw new Error('VRM stage model profile was not saved')
    }
    return nextProfile
  }

  public async deleteVrmStageModelProfile(modelId: unknown): Promise<void> {
    const id = this.parseRequiredString(modelId, 'VRM model id')

    await this.updatePetState((state) => {
      const modelProfiles = { ...state.vrm.modelProfiles }
      delete modelProfiles[id]
      return {
        ...state,
        vrm: {
          ...state.vrm,
          modelProfiles
        }
      }
    })
    void this.broadcastPastureChanged()
  }

  public async setVrmStageSceneSettings(input: unknown): Promise<PetVrmStageSceneSettings> {
    const sceneSettings = normalizePetVrmStageSceneSettings(input)

    await this.updatePetState((state) => ({
      ...state,
      vrm: {
        ...state.vrm,
        sceneSettings
      }
    }))
    void this.broadcastPastureChanged()
    return sceneSettings
  }

  public getWindowBounds(): PetWindowBounds | null {
    const window = this.getPetWindow()
    if (!window || window.isDestroyed()) return null
    return window.getBounds()
  }

  public async moveWindow(position: PetWindowPosition): Promise<PetWindowBounds | null> {
    const window = this.getPetWindow()
    const currentBounds = window && !window.isDestroyed() ? window.getBounds() : this.getPreferredBounds()
    const mode = this.getCurrentSceneMode()
    const nextBounds =
      mode === 'vrm-stage'
        ? this.clampFreeBounds({ ...currentBounds, x: position.x, y: position.y })
        : this.clampPastureBounds({ x: position.x, y: currentBounds.y }, currentBounds.width, PET_WINDOW_HEIGHT)

    if (window && !window.isDestroyed()) {
      window.setBounds(nextBounds, false)
    }
    await this.persistBoundsForMode(mode, nextBounds)
    return nextBounds
  }

  public async resizePasture(input: unknown): Promise<PetWindowBounds | null> {
    const currentBounds = this.getPetWindow()?.getBounds() ?? this.getPreferredBounds()
    const request = this.parseResizeRequest(input, currentBounds)
    const nextBounds = this.clampPastureBounds({ x: request.x, y: currentBounds.y }, request.width, PET_WINDOW_HEIGHT)
    const window = this.getPetWindow()
    if (window && !window.isDestroyed()) {
      window.setBounds(nextBounds, false)
    }
    await this.persistBoundsForMode('sprite-pasture', nextBounds)
    void this.broadcastPastureChanged()
    return nextBounds
  }

  public async resizeWindow(input: unknown): Promise<PetWindowBounds | null> {
    const currentBounds = this.getPetWindow()?.getBounds() ?? this.getPreferredBounds()
    const request = this.parseWindowResizeRequest(input, currentBounds)
    const nextBounds =
      request.mode === 'vrm-stage'
        ? this.clampFreeBounds(request)
        : this.clampPastureBounds({ x: request.x, y: currentBounds.y }, request.width, PET_WINDOW_HEIGHT)
    const window = this.getPetWindow()
    if (window && !window.isDestroyed()) {
      window.setBounds(nextBounds, false)
    }
    await this.persistBoundsForMode(request.mode, nextBounds)
    void this.broadcastPastureChanged()
    return nextBounds
  }

  private startMouseTracking(sender: Electron.WebContents): void {
    const window = this.getPetWindowFromSender(sender)
    if (!window || window.isDestroyed()) return

    this.mouseTrackingSenderId = sender.id
    if (this.mouseTrackingTimer) {
      this.emitMouseState(sender)
      return
    }

    this.emitMouseState(sender)
    this.mouseTrackingTimer = setInterval(() => {
      this.emitMouseState(sender)
    }, PET_MOUSE_TRACKING_INTERVAL_MS)
    this.mouseTrackingTimer.unref()
  }

  private stopMouseTracking(sender?: Electron.WebContents): void {
    if (sender && this.mouseTrackingSenderId !== sender.id) return
    if (this.mouseTrackingTimer) {
      clearInterval(this.mouseTrackingTimer)
      this.mouseTrackingTimer = null
    }
    this.mouseTrackingSenderId = null
  }

  private startDraggingWindow(sender: Electron.WebContents): boolean {
    const window = this.getPetWindowFromSender(sender)
    if (!window || window.isDestroyed()) return false

    this.applyMouseEventsIgnored(window, false)
    if (isLinux) return false

    try {
      startDrag(window.getNativeWindowHandle())
      return true
    } catch (error) {
      logger.warn('Failed to start native pet window drag', {
        error: error instanceof Error ? error.message : String(error)
      })
      return false
    }
  }

  public async setPin(pinOnTop: boolean): Promise<void> {
    await application.get('PreferenceService').set('feature.pet.pin_on_top', pinOnTop)
    this.applyPinPreference()
  }

  public playAnimation(animation: PetSemanticAnimationName, playOnce = false, reason?: string): void {
    this.setActivity({ animation, playOnce, reason, updatedAt: Date.now() })
  }

  public async dismissTaskBubble(taskKey: string): Promise<void> {
    this.parseTaskKey(taskKey)
  }

  public async dismissPermissionPrompt(approvalId: string): Promise<void> {
    this.parseApprovalId(approvalId)
  }

  public setTaskBubbleHold(input: unknown): void {
    this.parseTaskBubbleHold(input)
  }

  public async sendQuickReply(sender: Electron.WebContents, input: unknown): Promise<void> {
    const request = this.parseQuickReplyRequest(input)
    const sessionId = this.parseSessionTaskKey(request.taskKey)
    const topicId = buildAgentSessionTopicId(sessionId)
    const userMessageParts: CherryMessagePart[] = [{ type: 'text', text: request.text }]

    await dispatchStreamRequest(application.get('AiStreamManager'), new WebContentsListener(sender, topicId), {
      trigger: 'submit-message',
      topicId,
      userMessageParts
    })
  }

  public async openTask(taskKey: string): Promise<void> {
    const parsedTaskKey = this.parseTaskKey(taskKey)
    const sessionId = this.parseSessionTaskKey(parsedTaskKey)

    const mainWindowService = application.get('MainWindowService')
    const mainWindow = mainWindowService.getMainWindow()
    const targetPath = '/app/agents'
    const search = { sessionId, view: 'message' }

    if (mainWindow && !mainWindow.isDestroyed()) {
      await mainWindow.webContents.executeJavaScript(
        `window.navigate?.({ to: ${JSON.stringify(targetPath)},${search ? ` search: ${JSON.stringify(search)},` : ''} replace: false })`
      )
    }
    mainWindowService.showMainWindow()
  }

  public async dispatchTaskCommand(sender: Electron.WebContents, input: unknown): Promise<PetTaskCommandResult> {
    return this.taskController.dispatch(sender, input)
  }

  private registerIpcHandlers(): void {
    this.ipcHandle(IpcChannel.Pet_ListPackages, () => this.listPackages())
    this.ipcHandle(IpcChannel.Pet_GetSelectedPackage, () => this.getSelectedPackage())
    this.ipcHandle(IpcChannel.Pet_SelectAndImportPackage, () => this.selectAndImportPackage())
    this.ipcHandle(IpcChannel.Pet_SelectPackage, (_event, packageId: unknown) =>
      this.selectPackage(this.parsePackageId(packageId))
    )
    this.ipcHandle(IpcChannel.Pet_DeletePackage, (_event, packageId: unknown) =>
      this.deletePackage(this.parsePackageId(packageId))
    )
    this.ipcHandle(IpcChannel.Pet_ListAnimals, () => this.listAnimals())
    this.ipcHandle(IpcChannel.Pet_UpsertAnimal, (_event, instance: unknown) => this.upsertAnimal(instance))
    this.ipcHandle(IpcChannel.Pet_RemoveAnimal, (_event, instanceId: unknown) =>
      this.removeAnimal(this.parseInstanceId(instanceId))
    )
    this.ipcHandle(IpcChannel.Pet_ReorderAnimals, (_event, instanceIds: unknown) => this.reorderAnimals(instanceIds))
    this.ipcHandle(IpcChannel.Pet_GetPastureSnapshot, () => this.getPastureSnapshot())
    this.ipcHandle(IpcChannel.Pet_GetVrmStageConfig, () => this.getVrmStageConfig())
    this.ipcHandle(IpcChannel.Pet_SetVrmStageModelProfile, (_event, profile: unknown) =>
      this.setVrmStageModelProfile(profile)
    )
    this.ipcHandle(IpcChannel.Pet_DeleteVrmStageModelProfile, (_event, modelId: unknown) =>
      this.deleteVrmStageModelProfile(modelId)
    )
    this.ipcHandle(IpcChannel.Pet_SetVrmStageSceneSettings, (_event, settings: unknown) =>
      this.setVrmStageSceneSettings(settings)
    )
    this.ipcHandle(IpcChannel.Pet_ResizePasture, (_event, input: unknown) => this.resizePasture(input))
    this.ipcHandle(IpcChannel.Pet_ResizeWindow, (_event, input: unknown) => this.resizeWindow(input))
    this.ipcHandle(IpcChannel.Pet_DismissTaskBubble, (_event, taskKey: unknown) =>
      this.dismissTaskBubble(this.parseTaskKey(taskKey))
    )
    this.ipcHandle(IpcChannel.Pet_DismissPermissionPrompt, (_event, approvalId: unknown) =>
      this.dismissPermissionPrompt(this.parseApprovalId(approvalId))
    )
    this.ipcHandle(IpcChannel.Pet_SetTaskBubbleHold, (_event, state: unknown) => this.setTaskBubbleHold(state))
    this.ipcHandle(IpcChannel.Pet_SendQuickReply, (event, request: unknown) =>
      this.sendQuickReply(event.sender, request)
    )
    this.ipcHandle(IpcChannel.Pet_OpenTask, (_event, taskKey: unknown) => this.openTask(this.parseTaskKey(taskKey)))
    this.ipcHandle(IpcChannel.Pet_DispatchTaskCommand, (event, command: unknown) =>
      this.dispatchTaskCommand(event.sender, command)
    )
    this.ipcHandle(IpcChannel.Pet_Show, () => this.showPet())
    this.ipcHandle(IpcChannel.Pet_Hide, () => this.hidePet())
    this.ipcHandle(IpcChannel.Pet_Close, () => this.closePet())
    this.ipcHandle(IpcChannel.Pet_GetWindowBounds, () => this.getWindowBounds())
    this.ipcHandle(IpcChannel.Pet_MoveWindow, (_event, position: unknown) =>
      this.moveWindow(this.parsePosition(position))
    )
    this.ipcHandle(IpcChannel.Pet_SetMouseEventsIgnored, (event, ignored: unknown) =>
      this.setMouseEventsIgnored(event.sender, ignored)
    )
    this.ipcHandle(IpcChannel.Pet_StartMouseTracking, (event) => this.startMouseTracking(event.sender))
    this.ipcHandle(IpcChannel.Pet_StopMouseTracking, (event) => this.stopMouseTracking(event.sender))
    this.ipcHandle(IpcChannel.Pet_StartDraggingWindow, (event) => this.startDraggingWindow(event.sender))
    this.ipcHandle(IpcChannel.Pet_SetPin, (_event, pinOnTop: unknown) => this.setPin(Boolean(pinOnTop)))
    this.ipcHandle(IpcChannel.Pet_PlayAnimation, (_event, animation: unknown, playOnce?: unknown, reason?: unknown) => {
      const semanticAnimation = this.parsePlayAnimation(animation)
      if (!semanticAnimation) {
        throw new Error(`Unsupported pet animation: ${String(animation)}`)
      }
      this.playAnimation(semanticAnimation, Boolean(playOnce), typeof reason === 'string' ? reason : undefined)
    })
  }

  private subscribeWindowLifecycle(): void {
    const wm = application.get('WindowManager')
    this.registerDisposable(
      wm.onWindowCreatedByType(WindowType.Pet, ({ id, window }) => {
        this.windowId = id
        this.setupPetWindow(id, window)
      })
    )
  }

  private subscribePreferences(): void {
    const preferenceService = application.get('PreferenceService')
    this.registerDisposable(
      preferenceService.subscribeChange('feature.pet.enabled', (enabled) => {
        if (enabled) void this.activate()
        else void this.deactivate()
      })
    )
    this.registerDisposable(
      preferenceService.subscribeChange('feature.pet.pin_on_top', () => {
        this.applyPinPreference()
      })
    )
    this.registerDisposable(
      preferenceService.subscribeChange('feature.pet.mode', () => {
        void this.applyCurrentBounds().then(() => this.broadcastPastureChanged())
      })
    )
    this.registerDisposable(
      preferenceService.subscribeChange('feature.pet.scale', () => {
        void this.broadcastPastureChanged()
      })
    )
  }

  private setupPetWindow(windowId: string, window: BrowserWindow): void {
    window.setTitle('')
    this.applyMouseEventsIgnored(window, true)
    const webContents = window.webContents

    const onPageTitleUpdated = (event: Electron.Event) => {
      event.preventDefault()
      window.setTitle('')
    }
    const onBoundsChanged = () => {
      this.schedulePersistWindowBounds(window)
    }
    const onHidden = () => {
      this.stopMouseTracking(webContents)
    }

    const onClosed = () => {
      if (this.windowId === windowId) this.windowId = null
      this.stopMouseTracking(webContents)
      this.clearBoundsPersistTimer()
      if (!webContents.isDestroyed()) {
        webContents.off('page-title-updated', onPageTitleUpdated)
      }
      window.off('move', onBoundsChanged)
      window.off('resize', onBoundsChanged)
      window.off('hide', onHidden)
      window.off('closed', onClosed)
    }

    window.once('closed', onClosed)
    window.on('move', onBoundsChanged)
    window.on('resize', onBoundsChanged)
    window.on('hide', onHidden)
    webContents.on('page-title-updated', onPageTitleUpdated)
  }

  private setActivity(state: PetActivityState): void {
    this.clearIdleTimer()
    this.activityState = state
    this.broadcastActivity()

    if (state.playOnce) {
      const duration = getPetAnimationDuration(getLegacyAnimationName(state.animation)) + 150
      this.idleTimer = setTimeout(() => {
        this.setActivity({ animation: 'idle', updatedAt: Date.now() })
      }, duration)
      this.idleTimer.unref()
    }
  }

  private broadcastActivity(): void {
    application.get('WindowManager').broadcastToType(WindowType.Pet, IpcChannel.Pet_ActivityChanged, this.activityState)
  }

  private async broadcastPastureChanged(): Promise<void> {
    application
      .get('WindowManager')
      .broadcastToType(WindowType.Pet, IpcChannel.Pet_PastureChanged, await this.getPastureSnapshot())
  }

  private broadcastPackageChanged(petPackage?: PetPackageInfo | null): void {
    application.get('WindowManager').broadcastToType(WindowType.Pet, IpcChannel.Pet_PackageChanged, petPackage ?? null)
  }

  private async loadPetState(): Promise<StoredPetState> {
    if (this.stateLoaded) return this.stateCache
    if (!this.stateLoadPromise) {
      this.stateLoadPromise = this.stateStore.read()
    }
    this.stateCache = await this.stateLoadPromise
    this.stateLoaded = true
    return this.stateCache
  }

  private async getPetState(): Promise<StoredPetState> {
    return this.loadPetState()
  }

  private getPetStateSync(): StoredPetState {
    return this.stateCache
  }

  private async updatePetState(updater: (state: StoredPetState) => StoredPetState): Promise<StoredPetState> {
    const run = this.stateWriteQueue.then(async () => {
      const current = await this.getPetState()
      const next = await this.stateStore.write(updater(current))
      this.stateCache = next
      this.stateLoaded = true
      return next
    })
    this.stateWriteQueue = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  private getVrmStageConfigFromState(state: StoredPetState): PetVrmStageConfig {
    return {
      modelProfiles: { ...normalizePetVrmStageModelProfileRecord(state.vrm.modelProfiles) },
      sceneSettings: normalizePetVrmStageSceneSettings(state.vrm.sceneSettings)
    }
  }

  private releaseWindow(): void {
    this.clearIdleTimer()
    this.stopMouseTracking()
    this.clearBoundsPersistTimer()
    if (!this.windowId) return

    const wm = application.get('WindowManager')
    wm.close(this.windowId)
    this.windowId = null
  }

  private clearIdleTimer(): void {
    if (!this.idleTimer) return
    clearTimeout(this.idleTimer)
    this.idleTimer = null
  }

  private emitMouseState(sender: Electron.WebContents): void {
    if (this.mouseTrackingSenderId !== sender.id || sender.isDestroyed()) {
      this.stopMouseTracking(sender)
      return
    }

    const window = this.getPetWindowFromSender(sender)
    if (!window || window.isDestroyed()) {
      this.stopMouseTracking(sender)
      return
    }

    const state: PetMouseState = {
      cursor: screen.getCursorScreenPoint(),
      bounds: window.getBounds(),
      updatedAt: Date.now()
    }

    try {
      sender.send(IpcChannel.Pet_MouseStateChanged, state)
    } catch (error) {
      logger.warn('Failed to send pet mouse state', {
        error: error instanceof Error ? error.message : String(error)
      })
      this.stopMouseTracking(sender)
    }
  }

  private schedulePersistWindowBounds(window: BrowserWindow): void {
    if (window.isDestroyed() || window !== this.getPetWindow()) return
    this.clearBoundsPersistTimer()
    this.boundsPersistTimer = setTimeout(() => {
      this.boundsPersistTimer = null
      if (window.isDestroyed() || window !== this.getPetWindow()) return
      const bounds = window.getBounds()
      void this.persistBoundsForMode(this.getCurrentSceneMode(), bounds).then(() => this.broadcastPastureChanged())
    }, PET_BOUNDS_PERSIST_DEBOUNCE_MS)
    this.boundsPersistTimer.unref()
  }

  private clearBoundsPersistTimer(): void {
    if (!this.boundsPersistTimer) return
    clearTimeout(this.boundsPersistTimer)
    this.boundsPersistTimer = null
  }

  private async applyCurrentBounds(): Promise<void> {
    const window = this.getPetWindow()
    if (!window || window.isDestroyed()) return
    const mode = this.getCurrentSceneMode()
    this.applyWindowSizeLimits(window, mode)
    const bounds = this.getPreferredBounds()
    window.setBounds(bounds, false)
    await this.persistBoundsForMode(mode, bounds)
  }

  private applyWindowSizeLimits(window: BrowserWindow, mode: PetSceneMode): void {
    if (mode === 'vrm-stage') {
      window.setMinimumSize(PET_VRM_STAGE_MIN_WIDTH, PET_VRM_STAGE_MIN_HEIGHT)
      const maxSize = this.getVrmWindowMaximumSize()
      window.setMaximumSize(maxSize.width, maxSize.height)
      return
    }

    window.setMinimumSize(PET_PASTURE_MIN_WIDTH, PET_WINDOW_HEIGHT)
    window.setMaximumSize(PET_PASTURE_MAX_WIDTH, PET_WINDOW_HEIGHT)
  }

  private applyPinPreference(): void {
    const window = this.getPetWindow()
    if (!window || window.isDestroyed()) return

    const pinOnTop = application.get('PreferenceService').get('feature.pet.pin_on_top')
    if (pinOnTop) {
      window.setAlwaysOnTop(true, 'screen-saver', 1)
    } else {
      window.setAlwaysOnTop(false)
    }
    window.setVisibleOnAllWorkspaces(pinOnTop, { visibleOnFullScreen: pinOnTop })
  }

  private getPreferredBounds(): PetWindowBounds {
    if (this.getCurrentSceneMode() === 'vrm-stage') {
      const bounds = this.getVrmWindowStoredBounds()
      if (bounds.x >= 0 && bounds.y >= 0) return this.clampFreeBounds(bounds)

      const workArea = screen.getPrimaryDisplay().workArea
      return this.clampFreeBounds({
        ...bounds,
        x: workArea.x + Math.round((workArea.width - bounds.width) / 2),
        y: workArea.y + Math.round((workArea.height - bounds.height) / 2)
      })
    }

    const pastureBounds = this.getPastureStoredBounds()
    const width = pastureBounds.width

    if (pastureBounds.x >= 0 && pastureBounds.y >= 0) {
      return this.clampPastureBounds(
        {
          x: pastureBounds.x,
          y: this.normalizeStoredPastureY(pastureBounds.x, pastureBounds.y, width)
        },
        width,
        PET_WINDOW_HEIGHT
      )
    }

    const workArea = screen.getPrimaryDisplay().workArea
    return this.clampPastureBounds(
      {
        x: workArea.x + Math.round((workArea.width - width) / 2),
        y: workArea.y + workArea.height - PET_WINDOW_HEIGHT - DEFAULT_BOTTOM_GAP
      },
      width,
      PET_WINDOW_HEIGHT
    )
  }

  private getPastureStoredBounds(state: StoredPetState = this.getPetStateSync()): PetPastureBounds {
    const stored = state.pastureBounds
    const width = this.clampWidth(
      stored.width,
      screen.getPrimaryDisplay()?.workArea?.width ?? PET_PASTURE_DEFAULT_WIDTH
    )
    return {
      x: Number.isFinite(stored.x) ? stored.x : -1,
      y: Number.isFinite(stored.y) ? stored.y : -1,
      width
    }
  }

  private getVrmWindowStoredBounds(state: StoredPetState = this.getPetStateSync()): PetVrmWindowBounds {
    const stored = state.vrm.windowBounds
    const workArea = screen.getPrimaryDisplay()?.workArea
    const maxWidth = workArea?.width ?? PET_VRM_STAGE_DEFAULT_WIDTH
    const maxHeight = workArea?.height ?? PET_VRM_STAGE_DEFAULT_HEIGHT

    return {
      x: Number.isFinite(stored.x) ? stored.x : -1,
      y: Number.isFinite(stored.y) ? stored.y : -1,
      width: clampNumber(stored.width, PET_VRM_STAGE_MIN_WIDTH, maxWidth),
      height: clampNumber(stored.height, PET_VRM_STAGE_MIN_HEIGHT, maxHeight)
    }
  }

  private async persistPastureBounds(bounds: PetPastureBounds): Promise<void> {
    await this.updatePetState((state) => ({
      ...state,
      pastureBounds: bounds
    }))
  }

  private async persistVrmWindowBounds(bounds: PetVrmWindowBounds): Promise<void> {
    await this.updatePetState((state) => ({
      ...state,
      vrm: {
        ...state.vrm,
        windowBounds: bounds
      }
    }))
  }

  private async persistBoundsForMode(mode: PetSceneMode, bounds: PetWindowBounds): Promise<void> {
    if (mode === 'vrm-stage') {
      await this.persistVrmWindowBounds(bounds)
      return
    }

    await this.persistPastureBounds({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width
    })
  }

  private clampPastureBounds(position: PetWindowPosition, requestedWidth: number, height: number): PetWindowBounds {
    const display = this.getPastureDisplay(position.x, requestedWidth, position.y)
    const bounds = resolvePetPastureBounds(display, position.x, requestedWidth)
    return { ...bounds, height }
  }

  private clampFreeBounds(bounds: PetWindowBounds): PetWindowBounds {
    const display = screen.getDisplayNearestPoint({
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2
    })
    const workArea = display.workArea
    const width = clampNumber(bounds.width, PET_VRM_STAGE_MIN_WIDTH, workArea.width)
    const height = clampNumber(bounds.height, PET_VRM_STAGE_MIN_HEIGHT, workArea.height)
    const maxX = Math.max(workArea.x, workArea.x + workArea.width - width)
    const maxY = Math.max(workArea.y, workArea.y + workArea.height - height)

    return {
      x: Math.round(Math.min(Math.max(bounds.x, workArea.x), maxX)),
      y: Math.round(Math.min(Math.max(bounds.y, workArea.y), maxY)),
      width,
      height
    }
  }

  private clampWidth(width: number, workAreaWidth: number): number {
    const finiteWidth = Number.isFinite(width) ? width : PET_PASTURE_DEFAULT_WIDTH
    return Math.round(Math.min(Math.max(finiteWidth, PET_PASTURE_MIN_WIDTH), workAreaWidth, PET_PASTURE_MAX_WIDTH))
  }

  private getVrmWindowMaximumSize(): { width: number; height: number } {
    const displays = screen.getAllDisplays()
    const workAreas =
      displays.length > 0 ? displays.map((display) => display.workArea) : [screen.getPrimaryDisplay().workArea]
    return {
      width: Math.max(PET_VRM_STAGE_MIN_WIDTH, ...workAreas.map((workArea) => workArea.width)),
      height: Math.max(PET_VRM_STAGE_MIN_HEIGHT, ...workAreas.map((workArea) => workArea.height))
    }
  }

  private getPastureDisplay(x: number, width: number, y?: number): Display {
    const primaryDisplay = screen.getPrimaryDisplay()
    return screen.getDisplayNearestPoint(getPetPastureDisplayPoint(x, width, y, primaryDisplay))
  }

  private getCurrentSceneMode(): PetSceneMode {
    return application.get('PreferenceService').get('feature.pet.mode')
  }

  private parseWindowResizeRequest(input: unknown, fallbackBounds: PetWindowBounds): PetWindowResizeRequest {
    if (typeof input === 'number' || !isRecord(input) || input.mode === undefined) {
      const pasture = this.parseResizeRequest(input, fallbackBounds)
      return {
        ...fallbackBounds,
        edge: pasture.edge,
        height: PET_WINDOW_HEIGHT,
        mode: 'sprite-pasture',
        width: pasture.width,
        x: pasture.x,
        y: fallbackBounds.y
      }
    }

    const mode = this.parseSceneMode(input.mode)
    if (mode === 'sprite-pasture') {
      const pasture = this.parseResizeRequest(input, fallbackBounds)
      return {
        ...fallbackBounds,
        edge: pasture.edge,
        height: PET_WINDOW_HEIGHT,
        mode,
        width: pasture.width,
        x: pasture.x,
        y: fallbackBounds.y
      }
    }

    return {
      edge: this.parseWindowResizeEdge(input.edge),
      height: parseFiniteNumber(input.height, 'height'),
      mode,
      width: parseFiniteNumber(input.width, 'width'),
      x: parseFiniteNumber(input.x, 'x'),
      y: parseFiniteNumber(input.y, 'y')
    }
  }

  private parseResizeRequest(input: unknown, fallbackBounds: PetWindowBounds): PetPastureResizeRequest {
    if (typeof input === 'number' && Number.isFinite(input)) {
      return {
        edge: 'right',
        x: fallbackBounds.x,
        width: input
      }
    }

    if (!input || typeof input !== 'object') {
      throw new Error('Pasture resize request must be an object')
    }

    const request = input as Partial<PetPastureResizeRequest>
    if (request.edge !== 'left' && request.edge !== 'right') {
      throw new Error('Pasture resize edge must be left or right')
    }
    if (typeof request.x !== 'number' || !Number.isFinite(request.x)) {
      throw new Error('Pasture resize x must be a finite number')
    }
    if (typeof request.width !== 'number' || !Number.isFinite(request.width)) {
      throw new Error('Pasture resize width must be a finite number')
    }

    return {
      edge: request.edge,
      x: request.x,
      width: request.width
    }
  }

  private parseSceneMode(value: unknown): PetSceneMode {
    if (value === 'sprite-pasture' || value === 'vrm-stage') return value
    throw new Error('Unsupported pet scene mode')
  }

  private parseWindowResizeEdge(value: unknown): PetWindowResizeEdge {
    if (
      value === 'bottom' ||
      value === 'bottom-left' ||
      value === 'bottom-right' ||
      value === 'left' ||
      value === 'right' ||
      value === 'top' ||
      value === 'top-left' ||
      value === 'top-right'
    ) {
      return value
    }
    throw new Error('Unsupported pet window resize edge')
  }

  private normalizeStoredPastureY(x: number, y: number, width: number): number {
    const display = screen.getDisplayNearestPoint({ x, y })
    const legacyDefaultY = display.workArea.y + display.workArea.height - PET_PASTURE_HEIGHT - 24
    const legacyBottomY = display.workArea.y + display.workArea.height - PET_PASTURE_HEIGHT
    const bottomY = display.workArea.y + display.workArea.height - PET_WINDOW_HEIGHT
    if (
      width === PET_PASTURE_DEFAULT_WIDTH &&
      (Math.abs(y - legacyDefaultY) <= 2 || Math.abs(y - legacyBottomY) <= 2)
    ) {
      return bottomY
    }
    return y
  }

  private getPetWindow(): BrowserWindow | null {
    if (!this.windowId) return null
    return application.get('WindowManager').getWindow(this.windowId) ?? null
  }

  private getPetWindowFromSender(sender: Electron.WebContents): BrowserWindow | null {
    const window = ElectronBrowserWindow.fromWebContents(sender)
    if (!window || window.isDestroyed() || window !== this.getPetWindow()) return null
    return window
  }

  private async getAnimals(): Promise<PetAnimalInstance[]> {
    return this.getAnimalsFromState(await this.getPetState())
  }

  private getAnimalsFromState(state: StoredPetState): PetAnimalInstance[] {
    return state.animals
      .map((animal) => this.normalizeAnimal(animal))
      .sort((a, b) => a.order - b.order)
      .map((animal, order) => ({ ...animal, order }))
  }

  private async setAnimals(animals: PetAnimalInstance[]): Promise<void> {
    const normalized = animals
      .map((animal) => this.normalizeAnimal(animal))
      .sort((a, b) => a.order - b.order)
      .map((animal, order) => ({ ...animal, order }))
    await this.updatePetState((state) => ({
      ...state,
      animals: normalized
    }))
  }

  private async ensureDefaultAnimal(packages: PetPackageInfo[] = []): Promise<void> {
    const animals = await this.getAnimals()
    if (animals.length > 0) return

    const selected = (await this.getSelectedPackage()) ?? packages[0]
    if (!selected) return
    await this.ensurePackageAnimal(selected)
  }

  private async ensurePackageAnimal(petPackage: PetPackageInfo): Promise<void> {
    const animals = await this.getAnimals()
    if (animals.some((animal) => animal.packageId === petPackage.id)) return

    await this.setAnimals([
      ...animals,
      {
        id: randomUUID(),
        packageId: petPackage.id,
        name: petPackage.displayName,
        order: animals.length,
        enabled: true,
        agentId: null,
        homeXRatio: animals.length === 0 ? 0.5 : Math.min(0.9, 0.2 + animals.length * 0.15),
        personality: DEFAULT_PET_PERSONALITY,
        createdAt: new Date().toISOString()
      }
    ])
  }

  private async removeAnimalsByPackage(packageId: string): Promise<void> {
    const animals = await this.getAnimals()
    const removedIds = new Set(animals.filter((animal) => animal.packageId === packageId).map((animal) => animal.id))
    if (removedIds.size === 0) return

    await this.setAnimals(animals.filter((animal) => !removedIds.has(animal.id)))
  }

  private normalizeAnimal(input: PetAnimalInstance, fallback?: PetAnimalInstance): PetAnimalInstance {
    return {
      agentId: normalizeOptionalString(input.agentId ?? fallback?.agentId),
      id: input.id || fallback?.id || randomUUID(),
      packageId: input.packageId || fallback?.packageId || '',
      name: input.name?.trim() || fallback?.name || 'Pet',
      order: Number.isFinite(input.order) ? input.order : (fallback?.order ?? 0),
      enabled: typeof input.enabled === 'boolean' ? input.enabled : (fallback?.enabled ?? true),
      homeXRatio: clampRatio(Number.isFinite(input.homeXRatio) ? input.homeXRatio : (fallback?.homeXRatio ?? 0.5)),
      personality: input.personality || fallback?.personality || DEFAULT_PET_PERSONALITY,
      createdAt: input.createdAt || fallback?.createdAt || new Date().toISOString()
    }
  }

  private parsePackageId(value: unknown): string {
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error('Pet package id must be a non-empty string')
    }
    return value.trim()
  }

  private parseRequiredString(value: unknown, label: string): string {
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`${label} must be a non-empty string`)
    }
    return value.trim()
  }

  private parseInstanceId(value: unknown): string {
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error('Pet animal id must be a non-empty string')
    }
    return value.trim()
  }

  private parseTaskKey(value: unknown): string {
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error('Pet task key must be a non-empty string')
    }
    return value.trim()
  }

  private parseSessionTaskKey(value: unknown): string {
    const taskKey = this.parseTaskKey(value)
    if (!taskKey.startsWith('session:')) {
      throw new Error('Pet task key must target an agent session')
    }

    const sessionId = taskKey.slice('session:'.length).trim()
    if (!sessionId) {
      throw new Error('Pet task session id must be non-empty')
    }
    return sessionId
  }

  private parseApprovalId(value: unknown): string {
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error('Pet approval id must be a non-empty string')
    }
    return value.trim()
  }

  private parsePlayAnimation(value: unknown): PetSemanticAnimationName | null {
    if (isPetSemanticAnimationName(value)) return value
    if (!isPetAnimationName(value)) return null

    for (const animation of PET_SERVICE_SEMANTIC_ANIMATIONS) {
      if (getLegacyAnimationName(animation) === value) return animation
    }

    return null
  }

  private parseAnimalInstance(value: unknown): PetAnimalInstance {
    if (!value || typeof value !== 'object') {
      throw new Error('Pet animal instance must be an object')
    }
    const record = value as Partial<PetAnimalInstance>
    return this.normalizeAnimal({
      id: this.parseInstanceId(record.id),
      agentId: normalizeOptionalString(record.agentId),
      packageId: this.parsePackageId(record.packageId),
      name: typeof record.name === 'string' ? record.name : '',
      order: typeof record.order === 'number' ? record.order : 0,
      enabled: typeof record.enabled === 'boolean' ? record.enabled : true,
      homeXRatio: typeof record.homeXRatio === 'number' ? record.homeXRatio : 0.5,
      personality: record.personality || DEFAULT_PET_PERSONALITY,
      createdAt: typeof record.createdAt === 'string' ? record.createdAt : new Date().toISOString()
    })
  }

  private parsePosition(value: unknown): PetWindowPosition {
    if (!value || typeof value !== 'object') {
      throw new Error('Pet window position must be an object')
    }
    const { x, y } = value as Partial<PetWindowPosition>
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error('Pet window position must contain finite x and y numbers')
    }
    return { x, y }
  }

  private setMouseEventsIgnored(sender: Electron.WebContents, value: unknown): void {
    if (typeof value !== 'boolean') {
      throw new Error('Pet mouse event ignored state must be a boolean')
    }

    const window = this.getPetWindowFromSender(sender)
    if (!window) return
    this.applyMouseEventsIgnored(window, value)
  }

  private applyMouseEventsIgnored(window: BrowserWindow, ignored: boolean): void {
    if (ignored) {
      window.setIgnoreMouseEvents(true, { forward: true })
      return
    }
    window.setIgnoreMouseEvents(false)
  }

  private parseTaskBubbleHold(value: unknown): PetTaskBubbleHoldState {
    if (!value || typeof value !== 'object') {
      throw new Error('Pet bubble hold state must be an object')
    }
    const record = value as Partial<PetTaskBubbleHoldState>
    return {
      taskKey: this.parseTaskKey(record.taskKey),
      held: Boolean(record.held),
      hasDraft: Boolean(record.hasDraft)
    }
  }

  private parseQuickReplyRequest(value: unknown): PetQuickReplyRequest {
    if (!value || typeof value !== 'object') {
      throw new Error('Pet quick reply request must be an object')
    }
    const record = value as Partial<PetQuickReplyRequest>
    const text = typeof record.text === 'string' ? record.text.trim() : ''
    if (!text) throw new Error('Pet quick reply text must not be empty')
    return {
      taskKey: this.parseTaskKey(record.taskKey),
      text
    }
  }
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function clampRatio(value: number): number {
  return Math.min(Math.max(value, 0), 1)
}

function clampNumber(value: number, min: number, max: number): number {
  const finiteValue = Number.isFinite(value) ? value : min
  return Math.round(Math.min(Math.max(finiteValue, min), max))
}

function parseFiniteNumber(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Pet window resize field "${fieldName}" must be a finite number`)
  }
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
