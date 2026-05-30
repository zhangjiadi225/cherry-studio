import type { SharedCacheSchema } from './cacheSchemas'
import { DefaultSharedCache } from './cacheSchemas'

/**
 * Checks if a schema key is a template key (contains `${...}` placeholder).
 *
 * @example
 * ```ts
 * isTemplateKey('scroll.position.${id}')  // true
 * isTemplateKey('app.user.avatar')        // false
 * ```
 */
export function isTemplateKey(key: string): boolean {
  return key.includes('${') && key.includes('}')
}

/**
 * Converts a template key pattern into a RegExp for matching concrete keys.
 *
 * Dynamic segments may contain namespace separators used by runtime ids,
 * such as `agent-session:${id}`, but dots are still rejected so placeholders
 * cannot cross cache key segment boundaries. Non-ASCII characters are
 * rejected by design. The placeholder variable name itself is ignored at runtime.
 *
 * @example
 * ```ts
 * const regex = templateToRegex('scroll.position.${id}')
 * regex.test('scroll.position.topic123')   // true
 * regex.test('scroll.position.topic-123')  // true
 * regex.test('scroll.position.')           // false
 * regex.test('other.key.123')              // false
 * ```
 */
export function templateToRegex(template: string): RegExp {
  const escaped = template.replace(/[.*+?^${}()|[\]\\]/g, (match) => {
    if (match === '$' || match === '{' || match === '}') {
      return match
    }
    return '\\' + match
  })

  const pattern = escaped.replace(/\$\{[^}]+\}/g, '([A-Za-z0-9_:-]+)')

  return new RegExp(`^${pattern}$`)
}

/**
 * Finds the shared schema key that matches a given concrete key.
 *
 * Returns the exact schema key (fixed or template pattern), not the concrete
 * instance. Callers use it to look up the template's default value.
 */
export function findMatchingSharedCacheSchemaKey(key: string): keyof SharedCacheSchema | undefined {
  if (key in DefaultSharedCache) {
    return key as keyof SharedCacheSchema
  }

  const schemaKeys = Object.keys(DefaultSharedCache) as Array<keyof SharedCacheSchema>
  for (const schemaKey of schemaKeys) {
    if (isTemplateKey(schemaKey as string)) {
      const regex = templateToRegex(schemaKey as string)
      if (regex.test(key)) {
        return schemaKey
      }
    }
  }

  return undefined
}
