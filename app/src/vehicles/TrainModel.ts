import * as THREE from 'three';

const BODY_LENGTH = 20;
const BODY_WIDTH = 3.2;
const BODY_HEIGHT = 3.6;
const BODY_Y = 1.2;

/**
 * Build a single train car from Three.js primitives.
 * Uses metallic materials and glowing windows for a stylized look.
 */
export function buildTrainCar(
  color: THREE.ColorRepresentation,
  isHead: boolean,
  isTail: boolean,
): THREE.Group {
  const car = new THREE.Group();
  const baseColor = new THREE.Color(color);

  // Main body
  const bodyGeo = new THREE.BoxGeometry(BODY_WIDTH, BODY_HEIGHT, BODY_LENGTH);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: baseColor,
    metalness: 0.6,
    roughness: 0.3,
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = BODY_HEIGHT / 2 + BODY_Y;
  body.castShadow = true;
  car.add(body);

  // Roof
  const roofGeo = new THREE.BoxGeometry(BODY_WIDTH + 0.2, 0.3, BODY_LENGTH - 0.2);
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x333340, metalness: 0.8, roughness: 0.2 });
  const roof = new THREE.Mesh(roofGeo, roofMat);
  roof.position.y = BODY_HEIGHT + BODY_Y + 0.15;
  car.add(roof);

  // AC unit
  const acGeo = new THREE.BoxGeometry(1.8, 0.5, 6);
  const acMat = new THREE.MeshStandardMaterial({ color: 0x444455, metalness: 0.5, roughness: 0.5 });
  const ac = new THREE.Mesh(acGeo, acMat);
  ac.position.y = BODY_HEIGHT + BODY_Y + 0.55;
  car.add(ac);

  // Windows
  const winMat = new THREE.MeshStandardMaterial({
    color: 0x88ccff,
    emissive: 0x224466,
    emissiveIntensity: 0.8,
    metalness: 0.9,
    roughness: 0.1,
  });
  const windowCount = 6;
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 0; i < windowCount; i++) {
      const winGeo = new THREE.BoxGeometry(0.05, 1.2, 1.6);
      const win = new THREE.Mesh(winGeo, winMat);
      const zPos = -BODY_LENGTH / 2 + 2 + i * (BODY_LENGTH - 4) / (windowCount - 1);
      win.position.set(
        side * (BODY_WIDTH / 2 + 0.03),
        BODY_HEIGHT / 2 + BODY_Y + 0.4,
        zPos,
      );
      car.add(win);
    }
  }

  // Doors
  const doorMat = new THREE.MeshStandardMaterial({ color: 0x222233, metalness: 0.5, roughness: 0.4 });
  for (let side = -1; side <= 1; side += 2) {
    for (let d = -1; d <= 1; d += 2) {
      const doorGeo = new THREE.BoxGeometry(0.06, 2.4, 1.4);
      const door = new THREE.Mesh(doorGeo, doorMat);
      door.position.set(
        side * (BODY_WIDTH / 2 + 0.04),
        BODY_HEIGHT / 2 + BODY_Y - 0.3,
        d * 4.5,
      );
      car.add(door);
    }
  }

  // Undercarriage
  const underGeo = new THREE.BoxGeometry(BODY_WIDTH - 0.4, 0.6, BODY_LENGTH - 2);
  const underMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.3, roughness: 0.8 });
  const under = new THREE.Mesh(underGeo, underMat);
  under.position.y = 0.8;
  car.add(under);

  // Wheels
  const wheelGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.3, 12);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.8, roughness: 0.3 });
  for (let side = -1; side <= 1; side += 2) {
    for (let wz = -1; wz <= 1; wz += 2) {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(side * 1.6, 0.5, wz * 6);
      car.add(wheel);
    }
  }

  // Headlights (lead car)
  if (isHead) {
    const hlMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xffffcc,
      emissiveIntensity: 2.0,
    });
    for (let side = -1; side <= 1; side += 2) {
      const hlGeo = new THREE.SphereGeometry(0.2, 8, 8);
      const hl = new THREE.Mesh(hlGeo, hlMat);
      hl.position.set(side * 1.0, BODY_HEIGHT / 2 + BODY_Y - 0.5, BODY_LENGTH / 2 + 0.1);
      car.add(hl);
    }
    const boardGeo = new THREE.BoxGeometry(2.0, 0.5, 0.06);
    const boardMat = new THREE.MeshStandardMaterial({
      color: 0x111122,
      emissive: 0xff6600,
      emissiveIntensity: 0.5,
    });
    const board = new THREE.Mesh(boardGeo, boardMat);
    board.position.set(0, BODY_HEIGHT + 0.8, BODY_LENGTH / 2 + 0.05);
    car.add(board);
  }

  // Tail lights (rear car)
  if (isTail) {
    const tlMat = new THREE.MeshStandardMaterial({
      color: 0xff0000,
      emissive: 0xff0000,
      emissiveIntensity: 1.5,
    });
    for (let side = -1; side <= 1; side += 2) {
      const tlGeo = new THREE.SphereGeometry(0.15, 8, 8);
      const tl = new THREE.Mesh(tlGeo, tlMat);
      tl.position.set(side * 1.0, BODY_HEIGHT / 2 + BODY_Y - 0.5, -BODY_LENGTH / 2 - 0.1);
      car.add(tl);
    }
  }

  // Pantograph (middle cars)
  if (!isHead && !isTail) {
    const pantoMat = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.9, roughness: 0.2 });
    const armGeo = new THREE.CylinderGeometry(0.05, 0.05, 2.0, 6);
    for (let side = -1; side <= 1; side += 2) {
      const arm = new THREE.Mesh(armGeo, pantoMat);
      arm.rotation.z = side * 0.3;
      arm.position.set(side * 0.3, BODY_HEIGHT + BODY_Y + 1.0, 0);
      car.add(arm);
    }
    const contactGeo = new THREE.BoxGeometry(1.5, 0.06, 0.3);
    const contact = new THREE.Mesh(contactGeo, pantoMat);
    contact.position.y = BODY_HEIGHT + BODY_Y + 2.0;
    car.add(contact);
  }

  // Line-color stripe
  const stripeMat = new THREE.MeshStandardMaterial({
    color: baseColor,
    emissive: baseColor,
    emissiveIntensity: 0.3,
  });
  for (let side = -1; side <= 1; side += 2) {
    const stripeGeo = new THREE.BoxGeometry(0.06, 0.25, BODY_LENGTH - 0.5);
    const stripe = new THREE.Mesh(stripeGeo, stripeMat);
    stripe.position.set(side * (BODY_WIDTH / 2 + 0.04), 2.0, 0);
    car.add(stripe);
  }

  return car;
}
