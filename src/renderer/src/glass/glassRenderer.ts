// The WebGL2 board glass (spec 2026-10-08 A.4–A.6). Never throws: every failure returns
// false/null and logs one code. Colours come from the theme (spec) and tokens (colors).
import type { GlassMaterial, GlassSpec } from '../../../shared/schemas/theme'
import { BLIT, GLASS, PREBLUR, VERTEX } from './shaders'
import type { DrawItem, GlassRect, GlassStatus } from './surfaces'

export type Rgb = [number, number, number]
export interface GlassColors {
  status: Record<GlassStatus, Rgb>
}
export interface GlassFrame {
  width: number
  height: number
  dpr: number
  items: readonly DrawItem[]
  angles: readonly number[]
  scissor: GlassRect | null
}
export interface GlassRenderer {
  setWallpaper(img: HTMLImageElement): void
  draw(frame: GlassFrame): boolean
  dispose(): void
}

/** `#rrggbb` → 0..1 channels. The schema already validated the format. */
export function hexToUnitRgb(hex: string): Rgb {
  return [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255
  ]
}

interface Program {
  p: WebGLProgram
  u: Map<string, WebGLUniformLocation>
  a: number
}
interface Target {
  tex: WebGLTexture
  fb: WebGLFramebuffer
  w: number
  h: number
}

export function createGlassRenderer(
  canvas: HTMLCanvasElement,
  spec: GlassSpec,
  colors: GlassColors,
  log: (code: string) => void
): GlassRenderer | null {
  // preserveDrawingBuffer: the moving light redraws ONE surface's rect (scissor); without it the
  // browser clears the canvas between frames and everything else would vanish.
  const gl = canvas.getContext('webgl2', {
    premultipliedAlpha: true,
    antialias: false,
    preserveDrawingBuffer: true
  })
  if (gl === null) {
    log('glass_unavailable')
    return null
  }

  // Every shader is deleted once linked (or on failure), and a failed program too: a theme push
  // re-creates the renderer on the SAME context, so anything left behind adds up.
  const compile = (fs: string): Program | null => {
    const p = gl.createProgram()
    const made: WebGLShader[] = []
    let ok = true
    for (const [type, src] of [
      [gl.VERTEX_SHADER, VERTEX],
      [gl.FRAGMENT_SHADER, fs]
    ] as const) {
      const sh = gl.createShader(type)
      if (sh === null) {
        ok = false
        break
      }
      made.push(sh)
      gl.shaderSource(sh, src)
      gl.compileShader(sh)
      if (gl.getShaderParameter(sh, gl.COMPILE_STATUS) !== true) {
        ok = false
        break
      }
      gl.attachShader(p, sh)
    }
    if (ok) {
      gl.linkProgram(p)
      ok = gl.getProgramParameter(p, gl.LINK_STATUS) === true
    }
    for (const sh of made) {
      if (ok) gl.detachShader(p, sh)
      gl.deleteShader(sh)
    }
    if (!ok) {
      gl.deleteProgram(p)
      return null
    }
    const u = new Map<string, WebGLUniformLocation>()
    const n = Number(gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS))
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i)
      const loc = info === null ? null : gl.getUniformLocation(p, info.name)
      if (info !== null && loc !== null) u.set(info.name, loc)
    }
    return { p, u, a: gl.getAttribLocation(p, 'a') }
  }

  const blit = compile(BLIT)
  const preblur = compile(PREBLUR)
  const glass = compile(GLASS)
  if (blit === null || preblur === null || glass === null) {
    for (const prog of [blit, preblur, glass]) if (prog !== null) gl.deleteProgram(prog.p)
    log('glass_shader_failed')
    return null
  }
  const quad = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, quad)
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]),
    gl.STATIC_DRAW
  )

  const texture = (): WebGLTexture => {
    const t = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return t
  }
  const wallpaper = texture()
  let wallpaperSize: [number, number] | null = null
  let groundStale = true
  const targets = new Map<string, Target>()

  const target = (name: string, w: number, h: number): Target => {
    const old = targets.get(name)
    if (old !== undefined && old.w === w && old.h === h) return old
    if (old !== undefined) {
      gl.deleteTexture(old.tex)
      gl.deleteFramebuffer(old.fb)
    }
    const tex = texture()
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    const fb = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    const t = { tex, fb, w, h }
    targets.set(name, t)
    groundStale = true
    return t
  }

  const bindProgram = (prog: Program): void => {
    gl.useProgram(prog.p)
    gl.bindBuffer(gl.ARRAY_BUFFER, quad)
    gl.enableVertexAttribArray(prog.a)
    gl.vertexAttribPointer(prog.a, 2, gl.FLOAT, false, 0, 0)
  }
  const set1f = (prog: Program, name: string, v: number): void => {
    const l = prog.u.get(name)
    if (l !== undefined) gl.uniform1f(l, v)
  }
  const set1i = (prog: Program, name: string, v: number): void => {
    const l = prog.u.get(name)
    if (l !== undefined) gl.uniform1i(l, v)
  }
  const set2f = (prog: Program, name: string, a: number, b: number): void => {
    const l = prog.u.get(name)
    if (l !== undefined) gl.uniform2f(l, a, b)
  }
  const set3f = (prog: Program, name: string, v: Rgb): void => {
    const l = prog.u.get(name)
    if (l !== undefined) gl.uniform3f(l, v[0], v[1], v[2])
  }
  const set4f = (prog: Program, name: string, a: number, b: number, c: number, d: number): void => {
    const l = prog.u.get(name)
    if (l !== undefined) gl.uniform4f(l, a, b, c, d)
  }

  const fullscreen = (prog: Program, src: WebGLTexture, W: number, H: number): void => {
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, src)
    set1i(prog, 'u_tex', 0)
    set2f(prog, 'u_res', W, H)
    set4f(prog, 'u_rect', 0, 0, W, H)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
  }

  const material = (kind: DrawItem['kind']): GlassMaterial => {
    return spec.surfaces[kind]
  }
  const tintFor = (item: DrawItem): Rgb => {
    const col = spec.surfaces.column
    if (item.kind === 'column' && item.status === 'needs-you' && col.tintNeedsYou !== undefined) {
      return hexToUnitRgb(col.tintNeedsYou)
    }
    return hexToUnitRgb(material(item.kind).tint)
  }
  const level1Blurs = [
    ...new Set([spec.surfaces.header.blur, spec.surfaces.column.blur, spec.surfaces.field.blur])
  ]

  const applyScissor = (f: GlassFrame, H: number): void => {
    if (f.scissor === null) {
      gl.disable(gl.SCISSOR_TEST)
      return
    }
    const s = f.scissor
    gl.enable(gl.SCISSOR_TEST)
    gl.scissor(s.left * f.dpr, H - (s.top + s.height) * f.dpr, s.width * f.dpr, s.height * f.dpr)
  }
  const clipBox = (a: GlassRect | null, b: GlassRect | null): GlassRect | null | 'empty' => {
    if (a === null) return b
    if (b === null) return a
    const left = Math.max(a.left, b.left)
    const top = Math.max(a.top, b.top)
    const right = Math.min(a.left + a.width, b.left + b.width)
    const bottom = Math.min(a.top + a.height, b.top + b.height)
    return right <= left || bottom <= top
      ? 'empty'
      : { left, top, width: right - left, height: bottom - top }
  }
  const drawItem = (
    item: DrawItem,
    angle: number,
    backdrop: WebGLTexture,
    preblurred: boolean,
    f: GlassFrame,
    W: number,
    H: number
  ): void => {
    const m = material(item.kind)
    const x = item.rect.left * f.dpr
    const y = item.rect.top * f.dpr
    const w = item.rect.width * f.dpr
    const h = item.rect.height * f.dpr
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, backdrop)
    set1i(glass, 'u_bd', 0)
    set2f(glass, 'u_res', W, H)
    set1f(glass, 'u_dpr', f.dpr)
    set1i(glass, 'u_preblurred', preblurred ? 1 : 0)
    set1f(glass, 'u_refract', m.refract)
    set1f(glass, 'u_edge', m.edge)
    set1f(glass, 'u_blur', m.blur)
    set1f(glass, 'u_chroma', m.chroma)
    set1f(glass, 'u_tintAmt', m.tintAmount)
    set1f(glass, 'u_rim', m.rim)
    set1f(glass, 'u_exposure', m.exposure)
    set1f(glass, 'u_lift', m.lift)
    set1f(glass, 'u_glow', m.glow)
    set1f(glass, 'u_lightAngle', angle)
    set3f(glass, 'u_tint', tintFor(item))
    const status =
      item.kind === 'column' && item.status !== null ? colors.status[item.status] : null
    set4f(
      glass,
      'u_status',
      status?.[0] ?? 0,
      status?.[1] ?? 0,
      status?.[2] ?? 0,
      status === null ? 0 : 1
    )
    set4f(glass, 'u_box', x + w / 2, H - (y + h / 2), w / 2, h / 2)
    set1f(glass, 'u_r', item.radius * f.dpr)
    set4f(glass, 'u_rect', x - 2, y - 2, w + 4, h + 4)
    // The item's clip (its scroller) AND the frame's scissor (moving light) — both, never one
    // replacing the other, or a partial redraw composites twice over the last frame.
    const box = clipBox(item.clip, f.scissor)
    if (box === 'empty') return
    if (box !== null) {
      gl.enable(gl.SCISSOR_TEST)
      gl.scissor(
        box.left * f.dpr,
        H - (box.top + box.height) * f.dpr,
        box.width * f.dpr,
        box.height * f.dpr
      )
    }
    gl.drawArrays(gl.TRIANGLES, 0, 6)
    applyScissor(f, H)
  }

  return {
    setWallpaper(img) {
      gl.bindTexture(gl.TEXTURE_2D, wallpaper)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img)
      wallpaperSize = [img.naturalWidth, img.naturalHeight]
      groundStale = true
    },
    draw(f) {
      if (wallpaperSize === null || gl.isContextLost()) return false
      performance.mark('glass-draw-start')
      const W = Math.round(f.width * f.dpr)
      const H = Math.round(f.height * f.dpr)
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = W
        canvas.height = H
      }
      gl.viewport(0, 0, W, H)
      gl.disable(gl.BLEND)
      gl.disable(gl.SCISSOR_TEST)
      const ground = target('ground', W, H)
      const pre = new Map(level1Blurs.map((r) => [r, target(`pre${r}`, W, H)] as const))
      const l1 = target('l1', W, H)
      if (groundStale) {
        bindProgram(blit)
        gl.bindFramebuffer(gl.FRAMEBUFFER, ground.fb)
        set2f(blit, 'u_img', wallpaperSize[0], wallpaperSize[1])
        set1i(blit, 'u_cover', 1)
        fullscreen(blit, wallpaper, W, H)
        bindProgram(preblur)
        for (const [r, t] of pre) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb)
          set1f(preblur, 'u_radius', r * f.dpr)
          fullscreen(preblur, ground.tex, W, H)
        }
        groundStale = false
      }
      applyScissor(f, H)
      bindProgram(blit)
      set1i(blit, 'u_cover', 0)
      gl.bindFramebuffer(gl.FRAMEBUFFER, l1.fb)
      fullscreen(blit, ground.tex, W, H)
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
      bindProgram(glass)
      f.items.forEach((item, i) => {
        if (item.level !== 1) return
        const t = pre.get(material(item.kind).blur) ?? ground
        drawItem(item, f.angles[i] ?? 135, t.tex, t !== ground, f, W, H)
      })
      gl.disable(gl.BLEND)
      bindProgram(blit)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      fullscreen(blit, l1.tex, W, H)
      gl.enable(gl.BLEND)
      bindProgram(glass)
      f.items.forEach((item, i) => {
        if (item.level !== 2) return
        drawItem(item, f.angles[i] ?? 135, l1.tex, false, f, W, H)
      })
      gl.disable(gl.SCISSOR_TEST)
      performance.measure('glass-draw', 'glass-draw-start')
      performance.clearMarks('glass-draw-start')
      // Nothing stays in the timeline (entries are not capped); the drive reads it with a
      // PerformanceObserver, which still receives the entry.
      performance.clearMeasures('glass-draw')
      return !gl.isContextLost()
    },
    dispose() {
      for (const t of targets.values()) {
        gl.deleteTexture(t.tex)
        gl.deleteFramebuffer(t.fb)
      }
      targets.clear()
      gl.deleteTexture(wallpaper)
      gl.deleteBuffer(quad)
      for (const prog of [blit, preblur, glass]) gl.deleteProgram(prog.p)
    }
  }
}
