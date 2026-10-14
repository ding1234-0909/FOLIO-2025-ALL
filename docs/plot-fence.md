# 划地盘 · Plot Fence

> 一块被混元3D生成的中国风木栅栏围起来的私人地块。
> 作者：丁浩宸

## 一、它做了什么

沿一块矩形地块的周长等距摆放木栅栏段，下边中间留一个 4.2 m 的门。栅栏是**实例化渲染**（InstancedMesh），物理上合并成**单个 fixed 刚体**，90+ 段 cuboid 碰撞体，不可穿越。

开局车辆自动在地块中心出生，直接面对赛道。

## 二、矩形规格

```
边界轴对齐（米）:
  left   = -6.5      right  = 46.5     宽 53 m
  top    = -73.3     bottom = -40.3    深 33 m

地块实际范围（赛道内侧）:
  x ∈ [-6.9, 46.7]   z ∈ [-73.7, -40.0]

矩形略内缩 0.4 m，贴地块内侧、不压赛道。
```

### 门

```
位置: 下边中间 (z = -40.3)
开口: 4.2 m
范围: x ∈ [17.9, 22.1]   (中心 x = 20)
```

闭合折线（6 个角点）：

```
[left, top]  →  [right, top]  →  [right, bottom]
                                   ↓
                              门右端 [22.1, -40.3]
                                   ↓   (4.2 m 开口，无栅栏)
                              门左端 [17.9, -40.3]
                                   ↓
[left, bottom]  ←
```

## 三、栅栏段资产

| 项目 | 值 |
|---|---|
| 来源 | 腾讯混元 3D · 官网生成 |
| 原始文件 | `resources/hunyuan-raw/woodFence.glb`（47.7 MB，500k 面） |
| 入库文件 | `static/garden/woodFence.glb`（1.25 MB，25k 面） |
| Draco 压缩 | `static/garden/woodFence-compressed.glb`（323 KB） |
| 尺寸 | 1.572 × 1.000 × 0.172 m（长轴 X） |
| 长度方向修正 | `moduleYawOffset = 0`（长度已在 X 轴，无需旋转） |
| originHeight | 0（pivot 归底面中心） |
| Prompt | 中国古典园林木栅栏，独立构件，长2米、高1米，深棕色实木，竖向木条均匀排列，上下两道横梁，两端立柱齐平便于首尾拼接 |

未找到 `garden/woodFence.glb` 时自动回退到游戏原生 `static/fences/fences.glb`。

## 四、碰撞

所有栅栏段的 collision shape（cuboid）收集进**单个 `fixed` 刚体**：

```js
this.game.objects.add(null, {
    type: 'fixed',
    friction: 0.7,
    restitution: 0.1,
    colliders: [ ...90+ cuboids... ]
})
```

物理贴地：每段中点从 y=50 向下射线，命中 `categories.floor`（地形）取实际高度。

## 五、代码结构

### 核心类 — `sources/Game/World/PlotFence.js`

```
constructor()
  ├─ setBoundary()       // 写死矩形 6 角点 + 门
  └─ load()              // 优先加载 garden/woodFence.glb；失败则回退原生

load()
  └─ build(model, originHeight)
       ├─ Box3 实测 segmentLength / 长度轴 → moduleYawOffset
       ├─ resampleClosed(boundary, segmentLength)
       │    └─ 跳过 gateLength 长度段的采样点 → 门位置 0 栅栏
       ├─ getGroundElevation(midX, midZ)     // Rapier raycast
       ├─ 逐段 yaw = atan2(-dz, dx) + moduleYawOffset
       ├─ InstancedGroup(references, model)   // 实例化渲染
       └─ objects.add({ type:'fixed', colliders })  // 合并刚体
```

### 挂载点 — `sources/Game/World/World.js`

```js
this.plotFence = new PlotFence()   // World.step(1)，Garden 之后
```

### 出生点 — `sources/Game/Respawns.js`

```js
this.items.set('fence', {
    name: 'fence',
    position: new THREE.Vector3(15, 4, -60),   // 矩形内部中心偏上
    rotation: 0,
})
```

配合 `.env`：`VITE_PLAYER_SPAWN=fence`

## 六、如何改

### 改矩形大小 / 门位置

改 `PlotFence.setBoundary()` 里的 6 个角点坐标即可。门那段（第 4、5 个点）的 `x` 差值决定门宽。

### 改门宽

改 `gateLength`（默认 `4.2`），同时 `setBoundary()` 里的 `gateHalf / gateLeftX / gateRightX` 会自动跟着变。

### 改段长 / 换栅栏资产

换 `static/garden/woodFence.glb`（同名覆盖），`build()` 里会自动用 Box3 实测新段长重采样。如果新资产长度轴在 Z 轴，`moduleYawOffset` 会自动切 π/2。

### 重新生栅栏

```bash
# 1. 官网混元 3D 重新生成，下载 raw glb → resources/hunyuan-raw/woodFence.glb
# 2. 跑处理脚本（减面 + 贴图压缩 + normalize）
node scripts/hunyuan/process.js --only woodFence --compress
#    → static/garden/woodFence.glb
#    → static/garden/woodFence-compressed.glb
```

## 七、实测数据（2026-10-13）

| 项目 | 值 |
|---|---|
| segmentLength | 1.5723 m |
| 段数 | 106（门那段采样点全跳过） |
| 碰撞体 | 106 个 cuboid，1 个 fixed 刚体 |
| 矩形周长 | ≈ 172 m |
| 门开口 | 4.2 m，下边中间 x ∈ [17.9, 22.1] |
| 角色 | active=false, visible=false（开局直接开车） |
| 车辆 | player.state=1 (STATE_DEFAULT) |
| 出生点 | fence → (15, 4, -60)，矩形内部 |
| 资产加载 | ✅ woodFence.glb 命中，未走原生兜底 |
