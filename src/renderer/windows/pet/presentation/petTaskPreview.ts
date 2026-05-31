import type { PetTaskBinding, PetTaskBubbleSnapshot } from '@shared/pet'

const PET_PREVIEW_REDACTED = '[REDACTED]'
const PET_PREVIEW_SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN\s+(?:RSA\s+|EC\s+|OPENSSH\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA\s+|EC\s+|OPENSSH\s+)?PRIVATE\s+KEY-----/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /Bearer\s+[A-Za-z0-9_\-.~+/]+=*/g,
  /(?:api[_-]?key|api[_-]?secret|secret[_-]?key|password|passwd|token|access[_-]?token|client[_-]?secret|database[_-]?url)\s*[=:]\s*['"]?([^\s'"]{12,})['"]?/gi,
  /\bghp_[A-Za-z0-9]{36,}\b/g,
  /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g,
  /\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s'"]*(?:password|passwd|token|secret|key)[^\s'"]*/gi
]

export function getPetTaskPreview(task: PetTaskBinding | PetTaskBubbleSnapshot): string {
  const source = task.streamText || task.messages?.at(-1)?.text || ''
  const cleaned = redactPetPreviewSecrets(source)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/\|.*\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const text = cleaned || task.title
  const sentenceParts = text.split(/[.!?\u3002\uff01\uff1f]/u).filter(Boolean)
  const tail = sentenceParts.length > 1 ? (sentenceParts.at(-1) ?? text) : text

  return truncateText(tail.trim() || text, 140)
}

function redactPetPreviewSecrets(text: string): string {
  let result = text
  for (const pattern of PET_PREVIEW_SECRET_PATTERNS) {
    pattern.lastIndex = 0
    result = result.replace(pattern, PET_PREVIEW_REDACTED)
  }
  return result
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength - 1).trimEnd()}...`
}
