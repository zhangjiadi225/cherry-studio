import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { PET_FRAME_HEIGHT, PET_SPRITESHEET_HEIGHT, PET_SPRITESHEET_WIDTH } from '@shared/pet'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  deleteImportedPackage,
  importPetPackage,
  listImportedPetPackages,
  parsePetPackageMetadata,
  resolvePetPackageFile,
  validatePetPackage
} from '../PetPackageStore'

describe('PetPackageStore', () => {
  let tmp: string

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cherry-pet-'))
  })

  afterEach(async () => {
    await rmWithRetry(tmp)
  })

  it('validates and imports a Codex atlas package', async () => {
    const source = path.join(tmp, 'source')
    const managed = path.join(tmp, 'managed')
    await writePetPackage(source)

    const imported = await importPetPackage(source, managed)
    const packages = await listImportedPetPackages(managed)

    expect(imported.id).toBe('nyanko-sensei')
    expect(imported.spriteUrl).toMatch(/^file:/)
    expect(packages).toHaveLength(1)
    expect(packages[0]?.id).toBe('nyanko-sensei')
  })

  it('rejects packages missing pet.json', async () => {
    const source = path.join(tmp, 'source')
    await fs.mkdir(source, { recursive: true })

    await expect(validatePetPackage(source)).rejects.toThrow()
  })

  it('rejects spritesheets with the wrong size', async () => {
    const source = path.join(tmp, 'source')
    await writePetPackage(source, { width: 128, height: 128 })

    await expect(validatePetPackage(source)).rejects.toThrow(/1536x1872/)
  })

  it('accepts extended spritesheets when package metadata defines extra animation rows', async () => {
    const source = path.join(tmp, 'source')
    await writePetPackage(source, {
      height: PET_FRAME_HEIGHT * 10,
      animations: {
        celebrate: { row: 9, frameCount: 5, frameDurations: [120, 120, 120, 120, 240], loop: false }
      }
    })

    await expect(validatePetPackage(source)).resolves.toMatchObject({
      metadata: {
        animations: {
          celebrate: { row: 9, frameCount: 5, frameDurations: [120, 120, 120, 120, 240], loop: false }
        }
      }
    })
  })

  it('rejects spritesheet paths outside the package directory', () => {
    expect(() => resolvePetPackageFile('/tmp/pet', '../spritesheet.webp')).toThrow(/inside/)
    expect(() => resolvePetPackageFile('/tmp/pet', '/tmp/spritesheet.webp')).toThrow(/Invalid/)
  })

  it('rejects duplicate package ids on import', async () => {
    const first = path.join(tmp, 'first')
    const second = path.join(tmp, 'second')
    const managed = path.join(tmp, 'managed')
    await writePetPackage(first)
    await writePetPackage(second)

    await importPetPackage(first, managed)
    await expect(importPetPackage(second, managed)).rejects.toThrow(/already exists/)
  })

  it('deletes the managed package directory', async () => {
    const source = path.join(tmp, 'source')
    const managed = path.join(tmp, 'managed')
    await writePetPackage(source)

    await importPetPackage(source, managed)
    const packageDir = path.join(managed, 'nyanko-sensei')

    await expect(fs.access(packageDir)).resolves.toBeUndefined()
    await deleteImportedPackage(managed, 'nyanko-sensei')

    await expect(fs.access(packageDir)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(listImportedPetPackages(managed)).resolves.toHaveLength(0)
  })

  it('parses optional kind and animation overrides while preserving the required Codex fields', () => {
    expect(
      parsePetPackageMetadata({
        schemaVersion: 1,
        format: 'codex-atlas',
        id: 'nyanko-sensei',
        displayName: 'Nyanko Sensei',
        description: 'Lucky desktop companion',
        spritesheetPath: 'spritesheet.webp',
        kind: 'cat',
        animations: {
          celebrate: { row: 9, frameCount: 5, frameDurations: [120, 120, 120, 120, 240], loop: false }
        }
      })
    ).toEqual({
      schemaVersion: 1,
      format: 'codex-atlas',
      id: 'nyanko-sensei',
      displayName: 'Nyanko Sensei',
      description: 'Lucky desktop companion',
      spritesheetPath: 'spritesheet.webp',
      kind: 'cat',
      animations: {
        celebrate: { row: 9, frameCount: 5, frameDurations: [120, 120, 120, 120, 240], loop: false }
      }
    })
  })

  it('requires an animation manifest path for rich multi-asset packages', () => {
    expect(() =>
      parsePetPackageMetadata({
        schemaVersion: 1,
        format: 'cherry-multi-asset',
        id: 'nyanko-sensei',
        displayName: 'Nyanko Sensei',
        description: 'Lucky desktop companion',
        spritesheetPath: 'spritesheet.webp'
      })
    ).toThrow(/animationManifestPath/)
  })

  it('rejects rich animation manifest paths outside the package directory', async () => {
    const source = path.join(tmp, 'source')
    await writePetPackage(source, {
      format: 'cherry-multi-asset',
      animationManifestPath: '../animations.json'
    })

    await expect(validatePetPackage(source)).rejects.toThrow(/inside/)
  })

  it('loads valid rich animation manifests into runtime clips', async () => {
    const source = path.join(tmp, 'source')
    await writePetPackage(source, {
      format: 'cherry-multi-asset',
      animationManifestPath: 'animations.json',
      manifest: {
        schemaVersion: 1,
        clips: [
          {
            action: 'wave',
            frames: [{ assetPath: 'assets/wave-1.webp', durationMs: 180, width: 96, height: 96 }],
            loop: false,
            phaseGroup: 'gesture'
          }
        ]
      }
    })
    await fs.mkdir(path.join(source, 'assets'), { recursive: true })
    await sharp({
      create: {
        width: 96,
        height: 96,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      }
    })
      .webp()
      .toFile(path.join(source, 'assets', 'wave-1.webp'))

    await expect(validatePetPackage(source)).resolves.toMatchObject({
      metadata: {
        multiAssetClips: {
          wave: {
            frames: [{ durationMs: 180, height: 96, width: 96 }],
            loop: false,
            phaseGroup: 'gesture'
          }
        }
      }
    })
  })

  it('rejects rich animation manifests with unsafe frame durations', async () => {
    const source = path.join(tmp, 'source')
    await writePetPackage(source, {
      format: 'cherry-multi-asset',
      animationManifestPath: 'animations.json',
      manifest: {
        schemaVersion: 1,
        clips: [
          {
            action: 'wave',
            frames: [{ assetPath: 'assets/wave-1.webp', durationMs: 20, width: 96, height: 96 }],
            loop: false
          }
        ]
      }
    })
    await fs.mkdir(path.join(source, 'assets'), { recursive: true })
    await fs.writeFile(path.join(source, 'assets', 'wave-1.webp'), '')

    await expect(validatePetPackage(source)).rejects.toThrow(/duration/)
  })

  it('rejects rich animation manifests with missing assets', async () => {
    const source = path.join(tmp, 'source')
    await writePetPackage(source, {
      format: 'cherry-multi-asset',
      animationManifestPath: 'animations.json',
      manifest: {
        schemaVersion: 1,
        clips: [
          {
            action: 'wave',
            frames: [{ assetPath: 'assets/missing.webp', durationMs: 180, width: 96, height: 96 }],
            loop: false
          }
        ]
      }
    })

    await expect(validatePetPackage(source)).rejects.toThrow(/asset/)
  })

  it('rejects rich animation manifests when declared dimensions do not match the asset', async () => {
    const source = path.join(tmp, 'source')
    await writePetPackage(source, {
      format: 'cherry-multi-asset',
      animationManifestPath: 'animations.json',
      manifest: {
        schemaVersion: 1,
        clips: [
          {
            action: 'wave',
            frames: [{ assetPath: 'assets/wave-1.webp', durationMs: 180, width: 128, height: 96 }],
            loop: false
          }
        ]
      }
    })
    await fs.mkdir(path.join(source, 'assets'), { recursive: true })
    await sharp({
      create: {
        width: 96,
        height: 96,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      }
    })
      .webp()
      .toFile(path.join(source, 'assets', 'wave-1.webp'))

    await expect(validatePetPackage(source)).rejects.toThrow(/dimensions/)
  })

  it('rejects package imports with unsupported file types', async () => {
    const source = path.join(tmp, 'source')
    const managed = path.join(tmp, 'managed')
    await writePetPackage(source)
    await fs.writeFile(path.join(source, 'script.js'), 'alert(1)')

    await expect(importPetPackage(source, managed)).rejects.toThrow(/Unsupported pet package file type/)
  })

  it('rejects package imports with too many files', async () => {
    const source = path.join(tmp, 'source')
    const managed = path.join(tmp, 'managed')
    await writePetPackage(source)
    await fs.mkdir(path.join(source, 'assets'), { recursive: true })
    await Promise.all(
      Array.from({ length: 64 }, (_, index) => fs.writeFile(path.join(source, 'assets', `${index}.json`), '{}'))
    )

    await expect(importPetPackage(source, managed)).rejects.toThrow(/too many files/)
  })

  it('rejects package imports over the total byte budget', async () => {
    const source = path.join(tmp, 'source')
    const managed = path.join(tmp, 'managed')
    await writePetPackage(source)
    await fs.writeFile(path.join(source, 'large.webp'), Buffer.alloc(20 * 1024 * 1024))

    await expect(importPetPackage(source, managed)).rejects.toThrow(/too large/)
  })

  it('rejects package imports with oversized individual image files', async () => {
    const source = path.join(tmp, 'source')
    const managed = path.join(tmp, 'managed')
    await writePetPackage(source)
    await fs.writeFile(path.join(source, 'large.webp'), Buffer.alloc(8 * 1024 * 1024 + 1))

    await expect(importPetPackage(source, managed)).rejects.toThrow(/image file is too large/)
  })

  it('rejects package imports with images above the pixel budget', async () => {
    const source = path.join(tmp, 'source')
    const managed = path.join(tmp, 'managed')
    await writePetPackage(source)
    await sharp({
      create: {
        width: 4097,
        height: 4096,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      },
      limitInputPixels: false
    })
      .png()
      .toFile(path.join(source, 'huge.png'))

    await expect(importPetPackage(source, managed)).rejects.toThrow(/too many pixels/)
  })

  it('rejects package imports containing symbolic links', async () => {
    const source = path.join(tmp, 'source')
    const managed = path.join(tmp, 'managed')
    await writePetPackage(source)
    try {
      await fs.writeFile(path.join(tmp, 'outside.txt'), 'outside')
      await fs.symlink(path.join(tmp, 'outside.txt'), path.join(source, 'link.txt'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') return
      throw error
    }

    await expect(importPetPackage(source, managed)).rejects.toThrow(/symbolic links/)
  })
})

async function writePetPackage(
  packageDir: string,
  options: {
    animationManifestPath?: string
    animations?: Record<string, unknown>
    format?: string
    manifest?: unknown
    width?: number
    height?: number
  } = {}
): Promise<void> {
  await fs.mkdir(packageDir, { recursive: true })
  await fs.writeFile(
    path.join(packageDir, 'pet.json'),
    JSON.stringify({
      id: 'nyanko-sensei',
      displayName: 'Nyanko Sensei',
      description: 'Lucky desktop companion',
      spritesheetPath: 'spritesheet.webp',
      kind: 'cat',
      ...(options.format ? { format: options.format } : {}),
      ...(options.animationManifestPath ? { animationManifestPath: options.animationManifestPath } : {}),
      ...(options.animations ? { animations: options.animations } : {})
    })
  )
  if (options.manifest) {
    await fs.writeFile(
      path.join(packageDir, options.animationManifestPath ?? 'animations.json'),
      JSON.stringify(options.manifest)
    )
  }
  await sharp({
    create: {
      width: options.width ?? PET_SPRITESHEET_WIDTH,
      height: options.height ?? PET_SPRITESHEET_HEIGHT,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .webp()
    .toFile(path.join(packageDir, 'spritesheet.webp'))
}

async function rmWithRetry(target: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await fs.rm(target, { recursive: true, force: true })
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EBUSY' || attempt === 4) throw error
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
}
