import type { PetPermissionPromptSnapshot, PetTaskBinding, PetTaskBubbleSnapshot } from '@shared/pet'

import type { PetVrmPresentationMotionState, PetVrmStageModel } from './types'

const DONE_PULSE_MS = 1800
const FAILED_PULSE_MS = 2400

type PetVrmMotionCandidate = PetVrmPresentationMotionState & {
  modelOrder: number
  priority: number
}

export function buildPetVrmPresentationMotionStateMap(input: {
  bindings: PetTaskBinding[]
  bubbles: PetTaskBubbleSnapshot[]
  models: PetVrmStageModel[]
  now?: number
  permissionPrompts: PetPermissionPromptSnapshot[]
  queuedTasks: PetTaskBinding[]
}): Map<string, PetVrmPresentationMotionState> {
  const now = input.now ?? Date.now()
  const modelById = new Map(input.models.map((model) => [model.modelId, model]))
  const candidates: PetVrmMotionCandidate[] = []

  for (const prompt of input.permissionPrompts) {
    if (prompt.dismissed) continue
    const model = getVrmMotionModel(prompt, modelById)
    if (!model) continue
    candidates.push({
      animationTimeScale: 0.55,
      expression: 'surprised',
      expressionIntensity: 0.55,
      modelId: model.modelId,
      modelOrder: model.order,
      phase: 'waiting-permission',
      priority: 1000,
      startedAt: prompt.createdAt,
      taskKey: prompt.taskKey,
      updatedAt: prompt.updatedAt
    })
  }

  for (const binding of input.bindings) {
    if (binding.bubbleDismissed) continue
    const model = getVrmMotionModel(binding, modelById)
    if (!model) continue
    candidates.push(bindingToVrmMotionCandidate(binding, model))
  }

  for (const task of input.queuedTasks) {
    if (task.bubbleDismissed) continue
    const model = getVrmMotionModel(task, modelById)
    if (!model) continue
    candidates.push({
      animationTimeScale: 0.6,
      expression: 'neutral',
      expressionIntensity: 0.35,
      modelId: model.modelId,
      modelOrder: model.order,
      phase: 'thinking',
      priority: 450,
      startedAt: task.startedAt,
      taskKey: task.taskKey,
      updatedAt: task.updatedAt
    })
  }

  for (const bubble of input.bubbles) {
    if (bubble.bubbleDismissed) continue
    const model = getVrmMotionModel(bubble, modelById)
    if (!model) continue
    const candidate = bubbleToVrmMotionCandidate(bubble, model)
    if (candidate.expiresAt && candidate.expiresAt <= now) continue
    candidates.push(candidate)
  }

  const bestByModelId = new Map<string, PetVrmMotionCandidate>()
  for (const candidate of candidates.sort(compareVrmMotionCandidates)) {
    if (!bestByModelId.has(candidate.modelId)) bestByModelId.set(candidate.modelId, candidate)
  }

  return new Map(
    [...bestByModelId.values()]
      .sort((left, right) => left.modelOrder - right.modelOrder || left.modelId.localeCompare(right.modelId))
      .map((candidate) => [candidate.modelId, toVrmPresentationMotionState(candidate)])
  )
}

function toVrmPresentationMotionState(candidate: PetVrmMotionCandidate): PetVrmPresentationMotionState {
  return {
    animationPreset: candidate.animationPreset,
    animationTimeScale: candidate.animationTimeScale,
    expression: candidate.expression,
    expressionIntensity: candidate.expressionIntensity,
    expiresAt: candidate.expiresAt,
    lookAtCursor: candidate.lookAtCursor,
    modelId: candidate.modelId,
    phase: candidate.phase,
    startedAt: candidate.startedAt,
    taskKey: candidate.taskKey,
    updatedAt: candidate.updatedAt
  }
}

function bindingToVrmMotionCandidate(binding: PetTaskBinding, model: PetVrmStageModel): PetVrmMotionCandidate {
  if (binding.status === 'waiting') {
    return {
      animationTimeScale: 0.55,
      expression: 'surprised',
      expressionIntensity: 0.55,
      modelId: model.modelId,
      modelOrder: model.order,
      phase: 'waiting-permission',
      priority: 900,
      startedAt: binding.startedAt,
      taskKey: binding.taskKey,
      updatedAt: binding.updatedAt
    }
  }

  if (binding.currentToolName) {
    return {
      animationPreset: 'vroid-shoot',
      animationTimeScale: 1.28,
      expression: 'surprised',
      expressionIntensity: 0.42,
      modelId: model.modelId,
      modelOrder: model.order,
      phase: 'tool-running',
      priority: 760,
      startedAt: binding.startedAt,
      taskKey: binding.taskKey,
      updatedAt: binding.updatedAt
    }
  }

  if (binding.status === 'review') {
    return {
      animationTimeScale: 0.85,
      expression: 'neutral',
      expressionIntensity: 0.35,
      modelId: model.modelId,
      modelOrder: model.order,
      phase: 'thinking',
      priority: 650,
      startedAt: binding.startedAt,
      taskKey: binding.taskKey,
      updatedAt: binding.updatedAt
    }
  }

  return {
    animationTimeScale: binding.streamText ? 1.15 : 0.72,
    expression: binding.streamText ? 'happy' : 'neutral',
    expressionIntensity: binding.streamText ? 0.38 : 0.3,
    modelId: model.modelId,
    modelOrder: model.order,
    phase: binding.streamText ? 'speaking' : 'thinking',
    priority: binding.streamText ? 730 : 700,
    startedAt: binding.startedAt,
    taskKey: binding.taskKey,
    updatedAt: binding.updatedAt
  }
}

function bubbleToVrmMotionCandidate(bubble: PetTaskBubbleSnapshot, model: PetVrmStageModel): PetVrmMotionCandidate {
  const failed = bubble.status === 'failed' || bubble.status === 'aborted'
  return {
    animationPreset: failed ? 'vroid-squat' : 'vroid-peace-sign',
    animationTimeScale: failed ? 0.45 : 1.05,
    expression: failed ? 'sad' : 'happy',
    expressionIntensity: failed ? 0.62 : 0.7,
    expiresAt: bubble.updatedAt + (failed ? FAILED_PULSE_MS : DONE_PULSE_MS),
    modelId: model.modelId,
    modelOrder: model.order,
    phase: failed ? 'failed-pulse' : 'done-pulse',
    priority: failed ? 800 : 350,
    startedAt: bubble.endedAt,
    taskKey: bubble.taskKey,
    updatedAt: bubble.updatedAt
  }
}

function getVrmMotionModel(
  task: { animalId: string; petTargetId?: string; petTargetKind?: string },
  modelById: ReadonlyMap<string, PetVrmStageModel>
): PetVrmStageModel | null {
  if (task.petTargetKind !== 'vrm-model') return null
  return modelById.get(task.petTargetId || task.animalId) ?? null
}

function compareVrmMotionCandidates(left: PetVrmMotionCandidate, right: PetVrmMotionCandidate): number {
  return (
    right.priority - left.priority ||
    right.updatedAt - left.updatedAt ||
    left.modelOrder - right.modelOrder ||
    (left.taskKey ?? '').localeCompare(right.taskKey ?? '')
  )
}
