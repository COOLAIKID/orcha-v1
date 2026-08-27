export const FIELD_W = 960
export const FIELD_H = 612
let fieldHrefCache = ''

export function makeBlueField() {
  const canvas = document.createElement('canvas')
  canvas.width = FIELD_W
  canvas.height = FIELD_H
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  ctx.fillStyle = '#3d7ec4'
  ctx.fillRect(0, 0, FIELD_W, FIELD_H)
  const colors = [
    '#ffffff',
    '#f4fbff',
    '#e4f2ff',
    '#c5e7ff',
    '#9ad4ff',
    '#7ec8ff',
    '#4dabff',
    '#2b7fff',
    '#1d5fbe',
    '#163e7a',
    '#0f2f5c',
    '#bfe6ff',
    '#8ec4f5',
    '#d8eeff',
  ]
  for (let i = 0; i < 72; i += 1) {
    const x = Math.random() * FIELD_W
    const y = Math.random() * FIELD_H
    const r = 24 + Math.random() * 140
    const fill = ctx.createRadialGradient(x, y, 0, x, y, r)
    fill.addColorStop(0, colors[Math.floor(Math.random() * colors.length)])
    fill.addColorStop(1, 'rgba(61,126,196,0)')
    ctx.fillStyle = fill
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  const sweep = ctx.createLinearGradient(FIELD_W * 0.5 - 160, 0, FIELD_W * 0.5 + 160, 0)
  sweep.addColorStop(0, 'rgba(255,255,255,0)')
  sweep.addColorStop(0.38, 'rgba(218,243,255,.28)')
  sweep.addColorStop(0.5, 'rgba(255,255,255,.9)')
  sweep.addColorStop(0.62, 'rgba(218,243,255,.28)')
  sweep.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = sweep
  ctx.fillRect(0, 0, FIELD_W, FIELD_H)
  return canvas
}

export function getBlueFieldHref() {
  if (fieldHrefCache) return fieldHrefCache
  try {
    fieldHrefCache = makeBlueField().toDataURL('image/jpeg', 0.62)
  } catch {
    fieldHrefCache = ''
  }
  return fieldHrefCache
}
