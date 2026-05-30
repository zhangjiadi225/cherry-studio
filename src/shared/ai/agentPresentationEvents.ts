import type { CherryUIMessage } from '../data/types/message'

export const AGENT_PRESENTATION_EVENT_KINDS = [
  'stream.started',
  'message.delta',
  'message.completed',
  'tool.started',
  'approval.required',
  'approval.resolved',
  'stream.failed',
  'stream.cancelled'
] as const

export type AgentPresentationEventKind = (typeof AGENT_PRESENTATION_EVENT_KINDS)[number]
export type AgentPresentationEventType = AgentPresentationEventKind

export interface AgentPresentationScope {
  agentId: string
  sessionId: string
  streamId: string
  timestamp: number
  turnId?: string
  requestId?: string
  messageId?: string
}

export interface AgentPresentationStreamStartedEvent extends AgentPresentationScope {
  type: 'stream.started'
  status?: 'pending' | 'streaming'
}

export interface AgentPresentationMessageDeltaEvent extends AgentPresentationScope {
  type: 'message.delta'
  messageId: string
  delta: string
}

export interface AgentPresentationMessageCompletedEvent extends AgentPresentationScope {
  type: 'message.completed'
  message?: CherryUIMessage
  text?: string
}

export interface AgentPresentationToolStartedEvent extends AgentPresentationScope {
  type: 'tool.started'
  toolCallId: string
  toolName: string
}

export interface AgentPresentationApprovalRequiredEvent extends AgentPresentationScope {
  type: 'approval.required'
  approvalId: string
  toolCallId: string
  toolName: string
  safePreview: string
  previewRedacted: boolean
  previewTruncated: boolean
}

export interface AgentPresentationApprovalResolvedEvent extends AgentPresentationScope {
  type: 'approval.resolved'
  approvalId: string
  result: 'approved' | 'rejected' | 'resolved'
}

export interface AgentPresentationStreamFailedEvent extends AgentPresentationScope {
  type: 'stream.failed'
  error: string
  message?: CherryUIMessage
  text?: string
}

export interface AgentPresentationStreamCancelledEvent extends AgentPresentationScope {
  type: 'stream.cancelled'
  message?: CherryUIMessage
  text?: string
}

export type AgentPresentationEventByKind = {
  'stream.started': AgentPresentationStreamStartedEvent
  'message.delta': AgentPresentationMessageDeltaEvent
  'message.completed': AgentPresentationMessageCompletedEvent
  'tool.started': AgentPresentationToolStartedEvent
  'approval.required': AgentPresentationApprovalRequiredEvent
  'approval.resolved': AgentPresentationApprovalResolvedEvent
  'stream.failed': AgentPresentationStreamFailedEvent
  'stream.cancelled': AgentPresentationStreamCancelledEvent
}

export type AgentPresentationEvent<TKind extends AgentPresentationEventKind = AgentPresentationEventKind> =
  AgentPresentationEventByKind[TKind]

export type AgentPresentationEventHandler<TKind extends AgentPresentationEventKind = AgentPresentationEventKind> = (
  event: AgentPresentationEvent<TKind>
) => void
