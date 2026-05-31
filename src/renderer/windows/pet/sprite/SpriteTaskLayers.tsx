import type {
  PetAnimalInstance,
  PetDimensions,
  PetPermissionPromptSnapshot,
  PetQueueReason,
  PetTaskBinding,
  PetTaskBubbleSnapshot,
  PetTaskStatus
} from '@shared/pet'
import { getPetDimensions, PET_DEFAULT_SCALE, PET_PASTURE_GROUND_BOTTOM_OFFSET, PET_WINDOW_HEIGHT } from '@shared/pet'
import { Check, ChevronDown, ChevronUp, ExternalLink, MessageSquareReply, ShieldAlert, X } from 'lucide-react'
import type { KeyboardEvent, PointerEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { dismissPetApproval, dismissPetTask, openPetTask } from '../presentation/petPresentationActions'
import { getPetTaskPreview } from '../presentation/petTaskPreview'
import type { PastureAnimalPosition } from './PastureAnimal'
import { getPetTaskBubblePresentation, type PetTaskBubbleTone } from './petTaskPresentation'
import {
  buildControlIslandQueueSummary,
  comparePetPanelPriority,
  type PetPanelSnapshot,
  type PetPanelStatus,
  type PetQueueSummary,
  type PetSourceGroupSnapshot
} from './spriteTaskUi'

export type PetSpriteSceneAnimal = Pick<
  PetAnimalInstance,
  'agentId' | 'createdAt' | 'enabled' | 'homeXRatio' | 'id' | 'name' | 'order' | 'packageId' | 'personality'
>

export type PetOverlayItem = {
  animalId: string
  anchorX: number
  anchorY: number
  priority: number
  status: PetTaskStatus
  summary: string
  taskKey: string
  title: string
  variant: 'bubble' | 'panel'
}

export type PetOverlayPlacement = {
  expanded: boolean
  item: PetOverlayItem
  rect: { height: number; width: number; x: number; y: number }
  side: 'left' | 'right' | 'top'
  x: number
  y: number
  zIndex: number
}

type PermissionPromptPlacement = {
  prompt: PetPermissionPromptSnapshot
  rect: { height: number; width: number; x: number; y: number }
  x: number
  y: number
  zIndex: number
}

type PetControlIslandDockedEdge = 'left' | 'right'

type PetControlIslandPlacement = {
  dockedEdge: PetControlIslandDockedEdge | null
  hidden: boolean
  x: number
  y: number
}

type PetControlIslandDragState = {
  moved: boolean
  pointerId: number
  startScreenX: number
  startScreenY: number
  startX: number
  startY: number
}

type PetControlIslandSummary = {
  approvalsWaiting: number
  failures: number
  sourceCount: number
  tasksQueued: number
  tasksRunning: number
  total: number
}

export type PetControlIslandGroup = {
  animalId: string
  highestPriority: number
  id: string
  sourceKey: string
  sourceTitle: string
  status: PetPanelStatus
  taskCount: number
  tasks: PetPanelSnapshot[]
  updatedAt: number
}

export type PetControlIslandViewModel = {
  groups: PetControlIslandGroup[]
  priorityPanel: PetPanelSnapshot | null
  selectedGroupId: string | null
  selectedPanelId: string | null
  summary: PetControlIslandSummary
}

const STATUS_BUBBLE_WIDTH = 92
const STATUS_BUBBLE_HEIGHT = 28
const PERMISSION_PANEL_WIDTH = 252
const PERMISSION_PANEL_MIN_HEIGHT = 112
const CONTROL_ISLAND_TOP = 36
const CONTROL_ISLAND_RIGHT = 12
const CONTROL_ISLAND_WIDTH = 304
const CONTROL_ISLAND_TAB_SIZE = 32
const CONTROL_ISLAND_EDGE_HIDE_THRESHOLD = 24
const CONTROL_ISLAND_MIN_TOP = 8
const CONTROL_ISLAND_BOTTOM_GAP = 8
const CONTROL_ISLAND_DRAG_THRESHOLD = 4
const CONTROL_ISLAND_MAX_VISIBLE_TASKS = 4
const CONTROL_ISLAND_AUTO_CLEAR_MS = 3200
const OVERLAY_TOP_PADDING = 4
const OVERLAY_SIDE_GAP = 18
const OPEN_PANEL_TRANSIENT_RETENTION_MS = 1200
const PET_TASK_STATUS_LABEL_KEYS: Record<PetTaskStatus, string> = {
  aborted: 'settings.pet.bubble.status.aborted',
  done: 'settings.pet.bubble.status.done',
  failed: 'settings.pet.bubble.status.failed',
  review: 'settings.pet.bubble.status.review',
  running: 'settings.pet.bubble.status.running',
  waiting: 'settings.pet.bubble.status.waiting'
}
const PET_QUEUE_REASON_LABEL_KEYS: Record<PetQueueReason, string> = {
  'bound-busy': 'settings.pet.queue.reason.bound-busy',
  'bound-disabled': 'settings.pet.queue.reason.bound-disabled',
  'no-enabled-pet': 'settings.pet.queue.reason.no-enabled-pet',
  'no-free-pet': 'settings.pet.queue.reason.no-free-pet'
}

export { getPetTaskPreview } from '../presentation/petTaskPreview'

export function getPetTaskOverlayPriority(status: PetTaskStatus): number {
  switch (status) {
    case 'waiting':
    case 'review':
      return 100
    case 'failed':
      return 90
    case 'running':
      return 70
    case 'done':
      return 40
    case 'aborted':
      return 30
  }
}

export function buildPetOverlayItems(input: {
  animals: PetSpriteSceneAnimal[]
  bindingByAnimalId: Map<string, PetTaskBinding>
  bubbleByAnimalId: Map<string, PetTaskBubbleSnapshot>
  livePositions: Map<string, PastureAnimalPosition>
  petDimensions?: PetDimensions
  stageWidth: number
}): PetOverlayItem[] {
  const petDimensions = input.petDimensions ?? getPetDimensions(PET_DEFAULT_SCALE)
  const maxLeft = Math.max(0, input.stageWidth - petDimensions.width)

  return input.animals
    .filter((animal) => animal.enabled)
    .map((animal) => {
      const task = input.bindingByAnimalId.get(animal.id) ?? input.bubbleByAnimalId.get(animal.id)
      if (!task || task.bubbleDismissed) return null
      const position = input.livePositions.get(animal.id)
      const xRatio = position?.xRatio ?? animal.homeXRatio
      const anchorX = Math.round(xRatio * maxLeft + petDimensions.width / 2)
      const anchorY = PET_WINDOW_HEIGHT - PET_PASTURE_GROUND_BOTTOM_OFFSET - petDimensions.height - 8

      return {
        animalId: animal.id,
        anchorX,
        anchorY,
        priority: getPetTaskOverlayPriority(task.status),
        status: task.status,
        summary: getPetTaskPreview(task),
        taskKey: task.taskKey,
        title: task.title,
        variant: hasPeekPanelValue(task) ? ('panel' as const) : ('bubble' as const)
      }
    })
    .filter((item): item is PetOverlayItem => Boolean(item))
    .sort((left, right) => right.priority - left.priority || left.anchorX - right.anchorX)
}

export function layoutPetOverlays(
  items: PetOverlayItem[],
  stageWidth: number,
  _openTaskKeys: ReadonlySet<string> = new Set()
): PetOverlayPlacement[] {
  void _openTaskKeys
  return items.map((item, index) => {
    const x = clamp(item.anchorX - STATUS_BUBBLE_WIDTH / 2, 4, stageWidth - STATUS_BUBBLE_WIDTH - 4)
    const y = Math.max(OVERLAY_TOP_PADDING, item.anchorY - STATUS_BUBBLE_HEIGHT)
    return {
      expanded: false,
      item,
      rect: { height: STATUS_BUBBLE_HEIGHT, width: STATUS_BUBBLE_WIDTH, x, y },
      side: 'top',
      x,
      y,
      zIndex: 120 + items.length - index
    }
  })
}

export function reconcileOpenTaskPanelKeys(input: {
  currentOpenKeys: ReadonlySet<string>
  liveTaskKeys: ReadonlySet<string>
  missingSinceByTaskKey: ReadonlyMap<string, number>
  now: number
  retentionMs?: number
}): { missingSinceByTaskKey: Map<string, number>; openKeys: Set<string> } {
  const retentionMs = input.retentionMs ?? OPEN_PANEL_TRANSIENT_RETENTION_MS
  const nextOpenKeys = new Set<string>()
  const nextMissingSince = new Map<string, number>()

  for (const taskKey of input.currentOpenKeys) {
    if (input.liveTaskKeys.has(taskKey)) {
      nextOpenKeys.add(taskKey)
      continue
    }

    const missingSince = input.missingSinceByTaskKey.get(taskKey) ?? input.now
    if (input.now - missingSince <= retentionMs) {
      nextOpenKeys.add(taskKey)
      nextMissingSince.set(taskKey, missingSince)
    }
  }

  return { missingSinceByTaskKey: nextMissingSince, openKeys: nextOpenKeys }
}

export function buildPetControlIslandViewModel(input: {
  panels: PetPanelSnapshot[]
  queueSummary: PetQueueSummary
  selectedTaskKey?: string | null
  sourceGroups?: PetSourceGroupSnapshot[]
}): PetControlIslandViewModel {
  const visiblePanels = [...input.panels].sort(comparePetPanelPriority)
  const groups = normalizePetControlIslandGroups(input.sourceGroups ?? [], visiblePanels)
  const priorityPanel =
    visiblePanels.find((panel) => panel.kind === 'permission') ??
    visiblePanels.find((panel) => panel.status === 'failed') ??
    null
  const selectedPanel = input.selectedTaskKey
    ? (visiblePanels.find((panel) => panel.taskKey === input.selectedTaskKey) ?? null)
    : null
  const selectedGroup =
    selectedPanel && groups.find((group) => group.tasks.some((task) => task.id === selectedPanel.id))

  return {
    groups,
    priorityPanel,
    selectedGroupId: selectedGroup?.id ?? null,
    selectedPanelId: selectedPanel?.id ?? null,
    summary: {
      approvalsWaiting: input.queueSummary.approvalsWaiting,
      failures: input.queueSummary.failures,
      sourceCount: groups.length,
      tasksQueued: input.queueSummary.tasksQueued,
      tasksRunning: input.queueSummary.tasksRunning,
      total:
        input.queueSummary.approvalsWaiting +
        input.queueSummary.failures +
        input.queueSummary.tasksQueued +
        input.queueSummary.tasksRunning
    }
  }
}

export function formatPetControlSourceTitle(
  group: PetControlIslandGroup,
  index: number,
  t: (key: string, options?: { count: number }) => string
): string {
  const taskTitle = group.tasks
    .map((task) => task.title.trim())
    .find((title) => !isGeneratedPetControlTitle(title, group.sourceKey))
  if (taskTitle) return taskTitle

  const sourceTitle = group.sourceTitle.trim()
  if (!isGeneratedPetControlTitle(sourceTitle, group.sourceKey)) return sourceTitle

  return t('settings.pet.controlIsland.taskGroup', { count: index + 1 })
}

export function PetSpriteTaskOverlayLayer({
  onSelectTask,
  placements
}: {
  onSelectTask: (taskKey: string) => void
  placements: PetOverlayPlacement[]
}) {
  if (!placements.length) return null

  return (
    <div aria-hidden={false} style={{ inset: 0, pointerEvents: 'none', position: 'absolute', zIndex: 110 }}>
      {placements.map((placement) => (
        <PetThoughtBubble key={`${placement.item.taskKey}:bubble`} onSelect={onSelectTask} placement={placement} />
      ))}
    </div>
  )
}

export function PetPermissionPromptLayer({
  prompts,
  stageWidth
}: {
  prompts: PetPermissionPromptSnapshot[]
  stageWidth: number
}) {
  const placements = useMemo(() => layoutPermissionPrompts(prompts, stageWidth), [prompts, stageWidth])
  if (!placements.length) return null

  return (
    <div aria-hidden={false} style={{ inset: 0, pointerEvents: 'none', position: 'absolute', zIndex: 220 }}>
      {placements.map((placement) => (
        <PetPermissionPromptPanel key={placement.prompt.approvalId} placement={placement} />
      ))}
    </div>
  )
}

export function PetSpriteControlIslandLayer({
  animals,
  dndEnabled,
  onSelectTask,
  panels,
  queueSummary,
  selectedTaskKey,
  sourceGroups = [],
  stageWidth
}: {
  animals: PetSpriteSceneAnimal[]
  dndEnabled: boolean
  onSelectTask?: (taskKey: string | null) => void
  panels: PetPanelSnapshot[]
  queueSummary: PetQueueSummary
  selectedTaskKey?: string | null
  sourceGroups?: PetSourceGroupSnapshot[]
  stageWidth: number
}) {
  const [hovered, setHovered] = useState(false)
  const [focusedWithin, setFocusedWithin] = useState(false)
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [revealBlocked, setRevealBlocked] = useState(false)
  const { t } = useTranslation()
  const visiblePanels = useMemo(() => {
    return panels.filter((panel) => panel.kind === 'permission' || !dndEnabled)
  }, [dndEnabled, panels])
  const visibleQueueSummary = useMemo(
    () => (dndEnabled ? buildControlIslandQueueSummary(visiblePanels) : queueSummary),
    [dndEnabled, queueSummary, visiblePanels]
  )
  const visibleSourceGroups = useMemo(
    () => (dndEnabled ? filterSourceGroupsByPanels(sourceGroups, visiblePanels) : sourceGroups),
    [dndEnabled, sourceGroups, visiblePanels]
  )
  const viewModel = useMemo(
    () =>
      buildPetControlIslandViewModel({
        panels: visiblePanels,
        queueSummary: visibleQueueSummary,
        selectedTaskKey,
        sourceGroups: visibleSourceGroups
      }),
    [selectedTaskKey, visiblePanels, visibleQueueSummary, visibleSourceGroups]
  )
  const enabledAnimalCount = animals.filter((animal) => animal.enabled).length
  const hasActivity = viewModel.summary.total > 0 || viewModel.groups.length > 0 || visiblePanels.length > 0
  const activeGroup =
    viewModel.groups.find((group) => group.id === (viewModel.selectedGroupId ?? activeGroupId)) ??
    viewModel.groups[0] ??
    null
  const islandWidth = Math.min(CONTROL_ISLAND_WIDTH, Math.max(216, stageWidth - CONTROL_ISLAND_RIGHT * 2))
  const [placement, setPlacement] = useState(() => loadControlIslandPlacement(stageWidth, islandWidth))
  const dragRef = useRef<PetControlIslandDragState | null>(null)
  const suppressNextIslandClickRef = useRef(false)
  const hidden = placement.hidden && placement.dockedEdge !== null
  const controlActive = (hovered && !revealBlocked) || focusedWithin || Boolean(selectedTaskKey) || dragging
  const showFullControl = !hidden || controlActive
  const expanded = controlActive
  const left = showFullControl
    ? getControlIslandFullX(placement, stageWidth, islandWidth)
    : getControlIslandTabX(placement, stageWidth)
  const controlWidth = showFullControl ? islandWidth : CONTROL_ISLAND_TAB_SIZE
  const priorityTone = viewModel.priorityPanel ? getPanelToneStyle(viewModel.priorityPanel.status) : null

  useEffect(() => {
    if (!selectedTaskKey || hovered || focusedWithin) return
    const timer = window.setTimeout(() => onSelectTask?.(null), CONTROL_ISLAND_AUTO_CLEAR_MS)
    return () => window.clearTimeout(timer)
  }, [focusedWithin, hovered, onSelectTask, selectedTaskKey])

  useEffect(() => {
    if (!activeGroupId) return
    if (!viewModel.groups.some((group) => group.id === activeGroupId)) setActiveGroupId(null)
  }, [activeGroupId, viewModel.groups])

  useEffect(() => {
    setPlacement((current) => clampControlIslandPlacement(current, stageWidth, islandWidth))
  }, [islandWidth, stageWidth])

  const startControlIslandDrag = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return
      event.stopPropagation()
      dragRef.current = {
        moved: false,
        pointerId: event.pointerId,
        startScreenX: getPointerScreenX(event),
        startScreenY: getPointerScreenY(event),
        startX: getControlIslandFullX(placement, stageWidth, islandWidth),
        startY: placement.y
      }
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        // Pointer capture can fail if the pointer is already released.
      }
    },
    [islandWidth, placement, stageWidth]
  )

  const moveControlIslandDrag = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      const deltaX = getPointerScreenX(event) - drag.startScreenX
      const deltaY = getPointerScreenY(event) - drag.startScreenY
      const moved =
        drag.moved ||
        Math.abs(deltaX) >= CONTROL_ISLAND_DRAG_THRESHOLD ||
        Math.abs(deltaY) >= CONTROL_ISLAND_DRAG_THRESHOLD
      if (!moved) return
      if (!drag.moved) {
        drag.moved = true
        setDragging(true)
      }
      setPlacement(
        clampControlIslandPlacement(
          {
            dockedEdge: null,
            hidden: false,
            x: drag.startX + deltaX,
            y: drag.startY + deltaY
          },
          stageWidth,
          islandWidth
        )
      )
    },
    [islandWidth, stageWidth]
  )

  const finishControlIslandDrag = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      const deltaX = getPointerScreenX(event) - drag.startScreenX
      const deltaY = getPointerScreenY(event) - drag.startScreenY
      const moved =
        drag.moved ||
        Math.abs(deltaX) >= CONTROL_ISLAND_DRAG_THRESHOLD ||
        Math.abs(deltaY) >= CONTROL_ISLAND_DRAG_THRESHOLD
      dragRef.current = null
      setDragging(false)
      if (!moved) return
      suppressNextIslandClickRef.current = true
      window.setTimeout(() => {
        suppressNextIslandClickRef.current = false
      }, 0)
      const nextPlacement = getSnappedControlIslandPlacement(
        drag.startX + deltaX,
        drag.startY + deltaY,
        stageWidth,
        islandWidth
      )
      if (nextPlacement.hidden) {
        setHovered(false)
        setFocusedWithin(false)
        setRevealBlocked(true)
        onSelectTask?.(null)
      } else {
        setRevealBlocked(false)
      }
      setPlacement(nextPlacement)
    },
    [islandWidth, onSelectTask, stageWidth]
  )

  const cancelControlIslandDrag = useCallback(() => {
    dragRef.current = null
    setDragging(false)
  }, [])

  const revealControlIsland = useCallback(() => {
    if (suppressNextIslandClickRef.current) {
      suppressNextIslandClickRef.current = false
      return
    }
    setPlacement((current) =>
      clampControlIslandPlacement(
        {
          dockedEdge: null,
          hidden: false,
          x: getControlIslandFullX(current, stageWidth, islandWidth),
          y: current.y
        },
        stageWidth,
        islandWidth
      )
    )
    setFocusedWithin(true)
  }, [islandWidth, stageWidth])

  if (!enabledAnimalCount && !hasActivity) return null

  if (hidden && !showFullControl) {
    return (
      <div aria-hidden={false} style={{ inset: 0, pointerEvents: 'none', position: 'absolute', zIndex: 8 }}>
        <section
          data-pet-hit-zone="true"
          data-testid="pet-control-island"
          aria-label={t('settings.pet.controlIsland.show')}
          onFocusCapture={() => setFocusedWithin(true)}
          onBlurCapture={(event) => {
            const nextTarget = event.relatedTarget instanceof Node ? event.relatedTarget : null
            if (nextTarget && event.currentTarget.contains(nextTarget)) return
            setFocusedWithin(false)
          }}
          onMouseEnter={() => {
            if (!revealBlocked) setHovered(true)
          }}
          onMouseLeave={() => {
            setHovered(false)
            setRevealBlocked(false)
          }}
          onPointerCancel={cancelControlIslandDrag}
          onPointerMove={moveControlIslandDrag}
          onPointerUp={finishControlIslandDrag}
          style={{
            ...controlIslandStyle,
            left,
            opacity: hasActivity ? 1 : 0.72,
            pointerEvents: 'auto',
            top: placement.y,
            width: controlWidth
          }}>
          <button
            type="button"
            data-testid="pet-control-island-tab"
            aria-label={t('settings.pet.controlIsland.show')}
            onClick={revealControlIsland}
            onPointerDown={startControlIslandDrag}
            style={{
              ...controlIslandTabButtonStyle,
              borderColor: priorityTone?.dot ?? 'var(--color-border, rgba(20,20,20,0.16))',
              color: priorityTone?.dot ?? 'var(--color-foreground-secondary, #4b5563)'
            }}
            title={t('settings.pet.controlIsland.show')}>
            <MessageSquareReply aria-hidden size={15} strokeWidth={2.2} />
          </button>
        </section>
      </div>
    )
  }

  return (
    <div aria-hidden={false} style={{ inset: 0, pointerEvents: 'none', position: 'absolute', zIndex: 8 }}>
      <section
        data-pet-hit-zone="true"
        data-testid="pet-control-island"
        aria-label={expanded ? t('settings.pet.controlIsland.collapse') : t('settings.pet.controlIsland.expand')}
        onFocusCapture={() => setFocusedWithin(true)}
        onBlurCapture={(event) => {
          const nextTarget = event.relatedTarget instanceof Node ? event.relatedTarget : null
          if (nextTarget && event.currentTarget.contains(nextTarget)) return
          setFocusedWithin(false)
          if (!hovered) onSelectTask?.(null)
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => {
          setHovered(false)
          if (!focusedWithin) onSelectTask?.(null)
        }}
        onPointerCancel={cancelControlIslandDrag}
        onPointerMove={moveControlIslandDrag}
        onPointerUp={finishControlIslandDrag}
        style={{
          ...controlIslandStyle,
          opacity: hasActivity ? 1 : 0.72,
          pointerEvents: 'auto',
          left,
          top: placement.y,
          width: controlWidth
        }}>
        <div style={controlIslandHeaderStyle}>
          <button
            type="button"
            data-testid="pet-control-island-handle"
            aria-label={expanded ? t('settings.pet.controlIsland.collapse') : t('settings.pet.controlIsland.expand')}
            onPointerDown={startControlIslandDrag}
            title={t('settings.pet.controlIsland.drag')}
            style={controlIslandSummaryButtonStyle}>
            <span
              style={{
                ...controlIslandBeaconStyle,
                background: priorityTone?.dot ?? 'linear-gradient(135deg, #43d6a3, #7fb3ff)'
              }}
            />
            <span style={{ ...oneLineTextStyle, flex: 1, fontWeight: 850 }}>
              {viewModel.priorityPanel?.kind === 'permission'
                ? viewModel.priorityPanel.toolName || viewModel.priorityPanel.title
                : hasActivity
                  ? formatControlIslandHeadline(viewModel.summary, t)
                  : t('settings.pet.controlIsland.sources', { count: enabledAnimalCount })}
            </span>
            <ControlIslandMetric
              label={t('settings.pet.controlIsland.sources', {
                count: viewModel.summary.sourceCount || enabledAnimalCount
              })}
              tone="source"
              value={viewModel.summary.sourceCount || enabledAnimalCount}
            />
            {viewModel.summary.approvalsWaiting ? (
              <ControlIslandMetric
                label={t('settings.pet.controlIsland.permission', { count: viewModel.summary.approvalsWaiting })}
                tone="permission"
                value={viewModel.summary.approvalsWaiting}
              />
            ) : null}
            {viewModel.summary.tasksRunning ? (
              <ControlIslandMetric
                label={t('settings.pet.controlIsland.running', { count: viewModel.summary.tasksRunning })}
                tone="running"
                value={viewModel.summary.tasksRunning}
              />
            ) : null}
            {viewModel.summary.tasksQueued ? (
              <ControlIslandMetric
                label={t('settings.pet.controlIsland.queued', { count: viewModel.summary.tasksQueued })}
                tone="queued"
                value={viewModel.summary.tasksQueued}
              />
            ) : null}
            {viewModel.summary.failures ? (
              <ControlIslandMetric
                label={t('settings.pet.controlIsland.failed', { count: viewModel.summary.failures })}
                tone="failed"
                value={viewModel.summary.failures}
              />
            ) : null}
            {expanded ? <ChevronUp aria-hidden size={14} /> : <ChevronDown aria-hidden size={14} />}
          </button>
        </div>

        {expanded ? (
          <div data-testid="pet-control-island-panel" style={controlIslandPanelStyle}>
            {viewModel.priorityPanel ? <PetControlPriorityPanel panel={viewModel.priorityPanel} /> : null}

            {viewModel.groups.length ? (
              <div style={controlIslandGroupsStyle}>
                {viewModel.groups.map((group, index) => (
                  <PetControlSourceGroup
                    active={activeGroup?.id === group.id}
                    key={group.id}
                    displayTitle={formatPetControlSourceTitle(group, index, t)}
                    group={group}
                    selectedPanelId={viewModel.selectedPanelId}
                    onActivate={() => setActiveGroupId(group.id)}
                  />
                ))}
              </div>
            ) : (
              <div style={controlIslandEmptyStyle}>No active pet tasks</div>
            )}

            {activeGroup ? (
              <PetControlGroupDetails
                group={activeGroup}
                priorityPanelId={viewModel.priorityPanel?.id ?? null}
                selectedPanelId={viewModel.selectedPanelId}
              />
            ) : null}

            {viewModel.summary.total ? <PetControlQueueSummary queueSummary={visibleQueueSummary} /> : null}
          </div>
        ) : null}
      </section>
    </div>
  )
}

function layoutPermissionPrompts(
  prompts: PetPermissionPromptSnapshot[],
  stageWidth: number
): PermissionPromptPlacement[] {
  const visiblePrompts = prompts.filter((prompt) => !prompt.dismissed)
  return visiblePrompts.map((prompt, index) => {
    const x = clamp(OVERLAY_SIDE_GAP + index * 12, 4, stageWidth - PERMISSION_PANEL_WIDTH - 4)
    const y = OVERLAY_TOP_PADDING + index * 10
    return {
      prompt,
      rect: {
        height: PERMISSION_PANEL_MIN_HEIGHT,
        width: PERMISSION_PANEL_WIDTH,
        x,
        y
      },
      x,
      y,
      zIndex: 240 + visiblePrompts.length - index
    }
  })
}

function hasPeekPanelValue(task: PetTaskBinding | PetTaskBubbleSnapshot): boolean {
  return Boolean(task.streamText || task.messages?.length || task.status === 'waiting' || task.status === 'review')
}

function normalizePetControlIslandGroups(
  sourceGroups: PetSourceGroupSnapshot[],
  panels: PetPanelSnapshot[]
): PetControlIslandGroup[] {
  const groups = sourceGroups.length
    ? sourceGroups.map((group) => ({
        animalId: group.animalId,
        highestPriority: group.highestPriority,
        id: group.id,
        sourceKey: group.sourceKey,
        sourceTitle: group.sourceTitle,
        status: group.status,
        taskCount: group.taskCount,
        tasks: [...group.tasks].sort(comparePetPanelPriority),
        updatedAt: group.updatedAt
      }))
    : buildFallbackControlIslandGroups(panels)

  return groups.sort(
    (left, right) =>
      right.highestPriority - left.highestPriority ||
      right.updatedAt - left.updatedAt ||
      left.id.localeCompare(right.id)
  )
}

function buildFallbackControlIslandGroups(panels: PetPanelSnapshot[]): PetControlIslandGroup[] {
  const bySource = new Map<string, PetPanelSnapshot[]>()
  for (const panel of panels) {
    const sourceKey = panel.source?.sourceKey ?? panel.animalId
    const tasks = bySource.get(sourceKey)
    if (tasks) {
      tasks.push(panel)
    } else {
      bySource.set(sourceKey, [panel])
    }
  }

  return [...bySource.entries()].map(([sourceKey, tasks]) => {
    const sortedTasks = [...tasks].sort(comparePetPanelPriority)
    const primary = sortedTasks[0]
    return {
      animalId: primary?.animalId ?? 'unknown',
      highestPriority: Math.max(...sortedTasks.map((task) => task.priority)),
      id: `source:${sourceKey}`,
      sourceKey,
      sourceTitle: primary?.source?.sourceTitle ?? primary?.title ?? sourceKey,
      status: primary?.status ?? 'done',
      taskCount: sortedTasks.length,
      tasks: sortedTasks,
      updatedAt: Math.max(...sortedTasks.map((task) => task.updatedAt))
    }
  })
}

function filterSourceGroupsByPanels(
  sourceGroups: PetSourceGroupSnapshot[],
  visiblePanels: PetPanelSnapshot[]
): PetSourceGroupSnapshot[] {
  if (!sourceGroups.length) return []
  const visibleIds = new Set(visiblePanels.map((panel) => panel.id))
  return sourceGroups
    .map((group) => {
      const tasks = group.tasks.filter((task) => visibleIds.has(task.id))
      if (!tasks.length) return null
      const sortedTasks = [...tasks].sort(comparePetPanelPriority)
      return {
        ...group,
        highestPriority: Math.max(...sortedTasks.map((task) => task.priority)),
        status: sortedTasks[0]?.status ?? group.status,
        taskCount: sortedTasks.length,
        tasks: sortedTasks,
        updatedAt: Math.max(...sortedTasks.map((task) => task.updatedAt))
      }
    })
    .filter((group): group is PetSourceGroupSnapshot => Boolean(group))
}

function getDefaultControlIslandPlacement(stageWidth: number, islandWidth: number): PetControlIslandPlacement {
  return {
    dockedEdge: null,
    hidden: false,
    x: Math.max(0, stageWidth - islandWidth - CONTROL_ISLAND_RIGHT),
    y: CONTROL_ISLAND_TOP
  }
}

function clampControlIslandPlacement(
  placement: PetControlIslandPlacement,
  stageWidth: number,
  islandWidth: number
): PetControlIslandPlacement {
  const maxX = Math.max(0, stageWidth - islandWidth)
  const maxY = Math.max(CONTROL_ISLAND_MIN_TOP, PET_WINDOW_HEIGHT - CONTROL_ISLAND_TAB_SIZE - CONTROL_ISLAND_BOTTOM_GAP)
  const dockedEdge = placement.hidden
    ? (placement.dockedEdge ?? (placement.x < stageWidth / 2 ? 'left' : 'right'))
    : null
  return {
    dockedEdge,
    hidden: Boolean(placement.hidden && dockedEdge),
    x: Math.min(maxX, Math.max(0, placement.x)),
    y: Math.min(maxY, Math.max(CONTROL_ISLAND_MIN_TOP, placement.y))
  }
}

function loadControlIslandPlacement(stageWidth: number, islandWidth: number): PetControlIslandPlacement {
  return getDefaultControlIslandPlacement(stageWidth, islandWidth)
}

function getControlIslandFullX(placement: PetControlIslandPlacement, stageWidth: number, islandWidth: number): number {
  if (placement.hidden && placement.dockedEdge === 'left') return 0
  if (placement.hidden && placement.dockedEdge === 'right') return Math.max(0, stageWidth - islandWidth)
  return placement.x
}

function getControlIslandTabX(placement: PetControlIslandPlacement, stageWidth: number): number {
  return placement.dockedEdge === 'right' ? Math.max(0, stageWidth - CONTROL_ISLAND_TAB_SIZE) : 0
}

function getSnappedControlIslandPlacement(
  x: number,
  y: number,
  stageWidth: number,
  islandWidth: number
): PetControlIslandPlacement {
  const clamped = clampControlIslandPlacement({ dockedEdge: null, hidden: false, x, y }, stageWidth, islandWidth)
  if (clamped.x <= CONTROL_ISLAND_EDGE_HIDE_THRESHOLD) {
    return { ...clamped, dockedEdge: 'left', hidden: true, x: 0 }
  }
  if (clamped.x + islandWidth >= stageWidth - CONTROL_ISLAND_EDGE_HIDE_THRESHOLD) {
    return { ...clamped, dockedEdge: 'right', hidden: true, x: Math.max(0, stageWidth - islandWidth) }
  }
  return clamped
}

const PET_CONTROL_UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

function isGeneratedPetControlTitle(title: string, sourceKey: string): boolean {
  const value = title.trim()
  if (!value) return true
  if (value.toLowerCase() === sourceKey.toLowerCase()) return true
  if (value.toLowerCase().startsWith('agent:')) return true
  if (/^agent\s+[0-9a-f-]{12,}$/i.test(value)) return true
  return PET_CONTROL_UUID_PATTERN.test(value)
}

function ControlIslandMetric({
  label,
  tone,
  value
}: {
  label: string
  tone: 'failed' | 'permission' | 'queued' | 'running' | 'source'
  value: number
}) {
  return (
    <span aria-label={label} title={label} style={{ ...controlIslandMetricStyle, ...getControlIslandMetricTone(tone) }}>
      {value}
    </span>
  )
}

function PetControlPriorityPanel({ panel }: { panel: PetPanelSnapshot }) {
  return (
    <div data-testid="pet-control-priority-panel" style={controlIslandPriorityStyle}>
      {panel.kind === 'permission' ? (
        <PetSourceGroupPermissionRow task={panel} />
      ) : (
        <PetSourceGroupRegularTaskRow task={panel} />
      )}
    </div>
  )
}

function PetControlSourceGroup({
  active,
  displayTitle,
  group,
  onActivate,
  selectedPanelId
}: {
  active: boolean
  displayTitle: string
  group: PetControlIslandGroup
  onActivate: () => void
  selectedPanelId: string | null
}) {
  const toneStyle = getPanelToneStyle(group.status)
  const counts = summarizePetPanels(group.tasks)
  const selected = selectedPanelId ? group.tasks.some((task) => task.id === selectedPanelId) : false
  return (
    <button
      type="button"
      data-testid={`pet-control-source-row-${toTestId(group.sourceKey)}`}
      onFocus={onActivate}
      onMouseEnter={onActivate}
      style={{
        ...controlIslandSourceRowStyle,
        background:
          active || selected ? 'var(--color-accent, rgba(15,23,42,0.06))' : controlIslandSourceRowStyle.background,
        borderColor:
          active || selected
            ? 'color-mix(in srgb, var(--color-border-active, var(--color-border)) 72%, transparent)'
            : 'var(--color-border-subtle, var(--color-border))',
        boxShadow: active || selected ? `inset 2px 0 0 ${toneStyle.dot}, 0 1px 0 rgba(255,255,255,0.42)` : 'none'
      }}>
      <span style={{ ...statusDotStyle, background: toneStyle.dot }} />
      <span style={{ ...oneLineTextStyle, flex: 1, fontWeight: 760, textAlign: 'left' }}>{displayTitle}</span>
      <span style={{ ...sourceCountPillStyle, background: 'rgba(90, 131, 170, 0.1)' }}>{group.taskCount}</span>
      {counts.waiting ? (
        <span style={{ ...sourceCountPillStyle, color: 'var(--color-warning)' }}>{counts.waiting}</span>
      ) : null}
      {counts.running ? <span style={{ ...sourceCountPillStyle, color: '#0a9b73' }}>{counts.running}</span> : null}
      {counts.queued ? <span style={{ ...sourceCountPillStyle, color: '#577da8' }}>{counts.queued}</span> : null}
    </button>
  )
}

function PetControlGroupDetails({
  group,
  priorityPanelId,
  selectedPanelId
}: {
  group: PetControlIslandGroup
  priorityPanelId: string | null
  selectedPanelId: string | null
}) {
  const detailTasks = priorityPanelId ? group.tasks.filter((task) => task.id !== priorityPanelId) : group.tasks
  const visibleTasks = detailTasks.slice(0, CONTROL_ISLAND_MAX_VISIBLE_TASKS)
  const hiddenCount = Math.max(0, detailTasks.length - visibleTasks.length)
  if (!visibleTasks.length && !hiddenCount) return null

  return (
    <div data-testid={`pet-control-group-details-${toTestId(group.sourceKey)}`} style={controlIslandTaskListStyle}>
      {visibleTasks.map((task) => (
        <div
          key={task.id}
          data-testid={`pet-control-task-row-${toTestId(task.id)}`}
          style={{
            outline:
              selectedPanelId === task.id
                ? '1px solid color-mix(in srgb, var(--color-primary) 48%, transparent)'
                : 'none',
            borderRadius: 8
          }}>
          <PetSourceGroupTaskRow task={task} />
        </div>
      ))}
      {hiddenCount ? <div style={controlIslandMoreStyle}>+{hiddenCount}</div> : null}
    </div>
  )
}

function PetControlQueueSummary({ queueSummary }: { queueSummary: PetQueueSummary }) {
  const { t } = useTranslation()
  const labels = [
    queueSummary.approvalsWaiting
      ? formatCountLabel(
          t('settings.pet.queue.approvals_waiting', { count: queueSummary.approvalsWaiting }),
          queueSummary.approvalsWaiting
        )
      : null,
    queueSummary.tasksQueued
      ? formatCountLabel(
          t('settings.pet.queue.tasks_queued', { count: queueSummary.tasksQueued }),
          queueSummary.tasksQueued
        )
      : null,
    queueSummary.tasksRunning
      ? formatCountLabel(
          t('settings.pet.queue.tasks_running', { count: queueSummary.tasksRunning }),
          queueSummary.tasksRunning
        )
      : null,
    queueSummary.failures
      ? formatCountLabel(t('settings.pet.queue.failures', { count: queueSummary.failures }), queueSummary.failures)
      : null
  ].filter((label): label is string => Boolean(label))

  return (
    <div data-testid="pet-control-queue" style={controlIslandQueueStyle}>
      <div style={{ color: 'var(--color-foreground-muted, #697586)', fontSize: 10.5, fontWeight: 800 }}>
        {labels.join(' / ')}
      </div>
      {queueSummary.items.length ? (
        <div style={{ display: 'grid', gap: 4, marginTop: 5 }}>
          {queueSummary.items.slice(0, CONTROL_ISLAND_MAX_VISIBLE_TASKS).map((item) => (
            <div key={item.id} style={{ alignItems: 'center', display: 'flex', gap: 6, minWidth: 0 }}>
              <span style={{ ...statusDotStyle, background: getPanelToneStyle(item.status).dot }} />
              <span style={{ ...oneLineTextStyle, color: 'var(--color-foreground-secondary, #4b5563)', fontSize: 11 }}>
                {item.title}
                {item.queueReason ? ` - ${getQueueReasonLabel(item.queueReason, t)}` : ''}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function PetSourceGroupTaskRow({ task }: { task: PetPanelSnapshot }) {
  if (task.kind === 'permission') return <PetSourceGroupPermissionRow task={task} />
  return <PetSourceGroupRegularTaskRow task={task} />
}

function PetSourceGroupRegularTaskRow({ task }: { task: PetPanelSnapshot }) {
  const toneStyle = getPanelToneStyle(task.status)
  const presentation = getPanelPresentation(task.status)
  const { t } = useTranslation()
  const openLabel = t('settings.pet.controlIsland.openTask', { title: task.title })
  const dismissLabel = t('settings.pet.controlIsland.dismissTask', { title: task.title })
  const openTask = useCallback(() => void openPetTask(task.taskKey), [task.taskKey])
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget) return
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      openTask()
    },
    [openTask]
  )

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={openLabel}
      onClick={openTask}
      onKeyDown={handleKeyDown}
      style={{ ...sourceTaskRowStyle, cursor: 'pointer' }}>
      <span style={{ ...statusDotStyle, background: toneStyle.dot, marginTop: 5 }} />
      <div style={{ display: 'grid', flex: 1, minWidth: 0 }}>
        <div style={{ ...oneLineTextStyle, fontWeight: 700 }}>{task.title}</div>
        <div style={{ ...oneLineTextStyle, color: toneStyle.text, fontSize: 11 }}>{presentation}</div>
      </div>
      <div style={{ display: 'flex', flex: '0 0 auto', gap: 4 }}>
        <button
          type="button"
          aria-label={dismissLabel}
          onClick={(event) => {
            event.stopPropagation()
            void dismissPetTask(task.taskKey)
          }}
          title={dismissLabel}
          style={permissionIconButtonStyle}>
          <X aria-hidden size={13} strokeWidth={2.1} />
        </button>
      </div>
    </div>
  )
}

function PetSourceGroupPermissionRow({ task }: { task: PetPanelSnapshot }) {
  const [responding, setResponding] = useState(false)
  const { t } = useTranslation()
  const openLabel = t('settings.pet.controlIsland.openTask', { title: task.title })
  const respond = useCallback(
    async (approved: boolean) => {
      if (responding || !task.approvalId || !task.sessionId || !task.toolCallId) return
      setResponding(true)
      try {
        await window.api.ai.toolApproval.respond({
          approvalId: task.approvalId,
          approved,
          ...(approved ? {} : { reason: t('settings.pet.permission.deny_reason') }),
          topicId: `agent-session:${task.sessionId}`,
          anchorId: task.toolCallId
        })
      } finally {
        setResponding(false)
      }
    },
    [responding, t, task.approvalId, task.sessionId, task.toolCallId]
  )
  const openTask = useCallback(() => void openPetTask(task.taskKey), [task.taskKey])
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget) return
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      openTask()
    },
    [openTask]
  )

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={openLabel}
      onClick={openTask}
      onKeyDown={handleKeyDown}
      style={{
        ...sourceTaskRowStyle,
        borderColor: 'color-mix(in srgb, var(--color-warning) 35%, var(--color-border-subtle, var(--color-border)))',
        cursor: 'pointer'
      }}>
      <ShieldAlert aria-hidden color="var(--color-warning)" size={15} strokeWidth={2.2} style={{ marginTop: 3 }} />
      <div style={{ display: 'grid', flex: 1, gap: 3, minWidth: 0 }}>
        <div style={{ ...oneLineTextStyle, fontWeight: 800 }}>{t('settings.pet.permission.title')}</div>
        <div style={{ ...oneLineTextStyle, color: 'var(--color-foreground-muted, #697586)', fontSize: 11 }}>
          {task.toolName || task.title}
        </div>
        <div style={{ ...permissionPreviewStyle, maxHeight: 38 }}>{task.safePreview || task.summary}</div>
      </div>
      <div style={{ display: 'flex', flex: '0 0 auto', gap: 4 }}>
        <button
          type="button"
          aria-label={t('settings.pet.permission.deny')}
          disabled={responding}
          onClick={(event) => {
            event.stopPropagation()
            void respond(false)
          }}
          title={t('settings.pet.permission.deny')}
          style={permissionIconButtonStyle}>
          <X aria-hidden size={13} strokeWidth={2.1} />
        </button>
        <button
          type="button"
          aria-label={t('settings.pet.permission.allow_once')}
          disabled={responding}
          onClick={(event) => {
            event.stopPropagation()
            void respond(true)
          }}
          title={t('settings.pet.permission.allow_once')}
          style={permissionIconButtonStyle}>
          <Check aria-hidden size={13} strokeWidth={2.1} />
        </button>
      </div>
    </div>
  )
}

function PetPermissionPromptPanel({ placement }: { placement: PermissionPromptPlacement }) {
  const { prompt } = placement
  const [responding, setResponding] = useState(false)
  const { t } = useTranslation()
  const allowOnceLabel = t('settings.pet.permission.allow_once')
  const denyLabel = t('settings.pet.permission.deny')
  const dismissLabel = t('settings.pet.permission.dismiss')
  const openInCherryLabel = t('settings.pet.permission.open_in_cherry')

  const respond = useCallback(
    async (approved: boolean) => {
      if (responding) return
      setResponding(true)
      try {
        await window.api.ai.toolApproval.respond({
          approvalId: prompt.approvalId,
          approved,
          ...(approved ? {} : { reason: 'Denied from pet permission prompt' }),
          topicId: `agent-session:${prompt.sessionId}`,
          anchorId: prompt.toolCallId
        })
      } finally {
        setResponding(false)
      }
    },
    [prompt.approvalId, prompt.sessionId, prompt.toolCallId, responding]
  )

  return (
    <div
      data-pet-hit-zone="true"
      data-pet-permission-prompt="true"
      data-testid={`pet-permission-prompt-${toTestId(prompt.approvalId)}`}
      onPointerDown={(event) => event.stopPropagation()}
      style={{
        background: 'var(--color-glass, rgba(255,255,255,0.96))',
        border: '1px solid var(--color-warning-border, var(--color-glass-border, rgba(20,20,20,0.16)))',
        borderRadius: 8,
        boxShadow: '0 14px 34px rgba(15,23,42,0.2)',
        color: 'var(--color-foreground, #1f2933)',
        fontSize: 12,
        left: placement.x,
        lineHeight: 1.35,
        minHeight: PERMISSION_PANEL_MIN_HEIGHT,
        padding: 10,
        pointerEvents: 'auto',
        position: 'absolute',
        top: placement.y,
        width: PERMISSION_PANEL_WIDTH,
        zIndex: placement.zIndex
      }}>
      <div style={{ display: 'grid', gap: 8 }}>
        <div style={{ alignItems: 'center', display: 'flex', gap: 7, minWidth: 0, paddingRight: 20 }}>
          <ShieldAlert aria-hidden color="var(--color-warning)" size={15} strokeWidth={2.2} />
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontWeight: 700,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}>
              {prompt.toolName}
            </div>
            <div
              style={{
                color: 'var(--color-foreground-muted, #697586)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}>
              {prompt.title}
            </div>
          </div>
        </div>
        <div
          style={{
            background: 'var(--color-muted, rgba(15,23,42,0.06))',
            border: '1px solid var(--color-border-subtle, var(--color-border))',
            borderRadius: 6,
            color: 'var(--color-foreground-secondary, #4b5563)',
            fontFamily: 'var(--font-family-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
            maxHeight: 52,
            overflow: 'hidden',
            padding: '6px 7px',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word'
          }}>
          {prompt.safePreview}
        </div>
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <button
            type="button"
            aria-label={openInCherryLabel}
            onClick={() => void openPetTask(prompt.taskKey)}
            style={permissionIconButtonStyle}>
            <ExternalLink aria-hidden size={13} strokeWidth={2.1} />
          </button>
          <button
            type="button"
            disabled={responding}
            onClick={() => void respond(false)}
            style={permissionSecondaryButtonStyle}>
            <X aria-hidden size={13} strokeWidth={2.1} />
            <span>{denyLabel}</span>
          </button>
          <button
            type="button"
            disabled={responding}
            onClick={() => void respond(true)}
            style={permissionPrimaryButtonStyle}>
            <Check aria-hidden size={13} strokeWidth={2.1} />
            <span>{allowOnceLabel}</span>
          </button>
        </div>
      </div>
      <button
        type="button"
        aria-label={dismissLabel}
        onClick={() => void dismissPetApproval(prompt.approvalId)}
        style={overlayDismissButtonStyle}>
        <X aria-hidden size={12} strokeWidth={2.1} />
      </button>
    </div>
  )
}

function PetThoughtBubble({
  onSelect,
  placement
}: {
  onSelect: (taskKey: string) => void
  placement: PetOverlayPlacement
}) {
  const presentation = getPetTaskBubblePresentation(placement.item.status)
  const toneStyle = getOverlayToneStyle(presentation.tone)
  const { t } = useTranslation()
  const statusLabel = t(PET_TASK_STATUS_LABEL_KEYS[placement.item.status])

  return (
    <button
      type="button"
      data-pet-hit-zone="true"
      data-pet-thought-bubble="true"
      data-testid={`pet-thought-bubble-${toTestId(placement.item.taskKey)}`}
      aria-label={placement.item.title}
      onClick={() => onSelect(placement.item.taskKey)}
      style={{
        alignItems: 'center',
        background:
          'linear-gradient(180deg, color-mix(in srgb, var(--color-glass, rgba(255,255,255,0.96)) 94%, transparent), var(--color-glass, rgba(255,255,255,0.91)))',
        border: '1px solid var(--color-glass-border, rgba(20,20,20,0.16))',
        borderRadius: 999,
        boxShadow: '0 7px 18px rgba(15,23,42,0.13)',
        color: toneStyle.text,
        cursor: 'pointer',
        display: 'flex',
        gap: 5,
        height: STATUS_BUBBLE_HEIGHT,
        justifyContent: 'flex-start',
        left: placement.x,
        padding: '0 8px',
        pointerEvents: 'auto',
        position: 'absolute',
        top: placement.y,
        transform: 'translateY(0)',
        transition: 'transform 140ms ease, box-shadow 140ms ease',
        width: placement.rect.width,
        zIndex: placement.zIndex
      }}>
      {placement.item.status === 'running' ? (
        <ThinkingDots />
      ) : (
        <span style={{ ...statusDotStyle, background: toneStyle.dot }} />
      )}
      <span style={{ ...oneLineTextStyle, flex: 1, fontSize: 10.5, fontWeight: 800, letterSpacing: 0 }}>
        {statusLabel}
      </span>
    </button>
  )
}

function ThinkingDots() {
  return (
    <span aria-hidden style={{ display: 'inline-flex', gap: 2 }}>
      <span style={thinkingDotStyle} />
      <span style={{ ...thinkingDotStyle, opacity: 0.72 }} />
      <span style={{ ...thinkingDotStyle, opacity: 0.44 }} />
    </span>
  )
}

function getOverlayToneStyle(tone: PetTaskBubbleTone): { dot: string; text: string } {
  switch (tone) {
    case 'info':
      return { dot: 'var(--color-info)', text: 'var(--color-info-text, var(--color-info))' }
    case 'warning':
      return { dot: 'var(--color-warning)', text: 'var(--color-warning-text, var(--color-warning))' }
    case 'success':
      return { dot: 'var(--color-success)', text: 'var(--color-success-text, var(--color-success))' }
    case 'error':
      return { dot: 'var(--color-destructive)', text: 'var(--color-error-text, var(--color-destructive))' }
    case 'neutral':
      return { dot: 'var(--color-foreground-muted, #697586)', text: 'var(--color-foreground-secondary, #4b5563)' }
  }
}

function getPanelToneStyle(status: PetPanelStatus): { dot: string; text: string } {
  switch (status) {
    case 'pending':
    case 'waiting':
      return { dot: 'var(--color-warning)', text: 'var(--color-warning-text, var(--color-warning))' }
    case 'failed':
      return { dot: 'var(--color-destructive)', text: 'var(--color-error-text, var(--color-destructive))' }
    case 'review':
    case 'running':
    case 'queued':
      return { dot: 'var(--color-info)', text: 'var(--color-info-text, var(--color-info))' }
    case 'done':
      return { dot: 'var(--color-success)', text: 'var(--color-success-text, var(--color-success))' }
    case 'aborted':
      return { dot: 'var(--color-foreground-muted, #697586)', text: 'var(--color-foreground-secondary, #4b5563)' }
  }
}

function getPanelPresentation(status: PetPanelStatus): string {
  switch (status) {
    case 'pending':
      return 'Approval needed'
    case 'queued':
      return 'Queued'
    case 'running':
      return 'Running'
    case 'waiting':
      return 'Waiting'
    case 'review':
      return 'Reviewing'
    case 'done':
      return 'Ready'
    case 'failed':
      return 'Failed'
    case 'aborted':
      return 'Stopped'
  }
}

function getQueueReasonLabel(
  reason: PetQueueReason,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  return t(PET_QUEUE_REASON_LABEL_KEYS[reason])
}

function formatControlIslandHeadline(
  summary: PetControlIslandSummary,
  t: (key: string, options?: { count: number }) => string
): string {
  if (summary.approvalsWaiting) {
    return t('settings.pet.controlIsland.permission', { count: summary.approvalsWaiting })
  }
  if (summary.failures) {
    return t('settings.pet.controlIsland.failed', { count: summary.failures })
  }
  if (summary.tasksRunning) {
    return t('settings.pet.controlIsland.running', { count: summary.tasksRunning })
  }
  if (summary.tasksQueued) {
    return t('settings.pet.controlIsland.queued', { count: summary.tasksQueued })
  }
  return t('settings.pet.controlIsland.sources', { count: summary.sourceCount })
}

function summarizePetPanels(tasks: PetPanelSnapshot[]): { queued: number; running: number; waiting: number } {
  return tasks.reduce(
    (summary, task) => {
      if (task.kind === 'permission' || task.status === 'pending' || task.status === 'waiting') {
        summary.waiting += 1
      } else if (task.status === 'running' || task.status === 'review') {
        summary.running += 1
      } else if (task.status === 'queued') {
        summary.queued += 1
      }
      return summary
    },
    { queued: 0, running: 0, waiting: 0 }
  )
}

function getControlIslandMetricTone(tone: 'failed' | 'permission' | 'queued' | 'running' | 'source') {
  switch (tone) {
    case 'permission':
      return {
        background: 'color-mix(in srgb, var(--color-warning) 18%, transparent)',
        borderColor: 'color-mix(in srgb, var(--color-warning) 42%, transparent)',
        color: 'var(--color-warning-text, var(--color-warning))'
      }
    case 'failed':
      return {
        background: 'color-mix(in srgb, var(--color-destructive) 14%, transparent)',
        borderColor: 'color-mix(in srgb, var(--color-destructive) 38%, transparent)',
        color: 'var(--color-error-text, var(--color-destructive))'
      }
    case 'running':
      return {
        background: 'rgba(39, 190, 147, 0.14)',
        borderColor: 'rgba(39, 190, 147, 0.34)',
        color: '#0a8f6d'
      }
    case 'queued':
      return {
        background: 'rgba(99, 132, 176, 0.14)',
        borderColor: 'rgba(99, 132, 176, 0.34)',
        color: '#557aa4'
      }
    case 'source':
      return {
        background: 'rgba(45, 64, 84, 0.08)',
        borderColor: 'rgba(45, 64, 84, 0.18)',
        color: 'var(--color-foreground-secondary, #4b5563)'
      }
  }
}

function getPointerScreenX(event: PointerEvent<HTMLElement>): number {
  const x = Number.isFinite(event.screenX) ? event.screenX : event.clientX
  return Number.isFinite(x) ? x : 0
}

function getPointerScreenY(event: PointerEvent<HTMLElement>): number {
  const y = Number.isFinite(event.screenY) ? event.screenY : event.clientY
  return Number.isFinite(y) ? y : 0
}

function formatCountLabel(label: string, count: number): string {
  return label.replace('{{count}}', String(count))
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

function toTestId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '')
}

const statusDotStyle = {
  borderRadius: 999,
  flex: '0 0 auto',
  height: 7,
  width: 7
}

const thinkingDotStyle = {
  background: 'currentColor',
  borderRadius: 999,
  height: 4,
  width: 4
}

const controlIslandStyle = {
  background: 'transparent',
  border: 'none',
  borderRadius: 0,
  boxShadow: 'none',
  color: 'var(--color-foreground, #1f2933)',
  fontSize: 12,
  lineHeight: 1.25,
  padding: 0,
  position: 'absolute' as const,
  transition: 'opacity 150ms ease, transform 150ms ease'
}

const controlIslandHeaderStyle = {
  minWidth: 0
}

const controlIslandSummaryButtonStyle = {
  alignItems: 'center',
  background: 'color-mix(in srgb, var(--color-popover, #fff) 94%, transparent)',
  border: '1px solid var(--color-border, rgba(20,20,20,0.16))',
  borderRadius: 999,
  boxShadow: '0 8px 22px rgba(24, 40, 58, 0.13), inset 0 1px 0 rgba(255,255,255,0.58)',
  color: 'inherit',
  cursor: 'grab',
  display: 'flex',
  font: 'inherit',
  gap: 6,
  height: 30,
  minWidth: 0,
  padding: '0 7px 0 9px',
  textAlign: 'left' as const,
  width: '100%'
}

const controlIslandTabButtonStyle = {
  alignItems: 'center',
  background: 'color-mix(in srgb, var(--color-popover, #fff) 94%, transparent)',
  border: '1px solid var(--color-border, rgba(20,20,20,0.16))',
  borderRadius: 999,
  boxShadow: '0 8px 20px rgba(24, 40, 58, 0.15), inset 0 1px 0 rgba(255,255,255,0.58)',
  cursor: 'grab',
  display: 'inline-flex',
  height: CONTROL_ISLAND_TAB_SIZE,
  justifyContent: 'center',
  padding: 0,
  width: CONTROL_ISLAND_TAB_SIZE
}

const controlIslandBeaconStyle = {
  borderRadius: 999,
  boxShadow: '0 0 0 3px rgba(255,255,255,0.55)',
  flex: '0 0 auto',
  height: 9,
  width: 9
}

const controlIslandMetricStyle = {
  alignItems: 'center',
  border: '1px solid transparent',
  borderRadius: 999,
  display: 'inline-flex',
  flex: '0 0 auto',
  fontSize: 10,
  fontWeight: 850,
  height: 17,
  justifyContent: 'center',
  minWidth: 17,
  padding: '0 4px'
}

const controlIslandPanelStyle = {
  background: 'color-mix(in srgb, var(--color-popover, #fff) 96%, transparent)',
  border: '1px solid var(--color-border, rgba(20,20,20,0.16))',
  borderRadius: 8,
  boxShadow: '0 14px 30px rgba(24, 40, 58, 0.16), inset 0 1px 0 rgba(255,255,255,0.48)',
  display: 'grid',
  gap: 5,
  marginTop: 6,
  maxHeight: 122,
  overflow: 'hidden',
  padding: 6
}

const controlIslandPriorityStyle = {
  display: 'grid',
  gap: 4
}

const controlIslandGroupsStyle = {
  display: 'grid',
  gap: 3
}

const controlIslandSourceRowStyle = {
  alignItems: 'center',
  background: 'transparent',
  border: '1px solid transparent',
  borderRadius: 6,
  color: 'inherit',
  cursor: 'pointer',
  display: 'flex',
  font: 'inherit',
  gap: 6,
  minHeight: 25,
  minWidth: 0,
  padding: '3px 5px',
  transition: 'background-color 140ms ease, border-color 140ms ease, box-shadow 140ms ease'
}

const controlIslandTaskListStyle = {
  display: 'grid',
  gap: 3,
  maxHeight: 88,
  overflow: 'auto'
}

const controlIslandQueueStyle = {
  borderTop: '1px solid var(--color-border-subtle, var(--color-border))',
  display: 'grid',
  gap: 3,
  paddingTop: 5
}

const controlIslandEmptyStyle = {
  color: 'var(--color-foreground-muted, #697586)',
  fontSize: 11,
  padding: '5px 7px'
}

const controlIslandMoreStyle = {
  alignSelf: 'center',
  color: 'var(--color-foreground-muted, #697586)',
  fontSize: 11,
  fontWeight: 800,
  justifySelf: 'end',
  padding: '0 5px'
}

const sourceCountPillStyle = {
  alignItems: 'center',
  background: 'var(--color-secondary, var(--color-muted))',
  border: '1px solid var(--color-border-subtle, var(--color-border))',
  borderRadius: 999,
  color: 'var(--color-foreground-secondary, #4b5563)',
  display: 'inline-flex',
  flex: '0 0 auto',
  fontSize: 10,
  fontWeight: 800,
  height: 18,
  justifyContent: 'center',
  minWidth: 18,
  padding: '0 5px'
}

const sourceTaskRowStyle = {
  alignItems: 'flex-start',
  background: 'transparent',
  border: '1px solid transparent',
  borderRadius: 6,
  display: 'flex',
  gap: 6,
  minWidth: 0,
  padding: '4px 5px'
}

const oneLineTextStyle = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap' as const
}

const permissionPreviewStyle = {
  background: 'var(--color-muted, rgba(15,23,42,0.06))',
  border: '1px solid var(--color-border-subtle, var(--color-border))',
  borderRadius: 6,
  color: 'var(--color-foreground-secondary, #4b5563)',
  fontFamily: 'var(--font-family-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
  maxHeight: 52,
  overflow: 'hidden',
  padding: '6px 7px',
  whiteSpace: 'pre-wrap' as const,
  wordBreak: 'break-word' as const
}

const overlayDismissButtonStyle = {
  alignItems: 'center',
  background: 'transparent',
  border: 'none',
  borderRadius: 5,
  color: 'var(--color-foreground-muted, #697586)',
  cursor: 'pointer',
  display: 'flex',
  height: 18,
  justifyContent: 'center',
  padding: 0,
  position: 'absolute' as const,
  right: 5,
  top: 5,
  width: 18
}

const permissionIconButtonStyle = {
  alignItems: 'center',
  background: 'transparent',
  border: '1px solid transparent',
  borderRadius: 5,
  color: 'var(--color-foreground-secondary, #4b5563)',
  cursor: 'pointer',
  display: 'inline-flex',
  height: 22,
  justifyContent: 'center',
  padding: 0,
  width: 22
}

const permissionSecondaryButtonStyle = {
  alignItems: 'center',
  background: 'var(--color-secondary, var(--color-muted))',
  border: '1px solid var(--color-border-subtle, var(--color-border))',
  borderRadius: 6,
  color: 'var(--color-foreground-secondary, #4b5563)',
  cursor: 'pointer',
  display: 'inline-flex',
  font: 'inherit',
  fontWeight: 600,
  gap: 3,
  height: 24,
  padding: '0 8px'
}

const permissionPrimaryButtonStyle = {
  alignItems: 'center',
  background: 'var(--color-primary)',
  border: 'none',
  borderRadius: 6,
  color: 'var(--color-primary-foreground)',
  cursor: 'pointer',
  display: 'inline-flex',
  font: 'inherit',
  fontWeight: 700,
  gap: 3,
  height: 24,
  padding: '0 8px'
}
