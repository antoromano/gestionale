// src/utils/three-scenes.js
// Motore 3D & Fisica Interattiva con Three.js per Gestionale:
// 1. Knowledge Graph 3D Force-Directed (Coulomb Repulsion + Hooke Springs + Raycaster)
// 2. Cognitive Neural Orb 3D Reattivo (Geodesic Core + Wireframe Lattice)
// 3. Body Recovery Polyhedron 3D (Semaforo Muscolare 2-3 Giorni)
// 4. Micro-Fisica Spring Tilt per Card KPI

import * as THREE from 'three';

const activeDisposers = new WeakMap();

export function canUseWebGL() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  if (!window.WebGLRenderingContext) return false;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    return Boolean(gl);
  } catch {
    return false;
  }
}

function cleanupContainerScene(container) {
  if (!container) return;
  const prevDispose = activeDisposers.get(container);
  if (typeof prevDispose === 'function') {
    try {
      prevDispose();
    } catch {
      // ignore disposal errors
    }
    activeDisposers.delete(container);
  }
}

const NODE_COLORS_HEX = {
  person: 0x3b82f6,
  client: 0x10b981,
  technology: 0x8b5cf6,
  project: 0xf59e0b,
  exercise: 0xec4899,
  biometric: 0x06b6d4,
  concept: 0x6366f1,
  issue: 0xef4444,
};

/**
 * 1. GRAFO NEURALE 3D INTERATTIVO CON FISICA FORCE-DIRECTED (Sezione Second Brain)
 */
export function mountForceGraph3D(container, { nodes = [], edges = [], selectedNodeId = null, onSelectNode = null } = {}) {
  if (!container || !canUseWebGL()) return null;
  cleanupContainerScene(container);

  const width = Math.max(container.clientWidth || 640, 320);
  const height = Math.max(container.clientHeight || 380, 300);

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch {
    return null;
  }

  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  container.innerHTML = '';
  container.style.position = 'relative';
  container.appendChild(renderer.domElement);

  // Overlay per etichette 2D nitide ancorate alla proiezione 3D
  const labelsLayer = document.createElement('div');
  labelsLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;';
  container.appendChild(labelsLayer);

  const hudHint = document.createElement('div');
  hudHint.style.cssText = 'position:absolute;bottom:10px;left:12px;font-size:11px;color:#94a3b8;font-family:var(--font-mono, monospace);pointer-events:none;background:rgba(9,9,11,0.72);padding:4px 8px;border-radius:6px;border:1px solid rgba(255,255,255,0.08);';
  hudHint.textContent = 'Trascina per ruotare 3D • Scroll per zoom • Clicca un nodo per ispezionare 1-2 Hop';
  container.appendChild(hudHint);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(48, width / height, 0.1, 200);

  // Luci morbide fisiche
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.78);
  scene.add(ambientLight);

  const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.9);
  dirLight1.position.set(14, 18, 16);
  scene.add(dirLight1);

  const dirLight2 = new THREE.PointLight(0x8b5cf6, 0.7, 50);
  dirLight2.position.set(-14, -10, 12);
  scene.add(dirLight2);

  // Costruzione nodi fisici
  const simNodes = nodes.slice(0, 65).map((n, i) => {
    const angle = (i / Math.max(nodes.length, 1)) * Math.PI * 2;
    const radiusSpread = 5 + (i % 5) * 1.4;
    const isSelected = n.id === selectedNodeId;
    const deg = edges.filter(e => e.source_node_id === n.id || e.target_node_id === n.id).length;
    const sphereRadius = Math.min(0.85, 0.36 + deg * 0.06) * (isSelected ? 1.25 : 1);
    const hexColor = NODE_COLORS_HEX[n.node_type] || 0x6366f1;

    const geom = new THREE.SphereGeometry(sphereRadius, 24, 24);
    const mat = new THREE.MeshStandardMaterial({
      color: hexColor,
      roughness: 0.25,
      metalness: 0.18,
      emissive: hexColor,
      emissiveIntensity: isSelected ? 0.55 : 0.2,
    });
    const mesh = new THREE.Mesh(geom, mat);

    // Halo per il nodo selezionato
    if (isSelected) {
      const haloGeom = new THREE.RingGeometry(sphereRadius * 1.35, sphereRadius * 1.65, 32);
      const haloMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.75 });
      const halo = new THREE.Mesh(haloGeom, haloMat);
      mesh.add(halo);
    }

    const pos = new THREE.Vector3(
      Math.cos(angle) * radiusSpread,
      ((i % 7) - 3) * 1.4,
      Math.sin(angle) * radiusSpread
    );
    mesh.position.copy(pos);
    mesh.userData = { nodeId: n.id, label: n.label, nodeType: n.node_type };
    scene.add(mesh);

    const labelEl = document.createElement('div');
    labelEl.style.cssText = `
      position:absolute;
      transform:translate(-50%, -140%);
      font-size:${isSelected ? '11px' : '10px'};
      font-weight:${isSelected ? '700' : '500'};
      color:${isSelected ? '#ffffff' : '#e2e8f0'};
      background:${isSelected ? 'rgba(37,99,235,0.88)' : 'rgba(15,23,42,0.72)'};
      padding:2px 6px;
      border-radius:4px;
      white-space:nowrap;
      border:1px solid ${isSelected ? 'rgba(147,197,253,0.6)' : 'rgba(255,255,255,0.08)'};
      transition:opacity 0.15s;
    `;
    labelEl.textContent = n.label;
    labelsLayer.appendChild(labelEl);

    return {
      id: n.id,
      raw: n,
      mesh,
      labelEl,
      pos,
      vel: new THREE.Vector3(),
      force: new THREE.Vector3(),
      isSelected,
    };
  });

  const nodeMap = new Map(simNodes.map(sn => [sn.id, sn]));

  // Costruzione archi elastici
  const validEdges = edges
    .map(e => ({
      raw: e,
      source: nodeMap.get(e.source_node_id),
      target: nodeMap.get(e.target_node_id),
    }))
    .filter(e => e.source && e.target);

  const linePositions = new Float32Array(validEdges.length * 6);
  const lineColors = new Float32Array(validEdges.length * 6);
  const lineGeom = new THREE.BufferGeometry();
  lineGeom.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
  lineGeom.setAttribute('color', new THREE.BufferAttribute(lineColors, 3));

  const lineMat = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.65,
  });
  const lineSegments = new THREE.LineSegments(lineGeom, lineMat);
  scene.add(lineSegments);

  // Camera Orbit con Inerzia
  let sphericalTheta = 0.4;
  let sphericalPhi = 1.15;
  let orbitRadius = 17;
  let velTheta = 0.0018;
  let velPhi = 0;
  let isDragging = false;
  let dragMoved = false;
  let prevMouse = { x: 0, y: 0 };

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  const onPointerDown = (e) => {
    isDragging = true;
    dragMoved = false;
    prevMouse = { x: e.clientX, y: e.clientY };
  };

  const onPointerMove = (e) => {
    if (!isDragging) return;
    const dx = e.clientX - prevMouse.x;
    const dy = e.clientY - prevMouse.y;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragMoved = true;
    velTheta = -dx * 0.0065;
    velPhi = -dy * 0.0065;
    sphericalTheta += velTheta;
    sphericalPhi = Math.max(0.25, Math.min(Math.PI - 0.25, sphericalPhi + velPhi));
    prevMouse = { x: e.clientX, y: e.clientY };
  };

  const onPointerUp = (e) => {
    if (isDragging && !dragMoved && typeof onSelectNode === 'function') {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const intersects = raycaster.intersectObjects(simNodes.map(sn => sn.mesh));
      if (intersects.length > 0) {
        const hitNodeId = intersects[0].object.userData?.nodeId;
        if (hitNodeId) onSelectNode(hitNodeId);
      }
    }
    isDragging = false;
  };

  const onWheel = (e) => {
    e.preventDefault();
    orbitRadius = Math.max(7, Math.min(34, orbitRadius + e.deltaY * 0.012));
  };

  const domEl = renderer.domElement;
  domEl.style.cursor = 'grab';
  domEl.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  domEl.addEventListener('wheel', onWheel, { passive: false });

  // Step del motore fisico Force-Directed 3D (Coulomb + Hooke + Smorzamento)
  const stepPhysics = () => {
    const repulsionK = 2.6;
    const springK = 0.045;
    const restLength = 3.8;
    const centerGravity = 0.014;
    const damping = 0.85;

    for (const n of simNodes) {
      n.force.set(0, 0, 0);
    }

    // 1. Repulsione Coulombiana tra coppie di nodi
    for (let i = 0; i < simNodes.length; i++) {
      for (let j = i + 1; j < simNodes.length; j++) {
        const a = simNodes[i];
        const b = simNodes[j];
        const delta = new THREE.Vector3().subVectors(a.pos, b.pos);
        const distSq = Math.max(0.6, delta.lengthSq());
        const forceMag = repulsionK / distSq;
        delta.normalize().multiplyScalar(forceMag);
        a.force.add(delta);
        b.force.sub(delta);
      }
    }

    // 2. Attrazione elastica di Hooke lungo gli archi
    for (const edge of validEdges) {
      const a = edge.source;
      const b = edge.target;
      const delta = new THREE.Vector3().subVectors(b.pos, a.pos);
      const dist = Math.max(0.1, delta.length());
      const displacement = dist - restLength;
      const springForce = delta.normalize().multiplyScalar(springK * displacement);
      a.force.add(springForce);
      b.force.sub(springForce);
    }

    // 3. Gravità centripeta + integrazione velocità e posizione
    for (const n of simNodes) {
      const toCenter = n.pos.clone().multiplyScalar(-centerGravity);
      n.force.add(toCenter);
      n.vel.add(n.force).multiplyScalar(damping);
      // Limita velocità massima per stabilità
      if (n.vel.lengthSq() > 0.6) n.vel.normalize().multiplyScalar(0.75);
      n.pos.add(n.vel);
      n.mesh.position.copy(n.pos);
    }

    // Aggiorna geometria linee
    const posAttr = lineGeom.getAttribute('position');
    const colAttr = lineGeom.getAttribute('color');
    for (let i = 0; i < validEdges.length; i++) {
      const { source, target } = validEdges[i];
      const idx = i * 6;
      posAttr.array[idx] = source.pos.x;
      posAttr.array[idx + 1] = source.pos.y;
      posAttr.array[idx + 2] = source.pos.z;
      posAttr.array[idx + 3] = target.pos.x;
      posAttr.array[idx + 4] = target.pos.y;
      posAttr.array[idx + 5] = target.pos.z;

      const isHighlighted = source.isSelected || target.isSelected;
      const c = isHighlighted ? [0.38, 0.65, 0.98] : [0.42, 0.46, 0.58];
      colAttr.array[idx] = c[0];
      colAttr.array[idx + 1] = c[1];
      colAttr.array[idx + 2] = c[2];
      colAttr.array[idx + 3] = c[0];
      colAttr.array[idx + 4] = c[1];
      colAttr.array[idx + 5] = c[2];
    }
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
  };

  let rafId = null;
  let isVisible = true;
  const tempV = new THREE.Vector3();

  const animate = () => {
    if (!isVisible) return;
    rafId = requestAnimationFrame(animate);

    stepPhysics();

    if (!isDragging) {
      sphericalTheta += velTheta;
      velTheta *= 0.97;
      if (Math.abs(velTheta) < 0.0008) velTheta = 0.0008;
    }

    camera.position.x = orbitRadius * Math.sin(sphericalPhi) * Math.sin(sphericalTheta);
    camera.position.y = orbitRadius * Math.cos(sphericalPhi);
    camera.position.z = orbitRadius * Math.sin(sphericalPhi) * Math.cos(sphericalTheta);
    camera.lookAt(0, 0, 0);

    // Aggiorna coordinate etichette 2D
    const w = renderer.domElement.clientWidth || width;
    const h = renderer.domElement.clientHeight || height;
    for (const n of simNodes) {
      tempV.copy(n.pos);
      tempV.project(camera);
      if (tempV.z > 1) {
        n.labelEl.style.opacity = '0';
      } else {
        const x = (tempV.x * 0.5 + 0.5) * w;
        const y = (-(tempV.y * 0.5) + 0.5) * h;
        n.labelEl.style.opacity = n.isSelected ? '1' : '0.84';
        n.labelEl.style.left = `${x.toFixed(1)}px`;
        n.labelEl.style.top = `${y.toFixed(1)}px`;
      }
    }

    renderer.render(scene, camera);
  };

  const observer = typeof IntersectionObserver !== 'undefined'
    ? new IntersectionObserver((entries) => {
        isVisible = entries[0]?.isIntersecting ?? true;
        if (isVisible && !rafId) animate();
        else if (!isVisible && rafId) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
      })
    : null;
  if (observer) observer.observe(container);

  animate();

  const dispose = () => {
    if (rafId) cancelAnimationFrame(rafId);
    if (observer) observer.disconnect();
    domEl.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    domEl.removeEventListener('wheel', onWheel);
    simNodes.forEach(n => {
      n.mesh.geometry.dispose();
      n.mesh.material.dispose();
    });
    lineGeom.dispose();
    lineMat.dispose();
    renderer.dispose();
  };

  activeDisposers.set(container, dispose);
  return { dispose };
}

/**
 * 2. COGNITIVE NEURAL ORB 3D REATTIVO (Header Second Brain & Assistente IA)
 */
export function mountNeuralOrb3D(container, { size = 46, initialState = 'idle' } = {}) {
  if (!container || !canUseWebGL()) return null;
  cleanupContainerScene(container);

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch {
    return null;
  }

  renderer.setSize(size, size);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  container.innerHTML = '';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 20);
  camera.position.z = 3.4;

  const ambient = new THREE.AmbientLight(0xffffff, 0.8);
  scene.add(ambient);

  const pointLight = new THREE.PointLight(0x6366f1, 1.8, 10);
  pointLight.position.set(2, 2, 3);
  scene.add(pointLight);

  // Nucleo geodetico interno
  const coreGeom = new THREE.IcosahedronGeometry(0.72, 2);
  const coreMat = new THREE.MeshStandardMaterial({
    color: 0x4f46e5,
    emissive: 0x312e81,
    emissiveIntensity: 0.45,
    roughness: 0.2,
    metalness: 0.35,
    flatShading: true,
  });
  const coreMesh = new THREE.Mesh(coreGeom, coreMat);
  scene.add(coreMesh);

  // Reticolo wireframe esterno elastico
  const shellGeom = new THREE.IcosahedronGeometry(1.08, 1);
  const shellMat = new THREE.MeshBasicMaterial({
    color: 0x818cf8,
    wireframe: true,
    transparent: true,
    opacity: 0.55,
  });
  const shellMesh = new THREE.Mesh(shellGeom, shellMat);
  scene.add(shellMesh);

  let energyTarget = initialState === 'active' ? 1 : 0;
  let currentEnergy = energyTarget;
  let scaleVel = 0;
  let currentScale = 1;
  let t = 0;
  let rafId = null;

  const animate = () => {
    rafId = requestAnimationFrame(animate);
    t += 0.025 + currentEnergy * 0.055;

    // Integrazione elastica (molla smorzata) per transizione Idle <-> Active
    currentEnergy += (energyTarget - currentEnergy) * 0.08;
    const targetScale = 1 + currentEnergy * 0.14 + Math.sin(t * 2.2) * (0.03 + currentEnergy * 0.05);
    const springForce = (targetScale - currentScale) * 0.18;
    scaleVel = (scaleVel + springForce) * 0.82;
    currentScale += scaleVel;

    coreMesh.scale.setScalar(currentScale);
    shellMesh.scale.setScalar(1 + (currentScale - 1) * 0.65);

    coreMesh.rotation.y += 0.012 + currentEnergy * 0.035;
    coreMesh.rotation.x += 0.007 + currentEnergy * 0.02;
    shellMesh.rotation.y -= 0.008 + currentEnergy * 0.025;
    shellMesh.rotation.z += 0.006;

    coreMat.emissiveIntensity = 0.4 + currentEnergy * 0.65;
    renderer.render(scene, camera);
  };

  animate();

  const setEnergy = (state) => {
    energyTarget = state === 'active' ? 1 : 0;
  };

  const dispose = () => {
    if (rafId) cancelAnimationFrame(rafId);
    coreGeom.dispose();
    coreMat.dispose();
    shellGeom.dispose();
    shellMat.dispose();
    renderer.dispose();
  };

  activeDisposers.set(container, dispose);
  return { setEnergy, dispose };
}

/**
 * 3. VISUALIZZATORE 3D EQUILIBRIO MUSCOLARE & SEMAFORO RECUPERO 2-3 GIORNI (Sezione Body)
 */
export function mountBodyRecoveryCore3D(container, { columns = [], recoveryByCol = {}, onSelectColumn = null } = {}) {
  if (!container || !canUseWebGL()) return null;
  cleanupContainerScene(container);

  const width = Math.max(container.clientWidth || 240, 180);
  const height = Math.max(container.clientHeight || 130, 110);

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch {
    return null;
  }

  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  container.innerHTML = '';
  container.style.position = 'relative';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 50);
  camera.position.set(0, 0.6, 5.2);
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.AmbientLight(0xffffff, 0.85));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
  dirLight.position.set(4, 6, 5);
  scene.add(dirLight);

  const group = new THREE.Group();
  scene.add(group);

  // Nucleo centrale wireframe
  const coreGeom = new THREE.OctahedronGeometry(0.68, 0);
  const coreMat = new THREE.MeshStandardMaterial({
    color: 0x18181b,
    roughness: 0.3,
    metalness: 0.4,
    wireframe: true,
  });
  const coreMesh = new THREE.Mesh(coreGeom, coreMat);
  group.add(coreMesh);

  // Satelliti per ogni colonna esercizio colorati secondo il semaforo 2-3gg
  const satMeshes = [];
  const count = Math.max(columns.length, 1);

  columns.forEach((col, idx) => {
    const rec = recoveryByCol[col.id] || { status: 'optimal' };
    // optimal (2-3gg) -> Verde smeraldo | recovery (0-1gg) -> Blu | overdue (4+gg) -> Ambra/Rosso
    const hex = rec.status === 'optimal'
      ? 0x10b981
      : (rec.status === 'recovery' ? 0x3b82f6 : 0xf59e0b);

    const angle = (idx / count) * Math.PI * 2;
    const radius = 1.45;
    const yOffset = ((idx % 3) - 1) * 0.38;

    const satGeom = new THREE.SphereGeometry(0.22, 20, 20);
    const satMat = new THREE.MeshStandardMaterial({
      color: hex,
      emissive: hex,
      emissiveIntensity: rec.isRecommendedToday ? 0.5 : 0.2,
      roughness: 0.2,
      metalness: 0.2,
    });
    const sat = new THREE.Mesh(satGeom, satMat);
    sat.position.set(Math.cos(angle) * radius, yOffset, Math.sin(angle) * radius);
    sat.userData = { columnId: col.id, columnName: col.name };
    group.add(sat);
    satMeshes.push(sat);

    // Raggio di connessione al nucleo
    const pts = [new THREE.Vector3(0, 0, 0), sat.position.clone()];
    const rayGeom = new THREE.BufferGeometry().setFromPoints(pts);
    const rayMat = new THREE.LineBasicMaterial({ color: hex, transparent: true, opacity: 0.45 });
    group.add(new THREE.Line(rayGeom, rayMat));
  });

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  const onClick = (e) => {
    if (typeof onSelectColumn !== 'function') return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(satMeshes);
    if (hits.length > 0 && hits[0].object.userData?.columnId) {
      onSelectColumn(hits[0].object.userData.columnId);
    }
  };

  renderer.domElement.style.cursor = 'pointer';
  renderer.domElement.addEventListener('click', onClick);

  let rafId = null;
  let t = 0;
  const animate = () => {
    rafId = requestAnimationFrame(animate);
    t += 0.02;
    group.rotation.y += 0.009;
    group.position.y = Math.sin(t) * 0.06;
    renderer.render(scene, camera);
  };
  animate();

  const dispose = () => {
    if (rafId) cancelAnimationFrame(rafId);
    renderer.domElement.removeEventListener('click', onClick);
    coreGeom.dispose();
    coreMat.dispose();
    satMeshes.forEach(m => {
      m.geometry.dispose();
      m.material.dispose();
    });
    renderer.dispose();
  };

  activeDisposers.set(container, dispose);
  return { dispose };
}

/**
 * 4. MICRO-FISICA SPRING TILT PER LE CARD KPI
 */
export function attachSpringTiltCards(rootContainer) {
  if (!rootContainer || typeof window === 'undefined') return;
  const cards = rootContainer.querySelectorAll('.kpi-card-3d');
  cards.forEach(card => {
    if (card.dataset.tiltBound === '1') return;
    card.dataset.tiltBound = '1';

    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width - 0.5;
      const y = (e.clientY - rect.top) / rect.height - 0.5;
      const rotX = (-y * 5.5).toFixed(2);
      const rotY = (x * 5.5).toFixed(2);
      card.style.transform = `perspective(900px) rotateX(${rotX}deg) rotateY(${rotY}deg) translateY(-1px)`;
    });

    card.addEventListener('mouseleave', () => {
      card.style.transform = 'perspective(900px) rotateX(0deg) rotateY(0deg) translateY(0px)';
    });
  });
}

