import { InvalidInputError } from "./errors.js";
import type { ContractProof, ContractVerificationKey } from "./prove.js";

const FP_MODULUS = 0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaabn;

const G1_SIZE = 96;
const G2_SIZE = 192;
const FP_SIZE = 48;

function bytesToBigInt(bytes: Uint8Array): bigint {
  return BigInt("0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(""));
}

function validateFieldElement(bytes: Uint8Array, name: string): void {
  if (bytes.length !== FP_SIZE) {
    throw new InvalidInputError(`${name}: expected ${FP_SIZE} bytes, got ${bytes.length}`);
  }
  const value = bytesToBigInt(bytes);
  if (value >= FP_MODULUS) {
    throw new InvalidInputError(`${name}: must be < Fp modulus, got ${value}`);
  }
}

export function validateContractProof(proof: ContractProof): void {
  if (!(proof.a instanceof Uint8Array)) {
    throw new InvalidInputError("proof.a must be a Uint8Array");
  }
  if (!(proof.b instanceof Uint8Array)) {
    throw new InvalidInputError("proof.b must be a Uint8Array");
  }
  if (!(proof.c instanceof Uint8Array)) {
    throw new InvalidInputError("proof.c must be a Uint8Array");
  }

  if (proof.a.length !== G1_SIZE) {
    throw new InvalidInputError(`proof.a: expected ${G1_SIZE} bytes (G1), got ${proof.a.length}`);
  }
  if (proof.b.length !== G2_SIZE) {
    throw new InvalidInputError(`proof.b: expected ${G2_SIZE} bytes (G2), got ${proof.b.length}`);
  }
  if (proof.c.length !== G1_SIZE) {
    throw new InvalidInputError(`proof.c: expected ${G1_SIZE} bytes (G1), got ${proof.c.length}`);
  }

  for (let i = 0; i < 2; i++) {
    validateFieldElement(proof.a.slice(i * FP_SIZE, (i + 1) * FP_SIZE), `proof.a[${i}]`);
    validateFieldElement(proof.c.slice(i * FP_SIZE, (i + 1) * FP_SIZE), `proof.c[${i}]`);
  }

  for (let i = 0; i < 4; i++) {
    validateFieldElement(proof.b.slice(i * FP_SIZE, (i + 1) * FP_SIZE), `proof.b[${i}]`);
  }
}

export function validateContractVerificationKey(vk: ContractVerificationKey): void {
  if (!(vk.alpha instanceof Uint8Array)) {
    throw new InvalidInputError("vk.alpha must be a Uint8Array");
  }
  if (!(vk.beta instanceof Uint8Array)) {
    throw new InvalidInputError("vk.beta must be a Uint8Array");
  }
  if (!(vk.gamma instanceof Uint8Array)) {
    throw new InvalidInputError("vk.gamma must be a Uint8Array");
  }
  if (!(vk.delta instanceof Uint8Array)) {
    throw new InvalidInputError("vk.delta must be a Uint8Array");
  }
  if (!Array.isArray(vk.ic)) {
    throw new InvalidInputError("vk.ic must be an array");
  }

  if (vk.alpha.length !== G1_SIZE) {
    throw new InvalidInputError(`vk.alpha: expected ${G1_SIZE} bytes (G1), got ${vk.alpha.length}`);
  }
  if (vk.beta.length !== G2_SIZE) {
    throw new InvalidInputError(`vk.beta: expected ${G2_SIZE} bytes (G2), got ${vk.beta.length}`);
  }
  if (vk.gamma.length !== G2_SIZE) {
    throw new InvalidInputError(`vk.gamma: expected ${G2_SIZE} bytes (G2), got ${vk.gamma.length}`);
  }
  if (vk.delta.length !== G2_SIZE) {
    throw new InvalidInputError(`vk.delta: expected ${G2_SIZE} bytes (G2), got ${vk.delta.length}`);
  }

  for (let i = 0; i < 2; i++) {
    validateFieldElement(vk.alpha.slice(i * FP_SIZE, (i + 1) * FP_SIZE), `vk.alpha[${i}]`);
  }
  for (let i = 0; i < 4; i++) {
    validateFieldElement(vk.beta.slice(i * FP_SIZE, (i + 1) * FP_SIZE), `vk.beta[${i}]`);
    validateFieldElement(vk.gamma.slice(i * FP_SIZE, (i + 1) * FP_SIZE), `vk.gamma[${i}]`);
    validateFieldElement(vk.delta.slice(i * FP_SIZE, (i + 1) * FP_SIZE), `vk.delta[${i}]`);
  }

  if (vk.ic.length < 1) {
    throw new InvalidInputError("vk.ic: must have at least 1 entry");
  }

  for (let i = 0; i < vk.ic.length; i++) {
    const ic = vk.ic[i];
    if (!(ic instanceof Uint8Array)) {
      throw new InvalidInputError(`vk.ic[${i}]: expected Uint8Array`);
    }
    if (ic.length !== G1_SIZE) {
      throw new InvalidInputError(`vk.ic[${i}]: expected ${G1_SIZE} bytes (G1), got ${ic.length}`);
    }
    for (let j = 0; j < 2; j++) {
      validateFieldElement(ic.slice(j * FP_SIZE, (j + 1) * FP_SIZE), `vk.ic[${i}][${j}]`);
    }
  }
}
