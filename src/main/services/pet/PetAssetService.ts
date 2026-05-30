import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { application } from '@application'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { IpcChannel } from '@shared/IpcChannel'
import {
  PET_ASSET_KINDS,
  type PetAssetDeleteRequest,
  type PetAssetFileInfo,
  type PetAssetFileRole,
  type PetAssetImportRemoteRequest,
  type PetAssetImportRequest,
  type PetAssetInfo,
  type PetAssetKind,
  type PetAssetListRequest,
  type PetAssetResolveRequest,
  type PetAssetResolveResult,
  type PetPackageInfo
} from '@shared/pet'

import {
  deleteImportedPackage,
  findImportedPackage,
  importPetPackage,
  isPathInside,
  listImportedPetPackages,
  toPetPackageInfo
} from './PetPackageStore'

const PET_ASSET_MANIFEST_FILE = 'asset.json'
const PET_VRM_MODEL_FILE = 'model.vrm'
const PET_SCENE_BACKGROUND_FILE = 'background'
const PET_VRM_MAX_BYTES = 200 * 1024 * 1024
const PET_SCENE_IMAGE_MAX_BYTES = 32 * 1024 * 1024
const PET_SCENE_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp'])
const PET_VRM_EXTENSIONS = new Set(['.vrm'])

type StoredPetAssetManifest = PetAssetInfo

@Injectable('PetAssetService')
@ServicePhase(Phase.WhenReady)
export class PetAssetService extends BaseService {
  protected override onReady(): void {
    this.registerIpcHandlers()
  }

  public async listAssets(input?: unknown): Promise<PetAssetInfo[]> {
    const request = parseAssetListRequest(input)
    if (request.kind) return this.listAssetsByKind(request.kind)

    const groups = await Promise.all(PET_ASSET_KINDS.map((kind) => this.listAssetsByKind(kind)))
    return groups.flat().sort(comparePetAssets)
  }

  public async importAsset(input: unknown): Promise<PetAssetInfo> {
    const request = parseAssetImportRequest(input)
    switch (request.kind) {
      case 'sprite-package':
        return this.spritePackageToAsset(await this.importSpritePackage(request.sourcePath))
      case 'vrm-model':
        return this.importVrmModelFromPath(request)
      case 'scene-background':
        return this.importSceneBackgroundFromPath(request)
    }
  }

  public async importRemoteAsset(input: unknown): Promise<PetAssetInfo> {
    const request = parseAssetImportRemoteRequest(input)
    return this.importRemoteVrmModel(request)
  }

  public async deleteAsset(input: unknown): Promise<void> {
    const request = parseAssetDeleteRequest(input)
    switch (request.kind) {
      case 'sprite-package':
        await this.deleteSpritePackage(request.assetId)
        return
      case 'vrm-model':
        await this.deleteManagedAsset('vrm-model', request.assetId)
        return
      case 'scene-background':
        await this.deleteManagedAsset('scene-background', request.assetId)
        return
    }
  }

  public async resolveAsset(input: unknown): Promise<PetAssetResolveResult | null> {
    const request = parseAssetResolveRequest(input)
    switch (request.kind) {
      case 'sprite-package':
        return this.resolveSpritePackageAsset(request)
      case 'vrm-model':
      case 'scene-background':
        return this.resolveManagedAsset(request)
    }
  }

  public async listSpritePackages(): Promise<PetPackageInfo[]> {
    return (await listImportedPetPackagesSafe(this.getPrimarySpritePackageRoot())).sort((a, b) =>
      a.displayName.localeCompare(b.displayName)
    )
  }

  public async importSpritePackage(sourceDir: string): Promise<PetPackageInfo> {
    return importPetPackage(sourceDir, this.getPrimarySpritePackageRoot())
  }

  public async findSpritePackage(packageId: string): Promise<PetPackageInfo | null> {
    const petPackage = await findImportedPackage(this.getPrimarySpritePackageRoot(), packageId)
    return petPackage ? toPetPackageInfo(petPackage) : null
  }

  public async deleteSpritePackage(packageId: string): Promise<void> {
    const root = this.getPrimarySpritePackageRoot()
    if (await findImportedPackage(root, packageId)) {
      await deleteImportedPackage(root, packageId)
      return
    }
    throw new Error(`Pet package "${packageId}" was not found`)
  }

  private registerIpcHandlers(): void {
    this.ipcHandle(IpcChannel.Pet_ListAssets, (_event, request: unknown) => this.listAssets(request))
    this.ipcHandle(IpcChannel.Pet_ImportAsset, (_event, request: unknown) => this.importAsset(request))
    this.ipcHandle(IpcChannel.Pet_ImportRemoteAsset, (_event, request: unknown) => this.importRemoteAsset(request))
    this.ipcHandle(IpcChannel.Pet_DeleteAsset, (_event, request: unknown) => this.deleteAsset(request))
    this.ipcHandle(IpcChannel.Pet_ResolveAsset, (_event, request: unknown) => this.resolveAsset(request))
  }

  private async listAssetsByKind(kind: PetAssetKind): Promise<PetAssetInfo[]> {
    switch (kind) {
      case 'sprite-package':
        return (await this.listSpritePackages()).map((petPackage) => this.spritePackageToAsset(petPackage))
      case 'vrm-model':
      case 'scene-background':
        return this.listManagedAssets(kind)
    }
  }

  private async listManagedAssets(
    kind: Extract<PetAssetKind, 'scene-background' | 'vrm-model'>
  ): Promise<PetAssetInfo[]> {
    const root = this.getManagedAssetRoot(kind)
    await fs.mkdir(root, { recursive: true })
    const entries = await fs.readdir(root, { withFileTypes: true })
    const assets: PetAssetInfo[] = []

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const assetDir = path.join(root, entry.name)
      try {
        const asset = await this.readAssetManifest(assetDir, kind)
        assets.push(asset)
      } catch {
        // Ignore incomplete asset folders; import writes a manifest last.
      }
    }

    return assets.sort(comparePetAssets)
  }

  private async importVrmModelFromPath(request: PetAssetImportRequest): Promise<PetAssetInfo> {
    const sourcePath = parseSourcePath(request.sourcePath)
    const sourceStat = await fs.stat(sourcePath)
    if (!sourceStat.isFile()) throw new Error('VRM source must be a file')
    validateFileExtension(sourcePath, PET_VRM_EXTENSIONS, 'Only .vrm files are supported')
    validateMaxBytes(sourceStat.size, PET_VRM_MAX_BYTES, 'VRM model')

    const originalFileName = request.originalFileName?.trim() || path.basename(sourcePath)
    const displayName = request.displayName?.trim() || stripExtension(originalFileName)
    const assetId = createPetAssetId('vrm', originalFileName)
    const assetDir = path.join(this.getManagedAssetRoot('vrm-model'), assetId)
    const targetPath = path.join(assetDir, PET_VRM_MODEL_FILE)
    const now = Date.now()
    const asset: PetAssetInfo = {
      id: assetId,
      kind: 'vrm-model',
      displayName,
      originalFileName,
      createdAt: now,
      updatedAt: now,
      sizeBytes: sourceStat.size,
      files: [
        {
          role: 'model',
          relativePath: PET_VRM_MODEL_FILE,
          mediaType: request.mediaType?.trim() || 'model/vrm',
          sizeBytes: sourceStat.size
        }
      ]
    }

    await this.writeImportedFileAsset(assetDir, targetPath, sourcePath, asset)
    return asset
  }

  private async importRemoteVrmModel(request: PetAssetImportRemoteRequest): Promise<PetAssetInfo> {
    const sourceUrl = parseHttpsUrl(request.sourceUrl)
    validateFileExtension(request.fileName, PET_VRM_EXTENSIONS, 'Only .vrm files are supported')

    const response = await fetch(sourceUrl)
    if (!response.ok) {
      throw new Error(`Failed to download VRM model: ${response.status} ${response.statusText}`.trim())
    }

    const bytes = Buffer.from(await response.arrayBuffer())
    validateMaxBytes(bytes.byteLength, PET_VRM_MAX_BYTES, 'VRM model')

    const originalFileName = request.fileName.trim()
    const assetId = createPetAssetId('vrm', originalFileName)
    const assetDir = path.join(this.getManagedAssetRoot('vrm-model'), assetId)
    const targetPath = path.join(assetDir, PET_VRM_MODEL_FILE)
    const now = Date.now()
    const asset: PetAssetInfo = {
      id: assetId,
      kind: 'vrm-model',
      displayName: request.displayName?.trim() || stripExtension(originalFileName),
      originalFileName,
      createdAt: now,
      updatedAt: now,
      sizeBytes: bytes.byteLength,
      files: [
        {
          role: 'model',
          relativePath: PET_VRM_MODEL_FILE,
          mediaType: request.mediaType?.trim() || response.headers.get('content-type') || 'model/vrm',
          sizeBytes: bytes.byteLength
        }
      ]
    }

    await this.writeBufferedAsset(assetDir, targetPath, bytes, asset)
    return asset
  }

  private async importSceneBackgroundFromPath(request: PetAssetImportRequest): Promise<PetAssetInfo> {
    const sourcePath = parseSourcePath(request.sourcePath)
    const sourceStat = await fs.stat(sourcePath)
    if (!sourceStat.isFile()) throw new Error('Scene background source must be a file')
    validateFileExtension(sourcePath, PET_SCENE_IMAGE_EXTENSIONS, 'Only PNG, JPG, and WebP scene images are supported')
    validateMaxBytes(sourceStat.size, PET_SCENE_IMAGE_MAX_BYTES, 'Scene background')

    const originalFileName = request.originalFileName?.trim() || path.basename(sourcePath)
    const extension = path.extname(originalFileName).toLowerCase()
    const relativePath = `${PET_SCENE_BACKGROUND_FILE}${extension}`
    const assetId = createPetAssetId('scene', originalFileName)
    const assetDir = path.join(this.getManagedAssetRoot('scene-background'), assetId)
    const targetPath = path.join(assetDir, relativePath)
    const now = Date.now()
    const asset: PetAssetInfo = {
      id: assetId,
      kind: 'scene-background',
      displayName: request.displayName?.trim() || stripExtension(originalFileName),
      originalFileName,
      createdAt: now,
      updatedAt: now,
      sizeBytes: sourceStat.size,
      files: [
        {
          role: 'background',
          relativePath,
          mediaType: request.mediaType?.trim() || getSceneImageMediaType(extension),
          sizeBytes: sourceStat.size
        }
      ]
    }

    await this.writeImportedFileAsset(assetDir, targetPath, sourcePath, asset)
    return asset
  }

  private async writeImportedFileAsset(
    assetDir: string,
    targetPath: string,
    sourcePath: string,
    asset: StoredPetAssetManifest
  ): Promise<void> {
    await fs.mkdir(path.dirname(assetDir), { recursive: true })
    await fs.mkdir(assetDir, { recursive: false })
    try {
      await fs.copyFile(sourcePath, targetPath)
      await this.writeAssetManifest(assetDir, asset)
    } catch (error) {
      await fs.rm(assetDir, { recursive: true, force: true })
      throw error
    }
  }

  private async writeBufferedAsset(
    assetDir: string,
    targetPath: string,
    bytes: Buffer,
    asset: StoredPetAssetManifest
  ): Promise<void> {
    await fs.mkdir(path.dirname(assetDir), { recursive: true })
    await fs.mkdir(assetDir, { recursive: false })
    try {
      await fs.writeFile(targetPath, bytes)
      await this.writeAssetManifest(assetDir, asset)
    } catch (error) {
      await fs.rm(assetDir, { recursive: true, force: true })
      throw error
    }
  }

  private async resolveManagedAsset(request: PetAssetResolveRequest): Promise<PetAssetResolveResult | null> {
    if (request.kind !== 'vrm-model' && request.kind !== 'scene-background') return null
    const assetDir = this.getManagedAssetDir(request.kind, request.assetId)
    try {
      const asset = await this.readAssetManifest(assetDir, request.kind)
      const file = pickAssetFile(asset, request.fileRole ?? getDefaultFileRole(request.kind))
      if (!file) return null

      const filePath = resolveAssetFile(assetDir, file.relativePath)
      await fs.access(filePath)
      return {
        asset,
        url: pathToFileURL(filePath).href
      }
    } catch {
      return null
    }
  }

  private async resolveSpritePackageAsset(request: PetAssetResolveRequest): Promise<PetAssetResolveResult | null> {
    const petPackage = await this.findSpritePackage(request.assetId)
    if (!petPackage) return null
    return {
      asset: this.spritePackageToAsset(petPackage),
      url: petPackage.spriteUrl
    }
  }

  private async deleteManagedAsset(
    kind: Extract<PetAssetKind, 'scene-background' | 'vrm-model'>,
    assetId: string
  ): Promise<void> {
    const assetDir = this.getManagedAssetDir(kind, parseAssetId(assetId))
    if (!isPathInside(this.getManagedAssetRoot(kind), assetDir)) {
      throw new Error('Pet asset target must stay inside the managed root')
    }
    await fs.rm(assetDir, { recursive: true, force: false })
  }

  private async readAssetManifest(
    assetDir: string,
    expectedKind: Extract<PetAssetKind, 'scene-background' | 'vrm-model'>
  ): Promise<PetAssetInfo> {
    const manifestPath = path.join(assetDir, PET_ASSET_MANIFEST_FILE)
    const parsed = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as Partial<PetAssetInfo>
    const asset = normalizeStoredAsset(parsed)
    if (asset.kind !== expectedKind) throw new Error('Pet asset kind mismatch')
    if (path.basename(assetDir) !== asset.id) throw new Error('Pet asset id mismatch')
    return asset
  }

  private async writeAssetManifest(assetDir: string, asset: StoredPetAssetManifest): Promise<void> {
    await fs.writeFile(path.join(assetDir, PET_ASSET_MANIFEST_FILE), `${JSON.stringify(asset, null, 2)}\n`, 'utf8')
  }

  private spritePackageToAsset(petPackage: PetPackageInfo): PetAssetInfo {
    return {
      id: petPackage.id,
      kind: 'sprite-package',
      displayName: petPackage.displayName,
      createdAt: 0,
      updatedAt: 0,
      files: [
        { role: 'manifest', relativePath: 'pet.json' },
        { role: 'sprite', relativePath: petPackage.spritesheetPath }
      ]
    }
  }

  private getFeatureRoot(): string {
    return application.getPath('feature.pets')
  }

  private getPrimarySpritePackageRoot(): string {
    return path.join(this.getFeatureRoot(), 'assets', 'sprite', 'packages')
  }

  private getManagedAssetRoot(kind: Extract<PetAssetKind, 'scene-background' | 'vrm-model'>): string {
    switch (kind) {
      case 'vrm-model':
        return path.join(this.getFeatureRoot(), 'assets', 'vrm', 'models')
      case 'scene-background':
        return path.join(this.getFeatureRoot(), 'assets', 'scene', 'backgrounds')
    }
  }

  private getManagedAssetDir(kind: Extract<PetAssetKind, 'scene-background' | 'vrm-model'>, assetId: string): string {
    const root = this.getManagedAssetRoot(kind)
    const assetDir = path.join(root, parseAssetId(assetId))
    if (!isPathInside(root, assetDir)) {
      throw new Error('Pet asset target must stay inside the managed root')
    }
    return assetDir
  }
}

async function listImportedPetPackagesSafe(root: string): Promise<PetPackageInfo[]> {
  try {
    return await listImportedPetPackages(root)
  } catch {
    return []
  }
}

function parseAssetListRequest(input: unknown): PetAssetListRequest {
  if (input === undefined || input === null) return {}
  if (!isRecord(input)) throw new Error('Pet asset list request must be an object')
  return {
    ...(input.kind === undefined ? {} : { kind: parseAssetKind(input.kind) })
  }
}

function parseAssetImportRequest(input: unknown): PetAssetImportRequest {
  if (!isRecord(input)) throw new Error('Pet asset import request must be an object')
  return {
    kind: parseAssetKind(input.kind),
    sourcePath: parseRequiredString(input.sourcePath, 'sourcePath'),
    displayName: parseOptionalString(input.displayName),
    originalFileName: parseOptionalString(input.originalFileName),
    mediaType: parseOptionalString(input.mediaType)
  }
}

function parseAssetImportRemoteRequest(input: unknown): PetAssetImportRemoteRequest {
  if (!isRecord(input)) throw new Error('Pet remote asset import request must be an object')
  const kind = parseAssetKind(input.kind)
  if (kind !== 'vrm-model') throw new Error('Only VRM model remote imports are supported')
  return {
    kind,
    sourceUrl: parseRequiredString(input.sourceUrl, 'sourceUrl'),
    fileName: parseRequiredString(input.fileName, 'fileName'),
    displayName: parseOptionalString(input.displayName),
    mediaType: parseOptionalString(input.mediaType)
  }
}

function parseAssetDeleteRequest(input: unknown): PetAssetDeleteRequest {
  if (!isRecord(input)) throw new Error('Pet asset delete request must be an object')
  return {
    assetId: parseAssetId(input.assetId),
    kind: parseAssetKind(input.kind)
  }
}

function parseAssetResolveRequest(input: unknown): PetAssetResolveRequest {
  if (!isRecord(input)) throw new Error('Pet asset resolve request must be an object')
  return {
    assetId: parseAssetId(input.assetId),
    kind: parseAssetKind(input.kind),
    fileRole: input.fileRole === undefined ? undefined : parseAssetFileRole(input.fileRole)
  }
}

function parseAssetKind(value: unknown): PetAssetKind {
  if (typeof value === 'string' && (PET_ASSET_KINDS as readonly string[]).includes(value)) {
    return value as PetAssetKind
  }
  throw new Error('Unsupported pet asset kind')
}

function parseAssetFileRole(value: unknown): PetAssetFileRole {
  if (
    value === 'background' ||
    value === 'manifest' ||
    value === 'model' ||
    value === 'sprite' ||
    value === 'thumbnail'
  ) {
    return value
  }
  throw new Error('Unsupported pet asset file role')
}

function parseAssetId(value: unknown): string {
  const id = parseRequiredString(value, 'assetId')
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(id)) throw new Error('Invalid pet asset id')
  return id
}

function parseSourcePath(value: unknown): string {
  const sourcePath = parseRequiredString(value, 'sourcePath')
  if (!path.isAbsolute(sourcePath) || sourcePath.includes('\0')) {
    throw new Error('Pet asset source path must be an absolute path')
  }
  return sourcePath
}

function parseHttpsUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:') throw new Error('Remote pet asset URL must use HTTPS')
  return url.href
}

function parseRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Pet asset field "${fieldName}" must be a non-empty string`)
  }
  return value.trim()
}

function parseOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function normalizeStoredAsset(value: Partial<PetAssetInfo>): PetAssetInfo {
  if (!isRecord(value)) throw new Error('Pet asset manifest must be an object')
  const kind = parseAssetKind(value.kind)
  return {
    id: parseAssetId(value.id),
    kind,
    displayName: parseRequiredString(value.displayName, 'displayName'),
    createdAt: parseFiniteNumber(value.createdAt, 'createdAt'),
    updatedAt: parseFiniteNumber(value.updatedAt, 'updatedAt'),
    files: normalizeAssetFiles(value.files),
    originalFileName: parseOptionalString(value.originalFileName),
    sizeBytes: typeof value.sizeBytes === 'number' && Number.isFinite(value.sizeBytes) ? value.sizeBytes : undefined
  }
}

function normalizeAssetFiles(value: unknown): PetAssetFileInfo[] {
  if (!Array.isArray(value)) throw new Error('Pet asset files must be an array')
  return value.map((file) => {
    if (!isRecord(file)) throw new Error('Pet asset file must be an object')
    return {
      role: parseAssetFileRole(file.role),
      relativePath: parseRelativePath(file.relativePath),
      mediaType: parseOptionalString(file.mediaType),
      sizeBytes: typeof file.sizeBytes === 'number' && Number.isFinite(file.sizeBytes) ? file.sizeBytes : undefined
    }
  })
}

function parseRelativePath(value: unknown): string {
  const relativePath = parseRequiredString(value, 'relativePath')
  if (path.isAbsolute(relativePath) || relativePath.includes('\0')) {
    throw new Error('Pet asset file path must be relative')
  }
  return relativePath
}

function parseFiniteNumber(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Pet asset field "${fieldName}" must be a finite number`)
  }
  return value
}

function resolveAssetFile(assetDir: string, relativePath: string): string {
  const resolved = path.resolve(assetDir, relativePath)
  if (!isPathInside(assetDir, resolved)) {
    throw new Error('Pet asset file must stay inside the asset directory')
  }
  return resolved
}

function pickAssetFile(asset: PetAssetInfo, role: PetAssetFileRole): PetAssetFileInfo | undefined {
  return asset.files.find((file) => file.role === role)
}

function getDefaultFileRole(kind: PetAssetKind): PetAssetFileRole {
  switch (kind) {
    case 'sprite-package':
      return 'sprite'
    case 'vrm-model':
      return 'model'
    case 'scene-background':
      return 'background'
  }
}

function validateFileExtension(fileName: string, allowedExtensions: ReadonlySet<string>, message: string): void {
  if (!allowedExtensions.has(path.extname(fileName).toLowerCase())) {
    throw new Error(message)
  }
}

function validateMaxBytes(size: number, maxBytes: number, label: string): void {
  if (size > maxBytes) {
    throw new Error(`${label} is too large; maximum is ${maxBytes} bytes`)
  }
}

function createPetAssetId(prefix: string, fileName: string): string {
  return `${prefix}-${randomUUID()}-${sanitizePetAssetName(stripExtension(fileName))}`
}

function sanitizePetAssetName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'asset'
  )
}

function stripExtension(fileName: string): string {
  return path.basename(fileName, path.extname(fileName))
}

function getSceneImageMediaType(extension: string): string {
  switch (extension) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.webp':
      return 'image/webp'
    case '.png':
    default:
      return 'image/png'
  }
}

function comparePetAssets(left: PetAssetInfo, right: PetAssetInfo): number {
  return (
    right.updatedAt - left.updatedAt ||
    left.displayName.localeCompare(right.displayName) ||
    left.id.localeCompare(right.id)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
