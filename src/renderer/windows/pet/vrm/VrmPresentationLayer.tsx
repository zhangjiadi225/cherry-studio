import type {
  PetPermissionPromptSnapshot,
  PetQueueReason,
  PetTaskBinding,
  PetTaskBubbleSnapshot,
  PetTaskStatus
} from '@shared/pet'
import { CheckCircle2, Clock3, ExternalLink, LoaderCircle, ShieldAlert, TriangleAlert } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { openPetTask } from '../presentation/petPresentationActions'
import { getPetTaskPreview } from '../presentation/petTaskPreview'
import type { PetVrmStageModel } from './types'

const PET_VRM_PRESENTATION_MAX_ITEMS = 5
const PET_VRM_PRESENTATION_STATUS_LABEL_KEYS = {
  aborted: 'settings.pet.bubble.status.aborted',
  done: 'settings.pet.bubble.status.done',
  failed: 'settings.pet.bubble.status.failed',
  pending: 'settings.pet.permission.quiet_pending',
  queued: 'settings.pet.queue.tasks_queued',
  review: 'settings.pet.bubble.status.review',
  running: 'settings.pet.bubble.status.running',
  waiting: 'settings.pet.bubble.status.waiting'
} as const
const PET_VRM_QUEUE_REASON_LABEL_KEYS: Record<PetQueueReason, string> = {
  'bound-busy': 'settings.pet.queue.reason.bound-busy',
  'bound-disabled': 'settings.pet.queue.reason.bound-disabled',
  'no-enabled-pet': 'settings.pet.queue.reason.no-enabled-pet',
  'no-free-pet': 'settings.pet.queue.reason.no-free-pet'
}

type PetVrmPresentationStatus = PetTaskStatus | 'pending' | 'queued'
type PetVrmPresentationKind = 'permission' | 'task'

export type PetVrmPresentationItem = {
  currentToolName?: string
  kind: PetVrmPresentationKind
  modelId: string
  modelOrder: number
  previewRedacted?: boolean
  previewTruncated?: boolean
  priority: number
  queueReason?: PetQueueReason
  sourceTitle: string
  status: PetVrmPresentationStatus
  summary: string
  taskKey: string
  title: string
  toolName?: string
  updatedAt: number
}

export function PetVrmPresentationLayer({
  bindings,
  bubbles,
  models,
  permissionPrompts,
  queuedTasks,
  stageWidth
}: {
  bindings: PetTaskBinding[]
  bubbles: PetTaskBubbleSnapshot[]
  models: PetVrmStageModel[]
  permissionPrompts: PetPermissionPromptSnapshot[]
  queuedTasks: PetTaskBinding[]
  stageWidth: number
}) {
  const items = useMemo(
    () =>
      buildPetVrmPresentationItems({
        bindings,
        bubbles,
        models,
        permissionPrompts,
        queuedTasks
      }),
    [bindings, bubbles, models, permissionPrompts, queuedTasks]
  )

  if (!items.length) return null

  const width = Math.max(220, Math.min(320, stageWidth - 20))

  return (
    <div
      data-pet-hit-zone="true"
      data-testid="pet-vrm-presentation-layer"
      style={{
        display: 'grid',
        gap: 8,
        pointerEvents: 'auto',
        position: 'absolute',
        right: 10,
        top: 10,
        width,
        zIndex: 325
      }}>
      {items.map((item) => (
        <PetVrmPresentationCard key={`${item.modelId}:${item.taskKey}:${item.kind}`} item={item} />
      ))}
    </div>
  )
}

export function buildPetVrmPresentationItems(input: {
  bindings: PetTaskBinding[]
  bubbles: PetTaskBubbleSnapshot[]
  models: PetVrmStageModel[]
  permissionPrompts: PetPermissionPromptSnapshot[]
  queuedTasks: PetTaskBinding[]
}): PetVrmPresentationItem[] {
  const modelById = new Map(input.models.map((model) => [model.modelId, model]))
  const candidates: PetVrmPresentationItem[] = []

  for (const prompt of input.permissionPrompts) {
    if (prompt.dismissed) continue
    const model = getVrmPresentationModel(prompt, modelById)
    if (!model) continue
    candidates.push({
      kind: 'permission',
      modelId: model.modelId,
      modelOrder: model.order,
      previewRedacted: prompt.previewRedacted,
      previewTruncated: prompt.previewTruncated,
      priority: getVrmPresentationPriority('pending'),
      sourceTitle: prompt.sourceTitle,
      status: 'pending',
      summary: prompt.safePreview,
      taskKey: prompt.taskKey,
      title: prompt.title,
      toolName: prompt.toolName,
      updatedAt: prompt.updatedAt
    })
  }

  for (const binding of input.bindings) {
    if (binding.bubbleDismissed) continue
    const model = getVrmPresentationModel(binding, modelById)
    if (!model) continue
    candidates.push(
      taskToVrmPresentationItem(binding, model, binding.status, getVrmPresentationPriority(binding.status))
    )
  }

  for (const task of input.queuedTasks) {
    if (task.bubbleDismissed) continue
    const model = getVrmPresentationModel(task, modelById)
    if (!model) continue
    candidates.push(taskToVrmPresentationItem(task, model, 'queued', getVrmPresentationPriority('queued')))
  }

  for (const bubble of input.bubbles) {
    if (bubble.bubbleDismissed) continue
    const model = getVrmPresentationModel(bubble, modelById)
    if (!model) continue
    candidates.push(taskToVrmPresentationItem(bubble, model, bubble.status, getVrmPresentationPriority(bubble.status)))
  }

  const bestByModelId = new Map<string, PetVrmPresentationItem>()
  for (const item of candidates.sort(compareVrmPresentationItems)) {
    if (!bestByModelId.has(item.modelId)) bestByModelId.set(item.modelId, item)
  }

  return [...bestByModelId.values()]
    .sort((left, right) => left.modelOrder - right.modelOrder || left.modelId.localeCompare(right.modelId))
    .slice(0, PET_VRM_PRESENTATION_MAX_ITEMS)
}

function PetVrmPresentationCard({ item }: { item: PetVrmPresentationItem }) {
  const { t } = useTranslation()
  const openLabel = t('settings.pet.permission.open_in_cherry')
  const openTask = useCallback(() => void openPetTask(item.taskKey), [item.taskKey])
  const tone = getVrmPresentationTone(item.status)
  const statusLabel = getVrmPresentationStatusLabel(item.status, t)
  const title = item.kind === 'permission' ? t('settings.pet.permission.title') : item.title
  const detail =
    item.kind === 'permission'
      ? [item.toolName, item.title].filter(Boolean).join(' / ')
      : item.currentToolName || getQueueReasonText(item.queueReason, t) || item.sourceTitle

  return (
    <section
      data-status={item.status}
      data-testid={`pet-vrm-presentation-${toTestId(item.modelId)}`}
      style={{
        background: 'color-mix(in srgb, var(--color-popover) 86%, transparent)',
        border: `1px solid ${tone.border}`,
        borderRadius: 8,
        boxShadow: '0 12px 28px rgba(15,23,42,0.18)',
        color: 'var(--color-foreground, #1f2933)',
        display: 'grid',
        gap: 7,
        lineHeight: 1.35,
        padding: 9,
        backdropFilter: 'blur(16px)'
      }}>
      <div style={{ alignItems: 'center', display: 'flex', gap: 8, minWidth: 0 }}>
        <span
          aria-hidden
          style={{
            alignItems: 'center',
            background: tone.background,
            borderRadius: 999,
            color: tone.icon,
            display: 'inline-flex',
            flex: '0 0 auto',
            height: 24,
            justifyContent: 'center',
            width: 24
          }}>
          {getVrmPresentationIcon(item.status)}
        </span>
        <div style={{ display: 'grid', flex: 1, minWidth: 0 }}>
          <div style={{ color: tone.text, fontSize: 10.5, fontWeight: 800 }}>{statusLabel}</div>
          <div style={{ ...oneLineTextStyle, fontSize: 12, fontWeight: 800 }}>{title}</div>
        </div>
        <button type="button" aria-label={openLabel} onClick={openTask} title={openLabel} style={vrmOpenButtonStyle}>
          <ExternalLink aria-hidden size={13} strokeWidth={2.2} />
        </button>
      </div>

      <div style={{ alignItems: 'center', display: 'flex', gap: 6, minWidth: 0 }}>
        <span style={modelBadgeStyle}>{item.modelId}</span>
        {detail ? (
          <span style={{ ...oneLineTextStyle, color: 'var(--color-foreground-muted, #697586)' }}>{detail}</span>
        ) : null}
      </div>

      {item.summary ? (
        <div
          style={{
            background: 'var(--color-muted, rgba(15,23,42,0.06))',
            border: '1px solid var(--color-border-subtle, var(--color-border))',
            borderRadius: 6,
            color: 'var(--color-foreground-secondary, #4b5563)',
            fontFamily:
              item.kind === 'permission'
                ? 'var(--font-family-mono, ui-monospace, SFMono-Regular, Menlo, monospace)'
                : undefined,
            fontSize: 11,
            maxHeight: item.kind === 'permission' ? 52 : 36,
            overflow: 'hidden',
            padding: '5px 6px',
            whiteSpace: item.kind === 'permission' ? 'pre-wrap' : 'normal',
            wordBreak: 'break-word'
          }}>
          {item.summary}
        </div>
      ) : null}

      {item.previewRedacted || item.previewTruncated ? (
        <div style={{ display: 'flex', gap: 5 }}>
          {item.previewRedacted ? (
            <PetVrmPresentationTag>{t('settings.pet.permission.redacted')}</PetVrmPresentationTag>
          ) : null}
          {item.previewTruncated ? (
            <PetVrmPresentationTag>{t('settings.pet.permission.truncated')}</PetVrmPresentationTag>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

function PetVrmPresentationTag({ children }: { children: string }) {
  return <span style={tagStyle}>{children}</span>
}

function taskToVrmPresentationItem(
  task: PetTaskBinding | PetTaskBubbleSnapshot,
  model: PetVrmStageModel,
  status: PetVrmPresentationStatus,
  priority: number
): PetVrmPresentationItem {
  return {
    currentToolName: task.currentToolName,
    kind: 'task',
    modelId: model.modelId,
    modelOrder: model.order,
    priority,
    queueReason: task.queueReason,
    sourceTitle: task.sourceTitle,
    status,
    summary: getPetTaskPreview(task),
    taskKey: task.taskKey,
    title: task.title,
    updatedAt: task.updatedAt
  }
}

function getVrmPresentationModel(
  task: { animalId: string; petTargetId?: string; petTargetKind?: string },
  modelById: ReadonlyMap<string, PetVrmStageModel>
): PetVrmStageModel | null {
  if (task.petTargetKind !== 'vrm-model') return null
  return modelById.get(task.petTargetId || task.animalId) ?? null
}

function compareVrmPresentationItems(left: PetVrmPresentationItem, right: PetVrmPresentationItem): number {
  return (
    right.priority - left.priority ||
    right.updatedAt - left.updatedAt ||
    left.modelOrder - right.modelOrder ||
    left.taskKey.localeCompare(right.taskKey)
  )
}

function getVrmPresentationPriority(status: PetVrmPresentationStatus): number {
  switch (status) {
    case 'pending':
      return 1000
    case 'waiting':
      return 900
    case 'failed':
      return 800
    case 'running':
      return 700
    case 'review':
      return 650
    case 'queued':
      return 500
    case 'done':
      return 350
    case 'aborted':
      return 300
  }
}

function getVrmPresentationStatusLabel(
  status: PetVrmPresentationStatus,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  switch (status) {
    case 'queued':
      return t(PET_VRM_PRESENTATION_STATUS_LABEL_KEYS.queued, { count: 1 })
    default:
      return t(PET_VRM_PRESENTATION_STATUS_LABEL_KEYS[status])
  }
}

function getQueueReasonText(
  reason: PetQueueReason | undefined,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  return reason ? t(PET_VRM_QUEUE_REASON_LABEL_KEYS[reason]) : ''
}

function getVrmPresentationIcon(status: PetVrmPresentationStatus) {
  switch (status) {
    case 'pending':
    case 'waiting':
      return <ShieldAlert size={14} strokeWidth={2.2} />
    case 'running':
    case 'review':
      return <LoaderCircle size={14} strokeWidth={2.2} />
    case 'queued':
      return <Clock3 size={14} strokeWidth={2.2} />
    case 'done':
      return <CheckCircle2 size={14} strokeWidth={2.2} />
    case 'failed':
    case 'aborted':
      return <TriangleAlert size={14} strokeWidth={2.2} />
  }
}

function getVrmPresentationTone(status: PetVrmPresentationStatus): {
  background: string
  border: string
  icon: string
  text: string
} {
  switch (status) {
    case 'pending':
    case 'waiting':
      return {
        background: 'color-mix(in srgb, var(--color-warning) 16%, transparent)',
        border: 'color-mix(in srgb, var(--color-warning) 38%, var(--color-border))',
        icon: 'var(--color-warning)',
        text: 'var(--color-warning-text, var(--color-warning))'
      }
    case 'failed':
    case 'aborted':
      return {
        background: 'color-mix(in srgb, var(--color-destructive) 13%, transparent)',
        border: 'color-mix(in srgb, var(--color-destructive) 34%, var(--color-border))',
        icon: 'var(--color-destructive)',
        text: 'var(--color-error-text, var(--color-destructive))'
      }
    case 'done':
      return {
        background: 'color-mix(in srgb, var(--color-success) 14%, transparent)',
        border: 'color-mix(in srgb, var(--color-success) 30%, var(--color-border))',
        icon: 'var(--color-success)',
        text: 'var(--color-success-text, var(--color-success))'
      }
    case 'queued':
    case 'review':
    case 'running':
      return {
        background: 'color-mix(in srgb, var(--color-info) 13%, transparent)',
        border: 'color-mix(in srgb, var(--color-info) 30%, var(--color-border))',
        icon: 'var(--color-info)',
        text: 'var(--color-info-text, var(--color-info))'
      }
  }
}

function toTestId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '')
}

const oneLineTextStyle = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
}

const modelBadgeStyle = {
  ...oneLineTextStyle,
  background: 'color-mix(in srgb, var(--color-foreground) 7%, transparent)',
  border: '1px solid var(--color-border-subtle, var(--color-border))',
  borderRadius: 999,
  color: 'var(--color-foreground-secondary, #4b5563)',
  flex: '0 1 auto',
  fontSize: 10.5,
  fontWeight: 800,
  maxWidth: 120,
  padding: '2px 6px'
}

const tagStyle = {
  background: 'color-mix(in srgb, var(--color-warning) 12%, transparent)',
  border: '1px solid color-mix(in srgb, var(--color-warning) 28%, transparent)',
  borderRadius: 999,
  color: 'var(--color-warning-text, var(--color-warning))',
  fontSize: 10,
  fontWeight: 800,
  padding: '2px 6px'
}

const vrmOpenButtonStyle = {
  alignItems: 'center',
  background: 'color-mix(in srgb, var(--color-popover) 78%, transparent)',
  border: '1px solid var(--color-border)',
  borderRadius: 6,
  color: 'var(--color-foreground-secondary, #4b5563)',
  cursor: 'pointer',
  display: 'inline-flex',
  flex: '0 0 auto',
  height: 24,
  justifyContent: 'center',
  padding: 0,
  width: 24
}
