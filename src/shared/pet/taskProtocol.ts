import type { PetQueueReason, PetSourceKind, PetTaskKind, PetTaskMessageSummary, PetTaskStatus } from './types'

export const PET_TASK_PROTOCOL_VERSION = 1

export const PET_TASK_EVENT_TYPES = [
  'task.started',
  'task.updated',
  'task.completed',
  'task.removed',
  'approval.requested',
  'approval.resolved'
] as const

export type PetTaskEventType = (typeof PET_TASK_EVENT_TYPES)[number]

export const PET_TASK_COMMAND_TYPES = [
  'task.open',
  'task.quick_reply',
  'task.dismiss',
  'approval.dismiss',
  'approval.respond'
] as const

export type PetTaskCommandType = (typeof PET_TASK_COMMAND_TYPES)[number]

export type PetTaskSourceRef = {
  sourceKey: string
  sourceKind: PetSourceKind
  sourceId: string
  sourceTitle: string
}

export type PetTaskRef = {
  taskId: string
  kind: PetTaskKind
  targetId: string
  source: PetTaskSourceRef
  status: PetTaskStatus
  title: string
  startedAt: number
  updatedAt: number
  endedAt?: number
  currentToolName?: string
  openedInCherry?: boolean
  queueReason?: PetQueueReason
  messages?: PetTaskMessageSummary[]
  streamText?: string
}

export type PetTaskPatch = Partial<
  Pick<
    PetTaskRef,
    | 'currentToolName'
    | 'endedAt'
    | 'messages'
    | 'openedInCherry'
    | 'queueReason'
    | 'status'
    | 'streamText'
    | 'title'
    | 'updatedAt'
  >
>

export type PetTaskCompletionStatus = Extract<PetTaskStatus, 'done' | 'failed' | 'aborted'>

export type PetTaskResult = {
  status: PetTaskCompletionStatus
  endedAt: number
  errorMessage?: string
  reason?: string
}

export type PetApprovalPreview = {
  safePreview: string
  redacted: boolean
  truncated: boolean
}

export type PetApprovalRef = {
  approvalId: string
  taskId: string
  sessionId: string
  toolCallId: string
  toolName: string
  title: string
  source: PetTaskSourceRef
  preview: PetApprovalPreview
  createdAt: number
  updatedAt: number
}

export type PetApprovalDecision = 'allow_once' | 'deny'

export type PetTaskEventByType = {
  'task.started': {
    type: 'task.started'
    task: PetTaskRef
  }
  'task.updated': {
    type: 'task.updated'
    taskId: string
    patch: PetTaskPatch
    updatedAt: number
  }
  'task.completed': {
    type: 'task.completed'
    taskId: string
    result: PetTaskResult
  }
  'task.removed': {
    type: 'task.removed'
    taskId: string
    removedAt: number
  }
  'approval.requested': {
    type: 'approval.requested'
    approval: PetApprovalRef
  }
  'approval.resolved': {
    type: 'approval.resolved'
    approvalId: string
    taskId?: string
    decision: PetApprovalDecision
    resolvedAt: number
  }
}

export type PetTaskEvent<TType extends PetTaskEventType = PetTaskEventType> = PetTaskEventByType[TType]

export type PetTaskCommandByType = {
  'task.open': {
    type: 'task.open'
    taskId: string
  }
  'task.quick_reply': {
    type: 'task.quick_reply'
    taskId: string
    text: string
  }
  'task.dismiss': {
    type: 'task.dismiss'
    taskId: string
  }
  'approval.dismiss': {
    type: 'approval.dismiss'
    approvalId: string
  }
  'approval.respond': {
    type: 'approval.respond'
    approvalId: string
    decision: PetApprovalDecision
    reason?: string
  }
}

export type PetTaskCommand<TType extends PetTaskCommandType = PetTaskCommandType> = PetTaskCommandByType[TType]

export type PetTaskCommandFailureReason = 'invalid-state' | 'not-found' | 'not-supported' | 'rejected'

export type PetTaskCommandResult =
  | { ok: true }
  | {
      ok: false
      reason: PetTaskCommandFailureReason
      message?: string
    }

export type PetTaskProtocolEnvelope<TType extends PetTaskEventType = PetTaskEventType> = {
  version: typeof PET_TASK_PROTOCOL_VERSION
  sequence: number
  emittedAt: number
  event: PetTaskEvent<TType>
}

export type PetTaskProtocolSeed = {
  version: typeof PET_TASK_PROTOCOL_VERSION
  sequence: number
  capturedAt: number
  tasks: PetTaskRef[]
  approvals: PetApprovalRef[]
}
