import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  AGENT_PRESENTATION_EVENT_KINDS,
  type AgentPresentationEvent,
  type AgentPresentationEventByKind,
  type AgentPresentationEventKind
} from '../agentPresentationEvents'
import type {
  AgentPresentationEvent as TransportAgentPresentationEvent,
  AgentPresentationEventHandler,
  AgentPresentationEventType,
  AgentPresentationScope
} from '../transport'

const EXPECTED_KINDS = [
  'stream.started',
  'message.delta',
  'message.completed',
  'tool.started',
  'approval.required',
  'approval.resolved',
  'stream.failed',
  'stream.cancelled'
] as const

describe('AgentPresentationEvent', () => {
  it('exports the complete event kind list', () => {
    expect(AGENT_PRESENTATION_EVENT_KINDS).toEqual(EXPECTED_KINDS)
    expectTypeOf<(typeof EXPECTED_KINDS)[number]>().toEqualTypeOf<AgentPresentationEventKind>()
  })

  it('narrows payloads by event kind', () => {
    expectTypeOf<AgentPresentationEvent<'message.delta'>>().toEqualTypeOf<
      AgentPresentationEventByKind['message.delta']
    >()

    expectTypeOf<AgentPresentationEventByKind['message.delta']>().toMatchTypeOf<{
      type: 'message.delta'
      agentId: string
      sessionId: string
      streamId: string
      timestamp: number
      messageId: string
      delta: string
    }>()

    expectTypeOf<AgentPresentationEventByKind['approval.resolved']>().toMatchTypeOf<{
      type: 'approval.resolved'
      agentId: string
      sessionId: string
      streamId: string
      timestamp: number
      approvalId: string
      result: 'approved' | 'rejected' | 'resolved'
    }>()
  })

  it('represents every event kind in the union', () => {
    expectTypeOf<AgentPresentationEvent['type']>().toEqualTypeOf<AgentPresentationEventKind>()
    expectTypeOf<TransportAgentPresentationEvent>().toEqualTypeOf<AgentPresentationEvent>()
    expectTypeOf<AgentPresentationEventType>().toEqualTypeOf<AgentPresentationEventKind>()
    expectTypeOf<AgentPresentationScope>().toMatchTypeOf<{
      agentId: string
      sessionId: string
      streamId: string
      timestamp: number
    }>()
    expectTypeOf<AgentPresentationEventHandler<'stream.failed'>>().toEqualTypeOf<
      (event: AgentPresentationEvent<'stream.failed'>) => void
    >()
  })
})
