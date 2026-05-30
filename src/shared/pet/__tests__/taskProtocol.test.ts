import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  PET_TASK_COMMAND_TYPES,
  PET_TASK_EVENT_TYPES,
  type PetTaskCommand,
  type PetTaskCommandType,
  type PetTaskEvent,
  type PetTaskEventByType,
  type PetTaskEventType,
  type PetTaskProtocolEnvelope,
  type PetTaskProtocolSeed,
  type PetTaskRef
} from '../taskProtocol'

const EXPECTED_EVENT_TYPES = [
  'task.started',
  'task.updated',
  'task.completed',
  'task.removed',
  'approval.requested',
  'approval.resolved'
] as const

const EXPECTED_COMMAND_TYPES = [
  'task.open',
  'task.quick_reply',
  'task.dismiss',
  'approval.dismiss',
  'approval.respond'
] as const

describe('pet task protocol', () => {
  it('exports complete event and command type lists', () => {
    expect(PET_TASK_EVENT_TYPES).toEqual(EXPECTED_EVENT_TYPES)
    expect(PET_TASK_COMMAND_TYPES).toEqual(EXPECTED_COMMAND_TYPES)
    expectTypeOf<(typeof EXPECTED_EVENT_TYPES)[number]>().toEqualTypeOf<PetTaskEventType>()
    expectTypeOf<(typeof EXPECTED_COMMAND_TYPES)[number]>().toEqualTypeOf<PetTaskCommandType>()
  })

  it('narrows event payloads by type', () => {
    expectTypeOf<PetTaskEvent<'task.updated'>>().toEqualTypeOf<PetTaskEventByType['task.updated']>()
    expectTypeOf<PetTaskEventByType['approval.requested']>().toMatchTypeOf<{
      type: 'approval.requested'
      approval: {
        approvalId: string
        taskId: string
        toolCallId: string
        toolName: string
      }
    }>()
    expectTypeOf<PetTaskEvent>().toMatchTypeOf<
      | { type: 'task.started' }
      | { type: 'task.updated' }
      | { type: 'task.completed' }
      | { type: 'task.removed' }
      | { type: 'approval.requested' }
      | { type: 'approval.resolved' }
    >()
  })

  it('keeps commands and seeds UI-agnostic', () => {
    expectTypeOf<PetTaskCommand<'task.dismiss'>>().toMatchTypeOf<{
      type: 'task.dismiss'
      taskId: string
    }>()
    expectTypeOf<PetTaskCommand<'approval.dismiss'>>().toMatchTypeOf<{
      type: 'approval.dismiss'
      approvalId: string
    }>()
    expectTypeOf<PetTaskCommand<'approval.respond'>>().toMatchTypeOf<{
      type: 'approval.respond'
      approvalId: string
      decision: 'allow_once' | 'deny'
    }>()
    expectTypeOf<PetTaskProtocolEnvelope>().toMatchTypeOf<{
      sequence: number
      event: PetTaskEvent
    }>()
    expectTypeOf<PetTaskProtocolSeed>().toMatchTypeOf<{
      tasks: PetTaskRef[]
    }>()
    expectTypeOf<PetTaskRef>().not.toHaveProperty('animalId')
  })
})
