import { sessionService } from '@data/services/SessionService'
import { loggerService } from '@logger'
import { buildAgentSessionTopicId, extractAgentSessionId, isAgentSessionTopic } from '@main/ai/agentSession/topic'
import { type PendingApprovalSnapshot, toolApprovalRegistry } from '@main/ai/runtime/claudeCode/ToolApprovalRegistry'
import {
  type StreamDoneResult,
  type StreamErrorResult,
  type StreamListener,
  type StreamPausedResult
} from '@main/ai/streamManager/types'
import { application } from '@main/core/application'
import {
  BaseService,
  DependsOn,
  Emitter,
  type Event,
  Injectable,
  Phase,
  ServicePhase,
  toDisposable
} from '@main/core/lifecycle'
import type { AgentPresentationEvent, AgentPresentationScope } from '@shared/ai/agentPresentationEvents'
import type { TopicStatusSnapshotEntry } from '@shared/ai/transport'
import type { CherryUIMessage } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import { IpcChannel } from '@shared/IpcChannel'
import type { UIMessageChunk } from 'ai'

const logger = loggerService.withContext('AgentPresentationEventBridge')
const AGENT_PRESENTATION_REPLAY_LIMIT = 500
const STREAM_KEY_PREFIX = 'topic.stream.statuses.'

type AgentSessionIdentity = {
  agentId: string
  sessionId: string
  topicId: string
  streamId: string
  turnId?: string
}

class AgentPresentationStreamListener implements StreamListener {
  readonly id: string
  private readonly textByExecution = new Map<string, string>()

  constructor(
    readonly topicId: string,
    private readonly identity: AgentSessionIdentity,
    private readonly publish: (event: AgentPresentationEvent) => void
  ) {
    this.id = `agent-presentation:${identity.sessionId}`
  }

  onChunk(chunk: UIMessageChunk, sourceModelId?: UniqueModelId): void {
    this.publishToolStarted(chunk)

    const delta = extractTextDelta(chunk)
    if (!delta) return

    const executionKey = sourceModelId ?? 'default'
    this.textByExecution.set(executionKey, `${this.textByExecution.get(executionKey) ?? ''}${delta}`)
    this.publish({
      ...this.baseScope(chunkMessageId(chunk)),
      type: 'message.delta',
      messageId: chunkMessageId(chunk) ?? this.identity.streamId,
      delta
    })
  }

  onDone(result: StreamDoneResult): void {
    if (!result.isTopicDone) return
    this.publish({
      ...this.baseScope(result.finalMessage?.id),
      type: 'message.completed',
      message: result.finalMessage,
      text: extractMessageText(result.finalMessage) ?? this.getCombinedText()
    })
  }

  onPaused(result: StreamPausedResult): void {
    if (!result.isTopicDone) return
    this.publish({
      ...this.baseScope(result.finalMessage?.id),
      type: 'stream.cancelled',
      message: result.finalMessage,
      text: extractMessageText(result.finalMessage) ?? this.getCombinedText()
    })
  }

  onError(result: StreamErrorResult): void {
    if (!result.isTopicDone) return
    this.publish({
      ...this.baseScope(result.finalMessage?.id),
      type: 'stream.failed',
      error: result.error.message ?? 'Stream failed',
      message: result.finalMessage,
      text: extractMessageText(result.finalMessage) ?? this.getCombinedText()
    })
  }

  isAlive(): boolean {
    return true
  }

  private publishToolStarted(chunk: UIMessageChunk): void {
    const record = chunk as Record<string, unknown>
    const type = typeof record.type === 'string' ? record.type : ''
    if (!type.startsWith('tool-') && type !== 'tool-call') return

    const toolCallId = stringValue(record.toolCallId) ?? stringValue(record.id)
    if (!toolCallId) return
    const toolName = stringValue(record.toolName) ?? (type.replace(/^tool-/, '') || 'tool')

    this.publish({
      ...this.baseScope(chunkMessageId(chunk)),
      type: 'tool.started',
      toolCallId,
      toolName
    })
  }

  private baseScope(messageId?: string): AgentPresentationScope {
    return {
      agentId: this.identity.agentId,
      sessionId: this.identity.sessionId,
      streamId: this.identity.streamId,
      turnId: this.identity.turnId,
      messageId,
      timestamp: Date.now()
    }
  }

  private getCombinedText(): string {
    return [...this.textByExecution.values()].join('\n\n').trim()
  }
}

@Injectable('AgentPresentationEventBridge')
@ServicePhase(Phase.WhenReady)
@DependsOn(['AiStreamManager', 'WindowManager'])
export class AgentPresentationEventBridge extends BaseService {
  private readonly eventEmitter = this.registerDisposable(new Emitter<AgentPresentationEvent>())
  public readonly onAgentPresentationEvent: Event<AgentPresentationEvent> = this.eventEmitter.event
  private readonly replayEvents: AgentPresentationEvent[] = []
  private readonly streamListeners = new Map<string, AgentPresentationStreamListener>()
  private readonly identityBySessionId = new Map<string, AgentSessionIdentity>()
  private readonly pendingApprovalSessionIdsById = new Map<string, string>()

  protected async onInit(): Promise<void> {
    this.ipcHandle(IpcChannel.Ai_AgentPresentation_GetReplay, () => this.getReplayEvents())
    this.registerDisposable(
      application
        .get('CacheService')
        .subscribeSharedChange('topic.stream.statuses.${topicId}' as const, (entry, _previous, concreteKey) => {
          void this.handleTopicStreamStatus(entry ?? null, concreteKey)
        })
    )
    this.registerDisposable(
      toDisposable(
        toolApprovalRegistry.onPendingChanged((_pendingCount, pendingApprovals) => {
          void this.handlePendingApprovals(pendingApprovals)
        })
      )
    )
  }

  public getReplayEvents(): AgentPresentationEvent[] {
    return [...this.replayEvents]
  }

  private async handleTopicStreamStatus(entry: TopicStatusSnapshotEntry | null, concreteKey: string): Promise<void> {
    const topicId = parseTopicIdFromStreamConcreteKey(concreteKey)
    if (!topicId || !isAgentSessionTopic(topicId) || !entry) return

    const identity = await this.resolveIdentity(topicId, entry.turnId)
    if (!identity) return

    if (entry.status === 'pending' || entry.status === 'streaming') {
      this.publish({ ...this.scope(identity), type: 'stream.started', status: entry.status })
      this.ensureStreamListener(identity)
      return
    }

    if (entry.status === 'awaiting-approval') {
      this.ensureStreamListener(identity)
    }
  }

  private async handlePendingApprovals(pendingApprovals: PendingApprovalSnapshot[]): Promise<void> {
    const nextApprovalIds = new Set(pendingApprovals.map((approval) => approval.approvalId))

    for (const approval of pendingApprovals) {
      const topicId = buildAgentSessionTopicId(approval.sessionId)
      const identity = await this.resolveIdentity(topicId)
      if (!identity) continue

      this.pendingApprovalSessionIdsById.set(approval.approvalId, approval.sessionId)
      this.publish({
        ...this.scope(identity),
        type: 'approval.required',
        approvalId: approval.approvalId,
        toolCallId: approval.toolCallId,
        toolName: approval.toolName,
        safePreview: approval.safePreview,
        previewRedacted: approval.previewRedacted,
        previewTruncated: approval.previewTruncated
      })
    }

    for (const [approvalId, sessionId] of this.pendingApprovalSessionIdsById) {
      if (nextApprovalIds.has(approvalId)) continue
      this.pendingApprovalSessionIdsById.delete(approvalId)
      const identity = await this.resolveIdentity(buildAgentSessionTopicId(sessionId))
      if (!identity) continue
      this.publish({ ...this.scope(identity), type: 'approval.resolved', approvalId, result: 'resolved' })
    }
  }

  private ensureStreamListener(identity: AgentSessionIdentity): void {
    if (this.streamListeners.has(identity.sessionId)) return

    const listener = new AgentPresentationStreamListener(identity.topicId, identity, (event) => this.publish(event))
    if (application.get('AiStreamManager').addListener(identity.topicId, listener)) {
      this.streamListeners.set(identity.sessionId, listener)
    }
  }

  private releaseStreamListener(sessionId: string): void {
    const listener = this.streamListeners.get(sessionId)
    if (!listener) return
    application.get('AiStreamManager').removeListener(listener.topicId, listener.id)
    this.streamListeners.delete(sessionId)
  }

  private publish(event: AgentPresentationEvent): void {
    this.replayEvents.push(event)
    if (this.replayEvents.length > AGENT_PRESENTATION_REPLAY_LIMIT) {
      this.replayEvents.splice(0, this.replayEvents.length - AGENT_PRESENTATION_REPLAY_LIMIT)
    }
    this.eventEmitter.fire(event)
    application.get('WindowManager').broadcast(IpcChannel.Ai_AgentPresentation_Event, event)
    if (event.type === 'message.completed' || event.type === 'stream.failed' || event.type === 'stream.cancelled') {
      this.releaseStreamListener(event.sessionId)
    }
  }

  private async resolveIdentity(topicId: string, turnId?: string): Promise<AgentSessionIdentity | null> {
    const sessionId = extractAgentSessionId(topicId)
    const existing = this.identityBySessionId.get(sessionId)
    if (existing && (!turnId || existing.turnId === turnId)) return existing

    try {
      const session = await sessionService.getById(sessionId)
      const agentId = session.agentId?.trim() || `session:${sessionId}`
      const identity = {
        agentId,
        sessionId,
        topicId,
        streamId: turnId ?? existing?.streamId ?? sessionId,
        turnId
      }
      this.identityBySessionId.set(sessionId, identity)
      return identity
    } catch (error) {
      logger.debug('Failed to resolve agent presentation identity', {
        sessionId,
        error: error instanceof Error ? error.message : String(error)
      })
      return null
    }
  }

  private scope(identity: AgentSessionIdentity): AgentPresentationScope {
    return {
      agentId: identity.agentId,
      sessionId: identity.sessionId,
      streamId: identity.streamId,
      turnId: identity.turnId,
      timestamp: Date.now()
    }
  }
}

function parseTopicIdFromStreamConcreteKey(concreteKey: string): string | null {
  if (!concreteKey.startsWith(STREAM_KEY_PREFIX)) return null
  return concreteKey.slice(STREAM_KEY_PREFIX.length)
}

function extractTextDelta(chunk: UIMessageChunk): string {
  const record = chunk as Record<string, unknown>
  return record.type === 'text-delta' && typeof record.delta === 'string' ? record.delta : ''
}

function chunkMessageId(chunk: UIMessageChunk): string | undefined {
  const record = chunk as Record<string, unknown>
  return stringValue(record.messageId) ?? stringValue(record.id)
}

function extractMessageText(message?: CherryUIMessage): string | undefined {
  const text = message?.parts
    ?.map((part) => {
      if ('text' in part && typeof part.text === 'string') return part.text
      if ('type' in part && typeof part.type === 'string' && part.type.startsWith('tool-')) return `[${part.type}]`
      return ''
    })
    .filter(Boolean)
    .join(' ')
    .trim()

  return text || undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
