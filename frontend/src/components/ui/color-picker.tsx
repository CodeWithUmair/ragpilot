// src/components/ui/color-picker.tsx
//
// A self-contained color picker rendered inside a shadcn Popover. Replaces the
// native <input type="color">, whose OS-level picker broke out of the page
// layout. Zero dependencies — a saturation/value square + hue slider + hex
// input, all pure React + pointer events.
"use client"

import * as React from "react"
import { Popover, PopoverContent, PopoverTrigger } from "./popover"
import { cn } from "@/lib/utils"

// ── color math ────────────────────────────────────────────────────────────────

interface Hsv { h: number; s: number; v: number } // h:0-360, s/v:0-1

function clamp01(n: number) {
  return Math.min(1, Math.max(0, n))
}

function hexToHsv(hex: string): Hsv {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return { h: 0, s: 0, v: 0 }
  const int = parseInt(m[1], 16)
  const r = ((int >> 16) & 255) / 255
  const g = ((int >> 8) & 255) / 255
  const b = (int & 255) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s: max === 0 ? 0 : d / max, v: max }
}

function hsvToHex({ h, s, v }: Hsv): string {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  let r = 0, g = 0, b = 0
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  const to = (n: number) =>
    Math.round((n + m) * 255).toString(16).padStart(2, "0")
  return `#${to(r)}${to(g)}${to(b)}`.toUpperCase()
}

// Tracks a pointer over an element, reporting normalized [0,1] x/y on press+drag.
function useDragArea(onMove: (x: number, y: number) => void) {
  const ref = React.useRef<HTMLDivElement>(null)
  const handle = React.useCallback(
    (clientX: number, clientY: number) => {
      const el = ref.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      onMove(
        clamp01((clientX - rect.left) / rect.width),
        clamp01((clientY - rect.top) / rect.height),
      )
    },
    [onMove],
  )
  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    handle(e.clientX, e.clientY)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (e.buttons !== 1) return
    handle(e.clientX, e.clientY)
  }
  return { ref, onPointerDown, onPointerMove }
}

// ── component ─────────────────────────────────────────────────────────────────

export function ColorPicker({
  value,
  onChange,
  disabled,
  children,
  align = "end",
}: {
  value: string
  onChange: (hex: string) => void
  disabled?: boolean
  children: React.ReactNode // the trigger element
  align?: "start" | "center" | "end"
}) {
  const [hsv, setHsv] = React.useState<Hsv>(() => hexToHsv(value))
  const [hexText, setHexText] = React.useState(value)

  // Re-sync internal state when the value changes from outside (e.g. a preset
  // swatch is clicked). Comparing hexes avoids a feedback loop on our own edits.
  React.useEffect(() => {
    if (hsvToHex(hsv).toLowerCase() !== value.toLowerCase()) {
      setHsv(hexToHsv(value))
    }
    setHexText(value.toUpperCase())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const commit = (next: Hsv) => {
    setHsv(next)
    const hex = hsvToHex(next)
    setHexText(hex)
    onChange(hex)
  }

  const sv = useDragArea((x, y) => commit({ ...hsv, s: x, v: 1 - y }))
  const hue = useDragArea((x) => commit({ ...hsv, h: x * 360 }))

  const hueColor = hsvToHex({ h: hsv.h, s: 1, v: 1 })

  return (
    <Popover>
      <PopoverTrigger asChild disabled={disabled}>
        {children}
      </PopoverTrigger>
      <PopoverContent align={align} className="w-60">
        <div className="space-y-3">
          {/* Saturation / value square */}
          <div
            ref={sv.ref}
            onPointerDown={sv.onPointerDown}
            onPointerMove={sv.onPointerMove}
            className="relative h-36 w-full rounded-lg cursor-crosshair touch-none overflow-hidden"
            style={{ backgroundColor: hueColor }}
          >
            <div
              className="absolute inset-0"
              style={{ background: "linear-gradient(to right, #fff, rgba(255,255,255,0))" }}
            />
            <div
              className="absolute inset-0"
              style={{ background: "linear-gradient(to top, #000, rgba(0,0,0,0))" }}
            />
            <span
              className="absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow ring-1 ring-black/30 pointer-events-none"
              style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }}
            />
          </div>

          {/* Hue slider */}
          <div
            ref={hue.ref}
            onPointerDown={hue.onPointerDown}
            onPointerMove={hue.onPointerMove}
            className="relative h-3 w-full rounded-full cursor-pointer touch-none"
            style={{
              background:
                "linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)",
            }}
          >
            <span
              className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow ring-1 ring-black/30 pointer-events-none"
              style={{ left: `${(hsv.h / 360) * 100}%` }}
            />
          </div>

          {/* Hex input + live preview */}
          <div className="flex items-center gap-2">
            <span
              className="h-8 w-8 shrink-0 rounded-md border border-border"
              style={{ backgroundColor: hsvToHex(hsv) }}
            />
            <input
              value={hexText}
              onChange={(e) => {
                const raw = e.target.value
                setHexText(raw)
                const norm = raw.startsWith("#") ? raw : `#${raw}`
                if (/^#[0-9a-f]{6}$/i.test(norm)) {
                  setHsv(hexToHsv(norm))
                  onChange(norm.toUpperCase())
                }
              }}
              spellCheck={false}
              className={cn(
                "w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm font-mono uppercase",
                "focus:outline-none focus:ring-2 focus:ring-ring",
              )}
              aria-label="Hex color value"
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
