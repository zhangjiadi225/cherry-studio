import { VRM, VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm'
import type { LoadingManager } from 'three'
import { Box3, Group, Mesh, Object3D, Quaternion, Vector3 } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

import type { PetVrmRootPositionAnchor } from './vrmAnimation'

export type LoadedPetVrm = {
  animationAnchor?: PetVrmRootPositionAnchor
  groundOffsetY: number
  height: number
  root: Group
  vrm: VRM
  width: number
}

export async function loadPetVrmModel(
  url: string,
  options: { manager?: LoadingManager; onProgress?: (event: ProgressEvent<EventTarget>) => void } = {}
): Promise<LoadedPetVrm> {
  const loader = new GLTFLoader(options.manager)
  loader.register((parser) => new VRMLoaderPlugin(parser, { autoUpdateHumanBones: true }))

  const gltf = await loader.loadAsync(url, options.onProgress)
  const vrm = gltf.userData.vrm as VRM | undefined
  if (!vrm) throw new Error('The selected file is not a valid VRM model')

  VRMUtils.removeUnnecessaryVertices(vrm.scene)
  VRMUtils.combineSkeletons(vrm.scene)
  disableFrustumCulling(vrm.scene)

  const root = new Group()
  root.add(vrm.scene)
  rotateVrmGroupToFaceCamera(root, vrm)
  const groundOffsetY = groundVrmSceneAtRootOrigin(root, vrm.scene)
  const animationAnchor = createVrmRootPositionAnchor(vrm)
  vrm.springBoneManager?.reset()

  const bounds = computeVrmModelBounds(root)
  const size = bounds.getSize(new Vector3())

  return {
    animationAnchor,
    groundOffsetY,
    height: Math.max(size.y, 1),
    root,
    vrm,
    width: Math.max(size.x, 1)
  }
}

export function disposePetVrmModel(model: LoadedPetVrm): void {
  model.root.remove(model.vrm.scene)
  VRMUtils.deepDispose(model.vrm.scene)
}

function rotateVrmGroupToFaceCamera(root: Group, vrm: VRM): void {
  const facingDirection = vrm.lookAt?.faceFront?.clone()
  if (!facingDirection || facingDirection.lengthSq() <= 1e-6) return

  const targetDirection = new Vector3(0, 0, -1)
  const quaternion = new Quaternion().setFromUnitVectors(facingDirection.normalize(), targetDirection.normalize())
  root.quaternion.premultiply(quaternion)
  root.updateMatrixWorld(true)
}

function groundVrmSceneAtRootOrigin(root: Object3D, scene: Object3D): number {
  const bounds = computeVrmModelBounds(root)
  if (!Number.isFinite(bounds.min.y)) return 0

  const offsetY = -bounds.min.y
  if (Math.abs(offsetY) <= 1e-6) return 0

  scene.position.y += offsetY
  root.updateMatrixWorld(true)
  return offsetY
}

function createVrmRootPositionAnchor(vrm: VRM): PetVrmRootPositionAnchor | undefined {
  const hipNode = vrm.humanoid?.getNormalizedBoneNode('hips')
  if (!hipNode?.name) return undefined

  return {
    nodeName: hipNode.name,
    position: hipNode.position.clone()
  }
}

function computeVrmModelBounds(root: Object3D): Box3 {
  const box = new Box3()
  const childBox = new Box3()

  root.updateMatrixWorld(true)
  root.traverse((object) => {
    if (!object.visible) return

    const mesh = object as Mesh
    if (!mesh.isMesh || !mesh.geometry) return
    if (mesh.name.startsWith('VRMC_springBone_collider')) return

    if (!mesh.geometry.boundingBox) {
      mesh.geometry.computeBoundingBox()
    }

    childBox.copy(mesh.geometry.boundingBox!)
    childBox.applyMatrix4(mesh.matrixWorld)
    box.union(childBox)
  })

  return box
}

function disableFrustumCulling(root: Object3D): void {
  root.traverse((object) => {
    object.frustumCulled = false
  })
}
