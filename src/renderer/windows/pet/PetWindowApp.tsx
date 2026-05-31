import { usePreference } from '@data/hooks/usePreference'
import {
  usePetSceneModePreference,
  usePetVrmStageModelProfiles,
  usePetVrmStageSceneSettings
} from '@renderer/hooks/usePetPreferences'
import type {
  PetMouseState,
  PetPastureResizeRequest,
  PetTaskBinding,
  PetWindowBounds,
  PetWindowResizeEdge,
  PetWindowResizeRequest
} from '@shared/pet'
import {
  clampPetScale,
  getPetDimensions,
  PET_GROUND_HIT_HEIGHT,
  PET_PASTURE_DEFAULT_WIDTH,
  PET_PASTURE_MAX_WIDTH,
  PET_VRM_STAGE_MIN_HEIGHT,
  PET_VRM_STAGE_MIN_WIDTH,
  PET_WINDOW_HEIGHT
} from '@shared/pet'
import type { FC, PointerEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { usePetPresentationRuntime } from './presentation/usePetPresentationRuntime'
import type { PastureAnimalPosition } from './sprite/PastureAnimal'
import { buildPetPastureContexts } from './sprite/spriteBehaviorContext'
import SpritePastureScene from './sprite/SpritePastureScene'
import {
  buildPetOverlayItems,
  getPetTaskOverlayPriority,
  layoutPetOverlays,
  PetSpriteControlIslandLayer,
  PetSpriteTaskOverlayLayer
} from './sprite/SpriteTaskLayers'
import {
  buildControlIslandQueueSummary,
  buildControlIslandSourceGroups,
  buildPetPanelSnapshots
} from './sprite/spriteTaskUi'
import { getPetSpriteResizeRequest } from './sprite/spriteWindowController'
import type { PetVrmStageModelLoadState, PetVrmStageSceneSettings } from './vrm/types'
import VrmStageScene from './vrm/VrmStageScene'
import { getPetVrmResizeRequest } from './vrm/vrmWindowController'

type WindowDragState = {
  bounds: PetWindowBounds
  pointerId: number
  startScreenX: number
  startScreenY: number
  pendingFrame: number | null
  pendingPosition: { x: number; y: number } | null
}

type WindowResizeState = {
  bounds: PetWindowBounds
  edge: PetWindowResizeEdge
  pointerId: number
  startScreenX: number
  startScreenY: number
  pendingFrame: number | null
  pendingRequest: PetWindowResizeRequest | PetPastureResizeRequest | null
}

const PET_EDGE_RESIZE_HANDLE_WIDTH = 10
const PET_MOUSE_INTERACTION_GRACE_MS = 250
const PET_VRM_RESIZE_FRAME_SHOW_DELAY_MS = 250

const PetWindowApp: FC = () => {
  const { snapshot } = usePetPresentationRuntime()
  const [dndEnabled] = usePreference('feature.pet.dnd_enabled')
  const [petScale] = usePreference('feature.pet.scale')
  const [vrmFadeOnHoverEnabled, setVrmFadeOnHoverEnabled] = usePreference('feature.pet.vrm.fade_on_hover_enabled')
  const [stageWidth, setStageWidth] = useState(PET_PASTURE_DEFAULT_WIDTH)
  const [stageHeight, setStageHeight] = useState(PET_WINDOW_HEIGHT)
  const [windowX, setWindowX] = useState(0)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<WindowDragState | null>(null)
  const resizeRef = useRef<WindowResizeState | null>(null)
  const mouseEventsIgnoredRef = useRef<boolean | null>(null)
  const mousePassthroughTimerRef = useRef<number | null>(null)
  const mouseInteractiveUntilRef = useRef(0)
  const vrmResizeFrameTimerRef = useRef<number | null>(null)
  const vrmResizeFrameNearBorderRef = useRef(false)
  const [mouseState, setMouseState] = useState<PetMouseState | null>(null)
  const [windowDragging, setWindowDragging] = useState(false)
  const [vrmResizeFrameVisible, setVrmResizeFrameVisible] = useState(false)
  const [vrmStageFaded, setVrmStageFaded] = useState(false)
  const [vrmPointerTransparent, setVrmPointerTransparent] = useState(true)
  const [livePositions, setLivePositions] = useState<Map<string, PastureAnimalPosition>>(() => new Map())
  const [selectedTaskKey, setSelectedTaskKey] = useState<string | null>(null)
  const [sceneMode] = usePetSceneModePreference()
  const { profiles: vrmStageModelProfiles } = usePetVrmStageModelProfiles()
  const [vrmSceneSettings, setVrmSceneSettings] = usePetVrmStageSceneSettings()
  const [vrmModelLoadStates, setVrmModelLoadStates] = useState<Map<string, PetVrmStageModelLoadState>>(() => new Map())
  const sceneModeRef = useRef(sceneMode)
  sceneModeRef.current = sceneMode
  const spriteSceneEnabled = sceneMode === 'sprite-pasture'
  const vrmSceneEnabled = sceneMode === 'vrm-stage'

  const syncVrmStageSize = useCallback((fallback?: { height?: number; width?: number }) => {
    const size = getPetVrmStageViewportSize(rootRef.current, fallback)
    setStageWidth(size.width)
    setStageHeight(size.height)
  }, [])

  useEffect(() => {
    if (sceneMode === 'vrm-stage') {
      syncVrmStageSize()
    } else {
      setStageWidth(snapshot.bounds.width)
    }
    setWindowX(Number.isFinite(snapshot.bounds.x) ? snapshot.bounds.x : 0)
  }, [sceneMode, snapshot.bounds.width, snapshot.bounds.x, syncVrmStageSize])

  useEffect(() => {
    let mounted = true
    const startTracking = () => {
      if (!mounted) return
      void window.api.pet.startMouseTracking()
    }
    const stopTracking = () => {
      void window.api.pet.stopMouseTracking()
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        stopTracking()
        return
      }
      startTracking()
    }
    const offMouseStateChanged = window.api.pet.onMouseStateChanged((state) => {
      if (!mounted) return
      setMouseState(state)
      if (sceneModeRef.current === 'vrm-stage') {
        syncVrmStageSize(state.bounds)
      } else {
        setStageWidth(state.bounds.width)
        setStageHeight(state.bounds.height)
      }
      setWindowX(Number.isFinite(state.bounds.x) ? state.bounds.x : 0)
    })

    startTracking()
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      mounted = false
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      offMouseStateChanged()
      stopTracking()
    }
  }, [syncVrmStageSize])

  const setMouseEventsIgnored = useCallback((ignored: boolean) => {
    if (mouseEventsIgnoredRef.current === ignored) return
    mouseEventsIgnoredRef.current = ignored
    void window.api.pet.setMouseEventsIgnored(ignored).catch(() => {
      mouseEventsIgnoredRef.current = null
    })
  }, [])

  useEffect(() => {
    setMouseEventsIgnored(!vrmSceneEnabled || vrmFadeOnHoverEnabled)
    return () => {
      if (mousePassthroughTimerRef.current !== null) {
        window.clearTimeout(mousePassthroughTimerRef.current)
        mousePassthroughTimerRef.current = null
      }
      setMouseEventsIgnored(false)
    }
  }, [setMouseEventsIgnored, vrmFadeOnHoverEnabled, vrmSceneEnabled])

  useEffect(() => {
    const updateStageSize = () => {
      if (sceneModeRef.current === 'vrm-stage') {
        syncVrmStageSize()
        return
      }

      const width = rootRef.current?.clientWidth
      const height = rootRef.current?.clientHeight
      if (width && width > 0) setStageWidth(width)
      if (height && height > 0) setStageHeight(height)
    }
    updateStageSize()
    window.addEventListener('resize', updateStageSize)
    return () => window.removeEventListener('resize', updateStageSize)
  }, [syncVrmStageSize])

  useEffect(() => {
    if (vrmSceneEnabled) syncVrmStageSize()
  }, [syncVrmStageSize, vrmSceneEnabled])

  const packageById = useMemo(
    () => new Map(snapshot.packages.map((petPackage) => [petPackage.id, petPackage])),
    [snapshot.packages]
  )
  const sceneHeight = vrmSceneEnabled ? Math.max(PET_VRM_STAGE_MIN_HEIGHT, stageHeight) : PET_WINDOW_HEIGHT
  const windowRelativeMousePoint = useMemo(() => getPetWindowRelativeMousePoint(mouseState), [mouseState])
  const vrmLookAtPoint = windowRelativeMousePoint
  const vrmHitTestPoint = useMemo(
    () =>
      vrmSceneEnabled &&
      windowRelativeMousePoint &&
      isPetWindowPointInBounds(windowRelativeMousePoint, stageWidth, sceneHeight)
        ? windowRelativeMousePoint
        : null,
    [sceneHeight, stageWidth, vrmSceneEnabled, windowRelativeMousePoint]
  )
  const spriteAnimals = useMemo(
    () => (spriteSceneEnabled ? snapshot.animals.filter((animal) => animal.enabled) : []),
    [snapshot.animals, spriteSceneEnabled]
  )
  const spriteBindings = useMemo(() => snapshot.bindings.filter(isPetTaskBoundToSpriteAnimal), [snapshot.bindings])
  const spriteBubbles = useMemo(() => snapshot.bubbles.filter(isPetTaskBoundToSpriteAnimal), [snapshot.bubbles])
  const spritePermissionPrompts = useMemo(
    () => snapshot.permissionPrompts.filter(isPetTaskBoundToSpriteAnimal),
    [snapshot.permissionPrompts]
  )
  const spriteQueuedTasks = useMemo(
    () => snapshot.queuedTasks.filter(isPetTaskBoundToSpriteAnimal),
    [snapshot.queuedTasks]
  )
  const vrmBindings = useMemo(() => snapshot.bindings.filter(isPetTaskBoundToVrmModel), [snapshot.bindings])
  const vrmBubbles = useMemo(() => snapshot.bubbles.filter(isPetTaskBoundToVrmModel), [snapshot.bubbles])
  const vrmPermissionPrompts = useMemo(
    () => snapshot.permissionPrompts.filter(isPetTaskBoundToVrmModel),
    [snapshot.permissionPrompts]
  )
  const vrmQueuedTasks = useMemo(() => snapshot.queuedTasks.filter(isPetTaskBoundToVrmModel), [snapshot.queuedTasks])
  const bindingByAnimalId = useMemo(() => buildPetTaskBindingByAnimalId(spriteBindings), [spriteBindings])
  const boundedPetScale = clampPetScale(petScale)
  const petDimensions = useMemo(() => getPetDimensions(boundedPetScale), [boundedPetScale])
  const bubbleByAnimalId = useMemo(
    () => new Map(spriteBubbles.map((bubble) => [bubble.animalId, bubble])),
    [spriteBubbles]
  )
  const controlPanels = useMemo(
    () =>
      spriteSceneEnabled
        ? buildPetPanelSnapshots({
            bindings: spriteBindings,
            bubbles: spriteBubbles,
            permissionPrompts: spritePermissionPrompts,
            queuedTasks: spriteQueuedTasks
          })
        : [],
    [spriteBindings, spriteBubbles, spritePermissionPrompts, spriteQueuedTasks, spriteSceneEnabled]
  )
  const controlSourceGroups = useMemo(() => buildControlIslandSourceGroups(controlPanels), [controlPanels])
  const controlQueueSummary = useMemo(() => buildControlIslandQueueSummary(controlPanels), [controlPanels])
  useEffect(() => {
    const enabledAnimalIds = new Set(spriteAnimals.map((animal) => animal.id))
    setLivePositions((current) => {
      if ([...current.keys()].every((animalId) => enabledAnimalIds.has(animalId))) return current
      const next = new Map<string, PastureAnimalPosition>()
      for (const [animalId, position] of current) {
        if (enabledAnimalIds.has(animalId)) next.set(animalId, position)
      }
      return next
    })
  }, [spriteAnimals])
  const behaviorContextByAnimalId = useMemo(
    () =>
      buildPetPastureContexts({
        animals: spriteAnimals,
        bindingByAnimalId,
        bubbleByAnimalId,
        livePositions
      }),
    [bindingByAnimalId, bubbleByAnimalId, livePositions, spriteAnimals]
  )
  const overlayItems = useMemo(
    () =>
      spriteSceneEnabled
        ? buildPetOverlayItems({
            animals: spriteAnimals,
            bindingByAnimalId,
            bubbleByAnimalId,
            livePositions,
            petDimensions,
            stageWidth
          })
        : [],
    [bindingByAnimalId, bubbleByAnimalId, livePositions, petDimensions, spriteAnimals, spriteSceneEnabled, stageWidth]
  )
  const overlayPlacements = useMemo(
    () => (dndEnabled ? [] : layoutPetOverlays(overlayItems, stageWidth)),
    [dndEnabled, overlayItems, stageWidth]
  )
  useEffect(() => {
    if (!selectedTaskKey) return
    const taskStillVisible =
      overlayItems.some((item) => item.taskKey === selectedTaskKey) ||
      controlPanels.some((panel) => panel.taskKey === selectedTaskKey)
    if (!taskStillVisible) setSelectedTaskKey(null)
  }, [controlPanels, overlayItems, selectedTaskKey])

  const handleSelectTaskBubble = useCallback((taskKey: string) => {
    setSelectedTaskKey(taskKey)
  }, [])

  const handleAnimalPositionChange = useCallback((position: PastureAnimalPosition) => {
    setLivePositions((current) => {
      const previous = current.get(position.animalId)
      if (previous && previous.mode === position.mode && Math.abs(previous.xRatio - position.xRatio) < 0.001) {
        return current
      }
      const next = new Map(current)
      next.set(position.animalId, position)
      return next
    })
  }, [])
  const handleVrmModelLoadStateChange = useCallback((state: PetVrmStageModelLoadState) => {
    setVrmModelLoadStates((current) => {
      const previous = current.get(state.modelId)
      if (previous?.phase === state.phase && previous.error === state.error) return current

      const next = new Map(current)
      next.set(state.modelId, state)
      return next
    })
  }, [])
  const handleVrmHitTestTransparencyChange = useCallback((transparent: boolean) => {
    setVrmPointerTransparent(transparent)
  }, [])
  const handleVrmFadeOnHoverChange = useCallback(
    (enabled: boolean) => {
      void setVrmFadeOnHoverEnabled(enabled)
      if (!enabled) setVrmStageFaded(false)
    },
    [setVrmFadeOnHoverEnabled]
  )
  const handleVrmSceneSettingsChange = useCallback(
    (settings: PetVrmStageSceneSettings) => {
      void setVrmSceneSettings(settings)
    },
    [setVrmSceneSettings]
  )

  const movePendingWindow = useCallback(() => {
    const drag = dragRef.current
    if (!drag?.pendingPosition) return

    const position = drag.pendingPosition
    drag.pendingPosition = null
    drag.pendingFrame = null
    setWindowX(position.x)
    void window.api.pet.moveWindow(position).then((bounds) => {
      if (bounds) setWindowX(bounds.x)
    })
  }, [])

  const resizePendingPasture = useCallback(() => {
    const resize = resizeRef.current
    if (!resize?.pendingRequest) return

    const request = resize.pendingRequest
    resize.pendingRequest = null
    resize.pendingFrame = null
    void resizePetWindow(request).then((bounds) => {
      if (!bounds) return
      if (sceneModeRef.current === 'vrm-stage') {
        syncVrmStageSize(bounds)
      } else {
        setStageWidth(bounds.width)
        setStageHeight(bounds.height)
      }
      setWindowX(bounds.x)
    })
  }, [syncVrmStageSize])

  const clearMousePassthroughTimer = useCallback(() => {
    if (mousePassthroughTimerRef.current === null) return
    window.clearTimeout(mousePassthroughTimerRef.current)
    mousePassthroughTimerRef.current = null
  }, [])

  const clearVrmResizeFrameTimer = useCallback(() => {
    if (vrmResizeFrameTimerRef.current === null) return
    window.clearTimeout(vrmResizeFrameTimerRef.current)
    vrmResizeFrameTimerRef.current = null
  }, [])

  useEffect(() => {
    const point = windowRelativeMousePoint
    const pointInWindow = Boolean(point && isPetWindowPointInBounds(point, stageWidth, sceneHeight))
    const target = point && pointInWindow ? document.elementFromPoint(point.x, point.y) : null
    const nearResizeBorder =
      isPetMouseInHorizontalResizeZone(point, stageWidth, sceneHeight) ||
      (vrmSceneEnabled && isPetMouseInVerticalResizeZone(point, stageWidth, sceneHeight))
    const overHitTarget = isPetHitTarget(target)
    const vrmPixelInteractive = vrmSceneEnabled && pointInWindow && !vrmPointerTransparent
    const interactive = Boolean(
      dragRef.current ||
        resizeRef.current ||
        nearResizeBorder ||
        (!vrmSceneEnabled && vrmPixelInteractive) ||
        overHitTarget
    )

    if (vrmSceneEnabled) {
      const shouldFade =
        vrmFadeOnHoverEnabled && pointInWindow && !vrmPointerTransparent && !nearResizeBorder && !overHitTarget
      setVrmStageFaded(shouldFade)
      clearMousePassthroughTimer()
      if (interactive || !vrmFadeOnHoverEnabled) {
        mouseInteractiveUntilRef.current = Date.now() + PET_MOUSE_INTERACTION_GRACE_MS
        setMouseEventsIgnored(false)
        return
      }
      setMouseEventsIgnored(true)
      return
    }

    setVrmStageFaded(false)

    clearMousePassthroughTimer()
    if (interactive) {
      mouseInteractiveUntilRef.current = Date.now() + PET_MOUSE_INTERACTION_GRACE_MS
      setMouseEventsIgnored(false)
      return
    }

    const remainingGraceMs = mouseInteractiveUntilRef.current - Date.now()
    if (remainingGraceMs <= 0) {
      setMouseEventsIgnored(true)
      return
    }

    mousePassthroughTimerRef.current = window.setTimeout(() => {
      mousePassthroughTimerRef.current = null
      if (!dragRef.current && !resizeRef.current) setMouseEventsIgnored(true)
    }, remainingGraceMs)
  }, [
    clearMousePassthroughTimer,
    sceneHeight,
    setMouseEventsIgnored,
    stageWidth,
    vrmFadeOnHoverEnabled,
    vrmPointerTransparent,
    vrmSceneEnabled,
    windowRelativeMousePoint
  ])

  useEffect(() => {
    if (!vrmSceneEnabled) {
      vrmResizeFrameNearBorderRef.current = false
      clearVrmResizeFrameTimer()
      setVrmResizeFrameVisible(false)
      return
    }

    const nearResizeBorder =
      isPetMouseInHorizontalResizeZone(windowRelativeMousePoint, stageWidth, sceneHeight) ||
      isPetMouseInVerticalResizeZone(windowRelativeMousePoint, stageWidth, sceneHeight)

    if (!nearResizeBorder) {
      vrmResizeFrameNearBorderRef.current = false
      clearVrmResizeFrameTimer()
      setVrmResizeFrameVisible(false)
      return
    }

    if (vrmResizeFrameNearBorderRef.current) return
    vrmResizeFrameNearBorderRef.current = true
    clearVrmResizeFrameTimer()
    vrmResizeFrameTimerRef.current = window.setTimeout(() => {
      vrmResizeFrameTimerRef.current = null
      if (vrmResizeFrameNearBorderRef.current) setVrmResizeFrameVisible(true)
    }, PET_VRM_RESIZE_FRAME_SHOW_DELAY_MS)
  }, [clearVrmResizeFrameTimer, sceneHeight, stageWidth, vrmSceneEnabled, windowRelativeMousePoint])

  useEffect(() => {
    return () => {
      clearVrmResizeFrameTimer()
    }
  }, [clearVrmResizeFrameTimer])

  const handlePointerDown = useCallback(
    async (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 && event.button !== undefined) return
      event.preventDefault()

      const target = event.currentTarget
      const pointerId = event.pointerId
      const startScreenX = getPointerScreenX(event)
      const startScreenY = getPointerScreenY(event)
      setMouseEventsIgnored(false)
      setWindowDragging(true)
      const startedNativeDrag = await window.api.pet.startDraggingWindow().catch(() => false)
      if (startedNativeDrag) {
        setWindowDragging(false)
        return
      }

      const bounds = await window.api.pet.getWindowBounds()
      if (!bounds) {
        setWindowDragging(false)
        return
      }

      target.setPointerCapture?.(pointerId)
      dragRef.current = {
        bounds,
        pointerId,
        startScreenX,
        startScreenY,
        pendingFrame: null,
        pendingPosition: null
      }
    },
    [setMouseEventsIgnored]
  )

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return

      drag.pendingPosition = {
        x: drag.bounds.x + getPointerScreenX(event) - drag.startScreenX,
        y: vrmSceneEnabled ? drag.bounds.y + getPointerScreenY(event) - drag.startScreenY : drag.bounds.y
      }

      if (drag.pendingFrame === null) {
        drag.pendingFrame = requestAnimationFrame(movePendingWindow)
      }
    },
    [movePendingWindow, vrmSceneEnabled]
  )

  const finishWindowDrag = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return

      if (drag.pendingFrame !== null) {
        cancelAnimationFrame(drag.pendingFrame)
      }

      const position = {
        x: drag.bounds.x + getPointerScreenX(event) - drag.startScreenX,
        y: vrmSceneEnabled ? drag.bounds.y + getPointerScreenY(event) - drag.startScreenY : drag.bounds.y
      }
      setWindowX(position.x)
      void window.api.pet.moveWindow(position).then((bounds) => {
        if (bounds) setWindowX(bounds.x)
      })
      dragRef.current = null
      setWindowDragging(false)
    },
    [vrmSceneEnabled]
  )

  const handleResizePointerDown = useCallback(
    async (event: PointerEvent<HTMLDivElement>, edge: PetWindowResizeEdge) => {
      if (event.button !== 0 && event.button !== undefined) return
      event.preventDefault()
      event.stopPropagation()

      setMouseEventsIgnored(false)
      if (sceneMode === 'vrm-stage') {
        vrmResizeFrameNearBorderRef.current = true
        clearVrmResizeFrameTimer()
        setVrmResizeFrameVisible(true)
      }
      const target = event.currentTarget
      const pointerId = event.pointerId
      const startScreenX = getPointerScreenX(event)
      const startScreenY = getPointerScreenY(event)
      const bounds = await window.api.pet.getWindowBounds()
      if (!bounds) return

      target.setPointerCapture?.(pointerId)
      resizeRef.current = {
        bounds,
        edge,
        pointerId,
        startScreenX,
        startScreenY,
        pendingFrame: null,
        pendingRequest: null
      }
    },
    [clearVrmResizeFrameTimer, sceneMode, setMouseEventsIgnored]
  )

  const handleResizePointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const resize = resizeRef.current
      if (!resize || resize.pointerId !== event.pointerId) return

      resize.pendingRequest = getPetWindowResizeRequest(
        resize.edge,
        resize.bounds,
        getPointerScreenX(event) - resize.startScreenX,
        getPointerScreenY(event) - resize.startScreenY,
        sceneMode
      )
      if (resize.pendingFrame === null) {
        resize.pendingFrame = requestAnimationFrame(resizePendingPasture)
      }
    },
    [resizePendingPasture, sceneMode]
  )

  const finishWindowResize = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const resize = resizeRef.current
      if (!resize || resize.pointerId !== event.pointerId) return

      if (resize.pendingFrame !== null) {
        cancelAnimationFrame(resize.pendingFrame)
      }

      const request = getPetWindowResizeRequest(
        resize.edge,
        resize.bounds,
        getPointerScreenX(event) - resize.startScreenX,
        getPointerScreenY(event) - resize.startScreenY,
        sceneMode
      )
      void resizePetWindow(request).then((bounds) => {
        if (!bounds) return
        if (sceneModeRef.current === 'vrm-stage') {
          syncVrmStageSize(bounds)
        } else {
          setStageWidth(bounds.width)
          setStageHeight(bounds.height)
        }
        setWindowX(bounds.x)
      })
      resizeRef.current = null
    },
    [sceneMode, syncVrmStageSize]
  )

  const backgroundOffsetX = getPetBackgroundOffsetX(windowX, stageWidth)

  return (
    <div
      ref={rootRef}
      style={{
        width: vrmSceneEnabled ? stageWidth : '100vw',
        height: sceneHeight,
        position: 'relative',
        overflow: 'hidden',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        cursor: 'default'
      }}>
      {spriteSceneEnabled ? (
        <SpritePastureScene
          animals={spriteAnimals}
          backgroundOffsetX={backgroundOffsetX}
          behaviorContextByAnimalId={behaviorContextByAnimalId}
          bindingByAnimalId={bindingByAnimalId}
          bubbleByAnimalId={bubbleByAnimalId}
          onAnimalPositionChange={handleAnimalPositionChange}
          onResizePointerCancel={finishWindowResize}
          onResizePointerDown={handleResizePointerDown}
          onResizePointerMove={handleResizePointerMove}
          onResizePointerUp={finishWindowResize}
          overlayItems={overlayItems}
          packageById={packageById}
          petScale={boundedPetScale}
          selectedTaskKey={selectedTaskKey}
          stageWidth={stageWidth}
        />
      ) : null}
      {vrmSceneEnabled ? (
        <VrmStageScene
          bindings={vrmBindings}
          bubbles={vrmBubbles}
          hitTestPoint={vrmHitTestPoint}
          lookAtPoint={vrmLookAtPoint}
          modelLoadStates={vrmModelLoadStates}
          modelProfiles={vrmStageModelProfiles}
          onHitTestTransparencyChange={handleVrmHitTestTransparencyChange}
          onFadeOnHoverChange={handleVrmFadeOnHoverChange}
          onModelLoadStateChange={handleVrmModelLoadStateChange}
          onResizePointerCancel={finishWindowResize}
          onResizePointerDown={handleResizePointerDown}
          onResizePointerMove={handleResizePointerMove}
          onResizePointerUp={finishWindowResize}
          onSceneSettingsChange={handleVrmSceneSettingsChange}
          permissionPrompts={vrmPermissionPrompts}
          queuedTasks={vrmQueuedTasks}
          resizeFrameVisible={vrmResizeFrameVisible}
          sceneSettings={vrmSceneSettings}
          stageFaded={vrmStageFaded}
          stageHeight={sceneHeight}
          stageWidth={stageWidth}
          fadeOnHoverEnabled={vrmFadeOnHoverEnabled}
        />
      ) : null}
      {spriteSceneEnabled ? (
        <div
          data-pet-hit-zone="true"
          data-testid="pet-ground-drag"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: PET_GROUND_HIT_HEIGHT,
            cursor: windowDragging ? 'grabbing' : 'grab',
            zIndex: 2
          }}
          onPointerCancel={finishWindowDrag}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishWindowDrag}
        />
      ) : null}

      {spriteSceneEnabled && !dndEnabled ? (
        <PetSpriteTaskOverlayLayer onSelectTask={handleSelectTaskBubble} placements={overlayPlacements} />
      ) : null}

      {spriteSceneEnabled ? (
        <PetSpriteControlIslandLayer
          animals={spriteAnimals}
          dndEnabled={Boolean(dndEnabled)}
          onSelectTask={setSelectedTaskKey}
          panels={controlPanels}
          queueSummary={controlQueueSummary}
          selectedTaskKey={selectedTaskKey}
          sourceGroups={controlSourceGroups}
          stageWidth={stageWidth}
        />
      ) : null}
    </div>
  )
}

function getPointerScreenX(event: PointerEvent<HTMLElement>): number {
  const x = Number.isFinite(event.screenX) ? event.screenX : event.clientX
  return Number.isFinite(x) ? x : 0
}

function getPointerScreenY(event: PointerEvent<HTMLElement>): number {
  const y = Number.isFinite(event.screenY) ? event.screenY : event.clientY
  return Number.isFinite(y) ? y : 0
}

function getPetWindowResizeRequest(
  edge: PetWindowResizeEdge,
  bounds: PetWindowBounds,
  deltaX: number,
  deltaY: number,
  mode: 'sprite-pasture' | 'vrm-stage'
): PetPastureResizeRequest | PetWindowResizeRequest {
  if (mode === 'sprite-pasture' && (edge === 'left' || edge === 'right')) {
    return getPetSpriteResizeRequest(edge, bounds, deltaX)
  }

  return getPetVrmResizeRequest(edge, bounds, deltaX, deltaY)
}

function resizePetWindow(request: PetPastureResizeRequest | PetWindowResizeRequest): Promise<PetWindowBounds | null> {
  if ('mode' in request) return window.api.pet.window.resize(request)
  return window.api.pet.resizePasture(request)
}

export function getPetBackgroundOffsetX(windowX: number, stageWidth: number): number {
  const maxOffset = Math.max(0, PET_PASTURE_MAX_WIDTH - Math.max(0, stageWidth))
  if (maxOffset === 0) return 0

  const finiteWindowX = Number.isFinite(windowX) ? windowX : 0
  return Math.round(clamp(finiteWindowX, 0, maxOffset))
}

export function getPetWindowRelativeMousePoint(mouseState: PetMouseState | null): { x: number; y: number } | null {
  if (!mouseState) return null
  return {
    x: mouseState.cursor.x - mouseState.bounds.x,
    y: mouseState.cursor.y - mouseState.bounds.y
  }
}

export function isPetMouseInHorizontalResizeZone(
  point: { x: number; y: number } | null,
  width: number,
  height: number,
  handleWidth = PET_EDGE_RESIZE_HANDLE_WIDTH,
  overshoot = PET_EDGE_RESIZE_HANDLE_WIDTH
): boolean {
  if (!point || width <= 0 || height <= 0) return false
  const withinVerticalRange = point.y >= -overshoot && point.y <= height + overshoot
  if (!withinVerticalRange) return false
  return (
    (point.x >= -overshoot && point.x <= handleWidth) ||
    (point.x >= width - handleWidth && point.x <= width + overshoot)
  )
}

export function isPetMouseInVerticalResizeZone(
  point: { x: number; y: number } | null,
  width: number,
  height: number,
  handleWidth = PET_EDGE_RESIZE_HANDLE_WIDTH,
  overshoot = PET_EDGE_RESIZE_HANDLE_WIDTH
): boolean {
  if (!point || width <= 0 || height <= 0) return false
  const withinHorizontalRange = point.x >= -overshoot && point.x <= width + overshoot
  if (!withinHorizontalRange) return false
  return (
    (point.y >= -overshoot && point.y <= handleWidth) ||
    (point.y >= height - handleWidth && point.y <= height + overshoot)
  )
}

export function isPetWindowPointInBounds(point: { x: number; y: number }, width: number, height: number): boolean {
  return point.x >= 0 && point.x <= width && point.y >= 0 && point.y <= height
}

function getPetVrmStageViewportSize(
  root: HTMLElement | null,
  fallback: { height?: number; width?: number } = {}
): { height: number; width: number } {
  return {
    height: Math.max(
      PET_VRM_STAGE_MIN_HEIGHT,
      Math.round(getFirstPositiveFiniteNumber(fallback.height, window.innerHeight, root?.clientHeight))
    ),
    width: Math.max(
      PET_VRM_STAGE_MIN_WIDTH,
      Math.round(getFirstPositiveFiniteNumber(fallback.width, window.innerWidth, root?.clientWidth))
    )
  }
}

function getFirstPositiveFiniteNumber(...values: Array<number | undefined>): number {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  }
  return 1
}

export function isPetHitTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('[data-pet-hit-zone="true"]'))
}

function isPetTaskBoundToSpriteAnimal(task: { petTargetKind?: string }): boolean {
  return !task.petTargetKind || task.petTargetKind === 'animal'
}

function isPetTaskBoundToVrmModel(task: { petTargetKind?: string }): boolean {
  return task.petTargetKind === 'vrm-model'
}

export function buildPetTaskBindingByAnimalId(bindings: PetTaskBinding[]): Map<string, PetTaskBinding> {
  const bindingByAnimalId = new Map<string, PetTaskBinding>()
  for (const binding of bindings) {
    const current = bindingByAnimalId.get(binding.animalId)
    if (!current || comparePetTaskBindingPriority(binding, current) < 0) {
      bindingByAnimalId.set(binding.animalId, binding)
    }
  }
  return bindingByAnimalId
}

function comparePetTaskBindingPriority(left: PetTaskBinding, right: PetTaskBinding): number {
  return (
    getPetTaskOverlayPriority(right.status) - getPetTaskOverlayPriority(left.status) ||
    left.startedAt - right.startedAt ||
    left.updatedAt - right.updatedAt ||
    left.taskKey.localeCompare(right.taskKey)
  )
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

export default PetWindowApp
