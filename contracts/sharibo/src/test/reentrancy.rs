#![cfg(test)]

use super::*;
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Vec};

#[contracttype]
#[derive(Clone)]
struct ReentryConfig {
    target: Address,
    circle_id: u64,
    recipient: Address,
    nullifier_hash: Fr,
    external_nullifier: Fr,
    proof: Proof,
    mode: u32,
}

#[contracttype]
#[derive(Clone)]
enum DataKeyToken {
    Balance(Address),
    Reentry,
}

#[contract]
pub struct ReentrantToken;

#[contractimpl]
impl ReentrantToken {
    pub fn configure_reentry(
        env: Env,
        target: Address,
        circle_id: u64,
        recipient: Address,
        nullifier_hash: Fr,
        external_nullifier: Fr,
        proof: Proof,
        mode: u32,
    ) {
        let cfg = ReentryConfig {
            target,
            circle_id,
            recipient,
            nullifier_hash,
            external_nullifier,
            proof,
            mode,
        };
        env.storage().instance().set(&DataKeyToken::Reentry, &cfg);
    }

    pub fn mint(env: Env, to: Address, amount: i128) {
        let key = DataKeyToken::Balance(to.clone());
        let cur: i128 = env
            .storage()
            .instance()
            .get(&key)
            .unwrap_or(0i128);
        env.storage().instance().set(&key, &(cur + amount));
    }

    pub fn balance(env: Env, a: Address) -> i128 {
        env.storage()
            .instance()
            .get(&DataKeyToken::Balance(a))
            .unwrap_or(0i128)
    }

    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        // bookkeeping
        let fk = DataKeyToken::Balance(from.clone());
        let mut fbal: i128 = env.storage().instance().get(&fk).unwrap_or(0i128);
        fbal = fbal.checked_sub(amount).unwrap_or(0i128);
        env.storage().instance().set(&fk, &fbal);
        let tk = DataKeyToken::Balance(to.clone());
        let tbal: i128 = env.storage().instance().get(&tk).unwrap_or(0i128);
        env.storage().instance().set(&tk, &(tbal + amount));

        // maybe reenter
        if env.storage().instance().has(&DataKeyToken::Reentry) {
            let cfg: ReentryConfig = env.storage().instance().get(&DataKeyToken::Reentry).unwrap();
            if from == cfg.target {
                // call back into the Sharibo contract's `claim` entrypoint
                let client = ContractClient::new(&env, &cfg.target);
                client.claim(
                    &cfg.circle_id,
                    &cfg.recipient,
                    &cfg.nullifier_hash,
                    &cfg.external_nullifier,
                    &cfg.proof,
                );
            }
        }
    }
}

// ---- Tests ----

#[test]
#[should_panic(expected = "Error(Contract, #4)")]
fn reentrancy_same_nullifier_reverts_already_claimed() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(Contract, ());
    let client = ContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);

    // register our reentrant token
    let token = env.register(ReentrantToken, ());
    let token_client = ReentrantTokenClient::new(&env, &token);

    let root = real_root(&env);
    let vk = real_verification_key(&env);
    let circle_id = client.create_circle(&admin, &token, &root, &100i128, &1u32, &0u32, &vk);

    // fund the single-member circle
    let funder = Address::generate(&env);
    token_client.mint(&funder, &100i128);
    client.fund(&circle_id, &funder);

    // prepare a valid proof for round 0
    let nullifier_hash = real_nullifier_hash(&env);
    let external_nullifier = real_external_nullifier_round0(&env);
    let proof = real_valid_proof(&env);

    // configure the token to reenter with the SAME nullifier (should be rejected AlreadyClaimed)
    token_client.configure_reentry(
        &contract_id,
        &circle_id,
        &Address::generate(&env),
        &nullifier_hash,
        &external_nullifier,
        &proof,
        &0u32,
    );

    // claim: during transfer the token will reenter claim with the same nullifier
    let recipient = Address::generate(&env);
    client.claim(
        &circle_id,
        &recipient,
        &nullifier_hash,
        &external_nullifier,
        &proof,
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn reentrancy_different_nullifier_same_round_reverts() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(Contract, ());
    let client = ContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);

    let token = env.register(ReentrantToken, ());
    let token_client = ReentrantTokenClient::new(&env, &token);

    let root = real_root(&env);
    let vk = real_verification_key(&env);
    let circle_id = client.create_circle(&admin, &token, &root, &100i128, &1u32, &0u32, &vk);

    // fund
    let funder = Address::generate(&env);
    token_client.mint(&funder, &100i128);
    client.fund(&circle_id, &funder);

    // primary claim params
    let nullifier_hash = real_nullifier_hash(&env);
    let external_nullifier = real_external_nullifier_round0(&env);
    let proof = real_valid_proof(&env);

    // prepare a DIFFERENT nullifier for the reentrant attempt (same round)
    let reentrant_nullifier = real_nullifier_hash(&env) + Fr::from_u256(U256::from_u32(&env, 1));
    let reentrant_proof = proof.clone();

    token_client.configure_reentry(
        &contract_id,
        &circle_id,
        &Address::generate(&env),
        &reentrant_nullifier,
        &external_nullifier,
        &reentrant_proof,
        &0u32,
    );

    let recipient = Address::generate(&env);
    client.claim(
        &circle_id,
        &recipient,
        &nullifier_hash,
        &external_nullifier,
        &proof,
    );
}

#[test]
#[should_panic]
fn reentrancy_during_cancel_refunds() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(Contract, ());
    let client = ContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = env.register(ReentrantToken, ());
    let token_client = ReentrantTokenClient::new(&env, &token);

    let root = real_root(&env);
    let vk = real_verification_key(&env);
    let circle_id = client.create_circle(&admin, &token, &root, &100i128, &2u32, &0u32, &vk);

    // two funders
    let f1 = Address::generate(&env);
    let f2 = Address::generate(&env);
    token_client.mint(&f1, &100i128);
    token_client.mint(&f2, &100i128);
    client.fund(&circle_id, &f1);
    client.fund(&circle_id, &f2);

    // configure the token to reenter cancel during refund loop
    token_client.configure_reentry(
        &contract_id,
        &circle_id,
        &Address::generate(&env),
        &real_nullifier_hash(&env),
        &real_external_nullifier_round0(&env),
        &real_valid_proof(&env),
        &0u32,
    );

    // admin cancels — during refunds the token will try to reenter
    client.cancel_circle(&circle_id);
}
