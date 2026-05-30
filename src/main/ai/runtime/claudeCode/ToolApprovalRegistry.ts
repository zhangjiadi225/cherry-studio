import type { PermissionResult } from '@anthropic-ai/claude-agent-sdk'
import { loggerService } from '@logger'

const logger = loggerService.withContext('ToolApprovalRegistry')
const MAX_PREVIEW_LENGTH = 500
const MAX_PREVIEW_DEPTH = 3
const MAX_OBJECT_KEYS = 12
const REDACTED = '[REDACTED]'

const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN\s+(?:RSA\s+|EC\s+|OPENSSH\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA\s+|EC\s+|OPENSSH\s+)?PRIVATE\s+KEY-----/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /Bearer\s+[A-Za-z0-9_\-.~+/]+=*/g,
  /(?:api[_-]?key|api[_-]?secret|secret[_-]?key|password|passwd|token|access[_-]?token|client[_-]?secret|database[_-]?url)\s*[=:]\s*['"]?([^\s'"]{12,})['"]?/gi,
  /\bghp_[A-Za-z0-9]{36,}\b/g,
  /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g,
  /\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s'"]*(?:password|passwd|token|secret|key)[^\s'"]*/gi
]

type PendingApproval = {
  approvalId: string
  sessionId: string
  toolCallId: string
  toolName: string
  originalInput: Record<string, unknown>
  resolve: (result: PermissionResult) => void
  signal?: AbortSignal
  abortListener?: () => void
}

type SafePreviewResult = {
  safePreview: string
  previewRedacted: boolean
  previewTruncated: boolean
}

type DispatchDecision = {
  approved: boolean
  reason?: string
  updatedInput?: Record<string, unknown>
}

export type PendingApprovalSnapshot = Pick<PendingApproval, 'approvalId' | 'sessionId' | 'toolCallId' | 'toolName'> &
  SafePreviewResult

type PendingApprovalListener = (pendingCount: number, pendingApprovals: PendingApprovalSnapshot[]) => void

/**
 * Main-side dispatcher for tool-approval decisions. Holds each pending
 * `canUseTool` promise until the renderer's `Ai_ToolApproval_Respond` IPC
 * arrives, then resolves with the `PermissionResult` shape the Claude
 * Agent SDK expects.
 */
class ToolApprovalRegistry {
  private readonly pending = new Map<string, PendingApproval>()
  private readonly listeners = new Set<PendingApprovalListener>()

  register(entry: Omit<PendingApproval, 'abortListener'>): void {
    const { approvalId, signal } = entry
    if (this.pending.has(approvalId)) {
      logger.warn('Duplicate approval registration — rejecting', { approvalId })
      entry.resolve({ behavior: 'deny', message: 'Duplicate approval registration' })
      return
    }

    if (signal?.aborted) {
      entry.resolve({ behavior: 'deny', message: 'Tool request was cancelled before approval' })
      return
    }

    const stored: PendingApproval = { ...entry }
    if (signal) {
      const abortListener = () => this.dispatch(approvalId, { approved: false, reason: 'aborted' })
      stored.abortListener = abortListener
      signal.addEventListener('abort', abortListener, { once: true })
    }

    this.pending.set(approvalId, stored)
    this.notifyPendingChanged()
  }

  /** Returns `false` for unknown ids (already dispatched / session expired). */
  dispatch(approvalId: string, decision: DispatchDecision): boolean {
    const entry = this.pending.get(approvalId)
    if (!entry) return false
    this.pending.delete(approvalId)
    this.detachAbort(entry)
    this.notifyPendingChanged()

    entry.resolve(
      decision.approved
        ? { behavior: 'allow', updatedInput: decision.updatedInput ?? entry.originalInput }
        : { behavior: 'deny', message: decision.reason ?? 'User denied permission for this tool' }
    )
    return true
  }

  abort(sessionId: string, reason = 'session-aborted'): number {
    let aborted = 0
    for (const [approvalId, entry] of this.pending) {
      if (entry.sessionId !== sessionId) continue
      this.pending.delete(approvalId)
      this.detachAbort(entry)
      entry.resolve({ behavior: 'deny', message: reason })
      aborted++
    }
    if (aborted > 0) logger.info('Aborted pending approvals', { sessionId, count: aborted, reason })
    if (aborted > 0) this.notifyPendingChanged()
    return aborted
  }

  /**
   * Drop every pending approval. Call from the owning service's shutdown
   * path so the resolve callbacks don't strand dangling closures (and the
   * `canUseTool` promises don't hang forever) across a service restart.
   */
  clear(reason = 'service-shutdown'): number {
    const count = this.pending.size
    if (count === 0) return 0
    for (const [, entry] of this.pending) {
      this.detachAbort(entry)
      entry.resolve({ behavior: 'deny', message: reason })
    }
    this.pending.clear()
    logger.info('Cleared all pending approvals', { count, reason })
    this.notifyPendingChanged()
    return count
  }

  size(): number {
    return this.pending.size
  }

  onPendingChanged(listener: PendingApprovalListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private detachAbort(entry: PendingApproval): void {
    if (entry.signal && entry.abortListener) {
      entry.signal.removeEventListener('abort', entry.abortListener)
    }
  }

  private notifyPendingChanged(): void {
    const pendingCount = this.pending.size
    const pendingApprovals = [...this.pending.values()].map(
      ({ approvalId, sessionId, toolCallId, toolName, originalInput }) => ({
        approvalId,
        sessionId,
        toolCallId,
        toolName,
        ...buildSafeApprovalPreview(originalInput)
      })
    )
    for (const listener of this.listeners) {
      listener(pendingCount, pendingApprovals)
    }
  }
}

export const toolApprovalRegistry = new ToolApprovalRegistry()
export type { DispatchDecision }

export function buildSafeApprovalPreview(input: Record<string, unknown>): SafePreviewResult {
  const serialized = stableSafeStringify(input, 0)
  const redacted = redactSecrets(serialized)
  const previewTruncated = redacted.length > MAX_PREVIEW_LENGTH
  return {
    safePreview: previewTruncated ? `${redacted.slice(0, MAX_PREVIEW_LENGTH - 1).trimEnd()}…` : redacted,
    previewRedacted: redacted !== serialized,
    previewTruncated
  }
}

function stableSafeStringify(value: unknown, depth: number): string {
  if (depth >= MAX_PREVIEW_DEPTH) return '[Object]'
  if (value === null) return 'null'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_OBJECT_KEYS).map((item) => stableSafeStringify(item, depth + 1))
    if (value.length > MAX_OBJECT_KEYS) items.push(`… ${value.length - MAX_OBJECT_KEYS} more`)
    return `[${items.join(', ')}]`
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).slice(0, MAX_OBJECT_KEYS)
    const parts = entries.map(([key, item]) => `${key}: ${stableSafeStringify(item, depth + 1)}`)
    const extra = Object.keys(value as Record<string, unknown>).length - entries.length
    if (extra > 0) parts.push(`… ${extra} more`)
    return `{ ${parts.join(', ')} }`
  }
  return String(value)
}

function redactSecrets(text: string): string {
  let result = text
  for (const pattern of SECRET_PATTERNS) {
    pattern.lastIndex = 0
    result = result.replace(pattern, REDACTED)
  }
  return result
}
