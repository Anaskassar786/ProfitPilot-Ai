import { useEffect, useRef } from 'react'
import type { CSSProperties } from 'react'

export type JarvisOrbState = 'idle' | 'activating' | 'listening' | 'thinking' | 'speaking' | 'warning' | 'sleeping'
export type JarvisOrbProps = Readonly<{ state: JarvisOrbState; size?: number; className?: string; label?: string }>
type Point3 = Readonly<{ x: number; y: number; z: number; phase: number }>
export type ProjectedParticle = Readonly<{ x: number; y: number; depth: number; radius: number }>
export type OrbAnimationProfile = Readonly<{ speed: number; pulseSpeed: number; brightness: number; cyan: number; amber: number }>

const PARTICLE_COUNT = 92

export function orbAnimationProfile(state: JarvisOrbState): OrbAnimationProfile {
  if (state === 'listening') return { speed: .00105, pulseSpeed: .006, brightness: 1.25, cyan: 1, amber: 0 }
  if (state === 'thinking' || state === 'activating') return { speed: .00072, pulseSpeed: .012, brightness: 1.12, cyan: .82, amber: 0 }
  if (state === 'speaking') return { speed: .00086, pulseSpeed: .018, brightness: 1.2, cyan: 1, amber: 0 }
  if (state === 'warning') return { speed: .00042, pulseSpeed: .008, brightness: .96, cyan: .3, amber: 1 }
  if (state === 'sleeping') return { speed: .00008, pulseSpeed: .002, brightness: .38, cyan: .35, amber: 0 }
  return { speed: .00024, pulseSpeed: .0035, brightness: .82, cyan: .78, amber: 0 }
}

export function projectParticle(point: Point3, angle: number, size: number, pulse = 1): ProjectedParticle {
  const sin = Math.sin(angle)
  const cos = Math.cos(angle)
  const rotatedX = point.x * cos + point.z * sin
  const rotatedZ = -point.x * sin + point.z * cos
  const tilt = -.28
  const tiltSin = Math.sin(tilt)
  const tiltCos = Math.cos(tilt)
  const rotatedY = point.y * tiltCos - rotatedZ * tiltSin
  const depth = point.y * tiltSin + rotatedZ * tiltCos
  const sphereRadius = size * .405 * pulse
  const perspective = .88 + (depth + 1) * .09
  return { x: size / 2 + rotatedX * sphereRadius * perspective, y: size / 2 + rotatedY * sphereRadius * perspective, depth, radius: Math.max(.45, size * (.009 + (depth + 1) * .006)) }
}

export function JarvisOrb({ state, size = 48, className = '', label = `Jarvis ${state}` }: JarvisOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const pointsRef = useRef<readonly Point3[]>(spherePoints(PARTICLE_COUNT))

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let context: CanvasRenderingContext2D | null = null
    try { context = canvas.getContext('2d') } catch { return }
    if (!context) return
    const profile = orbAnimationProfile(state)
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    let reducedMotion = media.matches
    let intersecting = true
    let frame = 0
    let startedAt = performance.now()
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5)
    canvas.width = Math.round(size * dpr)
    canvas.height = Math.round(size * dpr)
    canvas.style.width = `${size}px`
    canvas.style.height = `${size}px`
    context.setTransform(dpr, 0, 0, dpr, 0, 0)

    const draw = (now: number) => {
      const elapsed = reducedMotion ? 0 : now - startedAt
      drawOrb(context!, pointsRef.current, size, elapsed, profile)
      if (!reducedMotion && intersecting && document.visibilityState !== 'hidden') frame = window.requestAnimationFrame(draw)
    }
    const resume = () => {
      window.cancelAnimationFrame(frame)
      if (!reducedMotion && intersecting && document.visibilityState !== 'hidden') {
        startedAt = performance.now()
        frame = window.requestAnimationFrame(draw)
      } else draw(performance.now())
    }
    const onMotion = (event: MediaQueryListEvent) => { reducedMotion = event.matches; resume() }
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(([entry]) => { intersecting = entry?.isIntersecting ?? true; resume() }, { threshold: .01 })
    observer?.observe(canvas)
    document.addEventListener('visibilitychange', resume)
    media.addEventListener?.('change', onMotion)
    draw(startedAt)
    return () => {
      window.cancelAnimationFrame(frame)
      observer?.disconnect()
      document.removeEventListener('visibilitychange', resume)
      media.removeEventListener?.('change', onMotion)
    }
  }, [size, state])

  const style = { '--jarvis-orb-size': `${size}px` } as CSSProperties
  return <span className={`jarvis-particle-orb state-${state} ${className}`.trim()} style={style} role="img" aria-label={label}><canvas ref={canvasRef} aria-hidden="true" /></span>
}

function drawOrb(context: CanvasRenderingContext2D, points: readonly Point3[], size: number, elapsed: number, profile: OrbAnimationProfile): void {
  const center = size / 2
  const pulse = 1 + Math.sin(elapsed * profile.pulseSpeed) * (profile.pulseSpeed > .01 ? .035 : .018)
  context.clearRect(0, 0, size, size)
  context.save()
  context.beginPath()
  context.arc(center, center, center - .6, 0, Math.PI * 2)
  context.clip()

  const background = context.createRadialGradient(size * .36, size * .3, size * .03, center, center, center)
  if (profile.amber > 0) {
    background.addColorStop(0, `rgba(255, 232, 176, ${.2 * profile.brightness})`)
    background.addColorStop(.42, `rgba(180, 106, 25, ${.2 * profile.brightness})`)
    background.addColorStop(1, 'rgba(22, 18, 20, .98)')
  } else {
    background.addColorStop(0, `rgba(176, 248, 255, ${.2 * profile.brightness})`)
    background.addColorStop(.38, `rgba(22, 132, 181, ${.18 * profile.brightness})`)
    background.addColorStop(1, 'rgba(5, 14, 28, .98)')
  }
  context.fillStyle = background
  context.fillRect(0, 0, size, size)

  const glow = context.createRadialGradient(center, center, 0, center, center, size * .47)
  glow.addColorStop(0, profile.amber ? `rgba(245, 158, 11, ${.13 * profile.brightness})` : `rgba(62, 219, 255, ${.16 * profile.brightness})`)
  glow.addColorStop(.62, profile.amber ? 'rgba(245, 158, 11, .04)' : 'rgba(38, 140, 255, .04)')
  glow.addColorStop(1, 'rgba(0,0,0,0)')
  context.fillStyle = glow
  context.fillRect(0, 0, size, size)

  const angle = elapsed * profile.speed
  const projected = points.map((point) => ({ point, projected: projectParticle(point, angle + point.phase * .025, size, pulse) })).sort((left, right) => left.projected.depth - right.projected.depth)
  for (const { point, projected: particle } of projected) {
    const alpha = Math.max(.12, Math.min(.95, (.38 + (particle.depth + 1) * .28) * profile.brightness))
    context.beginPath()
    context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2)
    context.fillStyle = profile.amber
      ? `rgba(251, 191, 36, ${alpha})`
      : `rgba(${Math.round(80 + profile.cyan * 35)}, ${Math.round(174 + profile.cyan * 52)}, 255, ${alpha})`
    context.shadowBlur = Math.max(1, size * .055 * alpha)
    context.shadowColor = profile.amber ? 'rgba(245, 158, 11, .8)' : 'rgba(57, 211, 255, .85)'
    context.fill()
    if (particle.depth > .28 && Math.abs(point.y) < .72) {
      context.beginPath()
      context.arc(particle.x, particle.y, particle.radius * 2.5, 0, Math.PI * 2)
      context.fillStyle = profile.amber ? `rgba(255, 214, 128, ${alpha * .08})` : `rgba(142, 236, 255, ${alpha * .09})`
      context.fill()
    }
  }
  context.shadowBlur = 0
  const rim = context.createLinearGradient(0, 0, size, size)
  rim.addColorStop(0, profile.amber ? 'rgba(255, 204, 103, .72)' : 'rgba(143, 238, 255, .82)')
  rim.addColorStop(.48, profile.amber ? 'rgba(245, 158, 11, .2)' : 'rgba(53, 140, 255, .3)')
  rim.addColorStop(1, 'rgba(10, 32, 58, .42)')
  context.strokeStyle = rim
  context.lineWidth = Math.max(1, size * .018)
  context.beginPath()
  context.arc(center, center, center - context.lineWidth, 0, Math.PI * 2)
  context.stroke()
  context.restore()
}

function spherePoints(count: number): readonly Point3[] {
  const points: Point3[] = []
  const goldenAngle = Math.PI * (3 - Math.sqrt(5))
  for (let index = 0; index < count; index += 1) {
    const y = 1 - (index / Math.max(1, count - 1)) * 2
    const radius = Math.sqrt(Math.max(0, 1 - y * y))
    const theta = goldenAngle * index
    points.push({ x: Math.cos(theta) * radius, y, z: Math.sin(theta) * radius, phase: (index * 17) % 29 })
  }
  return points
}
