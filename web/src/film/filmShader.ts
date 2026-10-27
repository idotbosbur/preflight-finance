/**
 * The film's own background: same chrome palette and iridescent rims as the site's ribbons, different motion.
 * Light scenes: a bundle of thin silk-like strands with a travelling wave. Dark scenes
 * (u_ring) the strands fan out into diagonal light trails. u_dark switches the palette from studio chrome to black chrome.
 */
export const FILM_FRAG = `
precision mediump float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_alpha;
uniform float u_swirl;
uniform float u_shift;
uniform vec3 u_clear;
uniform float u_dark;
uniform float u_ring;

mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

vec3 chromeLight(float v){
  v = clamp(v, 0.0, 1.0);
  vec3 c = mix(vec3(0.985, 0.99, 1.0), vec3(0.66, 0.70, 0.76), smoothstep(0.10, 0.40, v));
  c = mix(c, vec3(0.30, 0.33, 0.39), smoothstep(0.40, 0.52, v));
  c = mix(c, vec3(0.94, 0.96, 0.99), smoothstep(0.54, 0.68, v));
  c = mix(c, vec3(0.72, 0.76, 0.83), smoothstep(0.82, 1.0, v));
  return c;
}
vec3 chromeDark(float v){
  v = clamp(v, 0.0, 1.0);
  vec3 c = mix(vec3(0.015, 0.016, 0.02), vec3(0.14, 0.15, 0.18), smoothstep(0.10, 0.40, v));
  c = mix(c, vec3(0.90, 0.93, 1.0), smoothstep(0.42, 0.50, v));
  c = mix(c, vec3(0.05, 0.05, 0.06), smoothstep(0.53, 0.66, v));
  c = mix(c, vec3(0.30, 0.32, 0.37), smoothstep(0.82, 1.0, v));
  return c;
}
vec3 tint(float w){
  vec3 light = mix(vec3(0.55, 0.72, 1.0), vec3(1.0, 0.79, 0.68), w);
  vec3 dark = mix(vec3(0.25, 0.5, 1.0), vec3(1.0, 0.52, 0.18), w);
  return mix(light, dark, u_dark);
}
// Shade a tube cross-section: d in [-1, 1] across the tube, facing tilts the reflection.
vec3 tube(float d, float facing, float phase){
  float refl = 0.5 + 0.46 * d * facing + 0.07 * sin(phase);
  vec3 col = mix(chromeLight(refl), chromeDark(refl), u_dark);
  float rim = smoothstep(0.55, 0.99, abs(d));
  col = mix(col, col * 0.5 + tint(0.5 + 0.5 * sin(phase * 0.7)) * 0.62, rim * (0.7 + 0.3 * u_dark));
  col += pow(sqrt(max(0.0, 1.0 - d * d)), 28.0) * 0.22;
  return col;
}

void main(){
  vec2 s = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  float clearing = mix(1.0, smoothstep(0.20, 0.62, length((s - u_clear.xy) * vec2(0.55, 0.95))), u_clear.z);
  vec4 acc = vec4(0.0);

  // --- Strands. Light scenes: five thin silk strands in a low bundle with a travelling wave.
  //     Dark scenes (u_ring → 1): the same strands fan out and rise into long diagonal light trails
  //     sweeping across the frame, cleared behind the centred text. ---
  float trail = u_ring;
  vec2 p = s;
  float rr = length(p);
  p = rot(u_swirl * (1.6 / (rr * 3.0 + 0.4))) * p;          // gentle twirl when u_swirl > 0
  p = rot(0.18 + 0.06 * sin(u_shift * 0.7) + 0.40 * trail) * p;
  for (int i = 0; i < 7; i++) {
    float fi = float(i);
    float present = i < 5 ? 1.0 : trail;                     // two extra trails join in the dark
    if (present <= 0.001) continue;
    float amp = mix(0.16, 0.10, trail);
    float wave = amp * sin(p.x * mix(2.2, 1.3, trail) - u_time * 0.55 + fi * 0.32)
               + 0.05 * sin(p.x * 4.6 + u_time * 0.31 + fi * 0.9);
    float spread = mix(0.034, 0.085, trail);
    float yc = mix(-0.30, -0.04, trail) + wave + (fi - mix(2.0, 3.0, trail)) * spread * (1.0 + 0.4 * sin(p.x * 1.3 + u_time * 0.2));
    float twist = sin(p.x * 1.7 + u_time * 0.4 + fi * 1.1);
    float facing = twist / (abs(twist) + 0.25);
    float th = ((0.010 + 0.004 * mod(fi, 5.0)) * (0.45 + 0.55 * abs(facing)) + 0.003) * (1.0 + 0.35 * trail);
    float d = (p.y - yc) / th;
    float cover = 1.0 - smoothstep(0.85, 1.15, abs(d));
    if (cover <= 0.001) continue;
    vec3 col = tube(d, facing, p.x * 3.0 + fi + u_time * 0.3);
    // Trails fade towards their ends so they read as streaks of light, not bars.
    float ends = mix(1.0, smoothstep(1.25, 0.35, abs(p.x + 0.12 * sin(fi * 2.3))), trail);
    float a = cover * (0.7 + 0.3 * sqrt(max(0.0, 1.0 - d * d))) * u_alpha * clearing * present * ends;
    acc.rgb += (1.0 - acc.a) * col * a;
    acc.a += (1.0 - acc.a) * a;
  }

  // Soft iridescent glow, low and to the left, like the site's haze but placed differently.
  float h = exp(-pow(length(s - vec2(-0.55, -0.42)) * 1.8, 2.0)) * 0.22 * u_alpha * clearing
          + exp(-pow(length(s - vec2(0.6, 0.38)) * 2.6, 2.0)) * 0.12 * u_alpha * clearing;
  vec3 hc = tint(0.5 + 0.5 * sin(u_time * 0.12 + s.x * 2.0));
  acc.rgb += (1.0 - acc.a) * hc * h;
  acc.a += (1.0 - acc.a) * h;

  float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  acc += vec4(n / 255.0) * step(0.002, acc.a);
  gl_FragColor = acc;
}`;
