// One-off generator for circuits/input.example.json: builds a tiny 3-member
// circle in a levels=4 tree and writes a genuinely provable witness for the
// member at index 1, claiming circleId=1, round=0. Run with:
//   node -r tsx/cjs scripts/gen-example-input.cjs
const fs = require("fs");
const path = require("path");
const {
  generateIdentity,
  computeExternalNullifier,
  FR_MODULUS,
} = require("../../packages/client/src/identity.ts");
const { MerkleTree } = require("../../packages/client/src/tree.ts");

const LEVELS = 4;
const CLAIMANT_INDEX = 1;
// circle_id=0 matches the first circle a fresh contract instance assigns,
// which is what contracts/sharibo/src/test.rs's fixtures are built against.
const CIRCLE_ID = 0n;
const ROUND = 0n;

// Mirrors Contract::compute_recipient_hash in contracts/sharibo/src/lib.rs:
// sha256 of the recipient's ScAddress XDR reduced mod the bls12381 field
// modulus. A contract address is the 40 bytes [0,0,0,18, 0,0,0,1] followed
// by its 32-byte key; k=1 reproduces the real_recipient_r0 hash the
// contract fixtures are bound to. Keep in sync with the contract, not with
// packages/client's computeRecipientHash (which hashes a raw 32-byte StrKey).
async function recipientHash(k) {
  const bytes = new Uint8Array(40);
  bytes[3] = 18; // SCVAL_ADDRESS
  bytes[7] = 1; // ScAddress::Contract
  bytes.fill(k, 8); // 32-byte contract key set to k (matches fixture_recipient_xdr)
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  let n = 0n;
  for (const b of digest) n = (n << 8n) | BigInt(b);
  return n % FR_MODULUS;
}

async function main() {
  const identities = Array.from({ length: 3 }, () => generateIdentity());
  const tree = MerkleTree.create(
    LEVELS,
    identities.map((id) => id.commitment),
  );
  const identity = identities[CLAIMANT_INDEX];
  const merkleProof = tree.proof(CLAIMANT_INDEX);
  const externalNullifier = await computeExternalNullifier(CIRCLE_ID, ROUND);

  // Deterministic recipient binding matching the on-chain fixtures (k=1).
  const recipientHashValue = await recipientHash(1);

  const input = {
    identityNullifier: identity.identityNullifier.toString(),
    identitySecret: identity.identitySecret.toString(),
    pathElements: merkleProof.pathElements.map((e) => e.toString()),
    pathIndices: merkleProof.pathIndices,
    root: merkleProof.root.toString(),
    externalNullifier: externalNullifier.toString(),
    recipientHash: recipientHashValue.toString(),
  };

  fs.writeFileSync(
    path.join(__dirname, "..", "input.example.json"),
    JSON.stringify(input, null, 2) + "\n",
  );
  console.log("wrote input.example.json for member index", CLAIMANT_INDEX);
  console.log(input);
}

main();
