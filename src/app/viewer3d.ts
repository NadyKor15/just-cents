// A small STL viewer for the 3D-model tile and the kit: solid, softly lit, three-quarter view, a contact shadow,
// no wireframe. Optionally the printer bed as an outline, to show what "does not fit" means.
import * as THREE from 'three';
import { parseStl, type Bed } from '../core/mesh';

export type ViewOptions = {
  color?: string;
  bed?: Bed; // draw the bed as an outline box (mm)
  spin?: boolean; // slow turn
  background?: string | null; // null = transparent
  label?: string; // e.g. "80 mm", drawn as a height bar next to the model
};

export function viewStl(canvas: HTMLCanvasElement, buf: ArrayBuffer, o: ViewOptions = {}): { stop(): void } {
  const W = canvas.clientWidth || canvas.width;
  const H = canvas.clientHeight || canvas.height;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: o.background === null, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(W, H, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  if (o.background !== null) scene.background = new THREE.Color(o.background ?? '#f4efef');

  // the figure lies in XY (Y up in the sprite), Z is its thickness: stand it up on the ground
  const m = parseStl(buf);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  geo.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
  const mat = new THREE.MeshStandardMaterial({ color: o.color ?? '#a866a4', roughness: 0.55, metalness: 0.0, flatShading: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const group = new THREE.Group();
  group.add(mesh);
  scene.add(group);

  const size = new THREE.Vector3();
  bb.getSize(size);
  let span = Math.max(size.x, size.y, size.z);
  if (o.bed) {
    const [bx, by, bz] = o.bed; // width, height, depth
    const box = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(bx, by, bz)),
      new THREE.LineDashedMaterial({ color: '#5d5258', dashSize: 6, gapSize: 4 }),
    );
    box.computeLineDistances();
    box.position.set(0, by / 2, 0);
    scene.add(box);
    span = Math.max(span, bx, by, bz);
  }
  if (o.label) {
    const bar = new THREE.Group();
    const h = size.y;
    const lineMat = new THREE.LineBasicMaterial({ color: '#2b2427' });
    const x = size.x / 2 + span * 0.12;
    const pts = [new THREE.Vector3(x, 0, 0), new THREE.Vector3(x, h, 0)];
    bar.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat));
    for (const y of [0, h]) bar.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x - span * 0.03, y, 0), new THREE.Vector3(x + span * 0.03, y, 0)]), lineMat));
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 96;
    const g = c.getContext('2d')!;
    g.font = '600 56px system-ui, sans-serif';
    g.fillStyle = '#2b2427';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText(o.label, 8, 48);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
    sp.scale.set(span * 0.27, span * 0.1, 1);
    sp.position.set(x + span * 0.17, h / 2, 0);
    bar.add(sp);
    scene.add(bar);
  }

  // ground that only shows the shadow
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(span * 8, span * 8), new THREE.ShadowMaterial({ opacity: 0.18 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  scene.add(new THREE.HemisphereLight('#ffffff', '#d8ccd0', 1.6));
  const sun = new THREE.DirectionalLight('#ffffff', 2.2);
  sun.position.set(span * 0.9, span * 1.6, span * 1.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  const sc = sun.shadow.camera as THREE.OrthographicCamera;
  sc.left = sc.bottom = -span;
  sc.right = sc.top = span;
  sc.near = 0.1;
  sc.far = span * 6;
  sun.shadow.radius = 6;
  scene.add(sun);

  const cam = new THREE.PerspectiveCamera(30, W / H, span * 0.01, span * 20);
  // frame the taller of model and bed, and lean right a little so the height bar and its label stay inside
  const tall = Math.max(size.y, o.bed ? o.bed[1] : 0);
  const target = new THREE.Vector3(o.label ? span * 0.14 : 0, tall * 0.5, 0);
  const dist = Math.max(span, tall) * 2.5;
  const place = (a: number) => {
    // three-quarter view: 35° around, slightly above
    cam.position.set(target.x + Math.sin(a) * dist, target.y + span * 0.35, Math.cos(a) * dist);
    cam.lookAt(target);
  };
  let angle = 0.6;
  place(angle);
  let raf = 0;
  let last = performance.now();
  const frame = (t: number) => {
    if (o.spin) {
      angle += ((t - last) / 1000) * 0.5;
      place(angle);
    }
    last = t;
    renderer.render(scene, cam);
    if (o.spin) raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return {
    stop() {
      cancelAnimationFrame(raf);
      renderer.dispose();
    },
  };
}
