import type {
  PetAnimalInstance,
  PetPackageInfo,
  PetSemanticAnimationName,
  PetTaskBinding,
  PetTaskBubbleSnapshot,
  PetTaskStatus
} from '@shared/pet'
import {
  clampPetScale,
  getPetDimensions,
  PET_DEFAULT_SCALE,
  PET_PASTURE_GROUND_BOTTOM_OFFSET,
  resolvePetRuntimeClip
} from '@shared/pet'
import type { FC, PointerEvent } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { openPetTask, setPetTaskBubbleHold } from '../presentation/petPresentationActions'
import { preloadPetRuntimeClipAssets } from './petAssetCache'
import {
  createInitialPetBehaviorState,
  createPetBehaviorPersonality,
  type PetBehaviorContext,
  type PetBehaviorMode,
  type PetBehaviorPersonality,
  type PetBehaviorState,
  type PetBehaviorSuppressReason,
  type PetBehaviorTaskState,
  resetPetBehaviorPosition,
  resumePetBehavior,
  tickPetBehavior
} from './petBehavior'
import SpriteAnimator from './SpriteAnimator'

type PastureAnimalProps = {
  animal: PetAnimalInstance
  binding?: PetTaskBinding
  bubble?: PetTaskBubbleSnapshot
  behaviorContext?: PetBehaviorContext
  hasTaskOverlay?: boolean
  isTaskFocused?: boolean
  onPositionChange?: (position: PastureAnimalPosition) => void
  onFocusRequest?: (animalId: string) => void
  packageInfo: PetPackageInfo
  petScale?: number
  stageWidth: number
}

export type PastureAnimalPosition = {
  animalId: string
  mode: PetBehaviorMode
  xRatio: number
}

type DragState = {
  pointerId: number
  startScreenX: number
  startRatio: number
  lastScreenX: number
  moved: boolean
}

const TERMINAL_BUBBLE_VISIBLE_MS = 30_000

const PastureAnimal: FC<PastureAnimalProps> = ({
  animal,
  behaviorContext,
  binding,
  bubble,
  hasTaskOverlay = false,
  isTaskFocused = false,
  onFocusRequest,
  onPositionChange,
  packageInfo,
  petScale = PET_DEFAULT_SCALE,
  stageWidth
}) => {
  const [xRatio, setXRatio] = useState(animal.homeXRatio)
  const [animation, setAnimation] = useState<PetSemanticAnimationName>('idle')
  const [behaviorMode, setBehaviorMode] = useState<PetBehaviorMode>('observing')
  const [sleeping, setSleeping] = useState(false)
  const [bubbleHeld, setBubbleHeld] = useState(false)
  const [now, setNow] = useState(Date.now())
  const xRatioRef = useRef(animal.homeXRatio)
  const behaviorPersonalityRef = useRef<PetBehaviorPersonality>(createPetBehaviorPersonality(animal.personality))
  const behaviorStateRef = useRef<PetBehaviorState>(
    createInitialPetBehaviorState(animal.id, animal.order, animal.homeXRatio, getNow())
  )
  const animalIdentityRef = useRef<{ id: string; order: number } | undefined>(undefined)
  const dragRef = useRef<DragState | null>(null)
  const behaviorFrameRef = useRef<number | null>(null)
  const behaviorWasPausedRef = useRef(false)
  const suppressNextClickRef = useRef(false)
  const lastPositionReportRef = useRef<(PastureAnimalPosition & { reportedAt: number }) | undefined>(undefined)
  const behaviorRuntimeRef = useRef<{
    behaviorContext?: PetBehaviorContext
    bubbleHeld: boolean
    showBubble: boolean
    suppressReason?: PetBehaviorSuppressReason
    taskBound: boolean
    task?: PetTaskBinding | PetTaskBubbleSnapshot
  }>({
    bubbleHeld: false,
    showBubble: false,
    taskBound: false
  })

  const task = binding ?? bubble
  xRatioRef.current = xRatio
  const bindingStatus = binding?.status
  const bubbleStatus = bubble?.status
  const taskKey = task?.taskKey
  const terminal = task ? isTerminalStatus(task.status) : false
  const showBubble = Boolean(
    task &&
      !task.bubbleDismissed &&
      (binding || (terminal && (bubbleHeld || now - (task.endedAt ?? task.updatedAt) < TERMINAL_BUBBLE_VISIBLE_MS)))
  )

  useEffect(() => {
    const previousIdentity = animalIdentityRef.current
    const identityChanged =
      !previousIdentity || previousIdentity.id !== animal.id || previousIdentity.order !== animal.order
    const now = getNow()
    animalIdentityRef.current = { id: animal.id, order: animal.order }
    setXRatio(animal.homeXRatio)

    if (identityChanged) {
      behaviorPersonalityRef.current = createPetBehaviorPersonality(animal.personality)
      behaviorStateRef.current = createInitialPetBehaviorState(animal.id, animal.order, animal.homeXRatio, now)
      return
    }

    behaviorStateRef.current = resetPetBehaviorPosition(behaviorStateRef.current, animal.homeXRatio, now)
  }, [animal.homeXRatio, animal.id, animal.order, animal.personality])

  useEffect(() => {
    if (!terminal || !task || task.bubbleDismissed) return
    const handle = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(handle)
  }, [task, terminal])

  useEffect(() => {
    if (!bindingStatus) return
    setSleeping(false)
    setAnimation(getTaskAnimation(bindingStatus))
  }, [bindingStatus])

  useEffect(() => {
    if (!bubbleStatus || !terminal || bubble?.bubbleDismissed) return
    setSleeping(false)
    setAnimation(getTaskAnimation(bubbleStatus))
  }, [bubble?.bubbleDismissed, bubbleStatus, terminal])

  useEffect(() => {
    if (!taskKey) return
    void setPetTaskBubbleHold({
      taskKey,
      held: bubbleHeld,
      hasDraft: false
    })
  }, [taskKey, bubbleHeld])

  const boundedPetScale = clampPetScale(petScale)
  const petDimensions = getPetDimensions(boundedPetScale)
  const maxLeft = Math.max(0, stageWidth - petDimensions.width)
  const left = Math.round(xRatio * maxLeft)

  const suppressReason = getSuppressReason({
    binding: Boolean(binding),
    bubbleHeld,
    draft: '',
    dragging: Boolean(dragRef.current),
    focused: isTaskFocused,
    showBubble
  })
  const behaviorPaused = Boolean(suppressReason)
  const playOnce = animation === 'wave' || animation === 'jump' || animation === 'celebrate' || animation === 'play'
  const clip = resolvePetRuntimeClip(packageInfo, animation)
  const transform = getPetBehaviorTransform(animation, behaviorMode, sleeping)

  useEffect(() => {
    preloadPetRuntimeClipAssets(clip)
  }, [clip])

  behaviorRuntimeRef.current = {
    behaviorContext,
    bubbleHeld,
    showBubble,
    suppressReason,
    taskBound: Boolean(binding),
    task
  }

  useEffect(() => {
    if (behaviorPaused) {
      behaviorStateRef.current = {
        ...behaviorStateRef.current,
        lastMovedAt: getNow(),
        lastTickAt: getNow()
      }
      reportPositionChange(lastPositionReportRef, onPositionChange, {
        animalId: animal.id,
        mode: behaviorStateRef.current.mode,
        reportedAt: getNow(),
        xRatio: xRatioRef.current
      })
      behaviorWasPausedRef.current = true
      return
    }

    let cancelled = false
    const tick = (timestamp: number) => {
      if (cancelled) return
      if (behaviorWasPausedRef.current) {
        behaviorStateRef.current = resumePetBehavior(behaviorStateRef.current, timestamp)
        behaviorWasPausedRef.current = false
        setAnimation('idle')
        setBehaviorMode(behaviorStateRef.current.mode)
        setSleeping(false)
      }
      const runtime = behaviorRuntimeRef.current
      const update = tickPetBehavior(behaviorStateRef.current, {
        context: {
          ...runtime.behaviorContext,
          streaming: getStreamingState(runtime.task, runtime.showBubble),
          suppressReason: runtime.suppressReason,
          task: getBehaviorTaskState(runtime.showBubble || runtime.taskBound ? runtime.task?.status : undefined),
          userFocus: runtime.bubbleHeld ? 'hover' : runtime.behaviorContext?.userFocus
        },
        maxLeft,
        now: timestamp,
        personality: behaviorPersonalityRef.current
      })
      behaviorStateRef.current = update.state
      setXRatio(update.xRatio)
      setSleeping(update.sleeping)
      setAnimation(update.animation)
      setBehaviorMode(update.state.mode)
      reportPositionChange(lastPositionReportRef, onPositionChange, {
        animalId: animal.id,
        mode: update.state.mode,
        reportedAt: timestamp,
        xRatio: update.xRatio
      })
      behaviorFrameRef.current = requestAnimationFrame(tick)
    }

    behaviorFrameRef.current = requestAnimationFrame(tick)
    return () => {
      cancelled = true
      if (behaviorFrameRef.current !== null) cancelAnimationFrame(behaviorFrameRef.current)
      behaviorFrameRef.current = null
    }
  }, [animal.id, behaviorPaused, maxLeft, onPositionChange])

  const handlePointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.stopPropagation()
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Capture can fail if the pointer is already released; dragging still works via bubbled events.
    }
    dragRef.current = {
      lastScreenX: event.screenX,
      moved: false,
      pointerId: event.pointerId,
      startScreenX: event.screenX,
      startRatio: xRatioRef.current
    }
    setSleeping(false)
    setAnimation('walkRight')
  }, [])

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      event.stopPropagation()

      const deltaRatio = maxLeft > 0 ? (event.screenX - drag.startScreenX) / maxLeft : 0
      const nextRatio = clampRatio(drag.startRatio + deltaRatio)
      if (Math.abs(event.screenX - drag.startScreenX) >= 4) drag.moved = true
      xRatioRef.current = nextRatio
      setXRatio(nextRatio)
      setAnimation(event.screenX < drag.lastScreenX ? 'walkLeft' : 'walkRight')
      drag.lastScreenX = event.screenX
    },
    [maxLeft]
  )

  const finishDrag = useCallback(
    (event: PointerEvent<HTMLDivElement>, cancelled = false) => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      event.stopPropagation()
      if (typeof event.currentTarget.releasePointerCapture === 'function') {
        try {
          event.currentTarget.releasePointerCapture(event.pointerId)
        } catch {
          // Capture may already be gone after cancel/up.
        }
      }

      const deltaX = event.screenX - drag.startScreenX
      const finalRatio = clampRatio(drag.startRatio + (maxLeft > 0 ? deltaX / maxLeft : 0))
      dragRef.current = null
      suppressNextClickRef.current = cancelled || drag.moved || Math.abs(deltaX) >= 4
      if (cancelled) {
        setAnimation('idle')
        return
      }
      xRatioRef.current = finalRatio
      setXRatio(finalRatio)
      setAnimation(suppressNextClickRef.current ? 'idle' : 'wave')
      behaviorStateRef.current = resetPetBehaviorPosition(
        behaviorStateRef.current,
        finalRatio,
        getNow(),
        deltaX < 0 ? -1 : 1
      )
      void window.api.pet.upsertAnimal({ ...animal, homeXRatio: finalRatio })
      reportPositionChange(lastPositionReportRef, onPositionChange, {
        animalId: animal.id,
        mode: behaviorStateRef.current.mode,
        reportedAt: getNow(),
        xRatio: finalRatio
      })
    },
    [animal, maxLeft, onPositionChange]
  )

  const handleClick = useCallback(() => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false
      return
    }
    if (dragRef.current) return
    setSleeping(false)
    setAnimation('wave')
  }, [])

  const handleAnimationEnd = useCallback(() => {
    if (bindingStatus === 'failed') return
    if (bindingStatus && !terminal) {
      setAnimation(bindingStatus === 'waiting' ? 'waiting' : bindingStatus === 'review' ? 'review' : 'run')
      return
    }
    setAnimation('idle')
  }, [bindingStatus, terminal])

  useEffect(() => {
    if (!isTaskFocused) return
    setBubbleHeld(true)
    return () => setBubbleHeld(false)
  }, [isTaskFocused])

  return (
    <div
      data-pet-hit-zone="true"
      style={{
        position: 'absolute',
        left,
        bottom: PET_PASTURE_GROUND_BOTTOM_OFFSET,
        width: petDimensions.width,
        height: petDimensions.height,
        cursor: 'grab',
        transition: dragRef.current ? 'none' : 'transform 220ms ease',
        transform,
        transformOrigin: 'bottom center',
        zIndex: 10 + animal.order
      }}
      onClick={(event) => {
        if (suppressNextClickRef.current) {
          suppressNextClickRef.current = false
          event.stopPropagation()
          return
        }
        if (hasTaskOverlay) {
          event.stopPropagation()
          onFocusRequest?.(animal.id)
          if (taskKey) void openPetTask(taskKey)
          return
        }
        handleClick()
      }}
      onPointerCancel={(event) => finishDrag(event, true)}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={(event) => finishDrag(event)}>
      <SpriteAnimator clip={clip} onAnimationEnd={handleAnimationEnd} playOnce={playOnce} scale={boundedPetScale} />
    </div>
  )
}

function isTerminalStatus(status: PetTaskStatus): boolean {
  return status === 'done' || status === 'failed' || status === 'aborted'
}

function getTaskAnimation(status: PetTaskStatus): PetSemanticAnimationName {
  switch (status) {
    case 'running':
      return 'run'
    case 'waiting':
      return 'waiting'
    case 'review':
      return 'review'
    case 'done':
      return 'celebrate'
    case 'failed':
      return 'failed'
    case 'aborted':
      return 'idle'
  }
}

function getPetBehaviorTransform(
  animation: PetSemanticAnimationName,
  mode: PetBehaviorMode,
  sleeping: boolean
): string | undefined {
  if (sleeping || animation === 'sleep') return 'translateY(5px) scale(0.9)'
  if (animation === 'celebrate') return 'translateY(-7px) scale(1.08)'
  if (animation === 'play' || animation === 'jump') return 'translateY(-4px) scale(1.06)'
  if (animation === 'wave' || mode === 'socializing') return 'translateY(-2px) scale(1.04)'
  if (animation === 'observe' || mode === 'observing') return 'translateY(-1px) scale(1.02)'
  return undefined
}

function getSuppressReason(input: {
  binding: boolean
  bubbleHeld: boolean
  draft: string
  dragging: boolean
  focused: boolean
  showBubble: boolean
}): PetBehaviorSuppressReason | undefined {
  if (input.dragging) return 'dragging'
  if (input.binding) return 'task-bound'
  if (input.focused) return 'bubble-held'
  if (input.bubbleHeld) return 'bubble-held'
  if (input.draft) return 'reply-draft'
  if (input.showBubble) return 'bubble-visible'
  return undefined
}

function getStreamingState(
  task: PetTaskBinding | PetTaskBubbleSnapshot | undefined,
  showBubble: boolean
): PetBehaviorContext['streaming'] {
  if (!task?.streamText) return showBubble ? 'complete' : 'idle'
  if (isTerminalStatus(task.status)) return 'complete'
  return 'streaming'
}

function getBehaviorTaskState(status: PetTaskStatus | undefined): PetBehaviorTaskState {
  switch (status) {
    case 'running':
      return 'running'
    case 'waiting':
      return 'waiting'
    case 'review':
      return 'review'
    case 'done':
      return 'success'
    case 'failed':
      return 'error'
    case 'aborted':
      return 'aborted'
    case undefined:
      return 'idle'
  }
}

function reportPositionChange(
  ref: React.MutableRefObject<(PastureAnimalPosition & { reportedAt: number }) | undefined>,
  onPositionChange: PastureAnimalProps['onPositionChange'],
  position: PastureAnimalPosition & { reportedAt: number }
): void {
  const previous = ref.current
  if (
    previous &&
    previous.mode === position.mode &&
    Math.abs(previous.xRatio - position.xRatio) < 0.02 &&
    position.reportedAt - previous.reportedAt < 500
  ) {
    return
  }

  ref.current = position
  onPositionChange?.({
    animalId: position.animalId,
    mode: position.mode,
    xRatio: position.xRatio
  })
}

function clampRatio(value: number): number {
  return Math.min(Math.max(value, 0), 1)
}

function getNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

export default PastureAnimal
