import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { MeshData } from '../geometry/build3d';
import type { BuildOutput } from '../geometry/pipeline';
import type { GlassColor } from '../model/types';

export type PreviewMode = 'finished' | 'print' | 'exploded';

interface Props {
  build: BuildOutput | null;
  palette: GlassColor[];
  mode: PreviewMode;
  lightColor: string;
  lightIntensity: number;
  busy: boolean;
}

const PIECE_COLORS = ['#8ecae6', '#ffb703', '#90be6d', '#f28482', '#cdb4db', '#f4a261', '#84a59d', '#a8dadc', '#e9c46a', '#b5838d'];

function geometryOf(m: MeshData, crease = true): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
  g.setIndex(new THREE.BufferAttribute(m.indices, 1));
  if (!crease) {
    g.computeVertexNormals();
    return g;
  }
  const out = toCreasedNormals(g, (35 * Math.PI) / 180);
  g.dispose();
  return out;
}

/** Dark studio with a few bright soft boxes – gives chrome its contrast. */
function studioEnvironment(): THREE.Scene {
  const s = new THREE.Scene();
  s.add(new THREE.Mesh(new THREE.BoxGeometry(24, 24, 24), new THREE.MeshBasicMaterial({ color: 0x2b2e34, side: THREE.BackSide })));
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(24, 24), new THREE.MeshBasicMaterial({ color: 0x5a5e65 }));
  floor.position.set(0, -11.5, 0);
  floor.rotation.x = -Math.PI / 2;
  s.add(floor);
  const box = (w: number, h: number, x: number, y: number, z: number, k: number, tint = 0xffffff) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(tint).multiplyScalar(k), side: THREE.DoubleSide }),
    );
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    s.add(m);
  };
  box(16, 1.6, 0, 8, 7, 5);
  box(1.4, 14, -9, 0, 6, 3.5, 0xfff3e0);
  box(1.4, 14, 9, 1, 5, 2.5, 0xe8f0ff);
  box(14, 6, 0, 3.5, 10, 1.4);
  box(7, 4, 0, -3, 11, 1.0);
  box(10, 1, 0, -8, 6, 1.5);
  return s;
}

function labelSprite(text: string, color = '#111', bg = 'rgba(255,255,255,0.85)'): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(4, 8, 120, 48, 12);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.font = 'bold 34px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 64, 33);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  s.renderOrder = 10;
  return s;
}

interface Ctx {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  content: THREE.Group;
  envTex: THREE.Texture;
  fittedFor: string;
}

export function Preview3D({ build, palette, mode, lightColor, lightIntensity, busy }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const ctxRef = useRef<Ctx | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Set up renderer once.
  useEffect(() => {
    const host = hostRef.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    } catch (e) {
      setError('WebGL ist nicht verfügbar.');
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(studioEnvironment(), 0.02).texture;
    pmrem.dispose();
    scene.environment = envTex;

    const camera = new THREE.PerspectiveCamera(35, 1, 1, 20000);
    camera.position.set(0, -300, 900);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;

    scene.add(new THREE.AmbientLight(0xffffff, 0.3));
    const key = new THREE.DirectionalLight(0xffffff, 1.0);
    key.position.set(-300, 500, 800);
    scene.add(key);

    const content = new THREE.Group();
    scene.add(content);

    const ctx: Ctx = { renderer, scene, camera, controls, content, envTex, fittedFor: '' };
    ctxRef.current = ctx;

    const resize = () => {
      const w = host.clientWidth || 1;
      const h = host.clientHeight || 1;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();

    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      controls.update();
      renderer.render(scene, camera);
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      envTex.dispose();
      host.removeChild(renderer.domElement);
      ctxRef.current = null;
    };
  }, []);

  // Rebuild the scene content.
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const { content, scene } = ctx;
    for (const child of [...content.children]) {
      content.remove(child);
      child.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else if (mat) {
          const map = (mat as THREE.SpriteMaterial).map;
          if (map) map.dispose();
          mat.dispose();
        }
      });
    }
    if (!build || !build.pieces.length) return;

    const finished = mode === 'finished';
    const exploded = mode === 'exploded';
    scene.background = new THREE.Color(finished ? '#15171c' : '#e9ecef');
    ctx.renderer.toneMappingExposure = finished ? 1.0 : 1.05;

    // Overall bounds.
    const min = new THREE.Vector3(Infinity, Infinity, Infinity);
    const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    for (const p of build.pieces) {
      min.min(new THREE.Vector3(...p.min));
      max.max(new THREE.Vector3(...p.max));
    }
    const center = new THREE.Vector3().addVectors(min, max).multiplyScalar(0.5);
    const size = Math.max(max.x - min.x, max.y - min.y);
    const explode = exploded ? 0.22 : 0;

    const chrome = new THREE.MeshStandardMaterial({ color: 0xf4f6f8, metalness: 1, roughness: 0.08, envMapIntensity: 1.1 });
    build.pieces.forEach((p, i) => {
      const geo = geometryOf(p.mesh);
      const mat = finished
        ? chrome
        : new THREE.MeshStandardMaterial({
            color: p.fits ? PIECE_COLORS[i % PIECE_COLORS.length] : '#e63946',
            metalness: 0.05,
            roughness: 0.55,
          });
      const mesh = new THREE.Mesh(geo, mat);
      const pc = new THREE.Vector3((p.min[0] + p.max[0]) / 2, (p.min[1] + p.max[1]) / 2, 0);
      if (exploded) mesh.position.set((pc.x - center.x) * explode, (pc.y - center.y) * explode, 0);
      content.add(mesh);
      if (!finished && build.pieces.length > 1) {
        const s = labelSprite(p.label, p.fits ? '#111' : '#b00020');
        const k = Math.max(18, size * 0.035);
        s.scale.set(k * 2, k, 1);
        s.position.set(pc.x + mesh.position.x, pc.y + mesh.position.y, p.max[2] + 6);
        content.add(s);
      }
    });

    // Acrylic panes.
    const colorOf = (id: string) => palette.find((c) => c.id === id)?.hex ?? '#dddddd';
    const light = new THREE.Color(lightColor);
    for (const pane of build.panes) {
      const geo = geometryOf(pane.mesh, false);
      const col = new THREE.Color(colorOf(pane.fill));
      const mat = finished
        ? new THREE.MeshStandardMaterial({
            color: col,
            emissive: col.clone().multiply(light),
            emissiveIntensity: lightIntensity,
            roughness: 0.35,
            metalness: 0,
            transparent: true,
            opacity: 0.96,
          })
        : new THREE.MeshStandardMaterial({ color: col, roughness: 0.3, transparent: true, opacity: 0.55 });
      const mesh = new THREE.Mesh(geo, mat);
      if (exploded) {
        geo.computeBoundingBox();
        const bb = geo.boundingBox!;
        const pc = new THREE.Vector3().addVectors(bb.min, bb.max).multiplyScalar(0.5);
        mesh.position.set((pc.x - center.x) * explode, (pc.y - center.y) * explode, -Math.max(30, size * 0.12));
      }
      content.add(mesh);
    }

    if (!finished) {
      // Printer bed outline for scale (bottom left of the panel).
      const B = build.maxPiece;
      const bed = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.PlaneGeometry(B, B)),
        new THREE.LineBasicMaterial({ color: '#555' }),
      );
      bed.position.set(min.x - B / 2 - 20 - (exploded ? size * explode * 0.5 : 0), min.y + B / 2, 0);
      content.add(bed);
      const s = labelSprite(`${Math.round(B)} mm`, '#333', 'rgba(255,255,255,0.0)');
      s.scale.set(50, 25, 1);
      s.position.set(bed.position.x, bed.position.y, 2);
      content.add(s);
    }

    // Fit camera when the panel size changes notably.
    const key = `${Math.round(size / 20)}`;
    if (ctx.fittedFor !== key) {
      ctx.fittedFor = key;
      const dist = (size * (exploded ? 1.4 : 1.15)) / (2 * Math.tan((ctx.camera.fov * Math.PI) / 360));
      ctx.controls.target.copy(center);
      ctx.camera.position.set(center.x, center.y - dist * 0.35, dist);
      ctx.camera.near = Math.max(1, dist / 100);
      ctx.camera.far = dist * 20;
      ctx.camera.updateProjectionMatrix();
    }
  }, [build, palette, mode, lightColor, lightIntensity]);

  return (
    <div className="preview3d" ref={hostRef}>
      {error && <div className="preview-msg">{error}</div>}
      {busy && <div className="preview-busy">Berechne 3D …</div>}
      {!build && !busy && !error && <div className="preview-msg">Noch keine 3D-Vorschau</div>}
    </div>
  );
}
