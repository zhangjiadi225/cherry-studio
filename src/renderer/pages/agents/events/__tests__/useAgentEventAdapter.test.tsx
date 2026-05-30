import type { ActiveExecution, TopicStatusSnapshotEntry } from '@shared/ai/transport'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { AgentEventHandler } from '../agentEventBus'
import { createAgentEventBus } from '../agentEventBus'
import { useAgentEventAdapter } from '../useAgentEventAdapter'

const EXECUTION_ID = 'openai::gpt-4o' as UniqueModelId

function execution(anchorMessageId = 'assistant-1'): ActiveExecution {
  return { executionId: EXECUTION_ID, anchorMessageId }
}

function statusEntry(
  status: TopicStatusSnapshotEntry['status'],
  activeExecutions: ActiveExecution[] = []
): TopicStatusSnapshotEntry {
  return {
    status,
    turnId: 'turn-1',
    activeExecutions,
    awaitingApprovalAnchors: [],
    pendingQueue: []
  }
}

function assistant(id: string, text: string): CherryUIMessage {
  return {
    id,
    role: 'assistant',
    parts: text ? ([{ type: 'text', text }] as unknown as CherryMessagePart[]) : []
  } as CherryUIMessage
}

function toolPart(overrides: Record<string, unknown> = {}): CherryMessagePart {
  return {
    type: 'tool-Read',
    toolName: 'Read',
    toolCallId: 'tool-1',
    state: 'input-available',
    input: { file_path: 'README.md' },
    ...overrides
  } as unknown as CherryMessagePart
}

function expectEvent(handler: ReturnType<typeof vi.fn<AgentEventHandler>>, event: Record<string, unknown>): void {
  expect(handler).toHaveBeenCalledWith(
    expect.objectContaining({
      sessionId: 'session-1',
      timestamp: expect.any(Number),
      turnId: 'turn-1',
      ...event
    })
  )
}

function renderAdapter(input: {
  bus: ReturnType<typeof createAgentEventBus>
  agentId?: string
  streamStatus?: TopicStatusSnapshotEntry
  liveAssistants?: CherryUIMessage[]
  partsByMessageId?: Record<string, CherryMessagePart[]>
}) {
  const initialProps = {
    agentId: 'agent-1',
    topicId: 'agent-session:session-1',
    streamStatus: undefined,
    liveAssistants: [],
    partsByMessageId: {},
    ...input
  }
  const hook = renderHook((props: typeof initialProps) => useAgentEventAdapter(props), {
    initialProps
  })
  return {
    ...hook,
    rerender: (next: Partial<typeof initialProps>) => hook.rerender({ ...initialProps, ...next })
  }
}

describe('useAgentEventAdapter', () => {
  it('publishes stream.started when an agent execution becomes active', () => {
    const bus = createAgentEventBus()
    const handler = vi.fn<AgentEventHandler>()
    bus.subscribe('agent-1', handler)

    const { rerender } = renderAdapter({ bus, streamStatus: statusEntry('pending', []) })
    rerender({ bus, streamStatus: statusEntry('streaming', [execution()]) })

    expectEvent(handler, {
      type: 'stream.started',
      agentId: 'agent-1',
      streamId: 'turn-1',
      messageId: 'assistant-1'
    })
  })

  it('publishes message.delta when live assistant text grows', () => {
    const bus = createAgentEventBus()
    const handler = vi.fn<AgentEventHandler>()
    bus.subscribe('agent-1', handler)

    const { rerender } = renderAdapter({
      bus,
      streamStatus: statusEntry('streaming', [execution()]),
      liveAssistants: [assistant('assistant-1', 'hello')]
    })
    rerender({
      bus,
      streamStatus: statusEntry('streaming', [execution()]),
      liveAssistants: [assistant('assistant-1', 'hello world')]
    })

    expectEvent(handler, {
      type: 'message.delta',
      agentId: 'agent-1',
      streamId: 'turn-1',
      messageId: 'assistant-1',
      delta: ' world'
    })
  })

  it('publishes tool and approval events from message parts once', () => {
    const bus = createAgentEventBus()
    const handler = vi.fn<AgentEventHandler>()
    bus.subscribe('agent-1', handler)
    const approvalPart = toolPart({
      state: 'approval-requested',
      approval: { id: 'approval-1' }
    })

    const { rerender } = renderAdapter({
      bus,
      streamStatus: statusEntry('awaiting-approval', [execution()]),
      partsByMessageId: { 'assistant-1': [approvalPart] }
    })
    rerender({
      bus,
      streamStatus: statusEntry('awaiting-approval', [execution()]),
      partsByMessageId: { 'assistant-1': [approvalPart] }
    })

    expect(handler).toHaveBeenCalledTimes(3)
    expectEvent(handler, {
      type: 'stream.started',
      agentId: 'agent-1',
      streamId: 'turn-1',
      messageId: 'assistant-1'
    })
    expectEvent(handler, {
      type: 'tool.started',
      agentId: 'agent-1',
      streamId: 'turn-1',
      toolCallId: 'tool-1',
      toolName: 'Read'
    })
    expectEvent(handler, {
      type: 'approval.required',
      agentId: 'agent-1',
      streamId: 'turn-1',
      approvalId: 'approval-1',
      toolCallId: 'tool-1',
      toolName: 'Read',
      safePreview: '',
      previewRedacted: false,
      previewTruncated: false
    })
  })

  it('publishes terminal events from topic stream status', () => {
    const bus = createAgentEventBus()
    const handler = vi.fn<AgentEventHandler>()
    bus.subscribe('agent-1', handler)

    const { rerender } = renderAdapter({
      bus,
      streamStatus: statusEntry('streaming', [execution()]),
      liveAssistants: [assistant('assistant-1', 'done')]
    })
    rerender({
      bus,
      streamStatus: statusEntry('done', []),
      liveAssistants: [assistant('assistant-1', 'done')]
    })

    expectEvent(handler, {
      type: 'message.completed',
      agentId: 'agent-1',
      streamId: 'turn-1',
      messageId: 'assistant-1'
    })
  })
})
