import * as THREE from 'three/webgpu'
import { Game } from '../Game.js'
import { InstancedGroup } from '../InstancedGroup.js'

/**
 * 地块栅栏
 *
 * 矩形围一圈，下边中间留一个门。
 * 模块来源（按优先级）：
 *   1. static/garden/woodFence.glb —— 混元3D 生成的中国风木栅栏段
 *   2. 游戏原生 static/fences/fences.glb —— 资产未就绪时的兜底
 */
export class PlotFence
{
    constructor()
    {
        this.game = Game.getInstance()

        this.moduleKey = 'woodFence'
        this.fallbackOriginHeight = 1.04
        this.gateLength = 4.2

        this.setBoundary()
        this.load()
    }

    setBoundary()
    {
        // 矩形尺寸（略小于地块实际范围，贴地块内侧）
        // 地块边界极值：x∈[-6.9, 46.7]  z∈[-73.7, -40.0]
        const rect = {
            left:   - 6.5,
            right:    46.5,
            top:     - 73.3,   // 上边（z 小）
            bottom:  - 40.3,   // 下边（z 大，门开在这）
        }

        // 下边中间开门：门开口 4.2 m，门两端的栅栏到此为止，中间留白
        const gateCenterX = (rect.left + rect.right) / 2
        const gateHalf = this.gateLength / 2                 // 2.1
        const gateRightX = gateCenterX + gateHalf            // 22.1
        const gateLeftX = gateCenterX - gateHalf             // 17.9

        // 闭合折线（6 个角点）：上边、右边、下边右半段、门开口、下边左半段、左边
        // 门那段（gateRightX→gateLeftX）长度 = gateLength，resampleClosed 会跳过它
        this.boundary = [
            [ rect.left,   rect.top ],      // 左上
            [ rect.right,  rect.top ],      // 右上
            [ rect.right,  rect.bottom ],   // 右下
            [ gateRightX,  rect.bottom ],   // 门的右端
            [ gateLeftX,   rect.bottom ],   // 门的左端（gateLength 长的开口，无栅栏）
            [ rect.left,   rect.bottom ],   // 左下
        ]
    }

    async load()
    {
        const compressed = !!import.meta.env.VITE_COMPRESSED
        const compressedSuffix = compressed ? '-compressed' : ''

        let model = null
        let originHeight = 0

        try
        {
            const resources = await this.game.resourcesLoader.load([
                [ this.moduleKey, `garden/${this.moduleKey}${compressedSuffix}.glb?cb=1`, 'gltf' ]
            ])
            model = resources[this.moduleKey].scene
        }
        catch(error)
        {
            model = null
        }

        if(model)
        {
            originHeight = 0
        }
        else
        {
            model = this.game.resources.fencesModel.scene.children[0].clone()
            model.position.set(0, 0, 0)
            model.rotation.set(0, 0, 0)
            model.scale.set(1, 1, 1)
            originHeight = this.fallbackOriginHeight
            console.log('PlotFence > 未找到 garden/woodFence.glb，回退使用游戏原生栅栏')
        }

        this.build(model, originHeight)
    }

    build(_model, _originHeight)
    {
        _model.castShadow = true
        _model.receiveShadow = true
        _model.frustumCulled = true

        // 段长：模块局部 X/Z 中较长者为长度方向；若长度在 Z 轴上，摆放时补 90° 偏航修正
        const box = new THREE.Box3().setFromObject(_model)
        const lengthX = box.max.x - box.min.x
        const lengthZ = box.max.z - box.min.z
        this.segmentLength = Math.max(0.5, Math.max(lengthX, lengthZ))
        this.moduleYawOffset = lengthZ > lengthX ? Math.PI / 2 : 0

        const descriptions = this.game.objects.getFromModel(_model, {}, {})
        const colliderOffsets = descriptions[1] ? descriptions[1].colliders : []

        this.game.materials.updateObject(_model)

        // 等距重采样；门位置已由 resampleClosed 跳过（0 长度段）
        const points = this.resampleClosed(this.boundary, this.segmentLength)

        // 贴地射线需命中地形：Rapier 查询管线仅在 world.step() 重建，先刷新一次
        this.game.physics.world.queryPipeline.update(this.game.physics.world.colliders)

        this.references = []
        this.colliders = []

        for(let i = 0; i < points.length; i++)
        {
            const a = points[i]
            const b = points[(i + 1) % points.length]

            const midX = (a[0] + b[0]) * 0.5
            const midZ = (a[1] + b[1]) * 0.5
            const groundY = this.getGroundElevation(midX, midZ)

            const quaternion = new THREE.Quaternion().setFromAxisAngle(
                new THREE.Vector3(0, 1, 0),
                Math.atan2(- (b[1] - a[1]), b[0] - a[0]) + this.moduleYawOffset
            )

            const reference = new THREE.Object3D()
            reference.position.set(midX, groundY + _originHeight, midZ)
            reference.quaternion.copy(quaternion)
            reference.needsUpdate = true
            this.references.push(reference)

            for(const collider of colliderOffsets)
            {
                const offset = new THREE.Vector3(collider.position.x, collider.position.y, collider.position.z)
                offset.applyQuaternion(quaternion)

                this.colliders.push({
                    shape: collider.shape,
                    parameters: [ collider.parameters[0], collider.parameters[1], collider.parameters[2] ],
                    position: {
                        x: midX + offset.x,
                        y: groundY + _originHeight + offset.y,
                        z: midZ + offset.z
                    },
                    quaternion: { x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w },
                    category: 'object'
                })
            }
        }

        // 渲染：实例化
        this.instancedGroup = new InstancedGroup(this.references, _model)

        // 物理：单个 fixed 刚体 + 逐段 cuboid
        if(this.colliders.length)
        {
            this.object = this.game.objects.add(null, {
                type: 'fixed',
                friction: 0.7,
                restitution: 0.1,
                colliders: this.colliders
            })
        }
    }

    resampleClosed(_poly, _spacing)
    {
        const n = _poly.length
        const cumulative = [ 0 ]
        const segmentLengths = []

        for(let i = 0; i < n; i++)
        {
            const a = _poly[i]
            const b = _poly[(i + 1) % n]
            const len = Math.hypot(b[0] - a[0], b[1] - a[1])
            segmentLengths.push(len)
            cumulative.push(cumulative[i] + len)
        }

        // 门那段长度 ≈ gateLength，跳过所有落在该段上的采样点，形成 4.2 m 开口
        const gateLength = this.gateLength
        const isGateSegment = (len) => Math.abs(len - gateLength) < 0.5

        // 总周长（含门那段的长度）
        const perimeter = cumulative[n]
        if(perimeter <= 0)
            return []

        const count = Math.max(3, Math.round(perimeter / _spacing))
        const step = perimeter / count

        const points = []
        let index = 0

        for(let i = 0; i < count; i++)
        {
            const distance = i * step

            while(index < n - 1 && cumulative[index + 1] < distance)
                index++

            // 跳过门区域的采样
            if(isGateSegment(segmentLengths[index]))
                continue

            const a = _poly[index]
            const b = _poly[(index + 1) % n]
            const segLen = segmentLengths[index]
            const t = segLen <= 1e-9 ? 0 : (distance - cumulative[index]) / segLen

            points.push([ a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t ])
        }

        return points
    }

    getGroundElevation(_x, _z)
    {
        const startY = 50
        const ray = new this.game.RAPIER.Ray({ x: _x, y: startY, z: _z }, { x: 0, y: - 1, z: 0 })
        const hit = this.game.physics.world.castRay(
            ray, 100, true,
            undefined, undefined, undefined, undefined,
            (collider) => collider.collisionGroups() === this.game.physics.categories.floor
        )

        return hit ? startY - hit.timeOfImpact : 0
    }
}
