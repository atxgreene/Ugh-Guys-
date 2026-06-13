// Lightweight GPU particle pools (smoke, dust, sparks). Fixed capacity, recycled
// round-robin — one draw call each, soft round points via a tiny shader.
import * as THREE from 'three';

export class ParticlePool {
  constructor(scene, { capacity = 256, color = 0xffffff, blending = THREE.NormalBlending, gravity = 0, fog = false }) {
    this.cap = capacity;
    this.gravity = gravity;
    this.pos = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.size0 = new Float32Array(capacity);
    this.alpha0 = new Float32Array(capacity);
    this.grow = new Float32Array(capacity);
    this.cursor = 0;
    this.alive = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    geo.setDrawRange(0, capacity);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) } },
      transparent: true, depthWrite: false, blending, fog,
      vertexShader: `
        attribute float aSize; attribute float aAlpha; varying float vA;
        void main(){ vA = aAlpha; vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = aSize * (320.0 / max(1.0, -mv.z));
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `
        varying float vA; uniform vec3 uColor;
        void main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d,d);
          if (r > 0.25 || vA <= 0.001) discard;
          float a = vA * (1.0 - r * 4.0);
          gl_FragColor = vec4(uColor, a); }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    scene.add(this.points);
    this.geo = geo;
  }

  spawn(x, y, z, vx, vy, vz, life, size, alpha, grow = 1) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.cap;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life; this.maxLife[i] = life;
    this.size0[i] = size; this.alpha0[i] = alpha; this.grow[i] = grow;
    this.size[i] = size; this.alpha[i] = alpha;
  }

  update(dt) {
    let any = 0;
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i] <= 0) { if (this.alpha[i] !== 0) this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      this.vel[i * 3 + 1] += this.gravity * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] = this.size0[i] * (1 + (this.grow[i] - 1) * (1 - t));
      this.alpha[i] = this.alpha0[i] * t;
      any++;
    }
    this.alive = any;
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
  }

  dispose() { this.geo.dispose(); this.points.material.dispose(); this.points.parent?.remove(this.points); }
}
