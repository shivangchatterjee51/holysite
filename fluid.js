// Stable-fluids solver on the GPU (WebGL2, half-float targets).
// Velocity lives on a coarse grid, dye on a fine one; pressure is solved with Jacobi iterations.

const VS = `#version 300 es
in vec2 aPos;
uniform vec2 texel;
out vec2 vUv, vL, vR, vT, vB;
void main(){
  vUv = aPos * .5 + .5;
  vL = vUv - vec2(texel.x, 0.); vR = vUv + vec2(texel.x, 0.);
  vT = vUv + vec2(0., texel.y); vB = vUv - vec2(0., texel.y);
  gl_Position = vec4(aPos, 0., 1.);
}`;

const HEAD = `#version 300 es
precision highp float; precision highp sampler2D;
in vec2 vUv, vL, vR, vT, vB;
out vec4 o;
`;

const FS = {
  splat: `
uniform sampler2D uTarget; uniform float aspect, radius; uniform vec3 color; uniform vec2 point;
void main(){
  vec2 p = vUv - point; p.x *= aspect;
  o = vec4(texture(uTarget, vUv).xyz + exp(-dot(p, p) / radius) * color, 1.);
}`,
  advect: `
uniform sampler2D uVelocity, uSource; uniform vec2 texel; uniform float dt, dissipation;
void main(){
  vec2 coord = vUv - dt * texture(uVelocity, vUv).xy * texel;
  o = texture(uSource, coord) / (1. + dissipation * dt); o.a = 1.;
}`,
  divergence: `
uniform sampler2D uVelocity;
void main(){
  vec2 C = texture(uVelocity, vUv).xy;
  float L = texture(uVelocity, vL).x, R = texture(uVelocity, vR).x;
  float T = texture(uVelocity, vT).y, B = texture(uVelocity, vB).y;
  if (vL.x < 0.) L = -C.x; if (vR.x > 1.) R = -C.x;
  if (vT.y > 1.) T = -C.y; if (vB.y < 0.) B = -C.y;
  o = vec4(.5 * (R - L + T - B), 0., 0., 1.);
}`,
  curl: `
uniform sampler2D uVelocity;
void main(){
  float L = texture(uVelocity, vL).y, R = texture(uVelocity, vR).y;
  float T = texture(uVelocity, vT).x, B = texture(uVelocity, vB).x;
  o = vec4(.5 * (R - L - T + B), 0., 0., 1.);
}`,
  vorticity: `
uniform sampler2D uVelocity, uCurl; uniform float curl, dt;
void main(){
  float L = texture(uCurl, vL).x, R = texture(uCurl, vR).x;
  float T = texture(uCurl, vT).x, B = texture(uCurl, vB).x, C = texture(uCurl, vUv).x;
  vec2 f = .5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
  f /= length(f) + 1e-4; f *= curl * C; f.y *= -1.;
  o = vec4(clamp(texture(uVelocity, vUv).xy + f * dt, -1000., 1000.), 0., 1.);
}`,
  pressure: `
uniform sampler2D uPressure, uDivergence;
void main(){
  float L = texture(uPressure, vL).x, R = texture(uPressure, vR).x;
  float T = texture(uPressure, vT).x, B = texture(uPressure, vB).x;
  o = vec4((L + R + B + T - texture(uDivergence, vUv).x) * .25, 0., 0., 1.);
}`,
  gradient: `
uniform sampler2D uPressure, uVelocity;
void main(){
  float L = texture(uPressure, vL).x, R = texture(uPressure, vR).x;
  float T = texture(uPressure, vT).x, B = texture(uPressure, vB).x;
  o = vec4(texture(uVelocity, vUv).xy - vec2(R - L, T - B), 0., 1.);
}`,
  scale: `
uniform sampler2D uTexture; uniform float value;
void main(){ o = value * texture(uTexture, vUv); }`,
  display: `
uniform sampler2D uDye; uniform vec3 bg; uniform float gloss, dim;
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){
  vec3 c = texture(uDye, vUv).rgb;
  float l = length(texture(uDye, vL).rgb), r = length(texture(uDye, vR).rgb);
  float t = length(texture(uDye, vT).rgb), b = length(texture(uDye, vB).rgb);
  vec3 n = normalize(vec3(r - l, t - b, .045));
  float shade = .62 + .38 * n.z;
  float spec = pow(max(dot(n, normalize(vec3(-.35, .55, 1.))), 0.), 40.) * gloss;
  float amt = min(length(c), 1.);
  vec3 ink = 1. - exp(-c * 1.6);
  vec3 col = bg + (ink * shade + spec * amt * .22) * dim;
  col += (hash(gl_FragCoord.xy) - .5) / 255.;
  o = vec4(col, 1.);
}`,
};

export class Fluid {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'high-performance' });
    if (!gl || !gl.getExtension('EXT_color_buffer_float')) throw new Error('WebGL2 float render targets unavailable');
    this.gl = gl;
    this.config = Object.assign({
      simRes: 128, dyeRes: 1024, iterations: 20, curl: 26, pressure: .8,
      velocityDissipation: .25, dyeDissipation: .9, radius: .22, bg: [.047, .043, .039], gloss: 1, dim: 1,
    }, opts);
    this.splats = [];

    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
    const ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(0);

    const vs = this.#shader(gl.VERTEX_SHADER, VS);
    this.p = {};
    for (const k in FS) this.p[k] = this.#program(vs, this.#shader(gl.FRAGMENT_SHADER, HEAD + FS[k]));
    this.resize(true);
  }

  #shader(type, src) {
    const gl = this.gl, s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }

  #program(vs, fs) {
    const gl = this.gl, prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs);
    gl.bindAttribLocation(prog, 0, 'aPos'); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    const u = {};
    const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const name = gl.getActiveUniform(prog, i).name;
      u[name] = gl.getUniformLocation(prog, name);
    }
    return { prog, u };
  }

  #fbo(w, h) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    return { tex, fb, w, h, bind: (unit) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); return unit; } };
  }

  #double(w, h) {
    let a = this.#fbo(w, h), b = this.#fbo(w, h);
    return { w, h, texel: [1 / w, 1 / h], get read() { return a; }, get write() { return b; }, swap() { [a, b] = [b, a]; } };
  }

  #res(r) {
    const gl = this.gl;
    let aspect = gl.drawingBufferWidth / gl.drawingBufferHeight;
    if (aspect < 1) aspect = 1 / aspect;
    const min = Math.round(r), max = Math.round(r * aspect);
    return gl.drawingBufferWidth > gl.drawingBufferHeight ? [max, min] : [min, max];
  }

  resize(force = false) {
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    const w = Math.floor(this.canvas.clientWidth * dpr), h = Math.floor(this.canvas.clientHeight * dpr);
    if (!force && w === this.canvas.width && h === this.canvas.height) return;
    // Don't rebuild the sim for mobile URL-bar jitter: only the drawing buffer changes.
    const rebuild = force || !this.lastAspect || Math.abs(w / h - this.lastAspect) > .15;
    this.canvas.width = w; this.canvas.height = h;
    if (!rebuild) return;
    this.lastAspect = w / h;
    const [sw, sh] = this.#res(this.config.simRes), [dw, dh] = this.#res(this.config.dyeRes);
    this.velocity = this.#double(sw, sh);
    this.pressure = this.#double(sw, sh);
    this.dye = this.#double(dw, dh);
    this.divergence = this.#fbo(sw, sh);
    this.curlFbo = this.#fbo(sw, sh);
    return true;
  }

  #use(name, uniforms) {
    const gl = this.gl, { prog, u } = this.p[name];
    gl.useProgram(prog);
    for (const k in uniforms) {
      const v = uniforms[k], loc = u[k];
      if (!loc) continue;
      if (typeof v === 'number') gl.uniform1f(loc, v);
      else if (v.length === 2) gl.uniform2f(loc, v[0], v[1]);
      else gl.uniform3f(loc, v[0], v[1], v[2]);
    }
    return u;
  }

  #tex(u, name, unit, fbo) { this.gl.uniform1i(u[name], fbo.bind(unit)); }

  #blit(target) {
    const gl = this.gl;
    if (target) { gl.viewport(0, 0, target.w, target.h); gl.bindFramebuffer(gl.FRAMEBUFFER, target.fb); }
    else { gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight); gl.bindFramebuffer(gl.FRAMEBUFFER, null); }
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
  }

  // x, y in [0,1] (y up); dx, dy are velocity; color is rgb dye amount.
  splat(x, y, dx, dy, color, radius = this.config.radius) {
    this.splats.push([x, y, dx, dy, color, radius]);
  }

  #applySplat([x, y, dx, dy, color, radius]) {
    const aspect = this.canvas.width / this.canvas.height;
    const r = radius / 100 * (aspect > 1 ? aspect : 1);
    let u = this.#use('splat', { aspect, point: [x, y], color: [dx, dy, 0], radius: r, texel: this.velocity.texel });
    this.#tex(u, 'uTarget', 0, this.velocity.read);
    this.#blit(this.velocity.write); this.velocity.swap();
    u = this.#use('splat', { color });
    this.#tex(u, 'uTarget', 0, this.dye.read);
    this.#blit(this.dye.write); this.dye.swap();
  }

  step(dt) {
    const gl = this.gl, c = this.config, vel = this.velocity, texel = vel.texel;
    gl.disable(gl.BLEND);
    for (const s of this.splats.splice(0)) this.#applySplat(s);

    let u = this.#use('curl', { texel });
    this.#tex(u, 'uVelocity', 0, vel.read); this.#blit(this.curlFbo);

    u = this.#use('vorticity', { texel, curl: c.curl, dt });
    this.#tex(u, 'uVelocity', 0, vel.read); this.#tex(u, 'uCurl', 1, this.curlFbo);
    this.#blit(vel.write); vel.swap();

    u = this.#use('divergence', { texel });
    this.#tex(u, 'uVelocity', 0, vel.read); this.#blit(this.divergence);

    u = this.#use('scale', { texel, value: c.pressure });
    this.#tex(u, 'uTexture', 0, this.pressure.read); this.#blit(this.pressure.write); this.pressure.swap();

    u = this.#use('pressure', { texel });
    this.#tex(u, 'uDivergence', 0, this.divergence);
    for (let i = 0; i < c.iterations; i++) {
      this.#tex(u, 'uPressure', 1, this.pressure.read);
      this.#blit(this.pressure.write); this.pressure.swap();
    }

    u = this.#use('gradient', { texel });
    this.#tex(u, 'uPressure', 0, this.pressure.read); this.#tex(u, 'uVelocity', 1, vel.read);
    this.#blit(vel.write); vel.swap();

    u = this.#use('advect', { texel, dt, dissipation: c.velocityDissipation });
    this.#tex(u, 'uVelocity', 0, vel.read); this.#tex(u, 'uSource', 0, vel.read);
    this.#blit(vel.write); vel.swap();

    u = this.#use('advect', { dissipation: c.dyeDissipation });
    this.#tex(u, 'uVelocity', 0, vel.read); this.#tex(u, 'uSource', 1, this.dye.read);
    this.#blit(this.dye.write); this.dye.swap();
  }

  render() {
    const u = this.#use('display', { texel: this.dye.texel, bg: this.config.bg, gloss: this.config.gloss, dim: this.config.dim });
    this.#tex(u, 'uDye', 0, this.dye.read);
    this.#blit(null);
  }
}
