import type { AgentPresentationEvent } from '@shared/ai/agentPresentationEvents'
import {
  PET_PASTURE_DEFAULT_WIDTH,
  type PetAnimalInstance,
  type PetPackageInfo,
  type PetPastureBounds,
  type PetPastureSnapshot,
  type PetPermissionPromptSnapshot,
  type PetTaskBinding,
  type PetTaskBubbleSnapshot
} from '@shared/pet'

import { applyAgentPresentationEventToPetSnapshot } from './petAgentPresentationRuntime'
import type { PetPresentationAction } from './petPresentationActions'

const PET_PRESENTATION_REPLAY_LIMIT = 200

export const EMPTY_PET_PASTURE_SNAPSHOT: PetPastureSnapshot = {
  packages: [],
  animals: [],
  bindings: [],
  bubbles: [],
  permissionPrompts: [],
  queuedTasks: [],
  bounds: {
    x: -1,
    y: -1,
    width: PET_PASTURE_DEFAULT_WIDTH
  }
}

export type PetPresentationTaskStage = 'active' | 'bubble' | 'queued'

export type PetPresentationTaskRecord = {
  stage: PetPresentationTaskStage
  task: PetTaskBinding | PetTaskBubbleSnapshot
}

type PetPresentationEventBase<TType extends string> = {
  emittedAt: number
  id: string
  sequence: number
  source: 'agent-presentation' | 'pet-action' | 'pet-snapshot'
  type: TType
}

export type PetPresentationEvent =
  | (PetPresentationEventBase<'snapshot.seeded'> & { snapshot: PetPastureSnapshot })
  | (PetPresentationEventBase<'snapshot.updated'> & { snapshot: PetPastureSnapshot })
  | (PetPresentationEventBase<'packages.changed'> & { packages: PetPackageInfo[] })
  | (PetPresentationEventBase<'animals.changed'> & { animals: PetAnimalInstance[] })
  | (PetPresentationEventBase<'bounds.changed'> & { bounds: PetPastureBounds })
  | (PetPresentationEventBase<'task.started'> & { record: PetPresentationTaskRecord })
  | (PetPresentationEventBase<'task.queued'> & { record: PetPresentationTaskRecord })
  | (PetPresentationEventBase<'task.updated'> & {
      previous: PetPresentationTaskRecord
      record: PetPresentationTaskRecord
    })
  | (PetPresentationEventBase<'task.completed'> & {
      previous?: PetPresentationTaskRecord
      record: PetPresentationTaskRecord
    })
  | (PetPresentationEventBase<'task.removed'> & { record: PetPresentationTaskRecord; taskKey: string })
  | (PetPresentationEventBase<'approval.requested'> & { prompt: PetPermissionPromptSnapshot })
  | (PetPresentationEventBase<'approval.updated'> & {
      previous: PetPermissionPromptSnapshot
      prompt: PetPermissionPromptSnapshot
    })
  | (PetPresentationEventBase<'approval.resolved'> & { approvalId: string; prompt: PetPermissionPromptSnapshot })

export type PetPresentationRuntimeState = {
  events: PetPresentationEvent[]
  lastEvents: PetPresentationEvent[]
  seeded: boolean
  sequence: number
  snapshot: PetPastureSnapshot
}

export function createPetPresentationRuntimeState(
  snapshot: PetPastureSnapshot = EMPTY_PET_PASTURE_SNAPSHOT
): PetPresentationRuntimeState {
  return {
    events: [],
    lastEvents: [],
    seeded: false,
    sequence: 0,
    snapshot
  }
}

export function updatePetPresentationRuntimeState(
  state: PetPresentationRuntimeState,
  snapshot: PetPastureSnapshot
): PetPresentationRuntimeState {
  const events = state.seeded
    ? buildPetPresentationEvents(state.snapshot, snapshot, state.sequence, 'pet-snapshot')
    : [createPetPresentationEvent(state.sequence + 1, 'snapshot.seeded', { snapshot }, 'pet-snapshot')]
  const sequence = events.at(-1)?.sequence ?? state.sequence

  return {
    events: appendReplayEvents(state.events, events),
    lastEvents: events,
    seeded: true,
    sequence,
    snapshot
  }
}

export function updatePetPresentationRuntimeStateFromAgentEvent(
  state: PetPresentationRuntimeState,
  event: AgentPresentationEvent
): PetPresentationRuntimeState {
  const snapshot = applyAgentPresentationEventToPetSnapshot(state.snapshot, event)
  const events = buildPetPresentationEvents(state.snapshot, snapshot, state.sequence, 'agent-presentation')
  if (events.length === 0) return state
  const sequence = events.at(-1)?.sequence ?? state.sequence

  return {
    events: appendReplayEvents(state.events, events),
    lastEvents: events,
    seeded: true,
    sequence,
    snapshot
  }
}

export function updatePetPresentationRuntimeStateFromAction(
  state: PetPresentationRuntimeState,
  action: PetPresentationAction
): PetPresentationRuntimeState {
  const snapshot = applyPetPresentationAction(state.snapshot, action)
  const events = buildPetPresentationEvents(state.snapshot, snapshot, state.sequence, 'pet-action')
  if (events.length === 0) return state
  const sequence = events.at(-1)?.sequence ?? state.sequence

  return {
    events: appendReplayEvents(state.events, events),
    lastEvents: events,
    seeded: true,
    sequence,
    snapshot
  }
}

export function buildPetPresentationEvents(
  previous: PetPastureSnapshot,
  next: PetPastureSnapshot,
  baseSequence = 0,
  source: PetPresentationEvent['source'] = 'pet-snapshot'
): PetPresentationEvent[] {
  const events: PetPresentationEvent[] = []
  let sequence = baseSequence
  const addEvent = <TType extends PetPresentationEvent['type']>(
    type: TType,
    payload: Omit<Extract<PetPresentationEvent, { type: TType }>, keyof PetPresentationEventBase<TType>>
  ) => {
    sequence += 1
    events.push(createPetPresentationEvent(sequence, type, payload, source))
  }

  if (getPackagesSignature(previous.packages) !== getPackagesSignature(next.packages)) {
    addEvent('packages.changed', { packages: next.packages })
  }
  if (getAnimalsSignature(previous.animals) !== getAnimalsSignature(next.animals)) {
    addEvent('animals.changed', { animals: next.animals })
  }
  if (getBoundsSignature(previous.bounds) !== getBoundsSignature(next.bounds)) {
    addEvent('bounds.changed', { bounds: next.bounds })
  }

  const previousTasks = collectPresentationTasks(previous)
  const nextTasks = collectPresentationTasks(next)
  for (const [taskKey, record] of previousTasks) {
    if (!nextTasks.has(taskKey)) addEvent('task.removed', { record, taskKey })
  }
  for (const [taskKey, record] of nextTasks) {
    const previousRecord = previousTasks.get(taskKey)
    if (!previousRecord) {
      if (record.stage === 'queued') {
        addEvent('task.queued', { record })
      } else if (isTerminalTaskRecord(record)) {
        addEvent('task.completed', { record })
      } else {
        addEvent('task.started', { record })
      }
      continue
    }

    if (getTaskSignature(previousRecord) === getTaskSignature(record)) continue
    if (!isTerminalTaskRecord(previousRecord) && isTerminalTaskRecord(record)) {
      addEvent('task.completed', { previous: previousRecord, record })
      continue
    }

    addEvent('task.updated', { previous: previousRecord, record })
  }

  const previousApprovals = new Map(previous.permissionPrompts.map((prompt) => [prompt.approvalId, prompt]))
  const nextApprovals = new Map(next.permissionPrompts.map((prompt) => [prompt.approvalId, prompt]))
  for (const [approvalId, prompt] of previousApprovals) {
    if (!nextApprovals.has(approvalId)) addEvent('approval.resolved', { approvalId, prompt })
  }
  for (const [approvalId, prompt] of nextApprovals) {
    const previousPrompt = previousApprovals.get(approvalId)
    if (!previousPrompt) {
      addEvent('approval.requested', { prompt })
      continue
    }
    if (getApprovalSignature(previousPrompt) !== getApprovalSignature(prompt)) {
      addEvent('approval.updated', { previous: previousPrompt, prompt })
    }
  }

  if (events.length > 0) addEvent('snapshot.updated', { snapshot: next })
  return events
}

function createPetPresentationEvent<TType extends PetPresentationEvent['type']>(
  sequence: number,
  type: TType,
  payload: Omit<Extract<PetPresentationEvent, { type: TType }>, keyof PetPresentationEventBase<TType>>,
  source: PetPresentationEvent['source']
): Extract<PetPresentationEvent, { type: TType }> {
  return {
    emittedAt: Date.now(),
    id: `pet-presentation:${sequence}`,
    sequence,
    source,
    type,
    ...payload
  } as Extract<PetPresentationEvent, { type: TType }>
}

function appendReplayEvents(
  previousEvents: PetPresentationEvent[],
  nextEvents: PetPresentationEvent[]
): PetPresentationEvent[] {
  if (nextEvents.length === 0) return previousEvents
  return [...previousEvents, ...nextEvents].slice(-PET_PRESENTATION_REPLAY_LIMIT)
}

function applyPetPresentationAction(snapshot: PetPastureSnapshot, action: PetPresentationAction): PetPastureSnapshot {
  switch (action.type) {
    case 'task.opened':
      return updateTaskOpened(snapshot, action.taskKey, action.updatedAt)
    case 'task.dismissed':
      return updateTaskDismissed(snapshot, action.taskKey, action.updatedAt)
    case 'approval.dismissed':
      return updateApprovalDismissed(snapshot, action.approvalId, action.updatedAt)
    case 'task.bubbleHoldChanged':
      return snapshot
  }
}

function updateTaskOpened(snapshot: PetPastureSnapshot, taskKey: string, updatedAt: number): PetPastureSnapshot {
  return {
    ...snapshot,
    bindings: snapshot.bindings.map((binding) =>
      binding.taskKey === taskKey ? { ...binding, openedInCherry: true, updatedAt } : binding
    ),
    bubbles: snapshot.bubbles.map((bubble) =>
      bubble.taskKey === taskKey ? { ...bubble, openedInCherry: true, updatedAt } : bubble
    ),
    queuedTasks: snapshot.queuedTasks.map((task) =>
      task.taskKey === taskKey ? { ...task, openedInCherry: true, updatedAt } : task
    )
  }
}

function updateTaskDismissed(snapshot: PetPastureSnapshot, taskKey: string, updatedAt: number): PetPastureSnapshot {
  return {
    ...snapshot,
    bindings: snapshot.bindings.map((binding) =>
      binding.taskKey === taskKey ? { ...binding, bubbleDismissed: true, updatedAt } : binding
    ),
    bubbles: snapshot.bubbles.map((bubble) =>
      bubble.taskKey === taskKey ? { ...bubble, bubbleDismissed: true, updatedAt } : bubble
    )
  }
}

function updateApprovalDismissed(
  snapshot: PetPastureSnapshot,
  approvalId: string,
  updatedAt: number
): PetPastureSnapshot {
  return {
    ...snapshot,
    permissionPrompts: snapshot.permissionPrompts.map((prompt) =>
      prompt.approvalId === approvalId ? { ...prompt, dismissed: true, updatedAt } : prompt
    )
  }
}

function collectPresentationTasks(snapshot: PetPastureSnapshot): Map<string, PetPresentationTaskRecord> {
  const tasks = new Map<string, PetPresentationTaskRecord>()

  for (const task of snapshot.bindings) {
    tasks.set(task.taskKey, { stage: 'active', task })
  }
  for (const task of snapshot.queuedTasks) {
    if (!tasks.has(task.taskKey)) tasks.set(task.taskKey, { stage: 'queued', task })
  }
  for (const task of snapshot.bubbles) {
    if (!tasks.has(task.taskKey)) tasks.set(task.taskKey, { stage: 'bubble', task })
  }

  return tasks
}

function isTerminalTaskRecord(record: PetPresentationTaskRecord): boolean {
  return record.task.status === 'done' || record.task.status === 'failed' || record.task.status === 'aborted'
}

function getPackagesSignature(packages: PetPackageInfo[]): string {
  return packages.map((petPackage) => `${petPackage.id}:${petPackage.displayName}:${petPackage.spriteUrl}`).join('|')
}

function getAnimalsSignature(animals: PetAnimalInstance[]): string {
  return animals
    .map((animal) =>
      [
        animal.id,
        animal.packageId,
        animal.enabled,
        animal.agentId ?? '',
        animal.homeXRatio,
        animal.order,
        animal.personality
      ].join(':')
    )
    .join('|')
}

function getBoundsSignature(bounds: PetPastureBounds): string {
  return `${bounds.x}:${bounds.y}:${bounds.width}`
}

function getTaskSignature(record: PetPresentationTaskRecord): string {
  const task = record.task
  return JSON.stringify({
    stage: record.stage,
    status: task.status,
    title: task.title,
    updatedAt: task.updatedAt,
    endedAt: 'endedAt' in task ? task.endedAt : undefined,
    currentToolName: task.currentToolName,
    openedInCherry: task.openedInCherry,
    queueReason: task.queueReason,
    bubbleDismissed: task.bubbleDismissed,
    streamText: task.streamText,
    messageCount: task.messages?.length ?? 0,
    renderMessageId: task.render?.message.id
  })
}

function getApprovalSignature(prompt: PetPermissionPromptSnapshot): string {
  return JSON.stringify({
    approvalId: prompt.approvalId,
    dismissed: prompt.dismissed,
    safePreview: prompt.safePreview,
    status: prompt.status,
    taskKey: prompt.taskKey,
    toolName: prompt.toolName,
    updatedAt: prompt.updatedAt
  })
}
