export const VERTEX = `#version 300 es
in vec2 a; uniform vec4 u_rect; uniform vec2 u_res;
void main() { vec2 p = u_rect.xy + a * u_rect.zw; vec2 c = p / u_res * 2.0 - 1.0; gl_Position = vec4(c.x, -c.y, 0.0, 1.0); }`

/** Copies a texture; u_cover fits an image like CSS `cover`. */
export const BLIT = `#version 300 es
precision highp float;
uniform sampler2D u_tex; uniform vec2 u_res; uniform vec2 u_img; uniform int u_cover; out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  if (u_cover == 1) { float ia = u_img.x / u_img.y, sa = u_res.x / u_res.y;
    vec2 s = sa > ia ? vec2(1.0, ia / sa) : vec2(sa / ia, 1.0); uv = (uv - 0.5) * s + 0.5; }
  o = texture(u_tex, uv);
}`

/** 25-tap golden-angle spiral blur (the canvas frost), u_radius in device px. */
export const PREBLUR = `#version 300 es
precision highp float;
uniform sampler2D u_tex; uniform vec2 u_res; uniform float u_radius; out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy / u_res; vec3 s = texture(u_tex, uv).rgb;
  for (int i = 0; i < 24; i++) { float fi = float(i) + 0.5; float a = fi * 2.39996323;
    float r = sqrt(fi / 24.0) * u_radius; s += texture(u_tex, uv + vec2(cos(a), sin(a)) * r / u_res).rgb; }
  o = vec4(s / 25.0, 1.0);
}`

/** One glass surface. u_preblurred = 1: the backdrop is already frosted (level 1). */
export const GLASS = `#version 300 es
precision highp float;
uniform sampler2D u_bd; uniform vec2 u_res; uniform vec4 u_box; uniform float u_r; uniform float u_dpr;
uniform float u_refract, u_edge, u_blur, u_chroma, u_tintAmt, u_rim, u_exposure, u_lift, u_glow, u_lightAngle;
uniform int u_preblurred; uniform vec3 u_tint; uniform vec4 u_status; out vec4 o;
float sdBox(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
float D(vec2 f) { return -sdBox(f - u_box.xy, u_box.zw, u_r); }
vec3 frost(vec2 uv) {
  if (u_preblurred == 1) return texture(u_bd, uv).rgb;
  vec3 s = texture(u_bd, uv).rgb;
  for (int i = 0; i < 24; i++) { float fi = float(i) + 0.5; float a = fi * 2.39996323;
    float r = sqrt(fi / 24.0) * u_blur * u_dpr; s += texture(u_bd, uv + vec2(cos(a), sin(a)) * r / u_res).rgb; }
  return s / 25.0;
}
void main() {
  vec2 f = gl_FragCoord.xy; float d = D(f);
  vec2 n = vec2(D(f + vec2(1, 0)) - D(f - vec2(1, 0)), D(f + vec2(0, 1)) - D(f - vec2(0, 1)));
  float nl = length(n); n = nl > 1e-4 ? n / nl : vec2(0.0);
  float E = u_edge * u_dpr; float t = clamp(1.0 - d / E, 0.0, 1.0); float bend = t * t * t;
  vec2 uv = f / u_res; vec2 off = -n * bend * u_refract * u_dpr / u_res; vec2 ca = off * u_chroma;
  vec3 c = vec3(frost(uv + off + ca).r, frost(uv + off).g, frost(uv + off - ca).b);
  c *= u_exposure; c = mix(c, u_tint, u_tintAmt); c = 1.0 - (1.0 - c) * (1.0 - u_lift);
  float ty = (f.y - (u_box.y - u_box.w)) / (2.0 * u_box.w);
  c += vec3(1.0) * u_glow * pow(clamp(ty, 0.0, 1.0), 3.0) * smoothstep(0.0, E * 3.0, d);
  float la = radians(u_lightAngle); vec2 L = vec2(cos(la), sin(la)); float fa = dot(-n, L);
  float lit = max(fa, 0.0) + 0.35 * max(-fa, 0.0);
  float rb = 1.0 - smoothstep(0.0, 1.6 * u_dpr, d); float gw = (1.0 - smoothstep(0.0, E, d)) * 0.06;
  c += vec3(1.0) * (rb * (0.12 + 0.88 * lit) * u_rim + gw * lit);
  if (u_status.a > 0.0) {
    float sb = 1.0 - smoothstep(1.5 * u_dpr - 0.5, 1.5 * u_dpr + 0.5, d); float yy = 1.0 - ty;
    vec4 sc = yy < 0.12 ? mix(vec4(u_status.rgb, 0.9), vec4(u_status.rgb, 0.2), yy / 0.12)
            : yy < 0.30 ? mix(vec4(u_status.rgb, 0.2), vec4(1.0, 1.0, 1.0, 0.08), (yy - 0.12) / 0.18)
            : mix(vec4(1.0, 1.0, 1.0, 0.08), vec4(1.0, 1.0, 1.0, 0.12), (yy - 0.30) / 0.70);
    c = mix(c, sc.rgb, sb * sc.a);
  }
  float al = smoothstep(-0.5, 0.5, d); o = vec4(c * al, al);
}`
