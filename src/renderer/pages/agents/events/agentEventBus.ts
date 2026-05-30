import type { AgentEvent } from './agentEvents'

export type AgentEventHandler = (event: AgentEvent) => void

export interface AgentEventBus {
  publish: (agentId: string, event: AgentEvent) => void
  subscribe: (agentId: string, handler: AgentEventHandler) => () => void
}

export function createAgentEventBus(): AgentEventBus {
  const handlersByAgentId = new Map<string, Set<AgentEventHandler>>()

  return {
    publish(agentId, event) {
      const handlers = handlersByAgentId.get(agentId)
      if (!handlers) return
      for (const handler of [...handlers]) handler(event)
    },
    subscribe(agentId, handler) {
      let handlers = handlersByAgentId.get(agentId)
      if (!handlers) {
        handlers = new Set()
        handlersByAgentId.set(agentId, handlers)
      }
      handlers.add(handler)
      return () => {
        handlers?.delete(handler)
        if (handlers?.size === 0) handlersByAgentId.delete(agentId)
      }
    }
  }
}

export const rendererAgentEventBus = createAgentEventBus()

export function publishAgentEvent(agentId: string | undefined, event: AgentEvent | undefined): void {
  if (!agentId || !event) return
  rendererAgentEventBus.publish(agentId, event)
}
