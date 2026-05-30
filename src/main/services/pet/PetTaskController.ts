import type {
  PetQuickReplyRequest,
  PetTaskCommand,
  PetTaskCommandFailureReason,
  PetTaskCommandResult
} from '@shared/pet'
import { PET_TASK_COMMAND_TYPES } from '@shared/pet'
import type { WebContents } from 'electron'

type PetTaskControllerHost = {
  dismissApproval: (approvalId: string) => Promise<void>
  dismissTask: (taskId: string) => Promise<void>
  openTask: (taskId: string) => Promise<void>
  sendQuickReply: (sender: WebContents, request: PetQuickReplyRequest) => Promise<void>
}

export class PetTaskController {
  constructor(private readonly host: PetTaskControllerHost) {}

  public async dispatch(sender: WebContents, input: unknown): Promise<PetTaskCommandResult> {
    let command: PetTaskCommand
    try {
      command = parsePetTaskCommand(input)
    } catch (error) {
      return toPetTaskCommandError('rejected', error)
    }

    try {
      switch (command.type) {
        case 'task.open':
          await this.host.openTask(command.taskId)
          return { ok: true }
        case 'task.quick_reply':
          await this.host.sendQuickReply(sender, { taskKey: command.taskId, text: command.text })
          return { ok: true }
        case 'task.dismiss':
          await this.host.dismissTask(command.taskId)
          return { ok: true }
        case 'approval.dismiss':
          await this.host.dismissApproval(command.approvalId)
          return { ok: true }
        case 'approval.respond':
          return {
            ok: false,
            reason: 'not-supported',
            message: 'Pet approval decisions are still handled by the AI approval bridge'
          }
      }
    } catch (error) {
      return toPetTaskCommandError('rejected', error)
    }
  }
}

function parsePetTaskCommand(value: unknown): PetTaskCommand {
  if (!isRecord(value)) throw new Error('Pet task command must be an object')

  const type = parsePetTaskCommandType(value.type)
  switch (type) {
    case 'task.open':
      return { type, taskId: parseRequiredString(value.taskId, 'taskId') }
    case 'task.quick_reply':
      return {
        type,
        taskId: parseRequiredString(value.taskId, 'taskId'),
        text: parseRequiredString(value.text, 'text')
      }
    case 'task.dismiss':
      return { type, taskId: parseRequiredString(value.taskId, 'taskId') }
    case 'approval.dismiss':
      return { type, approvalId: parseRequiredString(value.approvalId, 'approvalId') }
    case 'approval.respond':
      return {
        type,
        approvalId: parseRequiredString(value.approvalId, 'approvalId'),
        decision: parseApprovalDecision(value.decision),
        reason: parseOptionalString(value.reason)
      }
  }
}

function parsePetTaskCommandType(value: unknown): PetTaskCommand['type'] {
  if (typeof value === 'string' && (PET_TASK_COMMAND_TYPES as readonly string[]).includes(value)) {
    return value as PetTaskCommand['type']
  }
  throw new Error('Unsupported pet task command type')
}

function parseApprovalDecision(value: unknown): PetTaskCommand<'approval.respond'>['decision'] {
  if (value === 'allow_once' || value === 'deny') return value
  throw new Error('Unsupported pet approval decision')
}

function parseRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Pet task command field "${fieldName}" must be a non-empty string`)
  }
  return value.trim()
}

function parseOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function toPetTaskCommandError(reason: PetTaskCommandFailureReason, error: unknown): PetTaskCommandResult {
  return {
    ok: false,
    reason,
    message: error instanceof Error ? error.message : String(error)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
