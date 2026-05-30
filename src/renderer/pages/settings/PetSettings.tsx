import {
  Button,
  Input,
  RowFlex,
  SegmentedControl,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Slider,
  Switch,
  Tooltip
} from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useAgents } from '@renderer/hooks/agents/useAgent'
import {
  usePetSceneModePreference,
  usePetVrmStageModelProfilesPreference,
  usePetVrmStageSceneSettingsPreference
} from '@renderer/hooks/usePetPreferences'
import { cn } from '@renderer/utils/style'
import SpriteAnimator from '@renderer/windows/pet/sprite/SpriteAnimator'
import type { PetVrmModelSummary, PetVrmStageModelProfileMap } from '@renderer/windows/pet/vrm/types'
import {
  createPetVrmStageModelProfile,
  deletePetVrmModel,
  listPetVrmModels,
  savePetVrmModel,
  subscribePetVrmLibraryChanges
} from '@renderer/windows/pet/vrm/vrmModelLibrary'
import type {
  PetAnimalInstance,
  PetPackageInfo,
  PetPastureBounds,
  PetPastureSnapshot,
  PetSceneMode,
  PetVrmStageAnimationMode,
  PetVrmStageAnimationPreset,
  PetVrmStageBackgroundMode,
  PetVrmStageExpressionName,
  PetVrmStageModelProfile,
  PetVrmStageSceneSettings
} from '@shared/pet'
import {
  clampPetScale,
  DEFAULT_PET_PERSONALITY,
  isPetPersonality,
  PET_DEFAULT_SCALE,
  PET_MAX_SCALE,
  PET_MIN_SCALE,
  PET_PASTURE_DEFAULT_WIDTH,
  PET_PASTURE_MAX_WIDTH,
  PET_PASTURE_MIN_WIDTH,
  PET_PERSONALITIES,
  PET_VRM_STAGE_ANIMATION_MODES,
  PET_VRM_STAGE_ANIMATION_PRESETS,
  PET_VRM_STAGE_BACKGROUND_MODES,
  PET_VRM_STAGE_DEFAULT_SCENE_SETTINGS,
  PET_VRM_STAGE_EXPRESSION_NAMES,
  resolvePetRuntimeClip
} from '@shared/pet'
import { FolderPlus, Trash2 } from 'lucide-react'
import type { FC, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { preloadPetRuntimeClipAssets } from '../../windows/pet/sprite/petAssetCache'
import { SettingContainer, SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '.'

const PREVIEW_SCALE = 0.2
const EMPTY_PACKAGES: PetPastureSnapshot['packages'] = []
const EMPTY_ANIMALS: PetPastureSnapshot['animals'] = []
const DEFAULT_PASTURE_BOUNDS: PetPastureBounds = { x: -1, y: -1, width: PET_PASTURE_DEFAULT_WIDTH }
const PET_SCALE_STEP_PERCENT = 2
const NO_AGENT_VALUE = '__none__'
const PET_SCENE_MODE_OPTIONS: readonly PetSceneMode[] = ['sprite-pasture', 'vrm-stage']
const PET_VRM_STAGE_SCALE_MIN_PERCENT = 50
const PET_VRM_STAGE_SCALE_MAX_PERCENT = 180
const PET_VRM_STAGE_Y_OFFSET_MIN = -120
const PET_VRM_STAGE_Y_OFFSET_MAX = 160
const PET_VRM_STAGE_LIGHT_PERCENT_MAX = 600
const PET_VRM_STAGE_CAMERA_ZOOM_MIN_PERCENT = 75
const PET_VRM_STAGE_CAMERA_ZOOM_MAX_PERCENT = 160

const PetSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const [enabled, setEnabled] = usePreference('feature.pet.enabled')
  const [pinOnTop, setPinOnTop] = usePreference('feature.pet.pin_on_top')
  const [dndEnabled, setDndEnabled] = usePreference('feature.pet.dnd_enabled')
  const [pastureBounds, setPastureBounds] = usePreference('feature.pet.pasture_bounds')
  const [petScale, setPetScale] = usePreference('feature.pet.scale')
  const effectivePastureBounds = pastureBounds ?? DEFAULT_PASTURE_BOUNDS
  const effectivePetScale = typeof petScale === 'number' ? petScale : PET_DEFAULT_SCALE
  const [widthDraft, setWidthDraft] = useState(() => clampPastureWidth(effectivePastureBounds.width))
  const [scaleDraft, setScaleDraft] = useState(() => petScaleToPercent(effectivePetScale))
  const [snapshot, setSnapshot] = useState<PetPastureSnapshot | null>(null)
  const [sceneMode, setSceneMode] = usePetSceneModePreference()
  const [vrmModels, setVrmModels] = useState<PetVrmModelSummary[]>([])
  const {
    deleteProfile: deleteVrmStageModelProfile,
    profiles: vrmStageModelProfiles,
    saveProfile: saveVrmStageModelProfile
  } = usePetVrmStageModelProfilesPreference()
  const [vrmSceneSettings, setVrmSceneSettings] = usePetVrmStageSceneSettingsPreference()
  const vrmFileInputRef = useRef<HTMLInputElement | null>(null)
  const { agents } = useAgents()

  const packages = snapshot?.packages ?? EMPTY_PACKAGES
  const animals = snapshot?.animals ?? EMPTY_ANIMALS
  const animalByPackageId = useMemo(() => new Map(animals.map((animal) => [animal.packageId, animal])), [animals])
  const spriteSceneEnabled = sceneMode === 'sprite-pasture'
  const vrmSceneEnabled = sceneMode === 'vrm-stage'

  const refreshSnapshot = useCallback(async () => {
    setSnapshot(await window.api.pet.getPastureSnapshot())
  }, [])

  const refreshVrmLibrary = useCallback(async () => {
    try {
      setVrmModels(await listPetVrmModels())
    } catch {
      setVrmModels([])
    }
  }, [])

  useEffect(() => {
    void refreshSnapshot()
    const offPastureChanged = window.api.pet.onPastureChanged(setSnapshot)
    return () => {
      offPastureChanged()
    }
  }, [refreshSnapshot])

  useEffect(() => {
    void refreshVrmLibrary()
    return subscribePetVrmLibraryChanges(() => {
      void refreshVrmLibrary()
    })
  }, [refreshVrmLibrary])

  useEffect(() => {
    setWidthDraft(clampPastureWidth(effectivePastureBounds.width))
  }, [effectivePastureBounds.width])

  useEffect(() => {
    setScaleDraft(petScaleToPercent(effectivePetScale))
  }, [effectivePetScale])

  const handleEnabledChange = async (nextEnabled: boolean) => {
    await setEnabled(nextEnabled)
    if (nextEnabled) {
      void window.api.pet.show()
    } else {
      void window.api.pet.close()
    }
  }

  const handlePinChange = async (nextPinOnTop: boolean) => {
    await setPinOnTop(nextPinOnTop)
    await window.api.pet.setPin(nextPinOnTop)
  }

  const handleWidthCommit = async ([nextWidth = PET_PASTURE_DEFAULT_WIDTH]: number[]) => {
    const width = clampPastureWidth(nextWidth)
    setWidthDraft(width)
    await setPastureBounds({ ...effectivePastureBounds, width })
    await window.api.pet.resizePasture(width)
  }

  const handleScaleCommit = async ([nextScalePercent = Math.round(PET_DEFAULT_SCALE * 100)]: number[]) => {
    const scale = percentToPetScale(nextScalePercent)
    setScaleDraft(petScaleToPercent(scale))
    await setPetScale(scale)
  }

  const handleSceneModeChange = (mode: PetSceneMode) => {
    void setSceneMode(mode)
  }

  const handleImport = async () => {
    try {
      const imported = await window.api.pet.selectAndImportPackage()
      if (imported) {
        await refreshSnapshot()
        window.toast.success(t('settings.pet.import_success'))
      }
    } catch (error) {
      window.toast.error(t('settings.pet.import_failed', { reason: formatError(error) }))
    }
  }

  const handleVrmImport = async (files: FileList | null) => {
    const selectedFiles = [...(files ?? [])]
    if (!selectedFiles.length) return

    try {
      await Promise.all(selectedFiles.map((file) => savePetVrmModel(file)))
      await refreshVrmLibrary()
      window.toast.success(t('settings.pet.vrm.import_success', { count: selectedFiles.length }))
    } catch (error) {
      window.toast.error(t('settings.pet.vrm.import_failed', { reason: formatError(error) }))
    }
  }

  const handlePackageEnabledChange = async (packageId: string, nextEnabled: boolean) => {
    try {
      const animal = animalByPackageId.get(packageId)
      if (animal) {
        await window.api.pet.upsertAnimal({ ...animal, enabled: nextEnabled })
      } else if (nextEnabled) {
        await window.api.pet.selectPackage(packageId)
      }
      await refreshSnapshot()
    } catch (error) {
      window.toast.error(t('settings.pet.animal_save_failed', { reason: formatError(error) }))
    }
  }

  const handleAnimalPersonalityChange = async (animal: PetAnimalInstance, value: string) => {
    if (!isPetPersonality(value)) return

    try {
      await window.api.pet.upsertAnimal({ ...animal, personality: value })
      await refreshSnapshot()
    } catch (error) {
      window.toast.error(t('settings.pet.animal_save_failed', { reason: formatError(error) }))
    }
  }

  const handleAnimalAgentChange = async (animal: PetAnimalInstance, value: string) => {
    const agentId = value === NO_AGENT_VALUE ? null : value

    try {
      const conflictingAnimals = agentId
        ? animals.filter((candidate) => candidate.id !== animal.id && candidate.agentId === agentId)
        : []
      await Promise.all(
        conflictingAnimals.map((candidate) => window.api.pet.upsertAnimal({ ...candidate, agentId: null }))
      )
      await window.api.pet.upsertAnimal({ ...animal, agentId })
      await refreshSnapshot()
    } catch (error) {
      window.toast.error(t('settings.pet.animal_save_failed', { reason: formatError(error) }))
    }
  }

  const handleVrmModelEnabledChange = async (model: PetVrmModelSummary, enabled: boolean) => {
    const currentProfile = vrmStageModelProfiles.get(model.id)
    const order = currentProfile?.order ?? getNextVrmStageModelOrder(vrmStageModelProfiles)
    const nextProfile = createPetVrmStageModelProfile(
      {
        enabled,
        homeXRatio: currentProfile?.homeXRatio ?? getDefaultVrmStageModelXRatio(order),
        modelId: model.id,
        order
      },
      currentProfile
    )
    await saveVrmStageModelProfile(nextProfile)
  }
  const handleVrmModelProfileChange = async (model: PetVrmModelSummary, patch: Partial<PetVrmStageModelProfile>) => {
    const currentProfile = vrmStageModelProfiles.get(model.id)
    const order = currentProfile?.order ?? getNextVrmStageModelOrder(vrmStageModelProfiles)
    const nextProfile = createPetVrmStageModelProfile(
      {
        enabled: currentProfile?.enabled ?? false,
        homeXRatio: currentProfile?.homeXRatio ?? getDefaultVrmStageModelXRatio(order),
        modelId: model.id,
        order,
        ...patch
      },
      currentProfile
    )
    await saveVrmStageModelProfile(nextProfile)
  }

  const handleVrmSceneSettingsChange = async (patch: Partial<PetVrmStageSceneSettings>) => {
    await setVrmSceneSettings({ ...vrmSceneSettings, ...patch })
  }

  const handleDeleteVrmModel = async (modelId: string) => {
    const confirmed = await window.modal.confirm({
      title: t('settings.pet.vrm.delete_confirm'),
      centered: true,
      okText: t('common.confirm'),
      cancelText: t('common.cancel')
    })
    if (!confirmed) return

    try {
      await deletePetVrmModel(modelId)
      await deleteVrmStageModelProfile(modelId)
      await refreshVrmLibrary()
      window.toast.success(t('settings.pet.vrm.delete_success'))
    } catch (error) {
      window.toast.error(t('settings.pet.vrm.delete_failed', { reason: formatError(error) }))
    }
  }

  const handleDeletePackage = async (packageId: string) => {
    const confirmed = await window.modal.confirm({
      title: t('settings.pet.delete_confirm'),
      centered: true,
      okText: t('common.confirm'),
      cancelText: t('common.cancel')
    })
    if (!confirmed) return

    try {
      await window.api.pet.deletePackage(packageId)
      await refreshSnapshot()
      window.toast.success(t('settings.pet.delete_success'))
    } catch (error) {
      window.toast.error(t('settings.pet.delete_failed', { reason: formatError(error) }))
    }
  }

  return (
    <SettingContainer theme={theme}>
      <input
        ref={vrmFileInputRef}
        accept=".vrm,model/vrm,model/gltf-binary,application/octet-stream"
        multiple
        style={{ display: 'none' }}
        type="file"
        onChange={(event) => {
          void handleVrmImport(event.currentTarget.files)
          event.currentTarget.value = ''
        }}
      />
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.pet.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.pet.enable')}</SettingRowTitle>
          <Switch checked={enabled} onCheckedChange={handleEnabledChange} />
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.pet.pin_on_top')}</SettingRowTitle>
          <Switch checked={pinOnTop} onCheckedChange={handlePinChange} />
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.pet.dnd_enabled')}</SettingRowTitle>
          <Switch checked={dndEnabled} onCheckedChange={setDndEnabled} />
        </SettingRow>
        <SettingDivider />
        <SettingSliderRow
          label={t('settings.pet.window_width')}
          valueLabel={t('settings.pet.window_width_value', { value: widthDraft })}
          slider={
            <Slider
              value={[widthDraft]}
              min={PET_PASTURE_MIN_WIDTH}
              max={PET_PASTURE_MAX_WIDTH}
              step={20}
              onValueChange={([nextWidth = PET_PASTURE_DEFAULT_WIDTH]) => setWidthDraft(clampPastureWidth(nextWidth))}
              onValueCommit={handleWidthCommit}
              className="w-full"
            />
          }
        />
        <SettingDivider />
        <SettingSliderRow
          label={t('settings.pet.pet_size')}
          valueLabel={t('settings.pet.pet_size_value', { value: scaleDraft })}
          slider={
            <Slider
              value={[scaleDraft]}
              min={PET_MIN_SCALE * 100}
              max={PET_MAX_SCALE * 100}
              step={PET_SCALE_STEP_PERCENT}
              onValueChange={([nextScalePercent = Math.round(PET_DEFAULT_SCALE * 100)]) =>
                setScaleDraft(clampPetScalePercent(nextScalePercent))
              }
              onValueCommit={handleScaleCommit}
              className="w-full"
            />
          }
        />
      </SettingGroup>

      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.pet.scene.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow className="gap-3">
          <SettingRowTitle>{t('settings.pet.scene.mode')}</SettingRowTitle>
          <SegmentedControl<PetSceneMode>
            value={sceneMode}
            onValueChange={handleSceneModeChange}
            options={PET_SCENE_MODE_OPTIONS.map((mode) => ({
              value: mode,
              label: t(`settings.pet.scene.modes.${mode}`)
            }))}
            size="sm"
          />
        </SettingRow>
      </SettingGroup>

      {vrmSceneEnabled ? (
        <SettingGroup theme={theme}>
          <SettingTitle>
            <span>{t('settings.pet.vrm.models')}</span>
            <RowFlex className="gap-2">
              <Button size="sm" onClick={() => vrmFileInputRef.current?.click()}>
                <FolderPlus size={15} />
                {t('settings.pet.vrm.import')}
              </Button>
            </RowFlex>
          </SettingTitle>
          <SettingDivider />
          <div className="flex flex-col gap-3">
            {vrmModels.length > 0 ? (
              <>
                <div className="flex flex-col gap-2">
                  {vrmModels.map((model) => {
                    const profile = vrmStageModelProfiles.get(model.id)
                    const effectiveProfile = getEffectiveVrmModelProfile(model, profile, vrmStageModelProfiles)
                    return (
                      <div key={model.id} className="grid gap-3 rounded-lg border border-border px-3 py-2">
                        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                          <div className="min-w-0">
                            <div className="truncate font-medium text-sm">{stripVrmExtension(model.name)}</div>
                            <div className="mt-0.5 text-foreground-muted text-xs">{formatFileSize(model.size)}</div>
                          </div>
                          <RowFlex className="gap-1">
                            <Switch
                              checked={profile?.enabled ?? false}
                              onCheckedChange={(checked) => void handleVrmModelEnabledChange(model, checked)}
                            />
                            <Button
                              aria-label={t('settings.pet.vrm.delete')}
                              size="icon"
                              variant="ghost"
                              onClick={() => void handleDeleteVrmModel(model.id)}>
                              <Trash2 size={15} />
                            </Button>
                          </RowFlex>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <VrmModelSliderField
                            label={t('settings.pet.vrm.model_scale')}
                            valueLabel={formatPercent(effectiveProfile.scale ?? 1)}
                            value={Math.round((effectiveProfile.scale ?? 1) * 100)}
                            min={PET_VRM_STAGE_SCALE_MIN_PERCENT}
                            max={PET_VRM_STAGE_SCALE_MAX_PERCENT}
                            step={5}
                            onCommit={(value) =>
                              void handleVrmModelProfileChange(model, { scale: clampVrmModelScalePercent(value) / 100 })
                            }
                          />
                          <VrmModelSliderField
                            label={t('settings.pet.vrm.x_position')}
                            valueLabel={formatPercent(effectiveProfile.homeXRatio)}
                            value={Math.round(effectiveProfile.homeXRatio * 100)}
                            min={0}
                            max={100}
                            step={5}
                            onCommit={(value) =>
                              void handleVrmModelProfileChange(model, { homeXRatio: clampPercent(value) / 100 })
                            }
                          />
                          <VrmModelSliderField
                            label={t('settings.pet.vrm.y_offset')}
                            valueLabel={`${effectiveProfile.yOffset ?? 0} px`}
                            value={effectiveProfile.yOffset ?? 0}
                            min={PET_VRM_STAGE_Y_OFFSET_MIN}
                            max={PET_VRM_STAGE_Y_OFFSET_MAX}
                            step={5}
                            onCommit={(value) =>
                              void handleVrmModelProfileChange(model, { yOffset: clampVrmYOffset(value) })
                            }
                          />
                          <VrmModelSliderField
                            label={t('settings.pet.vrm.layer_order')}
                            valueLabel={String(effectiveProfile.order)}
                            value={effectiveProfile.order}
                            min={0}
                            max={Math.max(4, vrmModels.length - 1)}
                            step={1}
                            onCommit={(value) => void handleVrmModelProfileChange(model, { order: Math.round(value) })}
                          />
                        </div>
                        <div className="grid gap-3 sm:grid-cols-3">
                          <PetPackageSelectField label={t('settings.pet.vrm.animation_preset')}>
                            <Select
                              value={effectiveProfile.animationPreset ?? 'vroid-show-full-body'}
                              onValueChange={(value) =>
                                isPetVrmStageAnimationPreset(value) &&
                                void handleVrmModelProfileChange(model, { animationPreset: value })
                              }>
                              <SelectTrigger size="sm" className="w-full">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {PET_VRM_STAGE_ANIMATION_PRESETS.map((preset) => (
                                  <SelectItem key={preset} value={preset}>
                                    {t(`settings.pet.vrm.animation_presets.${preset}`)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </PetPackageSelectField>
                          <PetPackageSelectField label={t('settings.pet.vrm.animation_mode')}>
                            <Select
                              value={effectiveProfile.animationMode ?? 'idle'}
                              onValueChange={(value) =>
                                isPetVrmStageAnimationMode(value) &&
                                void handleVrmModelProfileChange(model, { animationMode: value })
                              }>
                              <SelectTrigger size="sm" className="w-full">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {PET_VRM_STAGE_ANIMATION_MODES.map((mode) => (
                                  <SelectItem key={mode} value={mode}>
                                    {t(`settings.pet.vrm.animation_modes.${mode}`)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </PetPackageSelectField>
                          <PetPackageSelectField label={t('settings.pet.vrm.expression')}>
                            <Select
                              value={effectiveProfile.expression ?? 'neutral'}
                              onValueChange={(value) =>
                                isPetVrmStageExpressionName(value) &&
                                void handleVrmModelProfileChange(model, { expression: value })
                              }>
                              <SelectTrigger size="sm" className="w-full">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {PET_VRM_STAGE_EXPRESSION_NAMES.map((expression) => (
                                  <SelectItem key={expression} value={expression}>
                                    {t(`settings.pet.vrm.expressions.${expression}`)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </PetPackageSelectField>
                          <VrmModelSliderField
                            label={t('settings.pet.vrm.expression_intensity')}
                            valueLabel={formatPercent(effectiveProfile.expressionIntensity ?? 0.65)}
                            value={Math.round((effectiveProfile.expressionIntensity ?? 0.65) * 100)}
                            min={0}
                            max={100}
                            step={5}
                            onCommit={(value) =>
                              void handleVrmModelProfileChange(model, {
                                expressionIntensity: clampPercent(value) / 100
                              })
                            }
                          />
                        </div>
                        <div className="grid gap-2 sm:grid-cols-3">
                          <VrmModelSwitchField
                            checked={effectiveProfile.blink ?? true}
                            label={t('settings.pet.vrm.blink')}
                            onChange={(blink) => void handleVrmModelProfileChange(model, { blink })}
                          />
                          <VrmModelSwitchField
                            checked={effectiveProfile.idleMotion ?? true}
                            label={t('settings.pet.vrm.idle_motion')}
                            onChange={(idleMotion) => void handleVrmModelProfileChange(model, { idleMotion })}
                          />
                          <VrmModelSwitchField
                            checked={effectiveProfile.lookAtCursor ?? true}
                            label={t('settings.pet.vrm.look_at_cursor')}
                            onChange={(lookAtCursor) => void handleVrmModelProfileChange(model, { lookAtCursor })}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </>
            ) : (
              <div className="rounded-lg border border-border px-3 py-4 text-foreground-muted text-sm">
                {t('settings.pet.vrm.empty')}
              </div>
            )}
          </div>
        </SettingGroup>
      ) : null}

      {vrmSceneEnabled ? (
        <SettingGroup theme={theme}>
          <SettingTitle>{t('settings.pet.vrm.scene_settings')}</SettingTitle>
          <SettingDivider />
          <div className="grid gap-3">
            <SettingRow className="gap-3">
              <SettingRowTitle>{t('settings.pet.vrm.background_mode')}</SettingRowTitle>
              <SegmentedControl<PetVrmStageBackgroundMode>
                value={vrmSceneSettings.backgroundMode}
                onValueChange={(backgroundMode) => void handleVrmSceneSettingsChange({ backgroundMode })}
                options={PET_VRM_STAGE_BACKGROUND_MODES.map((mode) => ({
                  value: mode,
                  label: t(`settings.pet.vrm.background_modes.${mode}`)
                }))}
                size="sm"
              />
            </SettingRow>
            {vrmSceneSettings.backgroundMode !== 'transparent' ? (
              <>
                <SettingDivider />
                <SettingRow className="gap-3">
                  <SettingRowTitle>{t('settings.pet.vrm.background_color')}</SettingRowTitle>
                  <Input
                    aria-label={t('settings.pet.vrm.background_color')}
                    className="h-8 w-28"
                    type="color"
                    value={vrmSceneSettings.backgroundColor}
                    onChange={(event) =>
                      void handleVrmSceneSettingsChange({ backgroundColor: event.currentTarget.value })
                    }
                  />
                </SettingRow>
              </>
            ) : null}
            <SettingDivider />
            <SettingSliderRow
              label={t('settings.pet.vrm.camera_zoom')}
              valueLabel={formatPercent(vrmSceneSettings.cameraZoom)}
              slider={
                <Slider
                  value={[Math.round(vrmSceneSettings.cameraZoom * 100)]}
                  min={PET_VRM_STAGE_CAMERA_ZOOM_MIN_PERCENT}
                  max={PET_VRM_STAGE_CAMERA_ZOOM_MAX_PERCENT}
                  step={5}
                  onValueCommit={([value = 100]) =>
                    void handleVrmSceneSettingsChange({ cameraZoom: clampVrmCameraZoomPercent(value) / 100 })
                  }
                  className="w-full"
                />
              }
            />
            <SettingDivider />
            <SettingSliderRow
              label={t('settings.pet.vrm.key_light')}
              valueLabel={formatPercent(vrmSceneSettings.keyLightIntensity)}
              slider={
                <Slider
                  value={[Math.round(vrmSceneSettings.keyLightIntensity * 100)]}
                  min={0}
                  max={PET_VRM_STAGE_LIGHT_PERCENT_MAX}
                  step={10}
                  onValueCommit={([value = PET_VRM_STAGE_DEFAULT_SCENE_SETTINGS.keyLightIntensity * 100]) =>
                    void handleVrmSceneSettingsChange({ keyLightIntensity: clampLightPercent(value) / 100 })
                  }
                  className="w-full"
                />
              }
            />
            <SettingDivider />
            <SettingSliderRow
              label={t('settings.pet.vrm.fill_light')}
              valueLabel={formatPercent(vrmSceneSettings.fillLightIntensity)}
              slider={
                <Slider
                  value={[Math.round(vrmSceneSettings.fillLightIntensity * 100)]}
                  min={0}
                  max={PET_VRM_STAGE_LIGHT_PERCENT_MAX}
                  step={10}
                  onValueCommit={([value = PET_VRM_STAGE_DEFAULT_SCENE_SETTINGS.fillLightIntensity * 100]) =>
                    void handleVrmSceneSettingsChange({ fillLightIntensity: clampLightPercent(value) / 100 })
                  }
                  className="w-full"
                />
              }
            />
            <SettingDivider />
            <SettingSliderRow
              label={t('settings.pet.vrm.ambient_light')}
              valueLabel={formatPercent(vrmSceneSettings.ambientLightIntensity)}
              slider={
                <Slider
                  value={[Math.round(vrmSceneSettings.ambientLightIntensity * 100)]}
                  min={0}
                  max={PET_VRM_STAGE_LIGHT_PERCENT_MAX}
                  step={10}
                  onValueCommit={([value = PET_VRM_STAGE_DEFAULT_SCENE_SETTINGS.ambientLightIntensity * 100]) =>
                    void handleVrmSceneSettingsChange({ ambientLightIntensity: clampLightPercent(value) / 100 })
                  }
                  className="w-full"
                />
              }
            />
          </div>
        </SettingGroup>
      ) : null}

      {spriteSceneEnabled ? (
        <SettingGroup theme={theme}>
          <SettingTitle>
            <span>{t('settings.pet.packages')}</span>
            <RowFlex className="gap-2">
              <Button size="sm" onClick={handleImport}>
                <FolderPlus size={15} />
                {t('settings.pet.import')}
              </Button>
            </RowFlex>
          </SettingTitle>
          <SettingDivider />
          <div className="flex flex-col gap-2">
            {packages.map((petPackage) => {
              const inUse = animalByPackageId.has(petPackage.id)
              const animal = animalByPackageId.get(petPackage.id)
              return (
                <div
                  key={petPackage.id}
                  className={cn(
                    'grid gap-3 rounded-lg border px-3 py-2 sm:grid-cols-[minmax(0,1fr)_minmax(260px,420px)_auto]',
                    'border-border/60'
                  )}>
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <div className="flex h-12 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border/50 bg-muted/30">
                      <PetPackagePreview petPackage={petPackage} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-sm">{petPackage.displayName}</div>
                      <div className="mt-0.5 truncate text-foreground-muted text-xs">{petPackage.description}</div>
                    </div>
                  </div>
                  <div className="grid min-w-0 gap-2 sm:grid-cols-2">
                    <PetPackageSelectField label={t('settings.pet.personality.label')}>
                      <Select
                        disabled={!animal}
                        value={animal?.personality ?? DEFAULT_PET_PERSONALITY}
                        onValueChange={(value) => animal && void handleAnimalPersonalityChange(animal, value)}>
                        <SelectTrigger size="sm" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PET_PERSONALITIES.map((personality) => (
                            <SelectItem key={personality} value={personality}>
                              {t(`settings.pet.personality.${personality}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </PetPackageSelectField>
                    <PetPackageSelectField label={t('settings.pet.agent_binding')}>
                      <Select
                        disabled={!animal}
                        value={animal?.agentId ?? NO_AGENT_VALUE}
                        onValueChange={(value) => animal && void handleAnimalAgentChange(animal, value)}>
                        <SelectTrigger size="sm" className="w-full">
                          <SelectValue placeholder={t('settings.pet.select_agent')} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_AGENT_VALUE}>{t('common.none')}</SelectItem>
                          {agents.map((agent) => (
                            <SelectItem key={agent.id} value={agent.id}>
                              {agent.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </PetPackageSelectField>
                  </div>
                  <RowFlex className="gap-1">
                    <Switch
                      checked={animalByPackageId.get(petPackage.id)?.enabled ?? false}
                      onCheckedChange={(checked) => void handlePackageEnabledChange(petPackage.id, checked)}
                    />
                    <Tooltip content={inUse ? t('settings.pet.delete_in_use') : undefined}>
                      <Button
                        aria-label={t('settings.pet.delete')}
                        disabled={inUse}
                        size="icon"
                        variant="ghost"
                        onClick={() => void handleDeletePackage(petPackage.id)}>
                        <Trash2 size={15} />
                      </Button>
                    </Tooltip>
                  </RowFlex>
                </div>
              )
            })}
            {packages.length === 0 && (
              <div className="rounded-lg border border-border/60 px-3 py-4 text-foreground-muted text-sm">
                {t('settings.pet.empty_packages')}
              </div>
            )}
          </div>
        </SettingGroup>
      ) : null}
    </SettingContainer>
  )
}

const SettingSliderRow: FC<{ label: string; valueLabel: string; slider: ReactNode }> = ({
  label,
  slider,
  valueLabel
}) => (
  <div className="grid gap-2">
    <div className="flex items-center justify-between gap-3">
      <SettingRowTitle>{label}</SettingRowTitle>
      <span className="font-medium text-foreground-muted text-xs">{valueLabel}</span>
    </div>
    {slider}
  </div>
)

const VrmModelSliderField: FC<{
  label: string
  max: number
  min: number
  onCommit: (value: number) => void
  step: number
  value: number
  valueLabel: string
}> = ({ label, max, min, onCommit, step, value, valueLabel }) => (
  <div className="grid gap-2" role="group" aria-label={label}>
    <div className="flex items-center justify-between gap-3">
      <span className="font-medium text-foreground-muted text-xs">{label}</span>
      <span className="font-medium text-foreground-muted text-xs">{valueLabel}</span>
    </div>
    <Slider
      value={[value]}
      min={min}
      max={max}
      step={step}
      onValueCommit={([nextValue = value]) => onCommit(nextValue)}
      aria-label={label}
      className="w-full"
    />
  </div>
)

const VrmModelSwitchField: FC<{ checked: boolean; label: string; onChange: (checked: boolean) => void }> = ({
  checked,
  label,
  onChange
}) => (
  <label className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
    <span className="font-medium text-foreground-muted text-xs">{label}</span>
    <Switch checked={checked} onCheckedChange={onChange} />
  </label>
)

const PetPackagePreview: FC<{ petPackage: PetPackageInfo }> = ({ petPackage }) => {
  const clip = useMemo(() => resolvePetRuntimeClip(petPackage, 'idle'), [petPackage])

  useEffect(() => {
    preloadPetRuntimeClipAssets(clip)
  }, [clip])

  return <SpriteAnimator clip={clip} scale={PREVIEW_SCALE} />
}

const PetPackageSelectField: FC<{ children: ReactNode; label: string }> = ({ children, label }) => (
  <label className="grid min-w-0 gap-1">
    <span className="font-medium text-foreground-muted text-xs">{label}</span>
    {children}
  </label>
)

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function formatFileSize(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return '0 KB'
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(size >= 10 * 1024 * 1024 ? 0 : 1)} MB`
  return `${Math.ceil(size / 1024)} KB`
}

function stripVrmExtension(name: string): string {
  return name.replace(/\.vrm$/i, '')
}

function getEffectiveVrmModelProfile(
  model: PetVrmModelSummary,
  profile: PetVrmStageModelProfile | undefined,
  profiles: PetVrmStageModelProfileMap
): PetVrmStageModelProfile {
  if (profile) return profile

  const order = getNextVrmStageModelOrder(profiles)
  return createPetVrmStageModelProfile({
    enabled: false,
    homeXRatio: getDefaultVrmStageModelXRatio(order),
    modelId: model.id,
    order
  })
}

function getNextVrmStageModelOrder(profiles: PetVrmStageModelProfileMap): number {
  let order = -1
  for (const profile of profiles.values()) {
    order = Math.max(order, profile.order)
  }
  return order + 1
}

function getDefaultVrmStageModelXRatio(order: number): number {
  return order <= 0 ? 0.5 : Math.min(0.9, 0.18 + order * 0.16)
}

function clampPastureWidth(width: number): number {
  const finiteWidth = Number.isFinite(width) ? width : PET_PASTURE_DEFAULT_WIDTH
  return Math.round(Math.min(Math.max(finiteWidth, PET_PASTURE_MIN_WIDTH), PET_PASTURE_MAX_WIDTH))
}

function clampPetScalePercent(percent: number): number {
  const finitePercent = Number.isFinite(percent) ? percent : Math.round(PET_DEFAULT_SCALE * 100)
  return Math.round(clampPetScale(finitePercent / 100) * 100)
}

function clampPercent(percent: number): number {
  const finitePercent = Number.isFinite(percent) ? percent : 100
  return Math.round(Math.min(Math.max(finitePercent, 0), 100))
}

function clampLightPercent(percent: number): number {
  const finitePercent = Number.isFinite(percent) ? percent : 100
  return Math.round(Math.min(Math.max(finitePercent, 0), PET_VRM_STAGE_LIGHT_PERCENT_MAX))
}

function clampVrmCameraZoomPercent(percent: number): number {
  const finitePercent = Number.isFinite(percent) ? percent : 100
  return Math.round(
    Math.min(Math.max(finitePercent, PET_VRM_STAGE_CAMERA_ZOOM_MIN_PERCENT), PET_VRM_STAGE_CAMERA_ZOOM_MAX_PERCENT)
  )
}

function clampVrmModelScalePercent(percent: number): number {
  const finitePercent = Number.isFinite(percent) ? percent : 100
  return Math.round(Math.min(Math.max(finitePercent, PET_VRM_STAGE_SCALE_MIN_PERCENT), PET_VRM_STAGE_SCALE_MAX_PERCENT))
}

function clampVrmYOffset(offset: number): number {
  const finiteOffset = Number.isFinite(offset) ? offset : 0
  return Math.round(Math.min(Math.max(finiteOffset, PET_VRM_STAGE_Y_OFFSET_MIN), PET_VRM_STAGE_Y_OFFSET_MAX))
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}

function petScaleToPercent(scale: number): number {
  return clampPetScalePercent(Math.round(scale * 100))
}

function percentToPetScale(percent: number): number {
  return clampPetScalePercent(percent) / 100
}

function isPetVrmStageAnimationMode(value: string): value is PetVrmStageAnimationMode {
  return (PET_VRM_STAGE_ANIMATION_MODES as readonly string[]).includes(value)
}

function isPetVrmStageAnimationPreset(value: string): value is PetVrmStageAnimationPreset {
  return (PET_VRM_STAGE_ANIMATION_PRESETS as readonly string[]).includes(value)
}

function isPetVrmStageExpressionName(value: string): value is PetVrmStageExpressionName {
  return (PET_VRM_STAGE_EXPRESSION_NAMES as readonly string[]).includes(value)
}

export default PetSettings
