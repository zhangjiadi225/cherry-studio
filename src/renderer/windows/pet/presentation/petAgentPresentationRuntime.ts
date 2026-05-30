import type { AgentPresentationEvent } from '@shared/ai/agentPresentationEvents'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import type {
  PetAnimalInstance,
  PetPastureSnapshot,
  PetPermissionPromptSnapshot,
  PetQueueReason,
  PetTaskBinding,
  PetTaskBubbleSnapshot,
  PetTaskMessageRender,
  PetTaskMessageSummary,
  PetTaskStatus
} from '@shared/pet'

type PetPresentationTaskIdentity = {
  kind: 'session'
  sourceId: string
  sourceKey: string
  sourceKind: 'agent'
  sourceTitle: string
  targetId: string
  taskKey: string
  title: string
}

type AnimalAssignment = {
  animalId: string | null
  replacedBubbleTaskKey?: string
}

export function applyAgentPresentationEventToPetSnapshot(
  snapshot: PetPastureSnapshot,
  event: AgentPresentationEvent
): PetPastureSnapshot {
  const identity = getTaskIdentity(snapshot, event)
  const timestamp = event.timestamp || Date.now()

  switch (event.type) {
    case 'stream.started':
      return updateTaskBinding(snapshot, identity, 'running', timestamp)
    case 'message.delta':
      return appendStreamText(
        updateTaskBinding(snapshot, identity, 'running', timestamp),
        identity.taskKey,
        event.delta,
        timestamp
      )
    case 'tool.started':
      return updateTaskBinding(snapshot, identity, 'running', timestamp, { currentToolName: event.toolName })
    case 'approval.required': {
      const nextSnapshot = updateTaskBinding(snapshot, identity, 'waiting', timestamp)
      return upsertPermissionPrompt(nextSnapshot, event, identity, timestamp)
    }
    case 'approval.resolved':
      return markTaskForReview(removePermissionPrompt(snapshot, event.approvalId), identity.taskKey, timestamp)
    case 'message.completed':
      return completeTaskBinding(snapshot, identity, 'done', timestamp, event.text, event.message)
    case 'stream.failed':
      return completeTaskBinding(snapshot, identity, 'failed', timestamp, event.text, event.message)
    case 'stream.cancelled':
      return completeTaskBinding(snapshot, identity, 'aborted', timestamp, event.text, event.message)
  }
}

function getTaskIdentity(snapshot: PetPastureSnapshot, event: AgentPresentationEvent): PetPresentationTaskIdentity {
  const taskKey = `session:${event.sessionId}`
  const existing = getTaskSnapshot(snapshot, taskKey)
  const sourceId = existing?.sourceId ?? event.agentId
  const fallbackTitle = `Session ${event.sessionId.slice(0, 8)}`
  const title = existing?.title || fallbackTitle

  return {
    kind: 'session',
    sourceId,
    sourceKey: existing?.sourceKey || `agent:${sourceId}`,
    sourceKind: 'agent',
    sourceTitle: existing?.sourceTitle || (sourceId.startsWith('session:') ? title : `Agent ${sourceId}`),
    targetId: event.sessionId,
    taskKey,
    title
  }
}

function updateTaskBinding(
  snapshot: PetPastureSnapshot,
  identity: PetPresentationTaskIdentity,
  status: PetTaskStatus,
  timestamp: number,
  options: { currentToolName?: string; preferredAnimalId?: string } = {}
): PetPastureSnapshot {
  if (isTerminalStatus(status)) return completeTaskBinding(snapshot, identity, status, timestamp)

  const activeBinding = snapshot.bindings.find((binding) => binding.taskKey === identity.taskKey)
  const queuedBinding = snapshot.queuedTasks.find((binding) => binding.taskKey === identity.taskKey)
  const existing = activeBinding ?? queuedBinding
  const assignedAnimalId = getAssignedSourceAnimalId(snapshot, identity)
  const existingAnimalId = existing?.animalId || undefined
  const assignment =
    existingAnimalId && canAnimalHandleSourceById(snapshot.animals, existingAnimalId, identity)
      ? { animalId: existingAnimalId }
      : assignAnimalId(snapshot, identity, options.preferredAnimalId ?? assignedAnimalId ?? undefined)
  let nextSnapshot = assignment.replacedBubbleTaskKey
    ? removeBubble(snapshot, assignment.replacedBubbleTaskKey)
    : snapshot
  const animalId = assignment.animalId

  if (!animalId) {
    return queueTaskBinding(nextSnapshot, identity, status, timestamp, {
      currentToolName: options.currentToolName,
      existing,
      queuedAnimalId: assignedAnimalId ?? undefined,
      queueReason: queuedBinding?.queueReason ?? getQueueReason(snapshot, identity)
    })
  }

  const binding: PetTaskBinding = {
    animalId,
    bubbleDismissed: false,
    currentToolName: options.currentToolName ?? existing?.currentToolName,
    endedAt: undefined,
    kind: identity.kind,
    messages: existing?.messages,
    openedInCherry: existing?.openedInCherry,
    render: existing?.render,
    sourceId: identity.sourceId,
    sourceKey: identity.sourceKey,
    sourceKind: identity.sourceKind,
    sourceTitle: identity.sourceTitle,
    startedAt: existing?.startedAt ?? timestamp,
    status,
    streamText: existing?.streamText,
    targetId: identity.targetId,
    taskKey: identity.taskKey,
    title: identity.title,
    updatedAt: timestamp
  }

  nextSnapshot = {
    ...nextSnapshot,
    bindings: upsertByTaskKey(nextSnapshot.bindings, binding),
    bubbles: nextSnapshot.bubbles.filter((bubble) => bubble.taskKey !== identity.taskKey),
    queuedTasks: nextSnapshot.queuedTasks.filter((task) => task.taskKey !== identity.taskKey)
  }

  return sortTaskSnapshot(nextSnapshot)
}

function completeTaskBinding(
  snapshot: PetPastureSnapshot,
  identity: PetPresentationTaskIdentity,
  status: Extract<PetTaskStatus, 'aborted' | 'done' | 'failed'>,
  timestamp: number,
  streamText?: string,
  message?: CherryUIMessage
): PetPastureSnapshot {
  const activeBinding = snapshot.bindings.find((binding) => binding.taskKey === identity.taskKey)
  const queuedBinding = snapshot.queuedTasks.find((binding) => binding.taskKey === identity.taskKey)
  const existingBubble = snapshot.bubbles.find((bubble) => bubble.taskKey === identity.taskKey)
  const existing = activeBinding ?? queuedBinding ?? existingBubble
  if (!existing) return snapshot

  const text = normalizeStreamText(streamText ?? existing.streamText)
  const messages = text ? createStreamMessageSummary(identity.taskKey, text, timestamp) : existing.messages
  const bubble: PetTaskBubbleSnapshot = {
    animalId: existing.animalId,
    bubbleDismissed: existing.bubbleDismissed ?? false,
    currentToolName: existing.currentToolName,
    endedAt: timestamp,
    kind: identity.kind,
    messages,
    openedInCherry: existing.openedInCherry,
    queueReason: undefined,
    render: message ? toPetTaskMessageRender(message) : existing.render,
    sourceId: existing.sourceId,
    sourceKey: existing.sourceKey,
    sourceKind: existing.sourceKind,
    sourceTitle: existing.sourceTitle,
    startedAt: existing.startedAt,
    status,
    streamText: text,
    targetId: identity.targetId,
    taskKey: identity.taskKey,
    title: identity.title,
    updatedAt: timestamp
  }

  const nextSnapshot = sortTaskSnapshot({
    ...snapshot,
    bindings: snapshot.bindings.filter((binding) => binding.taskKey !== identity.taskKey),
    bubbles: upsertByTaskKey(snapshot.bubbles, bubble),
    queuedTasks: snapshot.queuedTasks.filter((task) => task.taskKey !== identity.taskKey)
  })

  return activeBinding
    ? promoteQueuedTask(nextSnapshot, activeBinding.animalId, activeBinding.sourceKey, timestamp)
    : nextSnapshot
}

function queueTaskBinding(
  snapshot: PetPastureSnapshot,
  identity: PetPresentationTaskIdentity,
  status: PetTaskStatus,
  timestamp: number,
  options: {
    currentToolName?: string
    existing?: PetTaskBinding
    queueReason?: PetQueueReason
    queuedAnimalId?: string
  }
): PetPastureSnapshot {
  const task: PetTaskBinding = {
    animalId: options.existing?.animalId ?? options.queuedAnimalId ?? '',
    bubbleDismissed: false,
    currentToolName: options.currentToolName ?? options.existing?.currentToolName,
    endedAt: undefined,
    kind: identity.kind,
    messages: options.existing?.messages,
    openedInCherry: options.existing?.openedInCherry,
    queueReason: options.queueReason,
    render: options.existing?.render,
    sourceId: identity.sourceId,
    sourceKey: identity.sourceKey,
    sourceKind: identity.sourceKind,
    sourceTitle: identity.sourceTitle,
    startedAt: options.existing?.startedAt ?? timestamp,
    status,
    streamText: options.existing?.streamText,
    targetId: identity.targetId,
    taskKey: identity.taskKey,
    title: identity.title,
    updatedAt: timestamp
  }

  return sortTaskSnapshot({
    ...snapshot,
    bindings: snapshot.bindings.filter((binding) => binding.taskKey !== identity.taskKey),
    bubbles: snapshot.bubbles.filter((bubble) => bubble.taskKey !== identity.taskKey),
    queuedTasks: upsertByTaskKey(snapshot.queuedTasks, task)
  })
}

function appendStreamText(
  snapshot: PetPastureSnapshot,
  taskKey: string,
  delta: string,
  timestamp: number
): PetPastureSnapshot {
  if (!delta) return snapshot
  const binding = snapshot.bindings.find((task) => task.taskKey === taskKey)
  if (!binding) return snapshot

  return sortTaskSnapshot({
    ...snapshot,
    bindings: upsertByTaskKey(snapshot.bindings, {
      ...binding,
      streamText: `${binding.streamText ?? ''}${delta}`,
      updatedAt: timestamp
    })
  })
}

function upsertPermissionPrompt(
  snapshot: PetPastureSnapshot,
  approval: Extract<AgentPresentationEvent, { type: 'approval.required' }>,
  identity: PetPresentationTaskIdentity,
  timestamp: number
): PetPastureSnapshot {
  const binding = snapshot.bindings.find((task) => task.taskKey === identity.taskKey)
  if (!binding) return snapshot

  const existing = snapshot.permissionPrompts.find((prompt) => prompt.approvalId === approval.approvalId)
  const prompt: PetPermissionPromptSnapshot = {
    animalId: binding.animalId,
    approvalId: approval.approvalId,
    createdAt: existing?.createdAt ?? timestamp,
    dismissed: existing?.dismissed ?? false,
    kind: 'session',
    previewRedacted: approval.previewRedacted,
    previewTruncated: approval.previewTruncated,
    safePreview: approval.safePreview,
    sessionId: approval.sessionId,
    sourceId: identity.sourceId,
    sourceKey: identity.sourceKey,
    sourceKind: identity.sourceKind,
    sourceTitle: identity.sourceTitle,
    status: 'pending',
    targetId: identity.targetId,
    taskKey: identity.taskKey,
    title: identity.title,
    toolCallId: approval.toolCallId,
    toolName: approval.toolName,
    updatedAt: timestamp
  }

  return sortTaskSnapshot({
    ...snapshot,
    permissionPrompts: upsertByApprovalId(snapshot.permissionPrompts, prompt)
  })
}

function removePermissionPrompt(snapshot: PetPastureSnapshot, approvalId: string): PetPastureSnapshot {
  if (!snapshot.permissionPrompts.some((prompt) => prompt.approvalId === approvalId)) return snapshot
  return {
    ...snapshot,
    permissionPrompts: snapshot.permissionPrompts.filter((prompt) => prompt.approvalId !== approvalId)
  }
}

function markTaskForReview(snapshot: PetPastureSnapshot, taskKey: string, timestamp: number): PetPastureSnapshot {
  const binding = snapshot.bindings.find((task) => task.taskKey === taskKey)
  if (!binding || binding.status !== 'waiting') return snapshot
  return sortTaskSnapshot({
    ...snapshot,
    bindings: upsertByTaskKey(snapshot.bindings, { ...binding, status: 'review', updatedAt: timestamp })
  })
}

function promoteQueuedTask(
  snapshot: PetPastureSnapshot,
  animalId: string,
  releasedSourceKey: string,
  timestamp: number
): PetPastureSnapshot {
  const animal = snapshot.animals.find((item) => item.id === animalId && item.enabled)
  if (!animal) return snapshot

  const nextTask = snapshot.queuedTasks
    .filter((task) => canAnimalHandleSource(animal, getIdentityFromTask(task)))
    .sort((a, b) => {
      if (a.sourceKey === releasedSourceKey && b.sourceKey !== releasedSourceKey) return -1
      if (b.sourceKey === releasedSourceKey && a.sourceKey !== releasedSourceKey) return 1
      return a.updatedAt - b.updatedAt
    })[0]
  if (!nextTask) return snapshot

  return sortTaskSnapshot({
    ...snapshot,
    bindings: upsertByTaskKey(snapshot.bindings, {
      ...nextTask,
      animalId,
      queueReason: undefined,
      updatedAt: timestamp
    }),
    bubbles: snapshot.bubbles.filter((bubble) => bubble.animalId !== animalId),
    queuedTasks: snapshot.queuedTasks.filter((task) => task.taskKey !== nextTask.taskKey)
  })
}

function assignAnimalId(
  snapshot: PetPastureSnapshot,
  identity: PetPresentationTaskIdentity,
  preferredAnimalId?: string
): AnimalAssignment {
  if (preferredAnimalId && canAnimalHandleSourceById(snapshot.animals, preferredAnimalId, identity)) {
    return { animalId: preferredAnimalId }
  }

  const allAnimals = snapshot.animals
  const hasExplicitAgentBinding = allAnimals.some((animal) => animal.agentId === identity.sourceId)
  const enabledAnimals = allAnimals.filter((animal) => animal.enabled)
  if (enabledAnimals.length === 0) return { animalId: null }

  const configuredAnimal = enabledAnimals.find(
    (animal) =>
      animal.agentId === identity.sourceId && !isAnimalOccupiedByOtherSource(snapshot, animal.id, identity.sourceKey)
  )
  if (configuredAnimal) return { animalId: configuredAnimal.id }
  if (hasExplicitAgentBinding) return { animalId: null }

  const freeAnimal = enabledAnimals.find(
    (animal) =>
      canAnimalHandleSource(animal, identity) && !isAnimalOccupiedByOtherSource(snapshot, animal.id, identity.sourceKey)
  )
  if (freeAnimal) return { animalId: freeAnimal.id }

  const animalById = new Map(enabledAnimals.map((animal) => [animal.id, animal]))
  const oldestBubble = snapshot.bubbles
    .filter((bubble) => {
      const animal = animalById.get(bubble.animalId)
      return bubble.status !== 'failed' && !bubble.bubbleDismissed && animal && canAnimalHandleSource(animal, identity)
    })
    .sort((a, b) => a.updatedAt - b.updatedAt)[0]

  return oldestBubble
    ? { animalId: oldestBubble.animalId, replacedBubbleTaskKey: oldestBubble.taskKey }
    : { animalId: null }
}

function getAssignedSourceAnimalId(snapshot: PetPastureSnapshot, identity: PetPresentationTaskIdentity): string | null {
  const assignedAnimalId =
    snapshot.bindings.find((task) => task.sourceKey === identity.sourceKey)?.animalId ||
    snapshot.queuedTasks.find((task) => task.sourceKey === identity.sourceKey)?.animalId ||
    snapshot.bubbles.find((task) => task.sourceKey === identity.sourceKey && !task.bubbleDismissed)?.animalId ||
    snapshot.permissionPrompts.find((prompt) => prompt.sourceKey === identity.sourceKey && !prompt.dismissed)?.animalId
  if (!assignedAnimalId) return null

  return canAnimalHandleSourceById(snapshot.animals, assignedAnimalId, identity) ? assignedAnimalId : null
}

function canAnimalHandleSourceById(
  animals: PetAnimalInstance[],
  animalId: string,
  identity: PetPresentationTaskIdentity
): boolean {
  const animal = animals.find((item) => item.id === animalId && item.enabled)
  return Boolean(animal && canAnimalHandleSource(animal, identity))
}

function canAnimalHandleSource(animal: PetAnimalInstance, identity: PetPresentationTaskIdentity): boolean {
  return !animal.agentId || animal.agentId === identity.sourceId
}

function isAnimalOccupiedByOtherSource(snapshot: PetPastureSnapshot, animalId: string, sourceKey: string): boolean {
  return (
    snapshot.bindings.some((binding) => binding.animalId === animalId && binding.sourceKey !== sourceKey) ||
    snapshot.queuedTasks.some((task) => task.animalId === animalId && task.sourceKey !== sourceKey) ||
    snapshot.bubbles.some(
      (bubble) => !bubble.bubbleDismissed && bubble.animalId === animalId && bubble.sourceKey !== sourceKey
    ) ||
    snapshot.permissionPrompts.some(
      (prompt) => !prompt.dismissed && prompt.animalId === animalId && prompt.sourceKey !== sourceKey
    )
  )
}

function getQueueReason(snapshot: PetPastureSnapshot, identity: PetPresentationTaskIdentity): PetQueueReason {
  const boundAnimal = snapshot.animals.find((animal) => animal.agentId === identity.sourceId)
  if (boundAnimal && !boundAnimal.enabled) return 'bound-disabled'
  if (boundAnimal) return 'bound-busy'
  if (!snapshot.animals.some((animal) => animal.enabled)) return 'no-enabled-pet'
  return 'no-free-pet'
}

function getTaskSnapshot(
  snapshot: PetPastureSnapshot,
  taskKey: string
): PetTaskBinding | PetTaskBubbleSnapshot | undefined {
  return (
    snapshot.bindings.find((task) => task.taskKey === taskKey) ??
    snapshot.queuedTasks.find((task) => task.taskKey === taskKey) ??
    snapshot.bubbles.find((task) => task.taskKey === taskKey)
  )
}

function getIdentityFromTask(task: PetTaskBinding): PetPresentationTaskIdentity {
  return {
    kind: task.kind,
    sourceId: task.sourceId,
    sourceKey: task.sourceKey,
    sourceKind: task.sourceKind,
    sourceTitle: task.sourceTitle,
    targetId: task.targetId,
    taskKey: task.taskKey,
    title: task.title
  }
}

function removeBubble(snapshot: PetPastureSnapshot, taskKey: string): PetPastureSnapshot {
  return {
    ...snapshot,
    bubbles: snapshot.bubbles.filter((bubble) => bubble.taskKey !== taskKey)
  }
}

function upsertByTaskKey<TTask extends { taskKey: string }>(tasks: TTask[], task: TTask): TTask[] {
  return [...tasks.filter((item) => item.taskKey !== task.taskKey), task]
}

function upsertByApprovalId(
  prompts: PetPermissionPromptSnapshot[],
  prompt: PetPermissionPromptSnapshot
): PetPermissionPromptSnapshot[] {
  return [...prompts.filter((item) => item.approvalId !== prompt.approvalId), prompt]
}

function sortTaskSnapshot(snapshot: PetPastureSnapshot): PetPastureSnapshot {
  return {
    ...snapshot,
    bindings: [...snapshot.bindings].sort((a, b) => a.startedAt - b.startedAt),
    bubbles: [...snapshot.bubbles].sort((a, b) => a.endedAt - b.endedAt),
    permissionPrompts: [...snapshot.permissionPrompts].sort((a, b) => a.createdAt - b.createdAt),
    queuedTasks: [...snapshot.queuedTasks].sort((a, b) => a.updatedAt - b.updatedAt)
  }
}

function createStreamMessageSummary(taskKey: string, text: string, timestamp: number): PetTaskMessageSummary[] {
  return [
    {
      createdAt: new Date(timestamp).toISOString(),
      id: `${taskKey}:assistant:${timestamp}`,
      role: 'assistant',
      text
    }
  ]
}

function toPetTaskMessageRender(message: CherryUIMessage): PetTaskMessageRender {
  return {
    message,
    partsByMessageId: {
      [message.id]: (message.parts ?? []) as CherryMessagePart[]
    }
  }
}

function isTerminalStatus(status: PetTaskStatus): status is Extract<PetTaskStatus, 'aborted' | 'done' | 'failed'> {
  return status === 'done' || status === 'failed' || status === 'aborted'
}

function normalizeStreamText(text?: string): string | undefined {
  const normalized = text?.trim()
  return normalized || undefined
}
