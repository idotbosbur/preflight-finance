/**
 * The Lens mark in 3D chrome (raymarched in WebGL, no library). With `assemble`, the two discs slide in
 * from either side spinning like coins, meet, and the lens punches out between them; then the mark
 * keeps a slow sway. Falls back to the flat LensMark without WebGL or with reduced motion.
 */
import { useEffect, useRef, useState } from "react";
import { LensMark } from "./LensMark.tsx";

const VS = "attribute vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }";

// Same geometry as LensMark, in units of the circle radius / 2 (r = .5, centres at +-.27).
const FS = `
precision highp float;
uniform vec2 R; uniform float T; uniform float A;
mat2 rot(float a){ float c=cos(a), s=sin(a); return mat2(c,-s,s,c); }
float ext(float d2, float dz){ return min(max(d2,dz),0.)+length(max(vec2(d2,dz),0.)); }
// Two bevelled chrome discs, each turned by its own spin about its centre, with their overlap cut out.
float map(vec3 p, float o, float ay){
  vec3 pa = p-vec3(-o,0.,0.); pa.xz = rot(ay)*pa.xz;
  vec3 pb = p-vec3( o,0.,0.); pb.xz = rot(-ay)*pb.xz;
  float bev=.055, h=.1;
  float a2 = length(pa.xy)-.5, b2 = length(pb.xy)-.5;
  float u = min(ext(a2+bev, abs(pa.z)-h), ext(b2+bev, abs(pb.z)-h))-bev;
  return max(u, -(max(a2,b2)-.035));
}
// Studio chrome: bright sky fading to grey, a sharp dark horizon, dark-to-light ground.
vec3 env(vec3 r){
  float y=r.y;
  vec3 top = mix(vec3(.5,.54,.61), vec3(.98,.99,1.), smoothstep(.02,.6,y));
  vec3 bot = mix(vec3(.2,.22,.27), vec3(.84,.87,.93), smoothstep(.02,.55,-y));
  vec3 c = y > .015 ? top : bot;
  c *= 1.-.55*exp(-pow(y/.035,2.));
  c += exp(-pow((r.x+.35)*3.2,2.))*smoothstep(-.1,.7,y)*.18;
  return c;
}
void main(){
  vec2 uv = (gl_FragCoord.xy-.5*R)/R.y;
  // Assembly: discs travel from far apart to their place while spinning one and a half turns.
  float o = mix(1.25, .27, A);
  float spin = (1.-A)*(1.-A)*9.42;
  float sway = .38*sin(T*.6), ax = .16*sin(T*.45)+.08;
  vec3 ro=vec3(0.,0.,mix(3.4,2.15,A)), rd=normalize(vec3(uv,-1.5));
  float t=0.; bool hit=false;
  for(int i=0;i<110;i++){
    vec3 p=ro+rd*t; p.yz=rot(ax)*p.yz; p.xz=rot(sway)*p.xz;
    float d=map(p,o,spin); if(d<.0008){hit=true;break;} t+=d*.85; if(t>7.)break;
  }
  if(!hit){ gl_FragColor=vec4(0.); return; }
  vec3 p=ro+rd*t; p.yz=rot(ax)*p.yz; p.xz=rot(sway)*p.xz;
  vec2 e=vec2(.0015,0.);
  vec3 n=normalize(vec3(map(p+e.xyy,o,spin)-map(p-e.xyy,o,spin), map(p+e.yxy,o,spin)-map(p-e.yxy,o,spin), map(p+e.yyx,o,spin)-map(p-e.yyx,o,spin)));
  n.xz=rot(-sway)*n.xz; n.yz=rot(-ax)*n.yz;
  vec3 r=reflect(rd,n);
  vec3 col=env(r);
  float fr=pow(1.-max(dot(-rd,n),0.),2.2);
  vec3 iri=mix(vec3(.5,.7,1.), vec3(1.,.76,.62), .5+.5*sin(r.x*4.+r.y*3.+T*.5));
  col=mix(col, col*.5+iri*.65, fr*.85);
  col+=pow(max(dot(r,normalize(vec3(-.5,.7,.5))),0.),70.)*.9;
  gl_FragColor=vec4(col,1.);
}`;

const ASSEMBLE_MS = 1500;
const ease = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

export function LensChrome({ className, assemble = false }: { readonly className?: string; readonly assemble?: boolean }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const [flat, setFlat] = useState(false);
  useEffect(() => {
    const c = ref.current;
    const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const gl = c?.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: true });
    if (!c || !gl || reduced) { setFlat(true); return; }
    const sh = (t: number, src: string) => { const o = gl.createShader(t)!; gl.shaderSource(o, src); gl.compileShader(o); return o; };
    const pr = gl.createProgram()!;
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) { setFlat(true); return; }
    gl.useProgram(pr);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, "p");
    gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const uR = gl.getUniformLocation(pr, "R"), uT = gl.getUniformLocation(pr, "T"), uA = gl.getUniformLocation(pr, "A");
    const t0 = performance.now();
    let raf = 0;
    const frame = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(c.clientWidth * dpr)), h = Math.max(1, Math.round(c.clientHeight * dpr));
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      const ms = performance.now() - t0;
      gl.viewport(0, 0, w, h);
      gl.uniform2f(uR, w, h); gl.uniform1f(uT, ms / 1000); gl.uniform1f(uA, assemble ? ease(ms / ASSEMBLE_MS) : 1);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLES, 0, 3);
      raf = requestAnimationFrame(frame);
    };
    frame();
    return () => cancelAnimationFrame(raf);
  }, [assemble]);
  return flat ? <LensMark className={className} /> : <canvas ref={ref} className={className} aria-hidden="true" />;
}
