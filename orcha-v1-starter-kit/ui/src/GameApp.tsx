import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'

type HudState = {
  score: number
  health: number
  combo: number
  wave: number
  status: string
}

type GameRuntime = {
  running: boolean
  score: number
  health: number
  combo: number
  wave: number
  lastHudUpdate: number
  lastSpawn: number
  lastPickup: number
  pointer: { x: number; y: number }
  keys: { left: boolean; right: boolean; up: boolean; down: boolean }
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)
const randRange = (min: number, max: number) => min + Math.random() * (max - min)

export function GameApp() {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const [overlayVisible, setOverlayVisible] = useState(true)
  const [hud, setHud] = useState<HudState>({ score: 0, health: 4, combo: 0, wave: 1, status: 'Stand by' })

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    let frameId = 0
    let disposed = false

    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#050816')
    scene.fog = new THREE.Fog('#050816', 16, 64)

    const camera = new THREE.PerspectiveCamera(58, mount.clientWidth / mount.clientHeight, 0.1, 120)
    camera.position.set(0, 0.4, 15)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    mount.appendChild(renderer.domElement)

    const ambient = new THREE.AmbientLight('#ffffff', 1.2)
    scene.add(ambient)

    const keyLight = new THREE.DirectionalLight('#67b6ff', 2.4)
    keyLight.position.set(3, 5, 6)
    scene.add(keyLight)

    const rimLight = new THREE.PointLight('#8f73ff', 18, 40, 2)
    rimLight.position.set(-4, 3, 10)
    scene.add(rimLight)

    const world = new THREE.Group()
    scene.add(world)

    const starGeometry = new THREE.BufferGeometry()
    const starCount = 1800
    const starPositions = new Float32Array(starCount * 3)
    for (let i = 0; i < starCount; i += 1) {
      const offset = i * 3
      starPositions[offset] = randRange(-32, 32)
      starPositions[offset + 1] = randRange(-18, 18)
      starPositions[offset + 2] = randRange(-40, 18)
    }
    starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3))
    const stars = new THREE.Points(
      starGeometry,
      new THREE.PointsMaterial({
        color: '#dfe9ff',
        size: 0.08,
        transparent: true,
        opacity: 0.8,
      }),
    )
    world.add(stars)

    const laneGeometry = new THREE.CircleGeometry(11, 64)
    const laneMaterial = new THREE.MeshStandardMaterial({
      color: '#0b1020',
      emissive: '#0d1b2a',
      transparent: true,
      opacity: 0.9,
    })
    const lane = new THREE.Mesh(laneGeometry, laneMaterial)
    lane.rotation.x = -Math.PI / 2
    lane.position.z = -10
    world.add(lane)

    const shipGroup = new THREE.Group()
    const shipBase = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.7, 2.4, 7, 14),
      new THREE.MeshStandardMaterial({ color: '#7ae7c7', emissive: '#0c4138', metalness: 0.25, roughness: 0.34 }),
    )
    shipBase.rotation.z = Math.PI / 2
    shipGroup.add(shipBase)

    const crown = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 22, 18),
      new THREE.MeshStandardMaterial({ color: '#e5ecff', emissive: '#6ea8ff', emissiveIntensity: 0.8, metalness: 0.15, roughness: 0.2 }),
    )
    crown.position.set(0.25, 0.1, 0.2)
    shipGroup.add(crown)

    const booster = new THREE.Mesh(
      new THREE.ConeGeometry(0.2, 0.7, 12),
      new THREE.MeshStandardMaterial({ color: '#ffb454', emissive: '#ff9f2c', emissiveIntensity: 1.4 }),
    )
    booster.rotation.z = Math.PI
    booster.position.set(-0.9, 0, 0)
    shipGroup.add(booster)

    const wingLeft = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.12, 1.6),
      new THREE.MeshStandardMaterial({ color: '#dfe7ff', emissive: '#8cb3ff', emissiveIntensity: 0.35 }),
    )
    wingLeft.position.set(0, -0.45, 0)
    shipGroup.add(wingLeft)

    const wingRight = wingLeft.clone()
    wingRight.position.y = 0.45
    shipGroup.add(wingRight)

    const engineGlow = new THREE.PointLight('#ff8f3d', 16, 10, 2)
    engineGlow.position.set(-1.2, 0, 0)
    shipGroup.add(engineGlow)

    const trailGeometry = new THREE.BufferGeometry()
    trailGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 0, 0, -1.3]), 3))
    const trail = new THREE.Line(
      trailGeometry,
      new THREE.LineBasicMaterial({ color: '#ff8f3d', transparent: true, opacity: 0.7 }),
    )
    trail.scale.set(1, 1, 1)
    shipGroup.add(trail)

    shipGroup.position.set(0, 0, 3)
    world.add(shipGroup)

    const obstacleGroup = new THREE.Group()
    world.add(obstacleGroup)

    const pickupGroup = new THREE.Group()
    world.add(pickupGroup)

    const runtime: GameRuntime = {
      running: false,
      score: 0,
      health: 4,
      combo: 0,
      wave: 1,
      lastHudUpdate: 0,
      lastSpawn: 0,
      lastPickup: 0,
      pointer: { x: 0, y: 0 },
      keys: { left: false, right: false, up: false, down: false },
    }

    const createAsteroid = () => {
      const size = randRange(0.7, 1.5)
      const asteroid = new THREE.Mesh(
        new THREE.IcosahedronGeometry(size, 1),
        new THREE.MeshStandardMaterial({
          color: '#7d88a8',
          emissive: '#38465f',
          emissiveIntensity: 0.7,
          metalness: 0.2,
          roughness: 0.8,
        }),
      )
      asteroid.scale.set(randRange(0.8, 1.6), randRange(0.8, 1.6), randRange(0.8, 1.6))
      asteroid.position.set(randRange(-7.8, 7.8), randRange(-4.8, 4.8), randRange(-46, -18))
      asteroid.rotation.set(randRange(0, Math.PI), randRange(0, Math.PI), randRange(0, Math.PI))
      asteroid.userData = { kind: 'obstacle', radius: size * 1.15, speed: randRange(9, 16) }
      obstacleGroup.add(asteroid)
      return asteroid
    }

    const createPickup = () => {
      const pickup = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.45, 0),
        new THREE.MeshStandardMaterial({
          color: '#7ee7ff',
          emissive: '#2ec6ff',
          emissiveIntensity: 1.4,
          metalness: 0.2,
          roughness: 0.2,
        }),
      )
      pickup.position.set(randRange(-7, 7), randRange(-4.5, 4.5), randRange(-46, -18))
      pickup.rotation.set(randRange(0, Math.PI), randRange(0, Math.PI), randRange(0, Math.PI))
      pickup.userData = { kind: 'pickup', radius: 0.8, speed: randRange(8.8, 14) }
      pickupGroup.add(pickup)
      return pickup
    }

    const resetHud = () => {
      const nextHud = { score: runtime.score, health: runtime.health, combo: runtime.combo, wave: runtime.wave, status: 'Ready to deploy' }
      setHud(nextHud)
    }

    const startRound = () => {
      runtime.running = true
      runtime.score = 0
      runtime.health = 4
      runtime.combo = 0
      runtime.wave = 1
      runtime.lastSpawn = 0
      runtime.lastPickup = 0
      runtime.lastHudUpdate = 0
      shipGroup.position.set(0, 0, 3)
      obstacleGroup.clear()
      pickupGroup.clear()
      setOverlayVisible(false)
      setHud({ score: 0, health: 4, combo: 0, wave: 1, status: 'In flight' })
    }

    const endRound = () => {
      runtime.running = false
      setOverlayVisible(true)
      setHud({
        score: runtime.score,
        health: Math.max(0, runtime.health),
        combo: runtime.combo,
        wave: runtime.wave,
        status: runtime.score > 0 ? 'Mission complete' : 'Mission failed',
      })
    }

    const handlePointerMove = (event: PointerEvent) => {
      const rect = mount.getBoundingClientRect()
      const px = (event.clientX - rect.left) / rect.width
      const py = (event.clientY - rect.top) / rect.height
      runtime.pointer.x = (px - 0.5) * 2
      runtime.pointer.y = (py - 0.5) * -2
    }

    const handleKeyChange = (event: KeyboardEvent, pressed: boolean) => {
      if (event.code === 'ArrowLeft' || event.code === 'KeyA') runtime.keys.left = pressed
      if (event.code === 'ArrowRight' || event.code === 'KeyD') runtime.keys.right = pressed
      if (event.code === 'ArrowUp' || event.code === 'KeyW') runtime.keys.up = pressed
      if (event.code === 'ArrowDown' || event.code === 'KeyS') runtime.keys.down = pressed
      if (event.code === 'Space' && pressed && !runtime.running) {
        startRound()
      }
    }

    mount.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('keydown', (event) => handleKeyChange(event, true))
    window.addEventListener('keyup', (event) => handleKeyChange(event, false))

    const clock = new THREE.Clock()

    const animate = () => {
      const dt = Math.min(clock.getDelta(), 0.033)

      if (runtime.running) {
        const moveX = (runtime.pointer.x * 7.3) + (runtime.keys.right ? 1 : 0) * 2.2 - (runtime.keys.left ? 1 : 0) * 2.2
        const moveY = (runtime.pointer.y * 4.5) + (runtime.keys.up ? 1 : 0) * 2.1 - (runtime.keys.down ? 1 : 0) * 2.1
        shipGroup.position.x = THREE.MathUtils.damp(shipGroup.position.x, clamp(moveX, -7, 7), 8, dt)
        shipGroup.position.y = THREE.MathUtils.damp(shipGroup.position.y, clamp(moveY, -4.4, 4.4), 8, dt)
        shipGroup.rotation.z = THREE.MathUtils.damp(shipGroup.rotation.z, (-moveX / 7.5) * 1.1, 8, dt)
        shipGroup.rotation.x = THREE.MathUtils.damp(shipGroup.rotation.x, (moveY / 5) * 0.7, 8, dt)

        runtime.lastSpawn += dt
        runtime.lastPickup += dt

        if (runtime.lastSpawn > Math.max(0.35, 1.25 - runtime.wave * 0.08)) {
          createAsteroid()
          runtime.lastSpawn = 0
        }

        if (runtime.lastPickup > 2.3) {
          createPickup()
          runtime.lastPickup = 0
        }

        for (const obstacle of obstacleGroup.children as THREE.Mesh[]) {
          obstacle.position.z += (obstacle.userData.speed as number) * dt
          obstacle.rotation.x += dt * 1.2
          obstacle.rotation.y += dt * 1.4

          if (obstacle.position.z > 18) {
            obstacleGroup.remove(obstacle)
            obstacle.geometry.dispose()
            ;(obstacle.material as THREE.Material).dispose()
          }

          const dx = obstacle.position.x - shipGroup.position.x
          const dy = obstacle.position.y - shipGroup.position.y
          const dz = obstacle.position.z - shipGroup.position.z
          if (Math.sqrt(dx * dx + dy * dy + dz * dz) < (obstacle.userData.radius as number) + 1.1) {
            obstacleGroup.remove(obstacle)
            obstacle.geometry.dispose()
            ;(obstacle.material as THREE.Material).dispose()
            runtime.health -= 1
            runtime.combo = 0
            runtime.wave = Math.max(1, Math.floor(runtime.score / 250) + 1)
          }
        }

        for (const pickup of pickupGroup.children as THREE.Mesh[]) {
          pickup.position.z += (pickup.userData.speed as number) * dt
          pickup.rotation.x += dt * 2.3
          pickup.rotation.y += dt * 2.8

          if (pickup.position.z > 18) {
            pickupGroup.remove(pickup)
            pickup.geometry.dispose()
            ;(pickup.material as THREE.Material).dispose()
          }

          const dx = pickup.position.x - shipGroup.position.x
          const dy = pickup.position.y - shipGroup.position.y
          const dz = pickup.position.z - shipGroup.position.z
          if (Math.sqrt(dx * dx + dy * dy + dz * dz) < (pickup.userData.radius as number) + 0.9) {
            pickupGroup.remove(pickup)
            pickup.geometry.dispose()
            ;(pickup.material as THREE.Material).dispose()
            runtime.score += 30 + runtime.combo * 10
            runtime.combo += 1
            runtime.health = Math.min(4, runtime.health + 0.2)
            runtime.wave = Math.max(1, Math.floor(runtime.score / 250) + 1)
          }
        }

        runtime.score += dt * 18
        runtime.wave = Math.max(1, Math.floor(runtime.score / 250) + 1)

        if (runtime.health <= 0) {
          endRound()
        }
      }

      stars.rotation.y += dt * 0.06
      stars.rotation.x += dt * 0.02
      lane.material.emissiveIntensity = 0.3 + Math.sin(performance.now() * 0.005) * 0.15
      engineGlow.intensity = runtime.running ? 18 + Math.sin(performance.now() * 0.06) * 5 : 8
      trail.material.opacity = runtime.running ? 0.6 + Math.sin(performance.now() * 0.12) * 0.3 : 0.2

      renderer.render(scene, camera)

      const hudNeedsUpdate = performance.now() - runtime.lastHudUpdate > 80
      if (hudNeedsUpdate) {
        runtime.lastHudUpdate = performance.now()
        setHud({
          score: Math.floor(runtime.score),
          health: Math.max(0, runtime.health),
          combo: runtime.combo,
          wave: runtime.wave,
          status: runtime.running ? 'In flight' : (runtime.score > 0 ? 'Mission complete' : 'Stand by'),
        })
      }

      frameId = window.requestAnimationFrame(animate)
    }

    frameId = window.requestAnimationFrame(animate)

    return () => {
      disposed = true
      window.cancelAnimationFrame(frameId)
      mount.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('keydown', (event) => handleKeyChange(event, true))
      window.removeEventListener('keyup', (event) => handleKeyChange(event, false))
      starGeometry.dispose()
      obstacleGroup.clear()
      pickupGroup.clear()
      renderer.dispose()
      mount.removeChild(renderer.domElement)
      if (disposed) {
        // no-op guard for cleanup bookkeeping
      }
    }
  }, [])

  const startMission = () => {
    setOverlayVisible(false)
    const event = new KeyboardEvent('keydown', { code: 'Space' })
    window.dispatchEvent(event)
  }

  return (
    <div className="game-shell">
      <div className="game-frame" ref={mountRef} />

      <div className="game-ui">
        <header className="hud-top">
          <div className="brand-block">
            <span className="brand-mark">N</span>
            <div>
              <strong>NEON VOID</strong>
              <small>Deep-space salvage</small>
            </div>
          </div>

          <div className="score-block">
            <div className="score-pill">
              <span>Score</span>
              <strong>{hud.score}</strong>
            </div>
            <div className="score-pill accent">
              <span>Wave</span>
              <strong>{hud.wave}</strong>
            </div>
          </div>
        </header>

        <div className="status-row">
          <div className="health-panel">
            <span className="panel-label">Hull</span>
            <div className="health-bar">
              <span style={{ width: `${(hud.health / 4) * 100}%` }} />
            </div>
          </div>

          <div className="combo-panel">
            <span className="panel-label">Combo</span>
            <strong>x{hud.combo}</strong>
          </div>
        </div>

        <div className="bottom-row">
          <div className="mission-card">
            <span className="panel-label">Mission</span>
            <strong>{hud.status}</strong>
            <small>Collect energy cores, dodge debris, survive the drift.</small>
          </div>

          <div className="controls-card">
            <span className="panel-label">Controls</span>
            <small>Mouse / WASD</small>
            <small>Space to launch</small>
          </div>
        </div>
      </div>

      {overlayVisible && (
        <div className="game-overlay">
          <div className="overlay-panel">
            <p className="eyebrow">Deep-space skirmish</p>
            <h1>NEON VOID</h1>
            <p className="overlay-copy">
              Drift through the debris field, harvest energy cores, and hold your ship together long enough to break the next wave.
            </p>
            <button type="button" className="launch-button" onClick={startMission}>
              Launch mission
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
