import * as THREE from 'three/webgpu'
import { Game } from './Game.js'

export class Respawns
{
    constructor(defaultName = 'landing')
    {
        this.game = Game.getInstance()
        this.defaultName = defaultName

        this.setItems()
    }

    setItems()
    {
        this.items = new Map()

        for(const child of this.game.resources.respawnsReferencesModel.scene.children)
        {
            child.rotation.reorder('YXZ')

            let name = child.name.replace(/^respawn(.+)$/i, '$1')

            name = name.charAt(0).toLowerCase() + name.slice(1)

            const item = {
                name: name,
                position: new THREE.Vector3(
                    child.position.x,
                    4,
                    child.position.z
                ),
                rotation: child.rotation.y
            }

            this.items.set(name, item)
        }

        // 地块内部出生点（plot fence 围合范围中心附近，约距围墙 5–10 m）
        this.items.set('fence', {
            name: 'fence',
            position: new THREE.Vector3(15, 4, -60),
            rotation: 0,
        })
    }

    getByName(name)
    {
        return this.items.get(name)
    }

    getDefault()
    {
        return this.items.get(this.defaultName)
    }

    getClosest(position)
    {
        let closestItem = null
        let closestDistance = Infinity

        this.items.forEach((item) =>
        {
            const distance = Math.hypot(item.position.x - position.x, item.position.z - position.z)

            if(distance < closestDistance)
            {
                closestDistance = distance
                closestItem = item
            }
        })

        return closestItem
    }
}