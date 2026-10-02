//! CPU-instruction benchmarks: create_circle, fund, claim, larger IC.

use super::*;

// CPU-instruction harness: measures create_circle / fund / claim, plus a
// synthetic larger-IC Groth16 verify (more public inputs → more g1_mul).
// Tree depth does NOT change claim cost (circuit-only); IC length does.
// Numbers are printed and recorded in contracts/README.md (soroban-sdk 23.5.3).
#[test]
fn cpu_instruction_benchmarks() {
    // ---- create_circle ----
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(Contract, ());
    let client = ContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token(&env, &token_admin);
    let root = real_root(&env);
    let vk = real_verification_key(&env);
    client.create_circle(
        &admin,
        &token,
        &root,
        &100i128,
        &5u32,
        &0u32,
        &vk,
        &0u32,
        &Address::generate(&env),
    );
    let create_cpu = env.cost_estimate().budget().cpu_instruction_cost();
    std::println!("bench create_circle: {create_cpu} CPU instructions");

    // ---- fund (one member) ----
    let token_admin_client = token::StellarAssetClient::new(&env, &token);
    let member = Address::generate(&env);
    token_admin_client.mint(&member, &100i128);
    client.fund(&0u64, &member);
    let fund_cpu = env.cost_estimate().budget().cpu_instruction_cost();
    std::println!("bench fund:          {fund_cpu} CPU instructions");

    // Fund the remaining 4 so claim can run.
    for _ in 0..4 {
        let m = Address::generate(&env);
        token_admin_client.mint(&m, &100i128);
        client.fund(&0u64, &m);
    }

    // ---- claim (current: 4 public inputs, ic.len() == 5) ----
    let recipient = Address::generate(&env);
    let nullifier_hash = real_nullifier_hash(&env);
    let external_nullifier = real_external_nullifier_round0(&env);
    let proof = real_valid_proof(&env);

    for nullifier_count in [0, 10, 50, 200] {
        // inject nullifiers and reset round pot
        env.as_contract(&contract_id, || {
            let key = DataKey::Circle(0);
            let mut circle: Circle = env.storage().persistent().get(&key).unwrap();
            circle.pot = circle.contribution * (circle.size as i128); // fully fund it
            circle.round = 0; // reset round so the proof works
            circle.contributors = Vec::new(&env);
            
            // clear and inject dummy nullifiers
            circle.nullifiers = Vec::new(&env);
            let dummy = Fr::from_u256(soroban_sdk::U256::from_u32(&env, 9999));
            for _ in 0..nullifier_count {
                circle.nullifiers.push_back(dummy.clone());
            }
            env.storage().persistent().set(&key, &circle);
        });

        // make sure the identity nullifier we test isn't in the dummy list
        env.cost_estimate().budget().reset_default();
        client.claim(
            &0u64,
            &Address::generate(&env),
            &nullifier_hash,
            &external_nullifier,
            &proof,
        );
        let claim_cpu = env.cost_estimate().budget().cpu_instruction_cost();
        std::println!("bench claim ({} nullifiers):         {} CPU instructions", nullifier_count, claim_cpu);
    }


    // ---- larger IC (simulate 5 public inputs → ic.len() == 6) ----
    // Runs the same Groth16 path with 2 extra g1_mul terms. Proof will not
    // verify (dummy inputs); we only care about instruction cost.
    env.cost_estimate().budget().reset_default();
    let mut big_vk = real_verification_key(&env);
    let pad = big_vk.ic.get(0).unwrap();
    big_vk.ic.push_back(pad.clone());
    big_vk.ic.push_back(pad);
    let zero = Fr::from_u256(U256::from_u32(&env, 0));
    let big_inputs = vec![
        &env,
        nullifier_hash,
        root,
        external_nullifier,
        zero.clone(),
        zero,
    ];
    let _ = Contract::verify_groth16(&env, &big_vk, &proof, &big_inputs);
    let large_ic_cpu = env.cost_estimate().budget().cpu_instruction_cost();
    std::println!("bench verify_groth16 (5 public inputs / ic=6): {large_ic_cpu} CPU instructions");
}
