import type { AgentPresentationEvent } from '@shared/ai/agentPresentationEvents'
import {
  PET_VRM_STAGE_DEFAULT_SCENE_SETTINGS,
  type PetAnimalInstance,
  type PetPackageInfo,
  type PetPastureSnapshot,
  type PetPermissionPromptSnapshot,
  type PetTaskBinding,
  type PetTaskBubbleSnapshot
} from '@shared/pet'
import { describe, expect, it } from 'vitest'

import {
  buildPetPresentationEvents,
  createPetPresentationRuntimeState,
  updatePetPresentationRuntimeState,
  updatePetPresentationRuntimeStateFromAction,
  updatePetPresentationRuntimeStateFromAgentEvent
} from '../petPresentationRuntime'

describe('petPresentationRuntime', () => {
  it('seeds a renderer-side replay stream from the current pasture snapshot', () => {
    const snapshot = createSnapshot({ animals: [createAnimal()] })
    const state = updatePetPresentationRuntimeState(createPetPresentationRuntimeState(), snapshot)

    expect(state.seeded).toBe(true)
    expect(state.snapshot).toBe(snapshot)
    expect(state.sequence).toBe(1)
    expect(state.lastEvents).toHaveLength(1)
    expect(state.lastEvents[0]).toMatchObject({
      sequence: 1,
      source: 'pet-snapshot',
      type: 'snapshot.seeded'
    })
    expect(state.events).toEqual(state.lastEvents)
  })

  it('turns snapshot task diffs into standard task presentation events', () => {
    const empty = createSnapshot()
    const running = createBinding({ status: 'running', updatedAt: 1000 })
    const startedEvents = buildPetPresentationEvents(empty, createSnapshot({ bindings: [running] }), 10)

    expect(startedEvents.map((event) => event.type)).toEqual(['task.started', 'snapshot.updated'])
    expect(startedEvents.map((event) => event.sequence)).toEqual([11, 12])
    expect(startedEvents[0]).toMatchObject({
      record: { stage: 'active', task: running },
      type: 'task.started'
    })

    const waiting = createBinding({ currentToolName: 'Bash', status: 'waiting', updatedAt: 1100 })
    expect(
      buildPetPresentationEvents(createSnapshot({ bindings: [running] }), createSnapshot({ bindings: [waiting] }))
    ).toMatchObject([
      {
        previous: { stage: 'active', task: running },
        record: { stage: 'active', task: waiting },
        type: 'task.updated'
      },
      { type: 'snapshot.updated' }
    ])

    const completed = createBubble({ status: 'done' })
    expect(
      buildPetPresentationEvents(createSnapshot({ bindings: [running] }), createSnapshot({ bubbles: [completed] }))
    ).toMatchObject([
      {
        previous: { stage: 'active', task: running },
        record: { stage: 'bubble', task: completed },
        type: 'task.completed'
      },
      { type: 'snapshot.updated' }
    ])
  })

  it('emits queued task and approval lifecycle events', () => {
    const queued = createBinding({ status: 'running' })
    const prompt = createPermissionPrompt()

    expect(buildPetPresentationEvents(createSnapshot(), createSnapshot({ queuedTasks: [queued] }))).toMatchObject([
      {
        record: { stage: 'queued', task: queued },
        type: 'task.queued'
      },
      { type: 'snapshot.updated' }
    ])

    expect(buildPetPresentationEvents(createSnapshot(), createSnapshot({ permissionPrompts: [prompt] }))).toMatchObject(
      [{ prompt, type: 'approval.requested' }, { type: 'snapshot.updated' }]
    )

    const dismissedPrompt = { ...prompt, dismissed: true, updatedAt: 1200 }
    expect(
      buildPetPresentationEvents(
        createSnapshot({ permissionPrompts: [prompt] }),
        createSnapshot({ permissionPrompts: [dismissedPrompt] })
      )
    ).toMatchObject([
      {
        previous: prompt,
        prompt: dismissedPrompt,
        type: 'approval.updated'
      },
      { type: 'snapshot.updated' }
    ])

    expect(buildPetPresentationEvents(createSnapshot({ permissionPrompts: [prompt] }), createSnapshot())).toMatchObject(
      [
        {
          approvalId: 'approval-a',
          prompt,
          type: 'approval.resolved'
        },
        { type: 'snapshot.updated' }
      ]
    )
  })

  it('caps replay events while preserving monotonically increasing sequence numbers', () => {
    let state = updatePetPresentationRuntimeState(createPetPresentationRuntimeState(), createSnapshot())

    for (let index = 0; index < 250; index += 1) {
      state = updatePetPresentationRuntimeState(state, createSnapshot({ bounds: { x: -1, y: -1, width: 641 + index } }))
    }

    expect(state.events).toHaveLength(200)
    expect(state.sequence).toBe(501)
    expect(state.events[0].sequence).toBe(302)
    expect(state.events.at(-1)).toMatchObject({
      sequence: 501,
      type: 'snapshot.updated'
    })
  })

  it('projects generic agent presentation events into renderer-owned pet task state', () => {
    let state = updatePetPresentationRuntimeState(
      createPetPresentationRuntimeState(),
      createSnapshot({ animals: [createAnimal({ agentId: 'agent-a' })], packages: [createPackage()] })
    )

    state = updatePetPresentationRuntimeStateFromAgentEvent(state, createAgentEvent('stream.started'))
    expect(state.snapshot.bindings).toMatchObject([
      {
        animalId: 'animal-a',
        sourceId: 'agent-a',
        status: 'running',
        taskKey: 'session:session-a'
      }
    ])
    expect(state.lastEvents[0]).toMatchObject({
      source: 'agent-presentation',
      type: 'task.started'
    })

    state = updatePetPresentationRuntimeStateFromAgentEvent(
      state,
      createAgentEvent('message.delta', { delta: 'hello' })
    )
    expect(state.snapshot.bindings[0]).toMatchObject({
      status: 'running',
      streamText: 'hello'
    })

    state = updatePetPresentationRuntimeStateFromAgentEvent(
      state,
      createAgentEvent('approval.required', {
        approvalId: 'approval-a',
        previewRedacted: false,
        previewTruncated: false,
        safePreview: 'echo hello',
        toolCallId: 'tool-call-a',
        toolName: 'Bash'
      })
    )
    expect(state.snapshot.bindings[0].status).toBe('waiting')
    expect(state.snapshot.permissionPrompts).toMatchObject([
      {
        approvalId: 'approval-a',
        animalId: 'animal-a',
        safePreview: 'echo hello',
        taskKey: 'session:session-a'
      }
    ])

    state = updatePetPresentationRuntimeStateFromAgentEvent(
      state,
      createAgentEvent('approval.resolved', { approvalId: 'approval-a', result: 'resolved' })
    )
    expect(state.snapshot.permissionPrompts).toEqual([])
    expect(state.snapshot.bindings[0].status).toBe('review')

    state = updatePetPresentationRuntimeStateFromAgentEvent(
      state,
      createAgentEvent('message.completed', { text: 'hello world' })
    )
    expect(state.snapshot.bindings).toEqual([])
    expect(state.snapshot.bubbles).toMatchObject([
      {
        animalId: 'animal-a',
        status: 'done',
        streamText: 'hello world',
        taskKey: 'session:session-a'
      }
    ])
  })

  it('applies renderer-local task presentation actions without main-side state', () => {
    const running = createBinding({ status: 'running' })
    const prompt = createPermissionPrompt()
    let state = updatePetPresentationRuntimeState(
      createPetPresentationRuntimeState(),
      createSnapshot({ bindings: [running], permissionPrompts: [prompt] })
    )

    state = updatePetPresentationRuntimeStateFromAction(state, {
      taskKey: running.taskKey,
      type: 'task.opened',
      updatedAt: 1300
    })
    expect(state.snapshot.bindings[0]).toMatchObject({
      openedInCherry: true,
      updatedAt: 1300
    })
    expect(state.lastEvents[0]).toMatchObject({
      source: 'pet-action',
      type: 'task.updated'
    })

    state = updatePetPresentationRuntimeStateFromAction(state, {
      taskKey: running.taskKey,
      type: 'task.dismissed',
      updatedAt: 1400
    })
    expect(state.snapshot.bindings[0]).toMatchObject({
      bubbleDismissed: true,
      updatedAt: 1400
    })

    state = updatePetPresentationRuntimeStateFromAction(state, {
      approvalId: prompt.approvalId,
      type: 'approval.dismissed',
      updatedAt: 1500
    })
    expect(state.snapshot.permissionPrompts[0]).toMatchObject({
      dismissed: true,
      updatedAt: 1500
    })
  })
})

function createSnapshot(overrides: Partial<PetPastureSnapshot> = {}): PetPastureSnapshot {
  return {
    animals: [],
    bindings: [],
    bubbles: [],
    bounds: { x: -1, y: -1, width: 640 },
    packages: [],
    permissionPrompts: [],
    queuedTasks: [],
    vrmModelProfiles: {},
    vrmSceneSettings: { ...PET_VRM_STAGE_DEFAULT_SCENE_SETTINGS },
    ...overrides
  }
}

function createPackage(): PetPackageInfo {
  return {
    description: 'Test pet',
    displayName: 'Test Pet',
    id: 'test-pet',
    imported: true,
    spriteUrl: 'file:///test-pet.png',
    spritesheetPath: 'spritesheet.png'
  }
}

function createAnimal(overrides: Partial<PetAnimalInstance> = {}): PetAnimalInstance {
  return {
    createdAt: '2026-01-01T00:00:00.000Z',
    enabled: true,
    homeXRatio: 0.5,
    id: 'animal-a',
    name: 'Animal A',
    order: 0,
    packageId: createPackage().id,
    personality: 'watcher',
    ...overrides
  }
}

function createBinding(overrides: Partial<PetTaskBinding> = {}): PetTaskBinding {
  return {
    animalId: 'animal-a',
    kind: 'session',
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
    animalId: 'animal-a',
    approvalId: 'approval-a',
    createdAt: 1000,
    kind: 'session',
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

function createAgentEvent<TType extends AgentPresentationEvent['type']>(
  type: TType,
  overrides: Partial<Extract<AgentPresentationEvent, { type: TType }>> = {}
): Extract<AgentPresentationEvent, { type: TType }> {
  return {
    agentId: 'agent-a',
    sessionId: 'session-a',
    streamId: 'turn-a',
    timestamp: 1700000000000,
    type,
    ...overrides
  } as Extract<AgentPresentationEvent, { type: TType }>
}
