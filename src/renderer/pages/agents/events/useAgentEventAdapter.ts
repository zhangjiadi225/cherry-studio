import type { ActiveExecution, TopicStreamStatus } from '@shared/ai/transport'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import { getToolName, isToolUIPart } from 'ai'
import { useEffect, useRef } from 'react'

import type { AgentEventBus } from './agentEventBus'
import { rendererAgentEventBus } from './agentEventBus'

export interface UseAgentEventAdapterInput {
  agentId?: string
  topicId: string
  streamStatus?: {
    status?: TopicStreamStatus
    turnId?: string
    activeExecutions: readonly ActiveExecution[]
  }
  liveAssistants: CherryUIMessage[]
  partsByMessageId: Record<string, CherryMessagePart[]>
  bus?: AgentEventBus
}

type AdapterState = {
  topicId?: string
  streamId?: string
  sessionId?: string
  activeMessageId?: string
  startedStreams: Set<string>
  completedStreams: Set<string>
  textByMessageId: Map<string, string>
  startedToolCalls: Set<string>
  requiredApprovals: Set<string>
}

type StreamStatusEntry = {
  status?: TopicStreamStatus
  turnId?: string
  activeExecutions: readonly ActiveExecution[]
}

function createAdapterState(): AdapterState {
  return {
    startedStreams: new Set(),
    completedStreams: new Set(),
    textByMessageId: new Map(),
    startedToolCalls: new Set(),
    requiredApprovals: new Set()
  }
}

function getStreamId(entry: StreamStatusEntry): string {
  return entry.turnId ?? entry.status ?? 'unknown'
}

function getSessionId(topicId: string): string {
  return topicId.startsWith('agent-session:') ? topicId.slice('agent-session:'.length) : topicId
}

function getBaseEventFields(input: UseAgentEventAdapterInput, state: AdapterState) {
  return {
    agentId: input.agentId ?? '',
    sessionId: state.sessionId ?? getSessionId(input.topicId),
    streamId: state.streamId ?? input.streamStatus?.turnId ?? input.topicId,
    timestamp: Date.now(),
    turnId: input.streamStatus?.turnId
  }
}

function getActiveMessageId(entry: StreamStatusEntry): string | undefined {
  return entry.activeExecutions.find((execution) => execution.anchorMessageId)?.anchorMessageId
}

function getMessageText(message: CherryUIMessage): string {
  return (message.parts ?? [])
    .map((part) => ('text' in part && typeof part.text === 'string' ? part.text : ''))
    .join('')
}

function resetForTopic(state: AdapterState, topicId: string): void {
  state.topicId = topicId
  state.sessionId = getSessionId(topicId)
  state.streamId = undefined
  state.activeMessageId = undefined
  state.startedStreams.clear()
  state.completedStreams.clear()
  state.textByMessageId.clear()
  state.startedToolCalls.clear()
  state.requiredApprovals.clear()
}

function publishStarted(input: UseAgentEventAdapterInput, state: AdapterState): void {
  const agentId = input.agentId
  const entry = input.streamStatus
  if (!agentId || !entry) return

  const messageId = getActiveMessageId(entry)
  if (!messageId) return

  const streamId = getStreamId(entry)
  state.streamId = streamId
  state.activeMessageId = messageId

  if (state.startedStreams.has(streamId)) return
  state.startedStreams.add(streamId)
  ;(input.bus ?? rendererAgentEventBus).publish(agentId, {
    ...getBaseEventFields(input, state),
    type: 'stream.started',
    messageId
  })
}

function publishTextDeltas(input: UseAgentEventAdapterInput, state: AdapterState): void {
  const agentId = input.agentId
  const streamId = state.streamId
  if (!agentId || !streamId) return

  for (const message of input.liveAssistants) {
    const current = getMessageText(message)
    const previous = state.textByMessageId.get(message.id)
    state.textByMessageId.set(message.id, current)
    if (previous === undefined) continue
    if (!current.startsWith(previous) || current.length <= previous.length) continue

    const delta = current.slice(previous.length)
    if (!delta) continue
    ;(input.bus ?? rendererAgentEventBus).publish(agentId, {
      ...getBaseEventFields(input, state),
      type: 'message.delta',
      messageId: message.id,
      delta
    })
  }
}

function publishToolEvents(input: UseAgentEventAdapterInput, state: AdapterState): void {
  const agentId = input.agentId
  const streamId = state.streamId
  if (!agentId || !streamId) return

  const bus = input.bus ?? rendererAgentEventBus
  for (const [messageId, parts] of Object.entries(input.partsByMessageId)) {
    for (const part of parts) {
      if (!isToolUIPart(part)) continue
      const toolCallId = String(part.toolCallId || '')
      if (!toolCallId) continue
      const toolName = getToolName(part) || part.type.replace(/^tool-/, '')
      const toolKey = `${messageId}:${toolCallId}`

      if (!state.startedToolCalls.has(toolKey)) {
        state.startedToolCalls.add(toolKey)
        bus.publish(agentId, {
          ...getBaseEventFields(input, state),
          type: 'tool.started',
          toolCallId,
          toolName
        })
      }

      const approvalId = part.approval?.id
      const approvalKey = approvalId ? `${messageId}:${approvalId}` : undefined
      if (
        part.state === 'approval-requested' &&
        approvalId &&
        approvalKey &&
        !state.requiredApprovals.has(approvalKey)
      ) {
        state.requiredApprovals.add(approvalKey)
        bus.publish(agentId, {
          ...getBaseEventFields(input, state),
          type: 'approval.required',
          approvalId,
          toolCallId,
          toolName,
          safePreview: '',
          previewRedacted: false,
          previewTruncated: false
        })
      }
    }
  }
}

function publishTerminal(input: UseAgentEventAdapterInput, state: AdapterState): void {
  const agentId = input.agentId
  const entry = input.streamStatus
  const streamId = state.streamId
  const messageId = state.activeMessageId
  if (!agentId || !entry || !streamId || !messageId || state.completedStreams.has(streamId)) return

  const bus = input.bus ?? rendererAgentEventBus
  if (entry.status === 'done') {
    state.completedStreams.add(streamId)
    bus.publish(agentId, { ...getBaseEventFields(input, state), type: 'message.completed', messageId })
  } else if (entry.status === 'aborted') {
    state.completedStreams.add(streamId)
    bus.publish(agentId, { ...getBaseEventFields(input, state), type: 'stream.cancelled' })
  } else if (entry.status === 'error') {
    state.completedStreams.add(streamId)
    bus.publish(agentId, { ...getBaseEventFields(input, state), type: 'stream.failed', error: 'Stream failed' })
  }
}

export function useAgentEventAdapter(input: UseAgentEventAdapterInput): void {
  const stateRef = useRef<AdapterState>(createAdapterState())

  useEffect(() => {
    const state = stateRef.current
    if (state.topicId !== input.topicId) resetForTopic(state, input.topicId)

    publishStarted(input, state)
    publishTextDeltas(input, state)
    publishToolEvents(input, state)
    publishTerminal(input, state)
  }, [input])
}
