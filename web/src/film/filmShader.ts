/**
 * The film's own background: liquid chrome, in the site's palette but with its own motion. Streams of molten
 * metal (signed-distance tubes joined with a smooth minimum, so they merge like mercury) flow low across the light
 * scenes; in the dark scenes (u_ring → 1) they fan out into diagonal streams. A slow domain warp gives the viscous
 * wobble, and the surface normal from the height field drives the chrome reflection. u_dark swaps the palette.
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
// Smooth minimum: where two streams meet they fuse instead of overlapping.
float smin(float a, float b, float k){ float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }

// Signed distance to the liquid (negative inside). w returns the local stream width for the height profile.
float liquid(vec2 s, out float w){
  float trail = u_ring;
  vec2 p = s;
  // Viscous wobble: two slow octaves of domain warp.
  p += 0.045 * vec2(sin(p.y * 3.1 + u_time * 0.42), sin(p.x * 2.3 - u_time * 0.37));
  p += 0.020 * vec2(sin(p.y * 7.3 - u_time * 0.61), sin(p.x * 6.1 + u_time * 0.53));
  float rr = length(p);
  p = rot(u_swirl * (1.4 / (rr * 3.0 + 0.4))) * p;
  p = rot(0.16 + 0.05 * sin(u_shift * 0.7) + 0.42 * trail) * p;
  float d = 1e3;
  float wsum = 0.0, wtot = 0.0;
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float present = i < 4 ? 1.0 : trail;
    if (present <= 0.001) continue;
    float wave = mix(0.15, 0.10, trail) * sin(p.x * mix(1.9, 1.2, trail) - u_time * 0.45 + fi * 0.55)
               + 0.04 * sin(p.x * 3.7 + u_time * 0.28 + fi * 1.3);
    float spread = mix(0.055, 0.11, trail);
    float yc = mix(-0.30, -0.03, trail) + wave + (fi - mix(1.5, 2.5, trail)) * spread * (1.0 + 0.5 * sin(p.x * 1.1 + u_time * 0.21 + fi));
    // Width swells and pinches along the stream, like a pour.
    float wi = (0.020 + 0.006 * mod(fi, 3.0)) * (0.65 + 0.55 * (0.5 + 0.5 * sin(p.x * 2.6 - u_time * 0.5 + fi * 2.0)));
    wi *= (1.0 + 0.25 * trail) * present;
    // Streams thin out towards their ends in the dark scenes, reading as pours of light.
    wi *= mix(1.0, smoothstep(1.35, 0.4, abs(p.x + 0.15 * sin(fi * 2.3))), trail);
    float di = abs(p.y - yc) - wi;
    float wt = exp(-abs(di) * 45.0) * present;   // nearby streams share their width smoothly (no seams)
    wsum += wi * wt; wtot += wt;
    d = smin(d, di, 0.035);
  }
  w = wtot > 1e-4 ? wsum / wtot : 0.03;
  return d;
}

void main(){
  vec2 s = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  float clearing = mix(1.0, smoothstep(0.20, 0.62, length((s - u_clear.xy) * vec2(0.55, 0.95))), u_clear.z);
  vec4 acc = vec4(0.0);

  float w;
  float d = liquid(s, w);
  float px = 1.5 / u_res.y;
  float cover = 1.0 - smoothstep(-px, px, d);
  if (cover > 0.001) {
    // Height of the liquid surface (a rounded profile) and its normal from the gradient.
    float e = 0.0025, w1, w2;
    float dx = liquid(s + vec2(e, 0.0), w1) - d;
    float dy = liquid(s + vec2(0.0, e), w2) - d;
    float depth = clamp(-d / max(w, 0.006), 0.0, 1.0);
    float hgt = sqrt(depth * (2.0 - depth));
    vec3 n = normalize(vec3(-dx / e * (1.0 - hgt) * 1.6, -dy / e * (1.0 - hgt) * 1.6, hgt + 0.12));
    // Chrome: reflect a studio horizon. Vertical tilt of the normal picks the band; a slow sweep makes it flow.
    float refl = 0.5 + 0.48 * n.y + 0.10 * n.x + 0.06 * sin(u_time * 0.35 + s.x * 2.0);
    vec3 col = mix(chromeLight(refl), chromeDark(refl), u_dark);
    float fres = pow(1.0 - n.z, 2.0);
    col = mix(col, col * 0.45 + tint(0.5 + 0.5 * sin(s.x * 3.0 + u_time * 0.25)) * 0.7, fres * (0.75 + 0.25 * u_dark));
    // Sharp specular highlight from a soft key light up and to the left.
    vec3 L = normalize(vec3(-0.4, 0.6, 0.7));
    col += pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 40.0) * 0.55;
    float a = cover * u_alpha * clearing;
    acc.rgb += (1.0 - acc.a) * col * a;
    acc.a += (1.0 - acc.a) * a;
  }

  // Soft iridescent glow, low and to the left.
  float h = exp(-pow(length(s - vec2(-0.55, -0.42)) * 1.8, 2.0)) * 0.22 * u_alpha * clearing
          + exp(-pow(length(s - vec2(0.6, 0.38)) * 2.6, 2.0)) * 0.12 * u_alpha * clearing;
  vec3 hc = tint(0.5 + 0.5 * sin(u_time * 0.12 + s.x * 2.0));
  acc.rgb += (1.0 - acc.a) * hc * h;
  acc.a += (1.0 - acc.a) * h;

  float nz = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  acc += vec4(nz / 255.0) * step(0.002, acc.a);
  gl_FragColor = acc;
}`;
