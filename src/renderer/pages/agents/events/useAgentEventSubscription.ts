import { useEffect, useRef } from 'react'

import type { AgentEventBus, AgentEventHandler } from './agentEventBus'
import { rendererAgentEventBus } from './agentEventBus'

export function useAgentEventSubscription(
  agentId: string | undefined,
  handler: AgentEventHandler,
  bus: AgentEventBus = rendererAgentEventBus
): void {
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(() => {
    if (!agentId) return undefined
    return bus.subscribe(agentId, (event) => handlerRef.current(event))
  }, [agentId, bus])
}
