import type {
  PetPermissionPromptSnapshot,
  PetPermissionPromptStatus,
  PetQueueReason,
  PetSourceKind,
  PetTaskBinding,
  PetTaskBubbleSnapshot,
  PetTaskStatus
} from '@shared/pet'

export type PetPanelKind = 'task' | 'permission'

export type PetPanelStatus = PetTaskStatus | 'queued' | PetPermissionPromptStatus

export type PetPanelAction = 'open-task' | 'quick-reply' | 'copy' | 'dismiss' | 'allow-once' | 'deny' | 'open-in-cherry'

export type PetPanelSnapshot = {
  id: string
  kind: PetPanelKind
  priority: number
  animalId: string
  taskKey: string
  status: PetPanelStatus
  title: string
  summary: string
  createdAt: number
  updatedAt: number
  actions: PetPanelAction[]
  approvalId?: string
  toolCallId?: string
  toolName?: string
  sessionId?: string
  safePreview?: string
  previewRedacted?: boolean
  previewTruncated?: boolean
  source?: PetTaskBinding | PetTaskBubbleSnapshot | PetPermissionPromptSnapshot
  currentToolName?: string
  queueReason?: PetQueueReason
}

export type PetQueueSummaryItem = {
  id: string
  kind: PetPanelKind
  animalId: string
  taskKey: string
  status: PetPanelStatus
  title: string
  priority: number
  createdAt: number
  queueReason?: PetQueueReason
}

export type PetQueueSummary = {
  approvalsWaiting: number
  tasksQueued: number
  tasksRunning: number
  failures: number
  items: PetQueueSummaryItem[]
}

export type PetSourceGroupSnapshot = {
  id: string
  sourceKey: string
  sourceKind: PetSourceKind
  sourceId: string
  sourceTitle: string
  animalId: string
  status: PetPanelStatus
  highestPriority: number
  taskCount: number
  updatedAt: number
  tasks: PetPanelSnapshot[]
}

export function buildPetPanelSnapshots(input: {
  bindings: PetTaskBinding[]
  bubbles: PetTaskBubbleSnapshot[]
  permissionPrompts: PetPermissionPromptSnapshot[]
  queuedTasks: PetTaskBinding[]
}): PetPanelSnapshot[] {
  const panels: PetPanelSnapshot[] = [
    ...input.permissionPrompts
      .filter((prompt) => !prompt.dismissed)
      .map((prompt) => petPermissionPromptToPanel(prompt)),
    ...input.bindings.filter((binding) => !binding.bubbleDismissed).map((binding) => petTaskSnapshotToPanel(binding)),
    ...input.queuedTasks.map((task) => petTaskSnapshotToPanel(task, 'queued')),
    ...input.bubbles.filter((bubble) => !bubble.bubbleDismissed).map((bubble) => petTaskSnapshotToPanel(bubble))
  ]

  return panels.sort(comparePetPanelPriority)
}

export function buildControlIslandSourceGroups(panels: PetPanelSnapshot[]): PetSourceGroupSnapshot[] {
  const groups = new Map<string, PetPanelSnapshot[]>()
  for (const panel of panels) {
    const sourceKey = panel.source?.sourceKey
    if (!sourceKey) continue
    const group = groups.get(sourceKey) ?? []
    group.push(panel)
    groups.set(sourceKey, group)
  }

  return [...groups.entries()]
    .map(([sourceKey, tasks]) => {
      const sortedTasks = tasks.sort(comparePetPanelPriority)
      const top = sortedTasks[0]
      const source = top?.source
      return {
        id: `source:${sourceKey}`,
        sourceKey,
        sourceKind: source?.sourceKind ?? 'agent',
        sourceId: source?.sourceId ?? sourceKey,
        sourceTitle: source?.sourceTitle ?? top?.title ?? sourceKey,
        animalId: top?.animalId ?? '',
        status: top?.status ?? 'queued',
        highestPriority: top?.priority ?? 0,
        taskCount: sortedTasks.length,
        updatedAt: Math.max(...sortedTasks.map((task) => task.updatedAt)),
        tasks: sortedTasks
      } satisfies PetSourceGroupSnapshot
    })
    .sort(
      (left, right) =>
        right.highestPriority - left.highestPriority ||
        right.updatedAt - left.updatedAt ||
        left.id.localeCompare(right.id)
    )
}

export function buildControlIslandQueueSummary(panels: PetPanelSnapshot[]): PetQueueSummary {
  const sortedPanels = [...panels].sort(comparePetPanelPriority)
  return {
    approvalsWaiting: sortedPanels.filter((panel) => panel.kind === 'permission').length,
    failures: sortedPanels.filter((panel) => panel.status === 'failed').length,
    items: sortedPanels.map((panel) => ({
      animalId: panel.animalId,
      createdAt: panel.createdAt,
      id: panel.id,
      kind: panel.kind,
      priority: panel.priority,
      queueReason: panel.queueReason,
      status: panel.status,
      taskKey: panel.taskKey,
      title: panel.title
    })),
    tasksQueued: sortedPanels.filter((panel) => panel.status === 'queued').length,
    tasksRunning: sortedPanels.filter((panel) => panel.status === 'running' || panel.status === 'review').length
  }
}

export function comparePetPanelPriority(left: PetPanelSnapshot, right: PetPanelSnapshot): number {
  return right.priority - left.priority || left.createdAt - right.createdAt || left.id.localeCompare(right.id)
}

function petPermissionPromptToPanel(prompt: PetPermissionPromptSnapshot): PetPanelSnapshot {
  return {
    id: `permission:${prompt.approvalId}`,
    kind: 'permission',
    priority: getPanelPriority('pending'),
    animalId: prompt.animalId,
    taskKey: prompt.taskKey,
    status: prompt.status,
    title: prompt.title,
    summary: prompt.safePreview,
    createdAt: prompt.createdAt,
    updatedAt: prompt.updatedAt,
    actions: ['allow-once', 'deny', 'open-in-cherry', 'dismiss'],
    approvalId: prompt.approvalId,
    toolCallId: prompt.toolCallId,
    toolName: prompt.toolName,
    sessionId: prompt.sessionId,
    safePreview: prompt.safePreview,
    previewRedacted: prompt.previewRedacted,
    previewTruncated: prompt.previewTruncated,
    source: prompt
  }
}

function petTaskSnapshotToPanel(
  task: PetTaskBinding | PetTaskBubbleSnapshot,
  overrideStatus?: Extract<PetPanelStatus, 'queued'>
): PetPanelSnapshot {
  const status = overrideStatus ?? task.status
  return {
    id: `task:${task.taskKey}`,
    kind: 'task',
    priority: getPanelPriority(status),
    animalId: task.animalId,
    taskKey: task.taskKey,
    status,
    title: task.title,
    summary: getTaskPanelSummary(task),
    createdAt: task.startedAt,
    updatedAt: task.updatedAt,
    actions: getTaskPanelActions(status),
    currentToolName: task.currentToolName,
    queueReason: task.queueReason,
    source: task
  }
}

function getPanelPriority(status: PetPanelStatus): number {
  switch (status) {
    case 'pending':
      return 700
    case 'failed':
      return 600
    case 'waiting':
      return 500
    case 'review':
      return 400
    case 'running':
    case 'queued':
      return 300
    case 'done':
      return 200
    case 'aborted':
      return 100
  }
}

function getTaskPanelActions(status: PetPanelStatus): PetPanelAction[] {
  const actions: PetPanelAction[] = ['open-task', 'copy', 'dismiss']
  if (status === 'running') {
    actions.splice(1, 0, 'quick-reply')
  }
  return actions
}

function getTaskPanelSummary(task: PetTaskBinding | PetTaskBubbleSnapshot): string {
  if (task.queueReason) return getQueueReasonSummary(task.queueReason)
  if (task.currentToolName && task.status === 'running') return `Using ${task.currentToolName}`
  if (task.status === 'review') return 'Permission handled; continuing'
  const source = task.streamText || task.messages?.at(-1)?.text || ''
  return source.trim() || task.title
}

function getQueueReasonSummary(reason: PetQueueReason): string {
  switch (reason) {
    case 'bound-disabled':
      return 'Bound pet is disabled'
    case 'bound-busy':
      return 'Bound pet is busy'
    case 'no-enabled-pet':
      return 'No enabled pet available'
    case 'no-free-pet':
      return 'Waiting for an available pet'
  }
}
