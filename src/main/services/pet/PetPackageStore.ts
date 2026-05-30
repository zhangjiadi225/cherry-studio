import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  getPetPackageSpritesheetHeight,
  isPetSemanticAnimationName,
  PET_SPRITESHEET_WIDTH,
  type PetAnimationDefinition,
  type PetMultiAssetFrame,
  type PetMultiAssetManifest,
  type PetMultiAssetManifestClip,
  type PetPackageInfo,
  type PetPackageMetadata
} from '@shared/pet'

export type ValidatedPetPackage = {
  metadata: PetPackageMetadata
  packageDir: string
  spritePath: string
}

const PET_PACKAGE_MAX_FILES = 64
const PET_PACKAGE_MAX_TOTAL_BYTES = 20 * 1024 * 1024
const PET_PACKAGE_MAX_IMAGE_BYTES = 8 * 1024 * 1024
const PET_PACKAGE_MAX_IMAGE_PIXELS = 4096 * 4096
const PET_PACKAGE_ALLOWED_EXTENSIONS = new Set(['.json', '.png', '.webp', '.jpg', '.jpeg'])
const PET_PACKAGE_IMAGE_EXTENSIONS = new Set(['.png', '.webp', '.jpg', '.jpeg'])
const PET_MULTI_ASSET_MAX_FRAMES_PER_CLIP = 32
const PET_MULTI_ASSET_MIN_FRAME_DURATION_MS = 50
const PET_MULTI_ASSET_MAX_FRAME_DURATION_MS = 5000

// pet.json is the only package entry point. Rich animation manifests may be
// referenced from it later, but file presence alone must not switch formats.
export function normalizePetPackageId(id: string): string {
  const normalized = id
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return normalized || 'pet'
}

export function isPathInside(parentDir: string, candidatePath: string): boolean {
  const parent = path.resolve(parentDir)
  const candidate = path.resolve(candidatePath)
  return candidate === parent || candidate.startsWith(`${parent}${path.sep}`)
}

export function resolvePetPackageFile(packageDir: string, relativePath: string): string {
  if (!relativePath || path.isAbsolute(relativePath) || relativePath.includes('\0')) {
    throw new Error('Invalid pet package path')
  }

  const resolved = path.resolve(packageDir, relativePath)
  if (!isPathInside(packageDir, resolved)) {
    throw new Error('Pet package path must stay inside the package directory')
  }

  return resolved
}

export function parsePetPackageMetadata(value: unknown): PetPackageMetadata {
  if (!value || typeof value !== 'object') {
    throw new Error('pet.json must contain an object')
  }

  const record = value as Record<string, unknown>
  const id = parseRequiredString(record.id, 'id')
  const displayName = parseRequiredString(record.displayName, 'displayName')
  const description = parseRequiredString(record.description, 'description')
  const spritesheetPath = parseRequiredString(record.spritesheetPath, 'spritesheetPath')
  const schemaVersion = parseOptionalPositiveInteger(record.schemaVersion, 'schemaVersion')
  const format = parseOptionalPackageFormat(record.format)
  const kind = typeof record.kind === 'string' && record.kind.trim() ? record.kind.trim() : undefined
  const animations = parseAnimationOverrides(record.animations)
  const animationManifestPath = parseOptionalString(record.animationManifestPath, 'animationManifestPath')

  if (format === 'cherry-multi-asset' && !animationManifestPath) {
    throw new Error('pet.json field "animationManifestPath" is required for cherry-multi-asset packages')
  }

  return {
    ...(schemaVersion ? { schemaVersion } : {}),
    ...(format ? { format } : {}),
    id,
    displayName,
    description,
    spritesheetPath,
    ...(kind ? { kind } : {}),
    ...(animations ? { animations } : {}),
    ...(animationManifestPath ? { animationManifestPath } : {})
  }
}

export async function validatePetPackage(packageDir: string): Promise<ValidatedPetPackage> {
  const resolvedPackageDir = path.resolve(packageDir)
  const metadataPath = path.join(resolvedPackageDir, 'pet.json')
  let metadata = parsePetPackageMetadata(JSON.parse(await fs.readFile(metadataPath, 'utf8')))
  const spritePath = resolvePetPackageFile(resolvedPackageDir, metadata.spritesheetPath)
  if (metadata.format === 'cherry-multi-asset') {
    metadata = {
      ...metadata,
      multiAssetClips: await loadMultiAssetClips(
        resolvedPackageDir,
        resolvePetPackageFile(resolvedPackageDir, metadata.animationManifestPath!)
      )
    }
  }

  await fs.access(spritePath)
  await validateSpritesheetDimensions(spritePath, metadata)

  return {
    metadata,
    packageDir: resolvedPackageDir,
    spritePath
  }
}

async function loadMultiAssetClips(
  packageDir: string,
  manifestPath: string
): Promise<PetPackageMetadata['multiAssetClips']> {
  const manifest = parseMultiAssetManifest(JSON.parse(await fs.readFile(manifestPath, 'utf8')), packageDir)
  const clips: PetPackageMetadata['multiAssetClips'] = {}

  for (const clip of manifest.clips) {
    const frames = await Promise.all(
      clip.frames.map(async (frame) => {
        const assetPath = resolvePetPackageFile(packageDir, frame.assetPath)
        await validateMultiAssetFrameImage(assetPath, frame.width, frame.height)
        return {
          durationMs: frame.durationMs,
          height: frame.height,
          imageUrl: pathToFileURL(assetPath).href,
          width: frame.width
        }
      })
    )

    clips[clip.action] = {
      frames,
      loop: clip.loop,
      ...(clip.phaseGroup ? { phaseGroup: clip.phaseGroup } : {})
    }
  }

  return clips
}

async function validateMultiAssetFrameImage(
  assetPath: string,
  declaredWidth: number,
  declaredHeight: number
): Promise<void> {
  try {
    await fs.access(assetPath)
  } catch (error) {
    throw new Error(`Pet animation asset is missing: ${path.basename(assetPath)}`, { cause: error })
  }

  const sharp = (await import('sharp')).default
  const image = await sharp(await fs.readFile(assetPath)).metadata()
  if (image.width !== declaredWidth || image.height !== declaredHeight) {
    throw new Error(
      `Pet animation asset dimensions must match manifest, got ${image.width}x${image.height}, expected ${declaredWidth}x${declaredHeight}`
    )
  }
}

function parseMultiAssetManifest(value: unknown, packageDir: string): PetMultiAssetManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Pet animation manifest must contain an object')
  }

  const record = value as Record<string, unknown>
  if (record.schemaVersion !== 1) {
    throw new Error('Pet animation manifest schemaVersion must be 1')
  }
  if (!Array.isArray(record.clips)) {
    throw new Error('Pet animation manifest field "clips" must be an array')
  }

  return {
    schemaVersion: 1,
    clips: record.clips.map((clip, index) => parseMultiAssetClip(clip, index, packageDir))
  }
}

function parseMultiAssetClip(value: unknown, index: number, packageDir: string): PetMultiAssetManifestClip {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Pet animation manifest clip ${index} must be an object`)
  }

  const record = value as Record<string, unknown>
  if (!isPetSemanticAnimationName(record.action)) {
    throw new Error(`Pet animation manifest clip ${index} has an unsupported action`)
  }
  if (!Array.isArray(record.frames) || record.frames.length === 0) {
    throw new Error(`Pet animation manifest clip ${record.action} must contain frames`)
  }
  if (record.frames.length > PET_MULTI_ASSET_MAX_FRAMES_PER_CLIP) {
    throw new Error(`Pet animation manifest clip ${record.action} has too many frames`)
  }

  return {
    action: record.action,
    frames: record.frames.map((frame, frameIndex) =>
      parseMultiAssetFrame(frame, `${record.action}.frames[${frameIndex}]`, packageDir)
    ),
    loop: Boolean(record.loop),
    ...(typeof record.phaseGroup === 'string' && record.phaseGroup.trim()
      ? { phaseGroup: record.phaseGroup.trim() }
      : {})
  }
}

function parseMultiAssetFrame(value: unknown, fieldName: string, packageDir: string): PetMultiAssetFrame {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Pet animation manifest frame "${fieldName}" must be an object`)
  }

  const record = value as Record<string, unknown>
  const assetPath = parseRequiredString(record.assetPath, `${fieldName}.assetPath`)
  const durationMs = parsePositiveInteger(record.durationMs, `${fieldName}.durationMs`)
  if (durationMs < PET_MULTI_ASSET_MIN_FRAME_DURATION_MS || durationMs > PET_MULTI_ASSET_MAX_FRAME_DURATION_MS) {
    throw new Error(
      `Pet animation manifest frame "${fieldName}" duration must be between ${PET_MULTI_ASSET_MIN_FRAME_DURATION_MS} and ${PET_MULTI_ASSET_MAX_FRAME_DURATION_MS} ms`
    )
  }
  resolvePetPackageFile(packageDir, assetPath)

  return {
    assetPath,
    durationMs,
    width: parsePositiveInteger(record.width, `${fieldName}.width`),
    height: parsePositiveInteger(record.height, `${fieldName}.height`)
  }
}

export async function listImportedPetPackages(managedRoot: string): Promise<PetPackageInfo[]> {
  await fs.mkdir(managedRoot, { recursive: true })
  const entries = await fs.readdir(managedRoot, { withFileTypes: true })
  const packages: PetPackageInfo[] = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue

    try {
      const petPackage = await validatePetPackage(path.join(managedRoot, entry.name))
      packages.push(toPetPackageInfo(petPackage))
    } catch {
      // Ignore invalid directories in the managed root; import performs strict validation.
    }
  }

  return packages.sort((a, b) => a.displayName.localeCompare(b.displayName))
}

export async function importPetPackage(sourceDir: string, managedRoot: string): Promise<PetPackageInfo> {
  await fs.mkdir(managedRoot, { recursive: true })
  const sourcePackage = await validatePetPackage(sourceDir)
  const targetDir = path.join(managedRoot, normalizePetPackageId(sourcePackage.metadata.id))

  if (!isPathInside(managedRoot, targetDir)) {
    throw new Error('Pet package target must stay inside the managed root')
  }

  try {
    await fs.access(targetDir)
    throw new Error(`Pet package "${sourcePackage.metadata.id}" already exists`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  await validatePackageResourceBudget(sourcePackage.packageDir)
  await fs.cp(sourcePackage.packageDir, targetDir, {
    recursive: true,
    force: false,
    errorOnExist: true
  })

  return toPetPackageInfo(await validatePetPackage(targetDir))
}

async function validatePackageResourceBudget(packageDir: string): Promise<void> {
  const files = await scanPetPackageFiles(packageDir)
  const totalBytes = files.reduce((total, file) => total + file.size, 0)

  if (files.length > PET_PACKAGE_MAX_FILES) {
    throw new Error(`Pet package contains too many files; maximum is ${PET_PACKAGE_MAX_FILES}`)
  }
  if (totalBytes > PET_PACKAGE_MAX_TOTAL_BYTES) {
    throw new Error(`Pet package is too large; maximum is ${PET_PACKAGE_MAX_TOTAL_BYTES} bytes`)
  }

  await Promise.all(files.map((file) => validatePackageFileBudget(file.path, file.size)))
}

async function scanPetPackageFiles(packageDir: string): Promise<Array<{ path: string; size: number }>> {
  const files: Array<{ path: string; size: number }> = []
  const stack = [packageDir]

  while (stack.length > 0) {
    const currentDir = stack.pop()!
    const entries = await fs.readdir(currentDir, { withFileTypes: true })

    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry.name)
      if (entry.isSymbolicLink()) {
        throw new Error('Pet packages cannot contain symbolic links')
      }
      if (entry.isDirectory()) {
        stack.push(entryPath)
        continue
      }
      if (!entry.isFile()) {
        throw new Error('Pet packages can only contain files and directories')
      }
      if (!PET_PACKAGE_ALLOWED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        throw new Error(`Unsupported pet package file type: ${entry.name}`)
      }
      files.push({ path: entryPath, size: (await fs.stat(entryPath)).size })
    }
  }

  return files
}

async function validatePackageFileBudget(filePath: string, size: number): Promise<void> {
  if (!PET_PACKAGE_IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase())) return
  if (size > PET_PACKAGE_MAX_IMAGE_BYTES) {
    throw new Error(`Pet package image file is too large; maximum is ${PET_PACKAGE_MAX_IMAGE_BYTES} bytes`)
  }

  const sharp = (await import('sharp')).default
  const image = await sharp(await fs.readFile(filePath), { limitInputPixels: false }).metadata()
  const pixels = (image.width ?? 0) * (image.height ?? 0)
  if (pixels > PET_PACKAGE_MAX_IMAGE_PIXELS) {
    throw new Error(`Pet package image has too many pixels; maximum is ${PET_PACKAGE_MAX_IMAGE_PIXELS}`)
  }
}

export async function findImportedPackage(managedRoot: string, packageId: string): Promise<ValidatedPetPackage | null> {
  await fs.mkdir(managedRoot, { recursive: true })
  const entries = await fs.readdir(managedRoot, { withFileTypes: true })

  for (const entry of entries) {
    if (!entry.isDirectory()) continue

    const packageDir = path.join(managedRoot, entry.name)
    try {
      const petPackage = await validatePetPackage(packageDir)
      if (petPackage.metadata.id === packageId) return petPackage
    } catch {
      // Ignore invalid directories in the managed root.
    }
  }

  return null
}

export async function deleteImportedPackage(managedRoot: string, packageId: string): Promise<void> {
  const petPackage = await findImportedPackage(managedRoot, packageId)
  if (!petPackage) {
    throw new Error(`Pet package "${packageId}" was not found`)
  }
  if (!isPathInside(managedRoot, petPackage.packageDir)) {
    throw new Error('Pet package target must stay inside the managed root')
  }

  await fs.rm(petPackage.packageDir, { recursive: true, force: false })
}

export function toPetPackageInfo(petPackage: ValidatedPetPackage): PetPackageInfo {
  return {
    ...petPackage.metadata,
    imported: true,
    spriteUrl: pathToFileURL(petPackage.spritePath).href
  }
}

async function validateSpritesheetDimensions(spritePath: string, metadata: PetPackageMetadata): Promise<void> {
  const sharp = (await import('sharp')).default
  const image = await sharp(await fs.readFile(spritePath)).metadata()
  const requiredHeight = getPetPackageSpritesheetHeight(metadata)

  if (image.width !== PET_SPRITESHEET_WIDTH || image.height !== requiredHeight) {
    throw new Error(
      `Pet spritesheet must be ${PET_SPRITESHEET_WIDTH}x${requiredHeight}, got ${image.width}x${image.height}`
    )
  }
}

function parseRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`pet.json field "${fieldName}" must be a non-empty string`)
  }

  return value.trim()
}

function parseOptionalString(value: unknown, fieldName: string): string | undefined {
  if (value === undefined) return undefined
  return parseRequiredString(value, fieldName)
}

function parseOptionalPackageFormat(value: unknown): PetPackageMetadata['format'] | undefined {
  if (value === undefined) return undefined
  if (value !== 'codex-atlas' && value !== 'cherry-multi-asset') {
    throw new Error('pet.json field "format" must be "codex-atlas" or "cherry-multi-asset"')
  }
  return value
}

function parseAnimationOverrides(value: unknown): PetPackageMetadata['animations'] | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('pet.json field "animations" must be an object')
  }

  const animations: PetPackageMetadata['animations'] = {}
  for (const [name, definition] of Object.entries(value)) {
    if (!isPetSemanticAnimationName(name)) {
      throw new Error(`Unsupported pet animation override: ${name}`)
    }
    animations[name] = parseAnimationDefinition(definition, name)
  }

  return Object.keys(animations).length > 0 ? animations : undefined
}

function parseAnimationDefinition(value: unknown, name: string): PetAnimationDefinition {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`pet.json animation "${name}" must be an object`)
  }

  const record = value as Record<string, unknown>
  const row = parseNonNegativeInteger(record.row, `${name}.row`)
  const frameCount = parsePositiveInteger(record.frameCount, `${name}.frameCount`)
  if (!Array.isArray(record.frameDurations) || record.frameDurations.length !== frameCount) {
    throw new Error(`pet.json animation "${name}" frameDurations must match frameCount`)
  }

  return {
    row,
    frameCount,
    frameDurations: record.frameDurations.map((duration, index) =>
      parsePositiveInteger(duration, `${name}.frameDurations[${index}]`)
    ),
    loop: Boolean(record.loop)
  }
}

function parseNonNegativeInteger(value: unknown, fieldName: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(`pet.json field "${fieldName}" must be a non-negative integer`)
  }
  return value as number
}

function parseOptionalPositiveInteger(value: unknown, fieldName: string): number | undefined {
  if (value === undefined) return undefined
  return parsePositiveInteger(value, fieldName)
}

function parsePositiveInteger(value: unknown, fieldName: string): number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new Error(`pet.json field "${fieldName}" must be a positive integer`)
  }
  return value as number
}
