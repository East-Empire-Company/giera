import { sweepAABB } from "./physics";

export type ActorMotionState = {
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  yaw: number;
  pitch: number;
  onGround: boolean;
  jumpHeight: number;
  flying: boolean;
};

export type ActorMoveInput = { forward: number; right: number; jump: boolean; sprint: boolean };
export type ActorStepResult = { landed: boolean; impactSpeed: number };
const WALK_SPEED = 4.3;
const SPRINT_SPEED = 5.6;
const GRAVITY = 32;
const AIR_CONTROL = 0.3;
const ACTOR_RADIUS = 0.3;
const ACTOR_HEIGHT = 1.8;

export function stepActor(
  world: (x: number, y: number, z: number) => boolean,
  state: ActorMotionState,
  input: ActorMoveInput,
  delta: number
): ActorStepResult {
  const speed = state.flying ? WALK_SPEED : input.sprint ? SPRINT_SPEED : WALK_SPEED;
  const cosPitch = Math.cos(state.pitch);
  let forwardX = -Math.sin(state.yaw) * cosPitch;
  let forwardY = state.flying ? -Math.sin(state.pitch) : 0;
  let forwardZ = -Math.cos(state.yaw) * cosPitch;
  const forwardLength = Math.hypot(forwardX, forwardY, forwardZ);
  if (forwardLength > 0) {
    forwardX /= forwardLength;
    forwardY /= forwardLength;
    forwardZ /= forwardLength;
  }
  let rightX = Math.cos(state.yaw);
  let rightZ = -Math.sin(state.yaw);
  const rightLength = Math.hypot(rightX, rightZ);
  if (rightLength > 0) {
    rightX /= rightLength;
    rightZ /= rightLength;
  }

  let wishX = forwardX * input.forward + rightX * input.right;
  let wishY = state.flying ? forwardY * input.forward : 0;
  let wishZ = forwardZ * input.forward + rightZ * input.right;
  if (state.flying) {
    if (input.jump) wishY += 1;
    if (input.sprint) wishY -= 1;
  }
  const wishLength = Math.hypot(wishX, wishY, wishZ);
  if (wishLength * wishLength > 0.001) {
    wishX /= wishLength;
    wishY /= wishLength;
    wishZ /= wishLength;
  }

  if (state.flying) {
    state.velocity.x = wishX * speed;
    state.velocity.y = wishY * speed;
    state.velocity.z = wishZ * speed;
  } else if (state.onGround) {
    state.velocity.x = wishX * speed;
    state.velocity.z = wishZ * speed;
    state.velocity.y = -1;
    if (input.jump) {
      state.velocity.y = Math.sqrt(2 * GRAVITY * state.jumpHeight);
      state.onGround = false;
    }
  } else {
    state.velocity.x += wishX * speed * AIR_CONTROL * delta;
    state.velocity.z += wishZ * speed * AIR_CONTROL * delta;
    state.velocity.y -= GRAVITY * delta;
  }

  const box = {
    minX: state.position.x - ACTOR_RADIUS,
    minY: state.position.y,
    minZ: state.position.z - ACTOR_RADIUS,
    maxX: state.position.x + ACTOR_RADIUS,
    maxY: state.position.y + ACTOR_HEIGHT,
    maxZ: state.position.z + ACTOR_RADIUS,
  };
  const movement = {
    x: state.velocity.x * delta,
    y: state.velocity.y * delta,
    z: state.velocity.z * delta,
  };
  let result = sweepAABB(world, box, movement);
  if (state.onGround && (result.hitAxis === "x" || result.hitAxis === "z")) {
    const stepBox = { ...box, minY: box.minY + 1, maxY: box.maxY + 1 };
    movement.y = 0;
    const stepped = sweepAABB(world, stepBox, movement);
    const directX = result.position.x - box.minX;
    const directZ = result.position.z - box.minZ;
    const steppedX = stepped.position.x - box.minX;
    const steppedZ = stepped.position.z - box.minZ;
    if (steppedX * steppedX + steppedZ * steppedZ > directX * directX + directZ * directZ + 1e-4) {
      const offsetX = stepped.position.x - stepBox.minX;
      const offsetZ = stepped.position.z - stepBox.minZ;
      stepBox.minX += offsetX;
      stepBox.maxX += offsetX;
      stepBox.minZ += offsetZ;
      stepBox.maxZ += offsetZ;
      movement.x = 0;
      movement.y = -1;
      movement.z = 0;
      result = sweepAABB(world, stepBox, movement);
    }
  }

  state.position.x = result.position.x + ACTOR_RADIUS;
  state.position.y = result.position.y;
  state.position.z = result.position.z + ACTOR_RADIUS;
  const wasAirborne = !state.onGround;
  const impactSpeed = -state.velocity.y;
  state.onGround = state.flying ? false : result.onGround;
  const landed = wasAirborne && state.onGround;
  if (result.hitAxis === "y") state.velocity.y = 0;
  if (result.hitAxis === "x") state.velocity.x = 0;
  if (result.hitAxis === "z") state.velocity.z = 0;

  return { landed, impactSpeed };
}

export function stepActorSubdivided(
  world: (x: number, y: number, z: number) => boolean,
  state: ActorMotionState,
  input: ActorMoveInput,
  deltaSeconds: number
): ActorStepResult {
  const delta = Math.max(0, Math.min(deltaSeconds, 0.25));
  const steps = Math.max(1, Math.ceil(delta / 0.05));
  const stepDelta = delta / steps;
  let landed = false;
  let impactSpeed = 0;
  for (let index = 0; index < steps; index += 1) {
    const result = stepActor(world, state, input, stepDelta);
    if (result.landed) {
      landed = true;
      impactSpeed = result.impactSpeed;
    }
  }
  return { landed, impactSpeed };
}
