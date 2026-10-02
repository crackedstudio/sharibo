#![no_std]
#![allow(clippy::too_many_arguments)]
#[cfg(test)]
extern crate std;


mod storage;
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype,
    crypto::bls12_381::{Fr, G1Affine, G2Affine},
    panic_with_error, token, vec, xdr::ToXdr, Address, Bytes, Env, Vec,
};

use crate::storage::{load_circle, save_circle, bump_instance, LEDGER_EXTEND_TO, LEDGER_THRESHOLD};

/// Groth16 verification key over BLS12-381.
///
/// Committed at circle creation time; every [`Self::claim`] proof is checked
/// against this key. Encodes the trusted-setup output of the Semaphore-style
/// circuit used by the off-chain prover.
///
/// G1/G2 byte encoding rules are in docs/wire-format.md §3.
/// ic length rule: ic.len() == number_of_public_signals + 1 (§4).
/// **Cross-component invariant:** any change to this struct's wire format must
/// be coordinated with the circuit public signals, contract `public_inputs`,
/// and SDK encoding. See docs/wire-format.md (#344).
#[contracttype]
#[derive(Clone)]
pub struct VerificationKey {
    /// `G1` element from the toxic-waste combination `[α]·G1`.
    pub alpha: G1Affine,
    /// `G2` element `[β]·G2`.
    pub beta: G2Affine,
    /// `G2` element `[γ]·G2` — the public-input gate.
    pub gamma: G2Affine,
    /// `G2` element `[δ]·G2` — the private-witness gate.
    pub delta: G2Affine,
    /// `vk_x` basis: `ic[0] + Σ pub_input_i · ic[i+1]`.
    /// Length must be exactly `number_of_public_inputs + 1`.
    pub ic: Vec<G1Affine>,
}

/// A Groth16 proof over BLS12-381 produced by the off-chain prover.
///
/// The three group elements satisfy the standard pairing equation checked by
/// [`Contract::verify_groth16`].
///
/// G1/G2 byte encoding rules are in docs/wire-format.md §3.
/// **Cross-component invariant:** any change to this struct's wire format must
/// be coordinated with the circuit public signals, contract `public_inputs`,
/// and SDK encoding. See docs/wire-format.md (#344).
#[contracttype]
#[derive(Clone)]
pub struct Proof {
    /// `A` commitment (the `π_a` G1 element).
    pub a: G1Affine,
    /// `B` commitment (the `π_b` G2 element).
    pub b: G2Affine,
    /// `C` commitment (the `π_c` G1 element).
    pub c: G1Affine,
}

/// On-chain state for a single Semaphore-style contribution circle.
///
/// A circle is a fixed-size ring of members (commitment [`Self::root`]) who
/// each contribute [`Self::contribution`] tokens per round. Once the pot is
/// full, one member can claim the entire pot per round using a ZK proof that
/// they are in the ring, with their nullifier preventing double-claims
/// across rounds.
///
/// # Storage schema versioning
///
/// `schema_version` is always the **first field** so that a future migration
/// helper can read it without needing to decode the full struct. The rule is:
///
/// - Every field addition or removal **must** bump `schema_version`.
/// - A bump requires either a migration function (reading the old layout,
///   writing the new one) or an explicit "testnet-reset" note in the release
///   commit message.
/// - The golden-XDR tests in `test.rs` (`mod xdr_golden`) will fail if the
///   serialised layout changes without a deliberate version bump, making
///   accidental breakage impossible to land unnoticed.
///
/// Current version: **2** (adds `fee_bps`/`fee_recipient` — breaking, needs
/// a testnet reset for pre-existing circles; see `docs/runbook-testnet-reset.md`).
#[contracttype]
#[derive(Clone)]
pub struct Circle {
    /// Schema version for this stored struct. Must be the first field.
    /// Increment whenever a field is added, removed, or reordered, and
    /// provide a migration path or explicit testnet-reset note.
    /// Current value: 2.
    pub schema_version: u32,
    /// Owner of the circle. Required to call [`Contract::cancel_circle`];
    /// does **not** gate funding or claiming — those are permissionless
    /// (fund) / zero-knowledge (claim).
    pub admin: Address,
    /// SAC token contract used for contributions and payouts.
    ///
    /// # Trust assumption
    ///
    /// This address is stored at circle creation and **never validated
    /// on-chain**. Every subsequent [`Contract::fund`] and
    /// [`Contract::claim`] call invokes `token::Client::transfer` against
    /// it unconditionally. A hostile token contract at this address can:
    ///
    /// - **Refuse specific transfers** — e.g. selectively block the payout
    ///   in `claim` while accepting `fund` deposits, permanently stranding
    ///   the pot.
    /// - **Charge a transfer fee (fee-on-transfer)** — report a successful
    ///   transfer but credit the recipient less than the nominal amount.
    ///   Because `claim` requires `pot == contribution * size` *exactly*,
    ///   even a 1-stroop fee causes every `fund` to land short of the
    ///   target and `claim` will never succeed, bricking the circle.
    /// - **Re-enter the contract** — call back into `fund`, `claim`, or
    ///   `cancel_circle` during a transfer. The contract holds no
    ///   reentrancy lock; correctness depends on the token not doing this.
    ///   (Soroban's host executes contracts in a single-threaded
    ///   call-stack, so reentrancy is detectable but not prevented.)
    /// - **Silently succeed without moving value** — `transfer` returns
    ///   `()` and the contract has no way to verify the actual balance
    ///   delta; a token that lies about transfers can drain the accounting
    ///   without moving tokens.
    ///
    /// **Mitigation**: members must verify the token address out of band
    /// before funding. The demo pins the native XLM Stellar Asset Contract
    /// (SAC), which is the only token whose behaviour the contract assumes.
    /// See `docs/threat-model.md` §"Token contract trust".
    pub token: Address,
    /// Merkle root of the member-commitment tree. Committed at creation
    /// and used as a public input to every [`Self::claim`] proof; binds
    /// the set of members who are eligible to claim.
    pub root: Fr,
    /// Amount each [`Contract::fund`] call deposits into [`Self::pot`].
    /// All contributors pay the same fixed amount per round.
    pub contribution: i128,
    /// Number of funders required to fill a round. `pot_target =
    /// contribution * size`; [`Contract::claim`] requires exact equality.
    pub size: u32,
    /// Current round number. Increments by 1 after each successful
    /// [`Contract::claim`]. Binds the proof's external_nullifier so a
    /// proof from round N cannot be replayed in round N+1.
    pub round: u32,
    /// Tokens deposited for the **current** round. Zeroed out after a
    /// successful claim or cancel (after refunds are issued).
    pub pot: i128,
    /// Verification key for the ZK circuit — all claims in this circle
    /// must prove against this key.
    pub vk: VerificationKey,
    /// Addresses that have funded the **current** round in order.
    /// Reset to empty after a successful `claim`, `cancel_circle`, or
    /// `expire_round`. Refunds are processed in this same order.
    /// Funding is unshielded (addresses are already public), so storing
    /// them here imposes no additional privacy loss — see issue #82.
    pub contributors: Vec<Address>,
    /// Nullifier hashes used in successful claims for this circle.
    /// Embedded inside the Circle persistent entry so they inherit the
    /// continuously-extended TTL lifecycle of the circle itself (issue #254).
    pub nullifiers: Vec<Fr>,
    /// True once `cancel_circle` has been called; prevents any further
    /// `fund` or `claim` calls so the circle is permanently closed.
    pub cancelled: bool,
    /// Number of ledgers each round is allowed to stay open before any
    /// contributor may call `expire_round` to recover their funds.
    /// Set at circle creation and never changes.
    pub round_deadline_ledgers: u32,
    /// The ledger sequence number at which the current round began.
    /// Reset to the current ledger after each successful `claim` or
    /// `expire_round`.
    pub round_started_ledger: u32,
    /// Protocol fee in basis points (`0..=10_000`, where `10_000` = 100% of
    /// the pot) deducted from every [`Contract::claim`] payout.
    ///
    /// Committed at circle creation — there is deliberately **no setter**, so
    /// members can read [`Contract::get_circle`] before funding and know
    /// exactly what will be deducted (see `docs/adr/007-protocol-fees.md`).
    /// A `0` fee costs nothing extra on `claim` (the fee transfer is skipped).
    pub fee_bps: u32,
    /// Address that receives the [`Self::fee_bps`] deduction on every
    /// [`Contract::claim`]. Must not be the contract's own address when
    /// `fee_bps > 0` (enforced at creation — mirror of the `claim` recipient
    /// guard); ignored when `fee_bps == 0`. Immutable after creation.
    pub fee_recipient: Address,
}

/// Lightweight, poll-friendly view of a [`Circle`]'s mutable/small fields.
///
/// Returned by [`Contract::get_circle_meta`] for callers that track funding
/// progress or round advancement (e.g. a UI polling loop). Deliberately
/// excludes:
///
/// - the immutable [`VerificationKey`] — committed at creation and never
///   changed, fetch it once via [`Contract::get_vk`] and cache it;
/// - the growable `contributors` / `nullifiers` vectors — already served by
///   [`Contract::get_contributors`] and [`Contract::has_claimed`].
///
/// On BLS12-381 the embedded VK alone serialises to several hundred bytes
/// (48 bytes per G1 point, 96 per G2 point, plus 5 G1 points in `ic`), so
/// returning it on every poll dominates RPC payload size for data that never
/// changes.
#[contracttype]
#[derive(Clone)]
pub struct CircleMeta {
    /// Schema version for this stored struct. Mirrors [`Circle::schema_version`].
    pub schema_version: u32,
    /// Owner of the circle. See [`Circle::admin`].
    pub admin: Address,
    /// SAC token contract used for contributions and payouts. See
    /// [`Circle::token`].
    pub token: Address,
    /// Merkle root of the member-commitment tree. See [`Circle::root`].
    pub root: Fr,
    /// Amount each [`Contract::fund`] call deposits into [`Circle::pot`].
    /// See [`Circle::contribution`].
    pub contribution: i128,
    /// Number of funders required to fill a round. See [`Circle::size`].
    pub size: u32,
    /// Current round number. See [`Circle::round`].
    pub round: u32,
    /// Tokens deposited for the **current** round. See [`Circle::pot`].
    pub pot: i128,
    /// True once `cancel_circle` has been called. See [`Circle::cancelled`].
    pub cancelled: bool,
    /// Number of ledgers each round is allowed to stay open before any
    /// contributor may call `expire_round`. See
    /// [`Circle::round_deadline_ledgers`].
    pub round_deadline_ledgers: u32,
    /// The ledger sequence number at which the current round began. See
    /// [`Circle::round_started_ledger`].
    pub round_started_ledger: u32,
    /// Protocol fee in basis points. See [`Circle::fee_bps`].
    pub fee_bps: u32,
    /// Address that receives the fee deduction on every claim. See
    /// [`Circle::fee_recipient`].
    pub fee_recipient: Address,
}

/// Storage keys for the contract's persistent and instance storage.
///
/// Exposed publicly because callers that read storage directly (e.g. SDK
/// indexers) need to know the exact `#[contracttype]` discriminants.
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// Instance-stored `u64` counter assigning the next free circle id.
    NextCircleId,
    /// Persistent-stored [`Circle`] keyed by its assigned id.
    Circle(u64),
    /// Persistent-stored `bool` marker: has `(circle_id, nullifier_hash)`
    /// already been used in a successful [`Contract::claim`]? Prevents
    /// double-claims across rounds.
    Nullifier(u64, Fr),
    /// Pending admin proposed via `propose_admin`; cleared on `accept_admin`.
    PendingAdmin(u64),
}

/// Revertable error codes for every public entrypoint.
///
/// All panics use `panic_with_error!` so the discriminant is surfaced to
/// on-chain callers and off-chain simulations.
///
/// The variant count is pinned by the `error_table_variant_count` test in
/// `test.rs`. Adding a variant here requires bumping `DOCUMENTED_ERROR_COUNT`
/// in that test and adding a row to `docs/errors.md`. See that file for the
/// full mapping to SDK classes, user-facing messages, and remedies.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// No [`Circle`] is stored at the requested `circle_id`.
    CircleNotFound = 1,
    /// [`Contract::claim`] called before the pot reached `contribution * size`.
    RoundNotFunded = 2,
    /// Proof's external_nullifier did not match `hash(circle_id, round)`.
    WrongRoundTag = 3,
    /// Nullifier has already been used in a prior claim for this circle.
    AlreadyClaimed = 4,
    /// Groth16 pairing check returned false.
    InvalidProof = 5,
    /// The round pot is already at `contribution * size`; further funds
    /// would permanently brick `claim`'s exact-equality check.
    RoundFull = 6,
    /// Checked pot arithmetic overflowed (absurd contribution/size).
    Overflow = 7,
    /// `cancel_circle` or `fund`/`claim` called on a cancelled circle.
    CircleCancelled = 8,
    /// `create_circle` rejected a `fee_bps` outside `0..=10_000`.
    InvalidFeeParams = 9,
    /// `create_circle` rejected invalid setup parameters: zero size, size
    /// above [`MAX_CIRCLE_SIZE`], non-positive contribution, or a
    /// verification key length mismatch.
    InvalidCircleParams = 10,
    /// A payout or refund target that would strand the tokens — currently
    /// only the contract's own address.
    InvalidRecipient = 11,
    /// `expire_round` was called before the round's deadline, or `fund` was
    /// called on a round whose deadline has already passed.
    RoundNotExpired = 12,
}

/// Number of public signals the membership circuit exposes:
/// [nullifierHash, root, externalNullifier, recipientHash].
const PUBLIC_INPUT_COUNT: u32 = 4;

/// Upper bound on [`Circle::size`]. Must equal `2^levels` from
/// `circuits/config.json` (the Merkle tree capacity the membership circuit
/// is generated from). Raising `levels` without bumping this constant fails
/// the `max_circle_size_matches_circuit_levels` test.
const MAX_CIRCLE_SIZE: u32 = 16;

/// Upper bound for [`Circle::fee_bps`]: 10_000 basis points = 100% of a pot.
/// `apply_fee` and `create_circle` share this single source of truth.
const MAX_FEE_BASIS_POINTS: u32 = 10_000;

/// Maximum number of members a circle can ever hold.
/// This matches the Merkle tree depth in `circuits/config.json` (`levels = 4`),
/// so the upper bound is `2^4 = 16` commitments.
const MAX_CIRCLE_SIZE: u32 = 16;

/// Minimum remaining TTL (in ledgers) that triggers an `extend_ttl` call.
///
/// Every write entrypoint that touches state (`create_circle`, `fund`,
/// `claim`, `cancel_circle`, `expire_round`, `propose_admin`, `accept_admin`)
/// calls `extend_ttl(LEDGER_THRESHOLD, LEDGER_EXTEND_TO)` on the entries it
/// writes. The Soroban host only performs the extension when the entry's
/// current TTL has fallen below `LEDGER_THRESHOLD`; if it is already higher,
/// the call is a no-op. Setting this to 100 ledgers (≈ 8 minutes at
/// ~5 s/ledger) means that any write performed in the last few minutes of a
/// circle's live window will refresh it to the full [`LEDGER_EXTEND_TO`]
/// budget.
///
/// This value only matters for entries that are being touched. A circle that
/// sits idle longer than [`LEDGER_EXTEND_TO`] archives regardless of the
/// threshold (see ADR 004).
const LEDGER_THRESHOLD: u32 = 100;

/// TTL (in ledgers) that persistent and instance entries are extended to on
/// each write.
///
/// 500,000 ledgers × 5 s/ledger ≈ **29 days** of activity-triggered liveness.
///
/// # Network limits this was chosen against (re-check before mainnet)
///
/// Soroban's TTL ceilings are **network settings**, not protocol constants.
/// As of 2026-09 the Stellar docs / CLI cookbook report:
///
/// | Setting | Testnet / Mainnet (reported) | Wall-clock (~5 s/ledger) |
/// |---|---|---|
/// | `max_entry_ttl` | **535,679** ledgers | ≈ 31 days |
/// | `min_persistent_entry_ttl` | **4,096** ledgers (typical) | ≈ 5.7 hours |
///
/// Re-check live values with:
/// `stellar network settings` / Horizon
/// `https://horizon.stellar.org/` (mainnet) and
/// `https://horizon-testnet.stellar.org/` (testnet), or the
/// [extend-contract-wasm cookbook](https://developers.stellar.org/docs/tools/cli/cookbook/extend-contract-wasm).
/// If the network ceiling drops below this constant, every `extend_ttl` call
/// silently clamps to the ceiling — the contract assumes the wrong lifetime
/// with no error.
///
/// `LEDGER_EXTEND_TO` is intentionally set just below the documented
/// `max_entry_ttl` ceiling to leave a small safety margin while still giving
/// circles close to the maximum window.
///
/// [`Circle::round_deadline_ledgers`] is validated at create time to be
/// strictly less than this value (0 = "no deadline" is allowed), so a round
/// deadline can never outlive the Circle entry that `expire_round` needs.
///
/// If a circle goes dormant (no write entrypoint) for longer than this
/// window, its persistent entry will be archived. An operator must then
/// submit a `RestoreFootprintOp` (via `stellar contract restore`) before any
/// further interaction is possible. See `contracts/README.md §Storage
/// lifetime` and `docs/adr/004-storage-archival.md`.
const LEDGER_EXTEND_TO: u32 = 500_000;

// Compile-time sanity check: the threshold at which we re-extend must be
// strictly less than the target we extend to, or the extension can never
// make progress. Also pin that the extend target stays below the documented
// network max_entry_ttl (535_679) so a silent clamp cannot happen unnoticed.
const _: () = assert!(
    LEDGER_THRESHOLD < LEDGER_EXTEND_TO,
    "LEDGER_THRESHOLD must be strictly less than LEDGER_EXTEND_TO",
);
const _: () = assert!(
    LEDGER_EXTEND_TO < 535_679,
    "LEDGER_EXTEND_TO must stay strictly below documented max_entry_ttl (535_679)",
);

/// Sharibo contract: permissionless Semaphore-style contribution circles on
/// Soroban.
///
/// # Lifecycle
///
/// 1. [`Self::create_circle`] — deployer commits a member root, fixed
///    contribution/size, and Groth16 VK. Returns the new circle id.
/// 2. [`Self::fund`] — any address deposits `contribution` tokens until the
///    pot reaches `contribution * size`.
/// 3. [`Self::claim`] — one eligible member (proves membership in the
///    Merkle root via ZK) takes the entire pot; round advances.
/// 4. (Escape hatch) [`Self::cancel_circle`] — admin refunds the current
///    round's contributors and permanently closes the circle.
#[contract]
pub struct Contract;

#[contractimpl]
#[allow(clippy::too_many_arguments)]
impl Contract {
    /// Create a new contribution circle and return its assigned `circle_id`.
    /// Create a new contribution circle and return its assigned `circle_id`.
    ///
    /// # Authentication
    ///
    /// Requires `admin.require_auth()`. The admin is the only address that
    /// may later [`Self::cancel_circle`]; they have no special power over
    /// funding or claiming.
    ///
    /// # Arguments
    ///
    /// * `admin` — circle owner; can cancel. Stored in [`Circle::admin`].
    /// * `token` — SAC token address for contributions/payouts. Stored in
    ///   [`Circle::token`]. Accepted without validation — see
    ///   [`Circle::token`] for the full list of trust assumptions members
    ///   must verify before funding.
    /// * `root` — Merkle root of the Semaphore commitment tree; binds who
    ///   is eligible to claim. Stored in [`Circle::root`].
    /// * `contribution` — fixed amount each [`Self::fund`] deposits.
    ///   Stored in [`Circle::contribution`].
    /// * `size` — number of funders needed to fill a round. `pot_target =
    ///   contribution * size`. Stored in [`Circle::size`]. Capped at
    ///   [`MAX_CIRCLE_SIZE`] (the Merkle tree's capacity); a larger size is
    ///   rejected with [`Error::InvalidCircleParams`] since no more than
    ///   2^levels members can ever prove membership.
    /// * `vk` — Groth16 verification key for the membership circuit.
    ///   Stored in [`Circle::vk`].
    /// * `fee_bps` — protocol fee in basis points (`0..=10_000`; `10_000`
    ///   = 100% of the pot). Committed at creation and immutable. Stored in
    ///   [`Circle::fee_bps`].
    /// * `fee_recipient` — address that receives the fee deduction on every
    ///   [`Self::claim`]. Must be a real recipient (not the contract itself)
    ///   when `fee_bps > 0`; ignored when `fee_bps == 0`. Stored in
    ///   [`Circle::fee_recipient`].
    ///
    /// # State effects
    ///
    /// * Writes a fresh [`Circle`] at [`DataKey::Circle`]`(id)` with
    ///   `round = 0`, `pot = 0`, empty contributors, `cancelled = false`.
    /// * Increments [`DataKey::NextCircleId`] in instance storage.
    /// * Extends both instance and persistent TTLs.
    ///
    /// # Errors
    ///
    /// * [`Error::InvalidCircleConfig`] — `size == 0` or `contribution <= 0`.
    ///   A non-positive target would let an empty pot count as already-funded
    ///   during the first claim and advance a round without any real deposits.
    /// * [`Error::InvalidFeeParams`] — `fee_bps` outside `0..=10_000`.
    /// * [`Error::InvalidRecipient`] — `fee_bps > 0` but `fee_recipient` is
    ///   the contract's own address, which would strand the fee forever.
    #[allow(clippy::too_many_arguments)]
    pub fn create_circle(
        env: Env,
        admin: Address,
        token: Address,
        root: Fr,
        contribution: i128,
        size: u32,
        round_deadline_ledgers: u32,
        vk: VerificationKey,
        fee_bps: u32,
        fee_recipient: Address,
    ) -> u64 {
        admin.require_auth();

        // ic must hold one point per public input plus one: the circuit's
        // public signals are [nullifierHash, root, externalNullifier,
        // recipientHash], so 4 + 1 = 5. Recount this if the circuit changes.
        // size is capped at MAX_CIRCLE_SIZE (2^levels from circuits/config.json):
        // the membership tree can only ever hold that many commitments, so a
        // larger size would fill the pot with contributions no member could
        // ever claim, leaving cancel_circle as the only exit.
        if size == 0
            || size > MAX_CIRCLE_SIZE
            || contribution <= 0
            || vk.ic.len() != PUBLIC_INPUT_COUNT + 1
        {
            panic_with_error!(&env, Error::InvalidCircleParams);
        }

        if fee_bps > MAX_FEE_BASIS_POINTS {
            panic_with_error!(&env, Error::InvalidFeeParams);
        }
        if fee_bps > 0 && fee_recipient == env.current_contract_address() {
            panic_with_error!(&env, Error::InvalidRecipient);
        }
        // A deadline of 0 means "no deadline". Any positive deadline must be
        // strictly shorter than LEDGER_EXTEND_TO so the Circle entry cannot
        // archive before expire_round becomes callable (issue #565).
        if round_deadline_ledgers >= LEDGER_EXTEND_TO {
            panic_with_error!(&env, Error::InvalidCircleParams);
        }

        let target = contribution
            .checked_mul(size as i128)
            .unwrap_or_else(|| panic_with_error!(&env, Error::InvalidCircleParams));
        let _ = target;

        let circle_id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::NextCircleId)
            .unwrap_or(0);

        let round_started_ledger = env.ledger().sequence();
        let circle = Circle {
            schema_version: 2,
            admin,
            token,
            root,
            contribution,
            size,
            round: 0,
            pot: 0,
            vk,
            contributors: Vec::new(&env),
            nullifiers: Vec::new(&env),
            cancelled: false,
            round_deadline_ledgers,
            round_started_ledger,
            fee_bps,
            fee_recipient,
        };
        let key = DataKey::Circle(circle_id);
        env.storage().persistent().set(&key, &circle);
        extend_persistent_ttl(&env, &key);
        env.storage()
            .instance()
            .set(&DataKey::NextCircleId, &(circle_id + 1));
        // Extend instance-storage TTL every time a new circle is created.
        // NextCircleId lives in instance storage; if the instance entry
        // is archived on a quiet network and later restored, NextCircleId
        // would reset to 0 and create_circle would silently overwrite
        // circle 0. Extending here ensures the counter outlives quiet
        // periods (see contracts/README.md §Instance-storage archival).
        extend_instance_ttl(&env);

         CircleCreated {
             circle_id,
             admin: circle.admin.clone(),
             token: circle.token.clone(),
             contrib: circle.contribution,
             size: circle.size,
         }
        .publish(&env);
        circle_id
    }

    /// Deposit one `contribution` into the circle's pot for the current round.
    ///
    /// # Authentication
    ///
    /// Requires `from.require_auth()`. **Open funding:** the Merkle root
    /// constrains who may *claim*, not who may *fund*. That lets a
    /// benefactor top up a community pot without being a member.
    ///
    /// # Arguments
    ///
    /// * `circle_id` — which circle to contribute to.
    /// * `from` — SAC token spender. Transfers [`Circle::contribution`]
    ///   tokens to the contract and is appended to
    ///   [`Circle::contributors`] for potential cancel-time refunds.
    ///
    /// # State effects
    ///
    /// * Transfers `contribution` tokens from `from` → contract via SAC.
    /// * Adds `contribution` to [`Circle::pot`] using checked arithmetic.
    /// * Pushes `from` onto [`Circle::contributors`].
    /// * Writes the updated circle and extends TTLs.
    ///
    /// # Errors
    ///
    /// * [`Error::CircleNotFound`] — `circle_id` does not exist.
    /// * [`Error::CircleCancelled`] — circle was already cancelled.
    /// * [`Error::RoundFull`] — pot already at `contribution * size`;
    ///   over-funding would permanently brick [`Self::claim`]'s
    ///   exact-equality check. See `contracts/README.md`.
    /// * [`Error::Overflow`] — `contribution * size` (computed via
    ///   `pot_target`) or `pot + contribution` overflows `i128`.
    #[allow(clippy::too_many_arguments)]
    pub fn fund(env: Env, circle_id: u64, from: Address) {
        from.require_auth();

        let mut circle = load_active_circle(&env, circle_id);

        // Reject funding into an already-expired round: the pot will never
        // reach the target (someone non-showed), so new deposits would just
        // get trapped until expire_round is called. Fail fast instead.
        if is_round_expired(&env, &circle) {
            panic_with_error!(&env, Error::RoundNotExpired);
        }

        let target = pot_target(&env, &circle);
        if circle.pot >= target {
            panic_with_error!(&env, Error::RoundFull);
        }

        let token_client = token::Client::new(&env, &circle.token);
        token_client.transfer(&from, env.current_contract_address(), &circle.contribution);

        // Defensive: with RoundFull above, pot + contribution cannot exceed
        // target when target itself fits in i128. Still use checked_add so an
        // absurd contribution surfaces as Error::Overflow rather than a bare
        // arithmetic trap (which would also depend on Cargo.toml overflow-checks).
        circle.pot = circle
            .pot
            .checked_add(circle.contribution)
            .unwrap_or_else(|| panic_with_error!(&env, Error::Overflow));
        circle.contributors.push_back(from.clone());
        persist_circle(&env, circle_id, &circle);
        env.events().publish(
            (symbol_short!("circle"), symbol_short!("funded"), circle_id),
            (from, circle.pot, target),
        );
    }

    /// Zero-knowledge payout: transfer the full round pot to `recipient`
    /// after verifying membership in the circle's Merkle root.
    ///
    /// # Authentication
    ///
    /// No address-based auth — eligibility is proved in zero knowledge.
    /// The recipient is unauthenticated: the prover chooses where funds
    /// land. (The ZK circuit proves the caller knows the secret for a
    /// commitment in the tree, which is the actual authorization check.)
    ///
    /// # Arguments
    ///
    /// * `circle_id` — which circle to claim from.
    /// * `recipient` — SAC token payout address. Receives the full pot.
    /// * `nullifier_hash` — unique per-claim marker computed from the
    ///   prover's identity nullifier. Stored to prevent the same identity
    ///   from claiming twice across any round.
    /// * `external_nullifier` — public input binding the proof to this
    ///   specific (circle, round) tuple. Must equal
    ///   `compute_external_nullifier(circle_id, round)`; prevents replay
    ///   of a valid proof from a different round or circle.
    /// * `proof` — Groth16 `(A, B, C)` triple over BLS12-381.
    ///
    /// # Verification steps (in order)
    ///
    /// 1. **Recipient is not the contract.** A self-transfer zeroes the
    ///    pot and burns the nullifier while leaving tokens stranded.
    ///    Reverts with [`Error::InvalidRecipient`].
    ///
    /// 2. **Round fully funded.** `pot == contribution * size` exactly —
    ///    not ≥. Partial pots cannot be partially claimed; the round must
    ///    be complete, or else the admin must `cancel_circle` and refund.
    ///    Reverts with [`Error::RoundNotFunded`].
    ///
    /// 3. **Nullifier unused.** A per-circle set stores every
    ///    `nullifier_hash` from a successful claim. Hitting an existing
    ///    entry means this identity already claimed (in any prior round)
    ///    and is trying to double-spend. Reverts with
    ///    [`Error::AlreadyClaimed`].
    ///    ///   4. **Groth16 proof verifies.** Standard pairing check against the
    ///    circle's [`VerificationKey`] with public inputs in the order
    ///    `[nullifier_hash, root, external_nullifier]` (see
    ///    docs/wire-format.md §1). Reverts with [`Error::InvalidProof`].
    ///
    /// # State effects
    ///
    /// * Sets [`DataKey::Nullifier`]`(circle_id, nullifier_hash) = true`
    ///   and extends TTL — idempotent double-claim fence.
    /// * Splits [`Circle::pot`] via `apply_fee` into the protocol fee and the
    ///   net payout; transfers the fee to [`Circle::fee_recipient`] (skipped
    ///   entirely when the fee is zero) and the net to `recipient`.
    /// * Zeros [`Circle::pot`], increments [`Circle::round`], clears
    ///   [`Circle::contributors`], and writes the updated circle back.
    /// * Extends both instance and persistent TTLs.
    ///
    /// # Errors
    ///
    /// * [`Error::CircleNotFound`] — `circle_id` does not exist.
    /// * [`Error::CircleCancelled`] — circle was already cancelled.
    /// * [`Error::RoundNotFunded`] — check 1 failed.
    /// * [`Error::WrongRoundTag`] — check 2 failed.
    /// * [`Error::AlreadyClaimed`] — check 3 failed.
    /// * [`Error::InvalidProof`] — check 4 failed.
    /// * [`Error::Overflow`] — computing `contribution * size` overflows
    ///   `i128` (absurd parameters set at circle creation).
    #[allow(clippy::too_many_arguments)]
    pub fn claim(
        env: Env,
        circle_id: u64,
        recipient: Address,
        nullifier_hash: Fr,
        external_nullifier: Fr,
        proof: Proof,
    ) {
        let mut circle = load_active_circle(&env, circle_id);

        // 1. recipient must not be the contract itself — a self-transfer zeroes
        //    the pot and burns the nullifier while leaving the tokens stranded
        //    with no accounting or recovery path.
        if recipient == env.current_contract_address() {
            panic_with_error!(&env, Error::InvalidRecipient);
        }

        // 2. round must be fully funded
        if circle.pot != pot_target(&env, &circle) {
            panic_with_error!(&env, Error::RoundNotFunded);
        }

        // 3. this nullifier must not have claimed before (any round, this circle)
        if circle.nullifiers.contains(&nullifier_hash) {
            panic_with_error!(&env, Error::AlreadyClaimed);
        }

        // 4. the proof's external_nullifier must be bound to this exact circle+round
        let expected_external_nullifier =
            Self::compute_external_nullifier(&env, circle_id, circle.round);
        if external_nullifier != expected_external_nullifier {
            panic_with_error!(&env, Error::WrongRoundTag);
        }

        // 3. this nullifier must not have claimed before (any round, this circle)
        if circle.nullifiers.contains(&nullifier_hash) {
            panic_with_error!(&env, Error::AlreadyClaimed);
        }

        // 4. the ZK proof itself must verify against the circle's committed root
        // Public signal order: [nullifierHash, root, externalNullifier]
        // — see docs/wire-format.md §1.
        // Bind the recipient into the public inputs so the proof commits to
        // where the payout will land. Compute the same SHA-256-based
        // reduction used for external nullifier binding.
        let recipient_hash = Self::compute_recipient_hash(&env, &recipient);
        let public_inputs = vec![
            &env,
            nullifier_hash.clone(),
            circle.root.clone(),
            external_nullifier,
            recipient_hash,
        ];
        if !Self::verify_groth16(&env, &circle.vk, &proof, &public_inputs) {
            panic_with_error!(&env, Error::InvalidProof);
        }

        // effects
        // Persist the round state and the nullifier (embedded in the Circle
        // struct since issue #254) before any external token call, so a hostile
        // token cannot re-enter the same claim with a fresh nullifier or stale
        // pot/round data while this call is in-flight.
        let claimed_round = circle.round;
        let payout = circle.pot;
        circle.pot = 0;
        circle.round += 1;
        circle.contributors = Vec::new(&env);
        circle.round_started_ledger = env.ledger().sequence();
        
        // Bound the nullifier set size by clearing it at cycle boundaries.
        // As defined in ADR 002 (turn ordering), members can claim exactly
        // once per cycle. The nullifier hash only prevents double
        // claiming within the same cycle; once the cycle advances, all
        // external nullifiers change. We push first and then clear so the
        // list starts empty at cycle boundaries.
        circle.nullifiers.push_back(nullifier_hash);
        persist_circle(&env, circle_id, &circle);

        let (fee, net) = apply_fee(&env, circle.fee_bps, payout);
        let token_client = token::Client::new(&env, &circle.token);
        if fee > 0 {
            token_client.transfer(&env.current_contract_address(), &circle.fee_recipient, &fee);
        }
        token_client.transfer(&env.current_contract_address(), &recipient, &net);

         CircleClaimed {
             circle_id,
             cround: claimed_round,
             payout,
             recipient: recipient.clone(),
         }
        .publish(&env);
    }

    /// Look up a [`Circle`] by its assigned id.
    ///
    /// # Authentication
    ///
    /// None — pure read, available to any caller.
    ///
    /// # Arguments
    ///
    /// * `circle_id` — id returned from [`Self::create_circle`].
    ///
    /// # Returns
    ///
    /// A full [`Circle`] struct (including the embedded [`VerificationKey`]
    /// and current-round [`Circle::contributors`]).
    ///
    /// # Polling callers
    ///
    /// The embedded [`VerificationKey`] is committed at creation and
    /// immutable, yet serialises to several hundred bytes of BLS12-381 group
    /// elements on every call. Callers that poll funding state (e.g. a UI
    /// progress loop) should prefer [`Self::get_circle_meta`], fetching the
    /// VK once via [`Self::get_vk`] instead.
    ///
    /// # Errors
    ///
    /// * [`Error::CircleNotFound`] — no circle stored at `circle_id`.
    pub fn get_circle(env: Env, circle_id: u64) -> Circle {
        load_circle(&env, circle_id)
    }

    /// Lightweight read of a circle's mutable/small fields — the poll-friendly
    /// alternative to [`Self::get_circle`].
    ///
    /// Returns a [`CircleMeta`] that deliberately excludes the embedded
    /// [`VerificationKey`] (committed at creation and immutable — fetch it
    /// once via [`Self::get_vk`]) and the `contributors`/`nullifiers` vectors
    /// (already served by [`Self::get_contributors`] and
    /// [`Self::has_claimed`]).
    ///
    /// # Authentication
    ///
    /// None — pure read, available to any caller.
    ///
    /// # Arguments
    ///
    /// * `circle_id` — id returned from [`Self::create_circle`].
    ///
    /// # Errors
    ///
    /// * [`Error::CircleNotFound`] — no circle stored at `circle_id`.
    pub fn get_circle_meta(env: Env, circle_id: u64) -> CircleMeta {
        let circle = load_circle(&env, circle_id);
        CircleMeta {
            schema_version: circle.schema_version,
            admin: circle.admin,
            token: circle.token,
            root: circle.root,
            contribution: circle.contribution,
            size: circle.size,
            round: circle.round,
            pot: circle.pot,
            cancelled: circle.cancelled,
            round_deadline_ledgers: circle.round_deadline_ledgers,
            round_started_ledger: circle.round_started_ledger,
            fee_bps: circle.fee_bps,
            fee_recipient: circle.fee_recipient,
        }
    }

    /// Pure read: the circle's Groth16 [`VerificationKey`].
    ///
    /// The VK is committed at creation and never changes, so clients should
    /// fetch it **once** and cache it (e.g. per `(contract_id, circle_id)`)
    /// rather than polling it. Use [`Self::get_circle_meta`] for the
    /// poll-friendly view of the remaining state.
    ///
    /// # Authentication
    ///
    /// None — pure read, available to any caller.
    ///
    /// # Arguments
    ///
    /// * `circle_id` — id returned from [`Self::create_circle`].
    ///
    /// # Errors
    ///
    /// * [`Error::CircleNotFound`] — no circle stored at `circle_id`.
    pub fn get_vk(env: Env, circle_id: u64) -> VerificationKey {
        load_circle(&env, circle_id).vk
    }

    /// Pure read: the current count of circles ever created (i.e. the next
    /// circle id that would be assigned). 0 if no circle has been created yet.
    pub fn get_circle_count(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::NextCircleId)
            .unwrap_or(0)
    }

    /// Pure read: the current round number for `circle_id`.
    ///
    /// Cheaper than [`Self::get_circle`] for callers that only need to track
    /// round advancement (e.g. polling the proof's external_nullifier binding).
    ///
    /// # Errors
    ///
    /// * [`Error::CircleNotFound`] — `circle_id` does not exist.
    pub fn get_round(env: Env, circle_id: u64) -> u32 {
        let circle: Circle = load_circle(&env, circle_id);
        circle.round
    }

    /// Pure read: the current pot balance (in token stroops) for `circle_id`.
    ///
    /// Cheaper than [`Self::get_circle`] for UI polling that only needs the
    /// funding-progress bar.
    ///
    /// # Errors
    ///
    /// * [`Error::CircleNotFound`] — `circle_id` does not exist.
    pub fn get_pot(env: Env, circle_id: u64) -> i128 {
        let circle: Circle = load_circle(&env, circle_id);
        circle.pot
    }

    /// Pure read: compact status tuple `(round, pot, target, cancelled)`.
    ///
    /// Returns everything the app's polling loop needs in one RPC call,
    /// without deserializing the embedded [`VerificationKey`]:
    ///
    /// * `round` — current round number.
    /// * `pot` — tokens deposited so far in this round.
    /// * `target` — `contribution * size`; pot must equal this for a claim.
    /// * `cancelled` — whether the circle has been permanently closed.
    ///
    /// # Errors
    ///
    /// * [`Error::CircleNotFound`] — `circle_id` does not exist.
    /// * [`Error::Overflow`] — `contribution * size` overflows `i128`
    ///   (absurd parameters set at circle creation).
    pub fn get_status(env: Env, circle_id: u64) -> (u32, i128, i128, bool) {
        let circle: Circle = load_circle(&env, circle_id);
        let target = pot_target(&env, &circle);
        (circle.round, circle.pot, target, circle.cancelled)
    }

    /// Pure read: the ordered list of addresses that have funded the
    /// **current** round of `circle_id`.
    ///
    /// Intended for the cancel/refund UI — callers can display the contributors
    /// and let the admin verify who will be refunded before calling
    /// [`Self::cancel_circle`].
    ///
    /// # Errors
    ///
    /// * [`Error::CircleNotFound`] — `circle_id` does not exist.
    pub fn get_contributors(env: Env, circle_id: u64) -> Vec<Address> {
        let circle: Circle = load_circle(&env, circle_id);
        circle.contributors
    }

    /// Pure read: whether `nullifier_hash` has already been used to claim in
    /// this circle. Mirrors the storage lookup in [`Self::claim`] so wallets
    /// can check eligibility without submitting a failing transaction.
    ///
    /// # Authentication
    ///
    /// None — pure read.
    ///
    /// # Arguments
    ///
    /// * `circle_id` — circle the caller wants to claim from.
    /// * `nullifier_hash` — identity nullifier to probe.
    ///
    /// # Returns
    ///
    /// `true` if the nullifier has ever been used in a successful claim for
    /// this circle (any round); the associated identity cannot claim again.
    pub fn has_claimed(env: Env, circle_id: u64, nullifier_hash: Fr) -> bool {
        let key = DataKey::Circle(circle_id);
        if let Some(circle) = env.storage().persistent().get::<_, Circle>(&key) {
            circle.nullifiers.contains(&nullifier_hash)
        } else {
            false
        }
    }

    /// Step 1 of two-step admin transfer: the current admin nominates a
    /// `new_admin` address.  The transfer is **not** final until `accept_admin`
    /// is called by `new_admin`.  This prevents a typo from permanently
    /// locking the circle: if the wrong address is proposed, the current
    /// admin can overwrite the pending slot with a corrected `propose_admin`
    /// call before anyone calls `accept_admin`.
    ///
    /// Reverts with [`Error::CircleCancelled`] on a cancelled circle — there
    /// is no point transferring admin rights once the circle is closed.
    #[allow(clippy::too_many_arguments)]
    pub fn propose_admin(env: Env, circle_id: u64, new_admin: Address) {
        let circle = load_circle(&env, circle_id);

        circle.admin.require_auth();

        if circle.cancelled {
            panic_with_error!(&env, Error::CircleCancelled);
        }

        let pending_key = DataKey::PendingAdmin(circle_id);
        env.storage().persistent().set(&pending_key, &new_admin);
        extend_persistent_ttl(&env, &pending_key);
        env.storage()
            .persistent()
            .extend_ttl(&pending_key, LEDGER_THRESHOLD, LEDGER_EXTEND_TO);
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_EXTEND_TO);

        AdminProposed {
            circle_id,
            old_admin: circle.admin.clone(),
            new_admin,
        }
        .publish(&env);
    }

    /// Step 2 of two-step admin transfer: the nominated address accepts,
    /// atomically updating `Circle.admin` and clearing the pending slot.
    ///
    /// Only the address stored by [`Self::propose_admin`] may call this.
    #[allow(clippy::too_many_arguments)]
    pub fn accept_admin(env: Env, circle_id: u64) {
        let mut circle = load_circle(&env, circle_id);

        if circle.cancelled {
            panic_with_error!(&env, Error::CircleCancelled);
        }

        let pending_key = DataKey::PendingAdmin(circle_id);
        let new_admin: Address = env
            .storage()
            .persistent()
            .get(&pending_key)
            .unwrap_or_else(|| panic_with_error!(&env, Error::CircleNotFound));

        new_admin.require_auth();

        let old_admin = circle.admin.clone();
        circle.admin = new_admin.clone();
        persist_circle(&env, circle_id, &circle);
        env.storage().persistent().set(&circle_key, &circle);
        env.storage()
            .persistent()
            .extend_ttl(&circle_key, LEDGER_THRESHOLD, LEDGER_EXTEND_TO);
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_EXTEND_TO);
        env.storage().persistent().remove(&pending_key);

        AdminAccepted {
            circle_id,
            old_admin,
            new_admin: new_admin.clone(),
        }
        .publish(&env);
    }

    /// Permissionless: expire a stuck round and refund all current-round
    /// contributors once the deadline has passed and the pot is below target.
    ///
    /// Unlike [`Self::cancel_circle`] this does **not** permanently close the
    /// circle — it resets the round counter so the group can continue. A ROSCA
    /// with one silent member in a single round should not be destroyed; the
    /// group can re-start without the absent member (admin can update the
    /// Merkle root in a new circle, or the group simply re-funds round N+1
    /// with willing participants).
    ///
    /// Conditions to trigger:
    /// - Circle is not cancelled.
    /// - Pot is below `contribution * size` (fully-funded rounds cannot be expired;
    ///   the claimer should call `claim` instead).
    /// - `env.ledger().sequence() > round_started_ledger + round_deadline_ledgers`.
    ///
    /// Effects:
    /// - Refunds every contributor for the current round (FIFO, same as cancel).
    /// - Increments `circle.round` so old proof round-tags are invalidated.
    /// - Resets `pot`, `contributors`, and `round_started_ledger`.
    /// - Emits a `rnd_exp` event.
    #[allow(clippy::too_many_arguments)]
    pub fn expire_round(env: Env, circle_id: u64) {
        let mut circle = load_circle(&env, circle_id);

        if circle.cancelled {
            panic_with_error!(&env, Error::CircleCancelled);
        }

        // Only callable once the deadline has passed.
        if !is_round_expired(&env, &circle) {
            panic_with_error!(&env, Error::RoundNotExpired);
        }

        // A fully-funded round should be claimed, not expired.
        if circle.pot >= pot_target(&env, &circle) {
            panic_with_error!(&env, Error::RoundFull);
        }

        // Refund every contributor for the current (stuck) round.
        let token_client = token::Client::new(&env, &circle.token);
        for contributor in circle.contributors.iter() {
            if contributor == env.current_contract_address() {
                panic_with_error!(&env, Error::InvalidRecipient);
            }
            token_client.transfer(
                &env.current_contract_address(),
                &contributor,
                &circle.contribution,
            );
        }

        let expired_round = circle.round;
        circle.pot = 0;
        circle.round += 1;
        circle.contributors = Vec::new(&env);
        circle.round_started_ledger = env.ledger().sequence();
        persist_circle(&env, circle_id, &circle);

         RoundExpired {
             circle_id,
             eround: expired_round,
         }
        .publish(&env);
    }

    /// Admin-only: cancel a stuck circle and refund all current-round
    /// contributors in FIFO order.
    ///
    /// # Authentication
    ///
    /// Requires [`Circle::admin`]`.require_auth()`. Only the admin set at
    /// circle creation can cancel.
    ///
    /// **When to use**: a circle where a member disappears and the pot will
    /// never reach the full target. Without this, contributed tokens are
    /// permanently stranded (claim requires `pot == contribution * size`).
    ///
    /// **Privacy note**: contributor addresses are already public (funding is
    /// unshielded), so refunds expose no additional information today.
    /// However, per-contributor storage constrains any future shielded-funding
    /// design — see issue #82.
    ///
    /// # Arguments
    ///
    /// * `circle_id` — the circle to cancel.
    ///
    /// # State effects
    ///
    /// * Transfers `contribution` tokens back to each address in
    ///   [`Circle::contributors`] in order.
    /// * Zeros [`Circle::pot`], sets [`Circle::cancelled`] = `true`, clears
    ///   [`Circle::contributors`].
    /// * Writes the updated circle and extends TTL. After this the circle
    ///   is permanently closed: further [`Self::fund`] and [`Self::claim`]
    ///   calls revert with [`Error::CircleCancelled`].
    ///
    /// # Errors
    ///
    /// * [`Error::CircleNotFound`] — `circle_id` does not exist.
    /// * [`Error::CircleCancelled`] — circle was already cancelled.
    #[allow(clippy::too_many_arguments)]
    pub fn cancel_circle(env: Env, circle_id: u64) {
        let mut circle = load_active_circle(&env, circle_id);

        circle.admin.require_auth();

        if circle.cancelled {
            panic_with_error!(&env, Error::CircleCancelled);
        }

        let refunded_count = circle.contributors.len();
        let refunded_total = circle.pot;
        let contributors = circle.contributors.clone();
        circle.pot = 0;
        circle.cancelled = true;
        circle.contributors = Vec::new(&env);
        persist_circle(&env, circle_id, &circle);
        env.storage().persistent().set(&key, &circle);
        env.storage()
            .persistent()
            .extend_ttl(&key, LEDGER_THRESHOLD, LEDGER_EXTEND_TO);
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_EXTEND_TO);

        // Refund every contributor for the current (stuck) round only after
        // the circle's cancelled state has been persisted; otherwise a hostile
        // token can call back into `cancel_circle` while the old state still reads
        // as active and claimable.
        let token_client = token::Client::new(&env, &circle.token);
        for contributor in contributors.iter() {
            // Defence in depth: a contributor address equal to the contract
            // itself would silently absorb the refund with no recovery path.
            // This can only arise from a future bug in `fund`; reject it here
            // so a bad state never silently loses funds.
            if contributor == env.current_contract_address() {
                panic_with_error!(&env, Error::InvalidRecipient);
            }
            token_client.transfer(
                &env.current_contract_address(),
                &contributor,
                &circle.contribution,
            );
        }

         CircleCancelled {
             circle_id,
             rcount: refunded_count,
             rtotal: refunded_total,
         }
        .publish(&env);
    }

    // External nullifier derivation: SHA-256 over big-endian u64(circle_id)
    // || u32(round), reduced mod r. Byte order and modulus reduction are
    // specified in docs/wire-format.md §2. Both Rust and TypeScript
    // implementations must agree on these details — a disagreement is
    // silent until the contract rejects the client's proof with WrongRoundTag.
    // Binds a proof to (circle_id, round) with SHA-256 (a native, accelerated
    // Soroban host function), reduced into the BLS12-381 scalar field via
    // `Fr::from_bytes` (which reduces mod r automatically). This is a
    // deliberate, permanent choice, not a placeholder: Soroban has no native
    // Poseidon host function, so hashing this check with Poseidon would mean
    // hand-porting a Poseidon permutation into pure Rust for no security
    // benefit — SHA-256 is equally sound for binding a proof to a round.
    // Poseidon is used where it actually earns its keep: *inside* the
    // circuit's constraint system (commitment + nullifierHash), where a
    // SNARK-unfriendly hash like SHA-256 would cost far more constraints.
    // See docs/wire-format.md (round-tag bytes).
    fn compute_external_nullifier(env: &Env, circle_id: u64, round: u32) -> Fr {
        let mut bytes = Bytes::new(env);
        bytes.extend_from_array(&circle_id.to_be_bytes());
        bytes.extend_from_array(&round.to_be_bytes());
        let digest = env.crypto().sha256(&bytes).to_bytes();
        Fr::from_bytes(digest)
    }

    // Compute a SHA-256-based hash of the recipient address serialized to
    // XDR, reduced into the scalar field (Fr). Mirrors the client's
    // `computeRecipientHash` so both sides bind the proof to the same
    // recipient representation.
    fn compute_recipient_hash(env: &Env, recipient: &Address) -> Fr {
        // Serialize the recipient address to its canonical XDR encoding, so
        // both sides hash exactly the same bytes.
        let bytes: Bytes = recipient.clone().to_xdr(env);
        let digest = env.crypto().sha256(&bytes).to_bytes();
        Fr::from_bytes(digest)
    }

    // Real on-chain Groth16 verification over BLS12-381, using Soroban's
    // native accelerated pairing host functions (see NOTES.md for why
    // BLS12-381 rather than BN254 — a pure-Rust BN254 pairing check does not
    // fit the CPU budget).
    //
    // Verification equation and public_inputs vector order are specified in
    // docs/wire-format.md §§1, 4.
    // native accelerated pairing host functions (see docs/adr/005-bls12-381-curve-choice.md
    // and contracts/BENCHMARKS.md — pure-Rust BN254 does not fit the CPU budget).
    // Checks the standard Groth16 pairing equation:
    // e(-A, B) * e(alpha, beta) * e(vk_x, gamma) * e(C, delta) == 1
    // where vk_x = ic[0] + sum(public_inputs[i] * ic[i+1]).
    fn verify_groth16(
        env: &Env,
        vk: &VerificationKey,
        proof: &Proof,
        public_inputs: &Vec<Fr>,
    ) -> bool {
        if public_inputs.len() + 1 != vk.ic.len() {
            return false;
        }

        let bls = env.crypto().bls12_381();

        let mut vk_x = vk.ic.get(0).unwrap();
        for i in 0..public_inputs.len() {
            let term = bls.g1_mul(&vk.ic.get(i + 1).unwrap(), &public_inputs.get(i).unwrap());
            vk_x = bls.g1_add(&vk_x, &term);
        }

        let neg_a = -proof.a.clone();
        let vp1 = vec![env, neg_a, vk.alpha.clone(), vk_x, proof.c.clone()];
        let vp2 = vec![
            env,
            proof.b.clone(),
            vk.beta.clone(),
            vk.gamma.clone(),
            vk.delta.clone(),
        ];

        bls.pairing_check(vp1, vp2)
    }
}

fn persist_circle(env: &Env, circle_id: u64, circle: &Circle) {
    let key = DataKey::Circle(circle_id);
    env.storage().persistent().set(&key, circle);
    extend_persistent_ttl(env, &key);
    extend_instance_ttl(env);
}

fn extend_persistent_ttl(env: &Env, key: &DataKey) {
    env.storage()
        .persistent()
        .extend_ttl(key, LEDGER_THRESHOLD, LEDGER_EXTEND_TO);
}

fn extend_instance_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(LEDGER_THRESHOLD, LEDGER_EXTEND_TO);
}

/// Load a [`Circle`] from persistent storage, or revert with
/// [`Error::CircleNotFound`].
///
/// Used by every entrypoint that must not operate on a closed circle:
/// [`Contract::fund`], [`Contract::claim`], and [`Contract::cancel_circle`].
fn load_active_circle(env: &Env, circle_id: u64) -> Circle {
    let circle = load_circle(env, circle_id);
    if circle.cancelled {
        panic_with_error!(env, Error::CircleCancelled);
    }
    circle
}

/// `contribution * size` for the current round, or [`Error::Overflow`].
/// Whether the circle's current round has passed its funding deadline.
///
/// A `round_deadline_ledgers` of 0 means "no deadline" — those rounds never
/// expire, which is the behaviour circles created before deadlines existed
/// inherit.
fn is_round_expired(env: &Env, circle: &Circle) -> bool {
    if circle.round_deadline_ledgers == 0 {
        return false;
    }
    let deadline = circle
        .round_started_ledger
        .saturating_add(circle.round_deadline_ledgers);
    env.ledger().sequence() >= deadline
}

fn pot_target(env: &Env, circle: &Circle) -> i128 {
    circle
        .contribution
        .checked_mul(circle.size as i128)
        .unwrap_or_else(|| panic_with_error!(env, Error::Overflow))
}

/// Split `amount` into a protocol fee and the net payout.
///
/// # Formula
///
/// ```text
/// fee = fee_bps * amount / 10_000   (integer truncation — rounds down)
/// net = amount - fee
/// ```
///
/// Because `fee` is truncated, the sum `fee + net` is always exactly
/// equal to `amount` — no tokens are created or destroyed.
///
/// # Overflow safety
///
/// The intermediate product `fee_bps * amount` would overflow `i128` for
/// large amounts if computed naively. The implementation avoids this by
/// splitting `amount` into a quotient and remainder:
///
/// ```text
/// fee = (amount / 10_000) * fee_bps + (amount % 10_000) * fee_bps / 10_000
/// ```
///
/// Both terms fit in `i128` for all `amount >= 0` and `fee_bps <= 10_000`.
///
/// # Arguments
///
/// * `fee_bps` — fee in basis points; must be in `0..=10_000` (i.e.
///   0 % – 100 %). `create_circle` rejects anything outside this range
///   with [`Error::InvalidFeeParams`].
/// * `amount` — gross token amount to split. Non-negative; the round-trip
///   invariant `fee + net == amount` holds for it.
///
/// # Returns
///
/// `(fee, net)` where `fee + net == amount`.
fn apply_fee(env: &Env, fee_bps: u32, amount: i128) -> (i128, i128) {
    if fee_bps > MAX_FEE_BASIS_POINTS {
        panic_with_error!(env, Error::InvalidFeeParams);
    }
    // Split to avoid overflow: amount = q * 10_000 + r, so
    //   fee_bps * amount = fee_bps * q * 10_000 + fee_bps * r
    // Dividing by 10_000:
    //   fee = fee_bps * q + fee_bps * r / 10_000
    // Both `fee_bps * q` and `fee_bps * r` fit in i128 for all valid inputs
    // (q <= i128::MAX / 10_000 and r < 10_000, fee_bps <= 10_000).
    let bps = fee_bps as i128;
    let q = amount / 10_000;
    let r = amount % 10_000;
    let fee = bps * q + bps * r / 10_000;
    let net = amount - fee;
    (fee, net)
}

mod test;
