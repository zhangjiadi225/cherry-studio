import type { StreamListener } from '@main/ai/streamManager/types'
import { BaseService } from '@main/core/lifecycle/BaseService'
import type { AgentPresentationEvent } from '@shared/ai/agentPresentationEvents'
import type { TopicStatusSnapshotEntry } from '@shared/ai/transport'
import type { UIMessageChunk } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  addListener: vi.fn<(topicId: string, listener: StreamListener) => boolean>(() => true),
  removeListener: vi.fn<(topicId: string, listenerId: string) => void>(),
  applicationGet: vi.fn(),
  broadcast: vi.fn<(channel: string, event: AgentPresentationEvent) => void>(),
  getSessionById: vi.fn(),
  onPendingChanged: vi.fn()
}))

vi.mock('@main/core/application', () => ({
  application: { get: mocks.applicationGet }
}))

vi.mock('@application', () => ({
  application: { get: mocks.applicationGet }
}))

vi.mock('@data/services/SessionService', () => ({
  sessionService: { getById: mocks.getSessionById }
}))

vi.mock('@main/ai/runtime/claudeCode/ToolApprovalRegistry', () => ({
  toolApprovalRegistry: {
    onPendingChanged: mocks.onPendingChanged
  }
}))

const { AgentPresentationEventBridge } = await import('../AgentPresentationEventBridge')

type SharedChangeCallback = (
  entry: TopicStatusSnapshotEntry | null,
  previous: TopicStatusSnapshotEntry | null,
  concreteKey: string
) => void

type PendingApprovalCallback = Parameters<typeof mocks.onPendingChanged>[0]

function createService() {
  const sharedChangeCallbacks: SharedChangeCallback[] = []
  const pendingApprovalCallbacks: PendingApprovalCallback[] = []
  const events: AgentPresentationEvent[] = []

  mocks.applicationGet.mockImplementation((name: string) => {
    if (name === 'CacheService') {
      return {
        subscribeSharedChange: vi.fn((_key: string, callback: SharedChangeCallback) => {
          sharedChangeCallbacks.push(callback)
          return vi.fn()
        })
      }
    }
    if (name === 'AiStreamManager') {
      return {
        addListener: mocks.addListener,
        removeListener: mocks.removeListener
      }
    }
    if (name === 'WindowManager') {
      return {
        broadcast: mocks.broadcast
      }
    }
    throw new Error(`Unexpected application.get(${name})`)
  })
  mocks.onPendingChanged.mockImplementation((callback: PendingApprovalCallback) => {
    pendingApprovalCallbacks.push(callback)
    return vi.fn()
  })

  const service = new AgentPresentationEventBridge()
  service.onAgentPresentationEvent((event) => events.push(event))

  return {
    service,
    events,
    emitTopicStatus: async (topicId: string, entry: TopicStatusSnapshotEntry | null) => {
      sharedChangeCallbacks[0]?.(entry, null, `topic.stream.statuses.${topicId}`)
      await Promise.resolve()
    },
    emitPendingApprovals: async (
      approvals: Array<{
        approvalId: string
        sessionId: string
        toolCallId: string
        toolName: string
        safePreview: string
        previewRedacted: boolean
        previewTruncated: boolean
      }>
    ) => {
      pendingApprovalCallbacks[0]?.(approvals.length, approvals)
      await Promise.resolve()
    }
  }
}

function listener() {
  const registered = mocks.addListener.mock.calls.at(-1)?.[1] as StreamListener | undefined
  if (!registered) throw new Error('stream listener was not registered')
  return registered
}

describe('AgentPresentationEventBridge', () => {
  beforeEach(() => {
    BaseService.resetInstances()
    vi.clearAllMocks()
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    mocks.addListener.mockReturnValue(true)
    mocks.getSessionById.mockImplementation(async (sessionId: string) => ({
      id: sessionId,
      agentId: `agent-${sessionId}`
    }))
  })

  it('emits stream.started for agent-session pending and streaming cache statuses', async () => {
    const { service, events, emitTopicStatus } = createService()
    await service._doInit()

    await emitTopicStatus('agent-session:session-1', {
      status: 'pending',
      turnId: 'turn-1'
    } as TopicStatusSnapshotEntry)
    await emitTopicStatus('agent-session:session-1', {
      status: 'streaming',
      turnId: 'turn-1'
    } as TopicStatusSnapshotEntry)

    expect(events).toEqual([
      {
        type: 'stream.started',
        agentId: 'agent-session-1',
        sessionId: 'session-1',
        streamId: 'turn-1',
        turnId: 'turn-1',
        timestamp: 1_700_000_000_000,
        status: 'pending'
      },
      {
        type: 'stream.started',
        agentId: 'agent-session-1',
        sessionId: 'session-1',
        streamId: 'turn-1',
        turnId: 'turn-1',
        timestamp: 1_700_000_000_000,
        status: 'streaming'
      }
    ])
    expect(mocks.addListener).toHaveBeenCalledTimes(1)
    expect(mocks.addListener).toHaveBeenCalledWith(
      'agent-session:session-1',
      expect.objectContaining({ id: 'agent-presentation:session-1' })
    )
    expect(service.getReplayEvents()).toEqual(events)
    expect(mocks.broadcast).toHaveBeenCalledTimes(2)
  })

  it('ignores non-agent topic status', async () => {
    const { service, events, emitTopicStatus } = createService()
    await service._doInit()

    await emitTopicStatus('topic-1', { status: 'pending', turnId: 'turn-1' } as TopicStatusSnapshotEntry)

    expect(events).toEqual([])
    expect(mocks.getSessionById).not.toHaveBeenCalled()
    expect(mocks.addListener).not.toHaveBeenCalled()
  })

  it('maps stream listener chunks to presentation events and releases on done', async () => {
    const { service, events, emitTopicStatus } = createService()
    await service._doInit()
    await emitTopicStatus('agent-session:session-1', {
      status: 'pending',
      turnId: 'turn-1'
    } as TopicStatusSnapshotEntry)

    const streamListener = listener()
    streamListener.onChunk(
      { type: 'text-delta', id: 'message-1', delta: 'hello' } as UIMessageChunk,
      'provider::model-1'
    )
    streamListener.onChunk({
      type: 'tool-bash',
      id: 'message-1',
      toolCallId: 'tool-1',
      toolName: 'Bash'
    } as unknown as UIMessageChunk)
    await streamListener.onDone({
      status: 'success',
      isTopicDone: true,
      finalMessage: {
        id: 'message-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'hello world' }]
      }
    })

    expect(events.map((event) => event.type)).toEqual([
      'stream.started',
      'message.delta',
      'tool.started',
      'message.completed'
    ])
    expect(events[1]).toMatchObject({
      type: 'message.delta',
      agentId: 'agent-session-1',
      sessionId: 'session-1',
      streamId: 'turn-1',
      turnId: 'turn-1',
      messageId: 'message-1',
      delta: 'hello'
    })
    expect(events[2]).toMatchObject({
      type: 'tool.started',
      toolCallId: 'tool-1',
      toolName: 'Bash'
    })
    expect(events[3]).toMatchObject({
      type: 'message.completed',
      message: { id: 'message-1' },
      text: 'hello world'
    })
    expect(mocks.removeListener).toHaveBeenCalledWith('agent-session:session-1', 'agent-presentation:session-1')
  })

  it('maps error and paused terminal events and releases each listener', async () => {
    const failed = createService()
    await failed.service._doInit()
    await failed.emitTopicStatus('agent-session:session-1', {
      status: 'pending',
      turnId: 'turn-error'
    } as TopicStatusSnapshotEntry)
    await listener().onError({
      status: 'error',
      isTopicDone: true,
      error: { name: 'Error', message: 'boom', stack: 'Error: boom' },
      finalMessage: {
        id: 'message-error',
        role: 'assistant',
        parts: [{ type: 'text', text: 'partial text' }]
      }
    })

    BaseService.resetInstances()
    const cancelled = createService()
    await cancelled.service._doInit()
    await cancelled.emitTopicStatus('agent-session:session-2', {
      status: 'pending',
      turnId: 'turn-paused'
    } as TopicStatusSnapshotEntry)
    await listener().onPaused({
      status: 'paused',
      isTopicDone: true,
      finalMessage: {
        id: 'message-paused',
        role: 'assistant',
        parts: [{ type: 'text', text: 'paused text' }]
      }
    })

    expect(failed.events.at(-1)).toMatchObject({
      type: 'stream.failed',
      sessionId: 'session-1',
      streamId: 'turn-error',
      error: 'boom',
      text: 'partial text'
    })
    expect(cancelled.events.at(-1)).toMatchObject({
      type: 'stream.cancelled',
      sessionId: 'session-2',
      streamId: 'turn-paused',
      text: 'paused text'
    })
    expect(mocks.removeListener).toHaveBeenCalledWith('agent-session:session-1', 'agent-presentation:session-1')
    expect(mocks.removeListener).toHaveBeenCalledWith('agent-session:session-2', 'agent-presentation:session-2')
  })

  it('emits approval.required and approval.resolved for pending approvals', async () => {
    const { service, events, emitPendingApprovals } = createService()
    await service._doInit()

    await emitPendingApprovals([
      {
        approvalId: 'approval-1',
        sessionId: 'session-1',
        toolCallId: 'tool-1',
        toolName: 'Bash',
        safePreview: 'echo hello',
        previewRedacted: false,
        previewTruncated: false
      }
    ])
    await emitPendingApprovals([])

    expect(events).toEqual([
      {
        type: 'approval.required',
        agentId: 'agent-session-1',
        sessionId: 'session-1',
        streamId: 'session-1',
        timestamp: 1_700_000_000_000,
        approvalId: 'approval-1',
        toolCallId: 'tool-1',
        toolName: 'Bash',
        safePreview: 'echo hello',
        previewRedacted: false,
        previewTruncated: false
      },
      {
        type: 'approval.resolved',
        agentId: 'agent-session-1',
        sessionId: 'session-1',
        streamId: 'session-1',
        timestamp: 1_700_000_000_000,
        approvalId: 'approval-1',
        result: 'resolved'
      }
    ])
  })
})
