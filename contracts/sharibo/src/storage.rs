use soroban_sdk::{panic_with_error, Env};

use crate::{Circle, DataKey, Error};

/// Minimum remaining TTL (in ledgers) that triggers an `extend_ttl` call.
///
/// The Soroban host only performs the extension when the entry's current TTL
/// has fallen below this threshold; if it is already higher, the call is a
/// no-op. Setting this to 100 ledgers (≈ 8 minutes at ~5 s/ledger) means
/// that any write performed in the last few minutes of a circle's live
/// window will refresh it to the full `LEDGER_EXTEND_TO` budget.
pub const LEDGER_THRESHOLD: u32 = 100;

/// TTL (in ledgers) that persistent and instance entries are extended to on
/// each write.
///
/// 500,000 ledgers × 5 s/ledger ≈ **29 days** of activity-triggered liveness.
///
/// The Soroban network cap for persistent entry TTL is **535,679 ledgers**
/// (≈ 30 days). `LEDGER_EXTEND_TO` is intentionally set just below that
/// ceiling to leave a small safety margin while still giving circles close
/// to the maximum window.
///
/// If a circle goes dormant for longer than this window, its persistent entry
/// will be archived. An operator must then submit a `RestoreFootprintOp`
/// before any further interaction is possible.
pub const LEDGER_EXTEND_TO: u32 = 500_000;

// Compile-time sanity check: the threshold at which we re-extend must be
// strictly less than the target we extend to, or the extension can never
// make progress.
const _: () = assert!(
    LEDGER_THRESHOLD < LEDGER_EXTEND_TO,
    "LEDGER_THRESHOLD must be strictly less than LEDGER_EXTEND_TO",
);

/// Load a [`Circle`] from persistent storage by its id.
///
/// Panics with [`Error::CircleNotFound`] if no circle is stored at `id`.
pub fn load_circle(env: &Env, id: u64) -> Circle {
    env.storage()
        .persistent()
        .get(&DataKey::Circle(id))
        .unwrap_or_else(|| panic_with_error!(env, Error::CircleNotFound))
}

/// Save a [`Circle`] to persistent storage and extend its TTL.
///
/// Also bumps the instance TTL (see [`bump_instance`]).
pub fn save_circle(env: &Env, id: u64, circle: &Circle) {
    let key = DataKey::Circle(id);
    env.storage().persistent().set(&key, circle);
    env.storage()
        .persistent()
        .extend_ttl(&key, LEDGER_THRESHOLD, LEDGER_EXTEND_TO);
    bump_instance(env);
}

/// Extend the instance-storage TTL.
///
/// Instance storage holds [`DataKey::NextCircleId`]; if the instance entry
/// is archived on a quiet network and later restored, `NextCircleId` would
/// reset to 0 and `create_circle` would silently overwrite circle 0.
/// Extending on every state-changing entrypoint ensures the counter outlives
/// quiet periods.
pub fn bump_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(LEDGER_THRESHOLD, LEDGER_EXTEND_TO);
}
