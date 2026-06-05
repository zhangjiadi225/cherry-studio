import type { PetPermissionPromptSnapshot, PetTaskBinding, PetTaskBubbleSnapshot } from '@shared/pet'
import { createPetVrmStageModelProfile } from '@shared/pet'
import { describe, expect, it } from 'vitest'

import type { PetVrmStageModel } from '../types'
import { buildPetVrmPresentationMotionStateMap } from '../VrmPresentationMotion'

describe('VrmPresentationMotion', () => {
  it('maps VRM running states to thinking, speaking, and tool-running motion', () => {
    const model = createModel()

    expect(
      buildPetVrmPresentationMotionStateMap({
        bindings: [createBinding()],
        bubbles: [],
        models: [model],
        permissionPrompts: [],
        queuedTasks: []
      }).get(model.modelId)
    ).toMatchObject({
      animationTimeScale: 0.72,
      expression: 'neutral',
      phase: 'thinking'
    })

    expect(
      buildPetVrmPresentationMotionStateMap({
        bindings: [createBinding({ streamText: 'Hello from the bound VRM agent.' })],
        bubbles: [],
        models: [model],
        permissionPrompts: [],
        queuedTasks: []
      }).get(model.modelId)
    ).toMatchObject({
      animationTimeScale: 1.15,
      expression: 'happy',
      phase: 'speaking'
    })

    expect(
      buildPetVrmPresentationMotionStateMap({
        bindings: [createBinding({ currentToolName: 'Bash', streamText: 'Checking files.' })],
        bubbles: [],
        models: [model],
        permissionPrompts: [],
        queuedTasks: []
      }).get(model.modelId)
    ).toMatchObject({
      animationPreset: 'vroid-shoot',
      animationTimeScale: 1.28,
      expression: 'surprised',
      phase: 'tool-running'
    })
  })

  it('prioritizes permission waiting over regular streaming motion', () => {
    const model = createModel()
    const state = buildPetVrmPresentationMotionStateMap({
      bindings: [createBinding({ streamText: 'Streaming answer.' })],
      bubbles: [],
      models: [model],
      permissionPrompts: [createPermissionPrompt()],
      queuedTasks: []
    }).get(model.modelId)

    expect(state).toMatchObject({
      animationPreset: undefined,
      expression: 'surprised',
      phase: 'waiting-permission',
      taskKey: 'session:session-a'
    })
  })

  it('maps queued VRM tasks to low-intensity thinking motion', () => {
    const model = createModel()
    const state = buildPetVrmPresentationMotionStateMap({
      bindings: [],
      bubbles: [],
      models: [model],
      permissionPrompts: [],
      queuedTasks: [createBinding({ queueReason: 'no-free-pet' })]
    }).get(model.modelId)

    expect(state).toMatchObject({
      animationTimeScale: 0.6,
      expression: 'neutral',
      phase: 'thinking'
    })
  })

  it('keeps done and failed pulses transient and filters expired pulses', () => {
    const model = createModel()
    const done = createBubble({ status: 'done', updatedAt: 10_000 })
    const failed = createBubble({ status: 'failed', taskKey: 'session:failed', updatedAt: 20_000 })

    expect(
      buildPetVrmPresentationMotionStateMap({
        bindings: [],
        bubbles: [done],
        models: [model],
        now: 11_000,
        permissionPrompts: [],
        queuedTasks: []
      }).get(model.modelId)
    ).toMatchObject({
      animationPreset: 'vroid-peace-sign',
      expression: 'happy',
      phase: 'done-pulse'
    })

    expect(
      buildPetVrmPresentationMotionStateMap({
        bindings: [],
        bubbles: [failed],
        models: [model],
        now: 21_000,
        permissionPrompts: [],
        queuedTasks: []
      }).get(model.modelId)
    ).toMatchObject({
      animationPreset: 'vroid-squat',
      expression: 'sad',
      phase: 'failed-pulse'
    })

    expect(
      buildPetVrmPresentationMotionStateMap({
        bindings: [],
        bubbles: [done],
        models: [model],
        now: 12_000,
        permissionPrompts: [],
        queuedTasks: []
      }).has(model.modelId)
    ).toBe(false)
  })

  it('ignores non-VRM tasks so unbound VRM models do not animate for generic work', () => {
    const model = createModel()

    expect(
      buildPetVrmPresentationMotionStateMap({
        bindings: [createBinding({ animalId: 'animal-a', petTargetId: undefined, petTargetKind: 'animal' })],
        bubbles: [],
        models: [model],
        permissionPrompts: [],
        queuedTasks: []
      }).has(model.modelId)
    ).toBe(false)
  })
})

function createModel(overrides: Partial<PetVrmStageModel> = {}): PetVrmStageModel {
  const profile = createPetVrmStageModelProfile({
    enabled: true,
    modelId: 'model-a',
    order: 0
  })

  return {
    enabled: true,
    id: profile.modelId,
    modelId: profile.modelId,
    order: profile.order,
    positionX: profile.positionX,
    positionY: profile.positionY,
    positionZ: profile.positionZ,
    profile,
    ...overrides
  }
}

function createBinding(overrides: Partial<PetTaskBinding> = {}): PetTaskBinding {
  return {
    animalId: 'model-a',
    kind: 'session',
    petTargetId: 'model-a',
    petTargetKind: 'vrm-model',
    sourceId: 'agent-a',
    sourceKey: 'agent:agent-a',
    sourceKind: 'agent',
    sourceTitle: 'Agent A',
    startedAt: 900,
    status: 'running',
    targetId: 'session-a',
    taskKey: 'session:session-a',
    title: 'Session A',
    updatedAt: 1000,
    ...overrides
  }
}

function createBubble(overrides: Partial<PetTaskBubbleSnapshot> = {}): PetTaskBubbleSnapshot {
  return {
    ...createBinding({ status: 'done' }),
    endedAt: 1400,
    status: 'done',
    ...overrides
  }
}

function createPermissionPrompt(overrides: Partial<PetPermissionPromptSnapshot> = {}): PetPermissionPromptSnapshot {
  return {
    animalId: 'model-a',
    approvalId: 'approval-a',
    createdAt: 1000,
    kind: 'session',
    petTargetId: 'model-a',
    petTargetKind: 'vrm-model',
    previewRedacted: false,
    previewTruncated: false,
    safePreview: 'run command',
    sessionId: 'session-a',
    sourceId: 'agent-a',
    sourceKey: 'agent:agent-a',
    sourceKind: 'agent',
    sourceTitle: 'Agent A',
    status: 'pending',
    targetId: 'session-a',
    taskKey: 'session:session-a',
    title: 'Session A',
    toolCallId: 'tool-call-a',
    toolName: 'Bash',
    updatedAt: 1000,
    ...overrides
  }
}
