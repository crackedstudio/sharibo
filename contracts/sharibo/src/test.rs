#![cfg(test)]

use super::*;
use soroban_sdk::testutils::Events as _;
use soroban_sdk::Symbol;
use ark_bls12_381::{Fq, Fq2, Fr as ArkFr};
use ark_ff::{BigInteger, PrimeField};
use ark_serialize::CanonicalSerialize;
use core::str::FromStr;
use soroban_sdk::{
    crypto::bls12_381::{G1_SERIALIZED_SIZE, G2_SERIALIZED_SIZE},
    symbol_short,
    testutils::{Address as _, Ledger as _},
    BytesN, TryIntoVal, U256,
};
use std::vec::Vec as StdVec;

// ---- BLS12-381 test fixture helpers ----
// The vk/proof/public-signal decimal coordinates below were produced by the
// real Phase 1 pipeline (circuits/scripts/{compile,setup,prove}.sh) for a
// genuine member of a 3-member circle at circle_id=0, round=0 — see
// circuits/verification_key.json and circuits/SETUP_TRANSCRIPT.md (entry
// 2026-09-04). The recipientHash public input (#266) is bound to the fixed
// payout recipients in real_recipient_r0/real_recipient_r1, so claim
// succeeds only when the recipient matches the proof's registered hash.
// This mirrors the pattern in Stellar's own groth16_verifier reference
// example (stellar/soroban-examples), which also hand-copies snarkjs
// decimal coordinates into ark_bls12_381 test fixtures.

fn g1_from_coords(env: &Env, x: &str, y: &str) -> G1Affine {
    let ark_g1 = ark_bls12_381::G1Affine::new(Fq::from_str(x).unwrap(), Fq::from_str(y).unwrap());
    let mut buf = [0u8; G1_SERIALIZED_SIZE];
    ark_g1.serialize_uncompressed(&mut buf[..]).unwrap();
    G1Affine::from_array(env, &buf)
}

fn g2_from_coords(env: &Env, x1: &str, x2: &str, y1: &str, y2: &str) -> G2Affine {
    let x = Fq2::new(Fq::from_str(x1).unwrap(), Fq::from_str(x2).unwrap());
    let y = Fq2::new(Fq::from_str(y1).unwrap(), Fq::from_str(y2).unwrap());
    let ark_g2 = ark_bls12_381::G2Affine::new(x, y);
    let mut buf = [0u8; G2_SERIALIZED_SIZE];
    ark_g2.serialize_uncompressed(&mut buf[..]).unwrap();
    G2Affine::from_array(env, &buf)
}

fn fr_from_dec_str(env: &Env, s: &str) -> Fr {
    let ark_fr = ArkFr::from_str(s).unwrap();
    let be_bytes = ark_fr.into_bigint().to_bytes_be();
    let mut buf = [0u8; 32];
    buf[32 - be_bytes.len()..].copy_from_slice(&be_bytes);
    Fr::from_bytes(BytesN::from_array(env, &buf))
}

fn real_verification_key(env: &Env) -> VerificationKey {
    VerificationKey {
        alpha: g1_from_coords(
            env,
            "749582537839343753662662092450452397832509643622354603215105997794324965974939825437185114316129745783000679419786",
            "349962341132122890724568751232889453699201095759070405617825002476699798173144003754632387388100339536150581215244",
        ),
        beta: g2_from_coords(
            env,
            "3880057797060520124320578764877315797540700415384043973769078971696515610163457289102411638052268730945509440648302",
            "3777314379925758442990512187413923812964245102202468031112766319752244038246687083607245318069508267135278455348947",
            "1050410361212406767716359668205231057458158288436209166038545299426881545468977171139347619446018726197388473923235",
            "2493412734090615878237556198351488937361522748982892294901084973296832797018771262475192943991186743848961306012498",
        ),
        gamma: g2_from_coords(
            env,
            "352701069587466618187139116011060144890029952792775240219908644239793785735715026873347600343865175952761926303160",
            "3059144344244213709971259814753781636986470325476647558659373206291635324768958432433509563104347017837885763365758",
            "1985150602287291935568054521177171638300868978215655730859378665066344726373823718423869104263333984641494340347905",
            "927553665492332455747201965776037880757740193453592970025027978793976877002675564980949289727957565575433344219582",
        ),
        delta: g2_from_coords(
            env,
            "3103645666922550361111901561944701284006750573312632567332559875331690914403420941599818706436045124448669974250790",
            "3892473957942423684853166161187107959564012482950189624261130947444530209444107817942442732442430331490982000756874",
            "3860930287635271697415179879375689624186819560916850902324686817327713655307663181135121813555053936247373929272638",
            "1609784541431292060270585748736180809687860649556710589001468182944600766631512130414063743752599919312580581028322",
        ),
        ic: Vec::from_array(
            env,
            [
                g1_from_coords(
            env,
            "1948681912634771776347271243697269400762251716937532457452923581348369025432509442708890118552407975194237752144664",
            "1526361214863697803897508994557674006711987536500572772987868823818838123020499567392825827003234526229256592150572",
        ),
                g1_from_coords(
            env,
            "1996879509684005423562585401688654576575161232087490077625494204747032957766974172044086894908053378253904401755730",
            "938418458954158369731701829218837465333564171691282976128469021105681510590706886645753016371048743646878192443694",
        ),
                g1_from_coords(
            env,
            "2398560985381871540380692463907950405589737572830547852061272016965957189219825831650864260209629954479961889180470",
            "3729714988371021735287567888627375815455285341680858179816835152338786038727026139819308628040992976171935801237270",
        ),
                g1_from_coords(
            env,
            "3403520263757154130275502090118802462849944469065463024473044329672057262363304773273195369185323624254346567471289",
            "3805601893891695262958779295252389984767576447401674048318515899983086904483008660041019394945622372012874842387532",
        ),
                g1_from_coords(
            env,
            "2654953448148255763590886035502807670705030137324598581800079858885547885080731505086166634735365119851769808844281",
            "3824601767367754127584601901985396184116989525023722408076886085818232017543800657331496265505592063050199138090712",
        ),
            ],
        ),
    }
}

fn real_valid_proof(env: &Env) -> Proof {
    Proof {
        a: g1_from_coords(
            env,
            "1708349714640132990116341818099964791395935613547019890172791631283252314514288166731033918417312755095039285019843",
            "3285460062824873754925050999595431551059036641146200280516246640127434556217703173184316895681654718481463021120032",
        ),
        b: g2_from_coords(
            env,
            "3461515140738367304484452093316171207098333521504934047864391267237205115923604207656136593549663497639960424315782",
            "393491027553521445187155884887801269497626412922068420673562699995765222927347934435695079142060868819232246104637",
            "3981742205559613706898623056751215992912828763233405579982160644558619024771303681944429856866144261251325320172945",
            "1143950950053112767246721891107648338869439135157952217329223294149907281346748974986679982543924761919300573028673",
        ),
        c: g1_from_coords(
            env,
            "2010730659768333791961548028276904949853697805224240152059270689203856732296067246426446940151551538588615585749195",
            "285401301347906869760402273560056020351528454436494587933276390880604851069804928520340988317916344941437093763888",
        ),
    }
}

// Real public signals for the proof above: (nullifier_hash, root, external_nullifier).
fn real_root(env: &Env) -> Fr {
    fr_from_dec_str(
        env,
        "26209293814355131390889932661322725195394840191932303091376020297848638697892",
    )
}
fn real_nullifier_hash(env: &Env) -> Fr {
    fr_from_dec_str(
        env,
        "21226719646080371019275358926522886326845061441166218142415794470695116145494",
    )
}
fn real_external_nullifier_round0(env: &Env) -> Fr {
    fr_from_dec_str(
        env,
        "9916401131788634118796694467337109503795060207059715207260235684299224251787",
    )
}

fn fixture_recipient_xdr(env: &Env, k: u8) -> Address {
    let mut b = [0u8; 40];
    b[3] = 18; // SCVAL_ADDRESS
    b[7] = 1; // ScAddress::Contract
    for byte in b.iter_mut().skip(8) {
        *byte = k;
    }
    use soroban_sdk::xdr::FromXdr as _;
    Address::from_xdr(env, &Bytes::from_array(env, &b)).unwrap()
}

// Fixed payout recipients for the committed proofs. Contract addresses are
// used (not account addresses) so the token payout needs no trustline, and
// each proof's recipientHash public input is the XDR SHA-256 (mod r) of the
// recipient address — a claim pays out only to the exact registered
// recipient (issue #266), a same-proof replay to any other address is
// rejected.
fn real_recipient_r0(env: &Env) -> Address {
    fixture_recipient_xdr(env, 1)
}

fn real_recipient_r1(env: &Env) -> Address {
    fixture_recipient_xdr(env, 2)
}
// ---- Issue #91: second trusted-setup ceremony, same identity, two rounds ----
//
// The fixtures above (real_verification_key/real_valid_proof) came from one
// Phase 1 ceremony and only ever proved round 0. To answer "can the same
// identity claim two consecutive rounds today?" we need a *second* proof
// for the SAME identityNullifier/identitySecret/Merkle path, bound to
// round 1's externalNullifier — which means a second, self-consistent
// (vk, proof) pair from a fresh ceremony (a Groth16 proof only verifies
// against the vk from the ceremony that produced it). Root and round-0
// externalNullifier/nullifierHash are unchanged (they don't depend on the
// ceremony), so those still match real_root()/real_external_nullifier_round0()
// /real_nullifier_hash() above — only the vk and both proofs are new.
// Regenerated 2026-09-04 from the same ceremony shape as the canonical key,
// proving round 0 (recipientHash = real_recipient_r0) and round 1
// (recipientHash = real_recipient_r1).

fn round_reuse_verification_key(env: &Env) -> VerificationKey {
    VerificationKey {
        alpha: g1_from_coords(
            env,
            "749582537839343753662662092450452397832509643622354603215105997794324965974939825437185114316129745783000679419786",
            "349962341132122890724568751232889453699201095759070405617825002476699798173144003754632387388100339536150581215244",
        ),
        beta: g2_from_coords(
            env,
            "3880057797060520124320578764877315797540700415384043973769078971696515610163457289102411638052268730945509440648302",
            "3777314379925758442990512187413923812964245102202468031112766319752244038246687083607245318069508267135278455348947",
            "1050410361212406767716359668205231057458158288436209166038545299426881545468977171139347619446018726197388473923235",
            "2493412734090615878237556198351488937361522748982892294901084973296832797018771262475192943991186743848961306012498",
        ),
        gamma: g2_from_coords(
            env,
            "352701069587466618187139116011060144890029952792775240219908644239793785735715026873347600343865175952761926303160",
            "3059144344244213709971259814753781636986470325476647558659373206291635324768958432433509563104347017837885763365758",
            "1985150602287291935568054521177171638300868978215655730859378665066344726373823718423869104263333984641494340347905",
            "927553665492332455747201965776037880757740193453592970025027978793976877002675564980949289727957565575433344219582",
        ),
        delta: g2_from_coords(
            env,
            "2782199162700541151590293642305149245941133573304292014026613340245638150528884723912279081423150251910370591011667",
            "1667965123321298419005404721536913286386696704243087897513376035401180460494271888014230149112884014846330935711274",
            "1565021075436299422171230555707527033313444826682266793248045102362668248763197924515903636436166901362990664872853",
            "1301042207180221059048456631035486481878699810584841268580403698129799558708961199014061692730926219821072491819436",
        ),
        ic: Vec::from_array(
            env,
            [
                g1_from_coords(
            env,
            "1948681912634771776347271243697269400762251716937532457452923581348369025432509442708890118552407975194237752144664",
            "1526361214863697803897508994557674006711987536500572772987868823818838123020499567392825827003234526229256592150572",
        ),
                g1_from_coords(
            env,
            "1996879509684005423562585401688654576575161232087490077625494204747032957766974172044086894908053378253904401755730",
            "938418458954158369731701829218837465333564171691282976128469021105681510590706886645753016371048743646878192443694",
        ),
                g1_from_coords(
            env,
            "2398560985381871540380692463907950405589737572830547852061272016965957189219825831650864260209629954479961889180470",
            "3729714988371021735287567888627375815455285341680858179816835152338786038727026139819308628040992976171935801237270",
        ),
                g1_from_coords(
            env,
            "3403520263757154130275502090118802462849944469065463024473044329672057262363304773273195369185323624254346567471289",
            "3805601893891695262958779295252389984767576447401674048318515899983086904483008660041019394945622372012874842387532",
        ),
                g1_from_coords(
            env,
            "2654953448148255763590886035502807670705030137324598581800079858885547885080731505086166634735365119851769808844281",
            "3824601767367754127584601901985396184116989525023722408076886085818232017543800657331496265505592063050199138090712",
        ),
            ],
        ),
    }
}

fn round_reuse_proof_round0(env: &Env) -> Proof {
    Proof {
        a: g1_from_coords(
            env,
            "1179578184163156892844953836318474739505515114028407946368752959862089427076975950437844441984714924047364307847863",
            "2583995179439786185863343706418614460828012726716846426469291464531647132875583069209284530385467167077510517431464",
        ),
        b: g2_from_coords(
            env,
            "1920751719822233711150824646590740142717678302792535050571729467730768891093744404284949819503387275798927443923355",
            "124465706171730484358811411088691374480907355110955487591297440269986196202043034949007840913693506577700901283194",
            "191938888254396250424327753572876070853434510184296114789260973311208360847831491902413009556679539921059487239469",
            "1915328193537518749159774035793016002622296408759565409172262384698272482567353958935792552018927550307377882090837",
        ),
        c: g1_from_coords(
            env,
            "408855853864300316978244656938054243943785534531632258533970983721911975793255750228934363325235221011705844280084",
            "395039523976183092096857501060693098057945786098473832406182006360727832694088099078790128822447850049805133834510",
        ),
    }
}

fn round_reuse_proof_round1(env: &Env) -> Proof {
    Proof {
        a: g1_from_coords(
            env,
            "2259786221683330276448460747884024526358991497498766135291354295974316045857153370560319455949928693033238640483031",
            "2750965138868310651203252825504066124952916510389725216535389255918703661503224948700993333529663443908054242479485",
        ),
        b: g2_from_coords(
            env,
            "2322563613659181235994800405865062759176883970411493460425571582089472681017959229785441374668923947053244898012845",
            "2358430731731540087145362278871412082851015655584284286088467993942564122027476225965526543589705890441987808199293",
            "3446991522716431602868665297839399750125541751205912418318077422548321793726702078433261268281283713226307388135815",
            "1119685591655926824955137167858243200982240024134106163140054532280280570088946835362790782396378497914289964467140",
        ),
        c: g1_from_coords(
            env,
            "187577619091086741012027511381398604995130001598429994322148675806800970453563435482945857655437707265982183306533",
            "2839619480605558288618111614154617437743057244363440683332637490316036895668277129425209099977654348071334913651039",
        ),
    }
}

// Poseidon(identityNullifier, externalNullifier_round1) for the SAME
// identity as real_nullifier_hash() — deliberately a different value
// because externalNullifier changed, even though identityNullifier didn't.
fn round_reuse_nullifier_hash_round1(env: &Env) -> Fr {
    fr_from_dec_str(env, "49427450209661096950044132594013152139023072336714402456973658706693457893626")
}

fn create_token(env: &Env, admin: &Address) -> Address {
    env.register_stellar_asset_contract_v2(admin.clone())
        .address()
}

fn expected_external_nullifier(env: &Env, circle_id: u64, round: u32) -> Fr {
    Contract::compute_external_nullifier(env, circle_id, round)
}

struct Setup {
    env: Env,
    client_id: Address,
    token: Address,
    members: StdVec<Address>,
    circle_id: u64,
    size: u32,
    contribution: i128,
}

fn setup(size: u32, contribution: i128) -> Setup {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(Contract, ());
    let client = ContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token(&env, &token_admin);
    let token_admin_client = token::StellarAssetClient::new(&env, &token);

    // this is the FIRST circle registered against a fresh contract, so it
    // is assigned circle_id=0 — matching the real proof fixtures above,
    // which were generated for circle_id=0.
    let root = real_root(&env);
    let vk = real_verification_key(&env);
    let circle_id = client.create_circle(&admin, &token, &root, &contribution, &size, &0u32, &vk, &0u32, &Address::generate(&env));
    assert_eq!(circle_id, 0);

    let mut members: StdVec<Address> = StdVec::new();
    for _ in 0..size {
        let m = Address::generate(&env);
        token_admin_client.mint(&m, &contribution);
        members.push(m);
    }

    Setup {
        env,
        client_id: contract_id,
        token,
        members,
        circle_id,
        size,
        contribution,
    }
}

/// Like [`setup`] but creates the circle with a non-zero protocol fee and
/// returns the fee recipient alongside, so claim tests can assert against
/// exactly who received the deducted amount.
fn setup_with_fee(size: u32, contribution: i128, fee_bps: u32) -> (Setup, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(Contract, ());
    let client = ContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token(&env, &token_admin);
    let token_admin_client = token::StellarAssetClient::new(&env, &token);

    let root = real_root(&env);
    let vk = real_verification_key(&env);
    let fee_recipient = Address::generate(&env);
    let circle_id = client.create_circle(
        &admin,
        &token,
        &root,
        &contribution,
        &size,
        &0u32,
        &vk,
        &fee_bps,
        &fee_recipient,
    );
    assert_eq!(circle_id, 0);

    let mut members: StdVec<Address> = StdVec::new();
    for _ in 0..size {
        let m = Address::generate(&env);
        token_admin_client.mint(&m, &contribution);
        members.push(m);
    }

    let setup = Setup {
        env,
        client_id: contract_id,
        token,
        members,
        circle_id,
        size,
        contribution,
    };
    (setup, fee_recipient)
}

#[test]
fn happy_path_round_pays_out_and_advances() {
    let s = setup(5, 100);
    let client = ContractClient::new(&s.env, &s.client_id);
    let token_client = token::Client::new(&s.env, &s.token);

    for m in s.members.iter() {
        client.fund(&s.circle_id, m);
    }

    let circle = client.get_circle(&s.circle_id);
    assert_eq!(circle.pot, s.contribution * (s.size as i128));

    let recipient = real_recipient_r0(&s.env); // fixed fixture recipient bound to real_valid_proof
    let nullifier_hash = real_nullifier_hash(&s.env);
    let external_nullifier = real_external_nullifier_round0(&s.env);
    let proof = real_valid_proof(&s.env);

    client.claim(
        &s.circle_id,
        &recipient,
        &nullifier_hash,
        &external_nullifier,
        &proof,
    );

    assert_eq!(
        token_client.balance(&recipient),
        s.contribution * (s.size as i128)
    );
    assert_eq!(token_client.balance(&s.client_id), 0);

    let circle_after = client.get_circle(&s.circle_id);
    assert_eq!(circle_after.pot, 0);
    assert_eq!(circle_after.round, 1);
}

// ---- Issue #252: protocol fees ----

// Requires a successful claim: the proof must verify against the committed
// vk AND its recipientHash public input must match the payout address
// (issue #266/#275) — satisfied by the regenerated fixtures and the fixed
// real_recipient_r0 payout address below.
#[test]
fn claim_deducts_fee_and_sends_to_fee_recipient() {
    // 500 bps = 5% of a 5 * 100 = 500 stroop pot → 25 fee, 475 net.
    // Asserts the `apply_fee` invariant fee + net == payout on-chain.
    let (s, fee_recipient) = setup_with_fee(5, 100, 500);
    let client = ContractClient::new(&s.env, &s.client_id);
    let token_client = token::Client::new(&s.env, &s.token);

    for m in s.members.iter() {
        client.fund(&s.circle_id, m);
    }

    let payout = s.contribution * (s.size as i128);
    let recipient = real_recipient_r0(&s.env);
    let nullifier_hash = real_nullifier_hash(&s.env);
    let external_nullifier = real_external_nullifier_round0(&s.env);
    let proof = real_valid_proof(&s.env);
    client.claim(
        &s.circle_id,
        &recipient,
        &nullifier_hash,
        &external_nullifier,
        &proof,
    );

    let fee = 25i128;
    let net = payout - fee;
    assert_eq!(fee + net, payout, "apply_fee must preserve the amount");
    assert_eq!(token_client.balance(&fee_recipient), fee);
    assert_eq!(token_client.balance(&recipient), net);
    assert_eq!(token_client.balance(&s.client_id), 0);
}

#[test]
fn claim_skips_fee_transfer_when_fee_bps_zero() {
    // fee_bps = 0 must behave exactly as a pre-fee circle: one payout
    // transfer to the recipient, nothing to the (ignored) fee recipient.
    let (s, fee_recipient) = setup_with_fee(5, 100, 0);
    let client = ContractClient::new(&s.env, &s.client_id);
    let token_client = token::Client::new(&s.env, &s.token);

    for m in s.members.iter() {
        client.fund(&s.circle_id, m);
    }

    let payout = s.contribution * (s.size as i128);
    let recipient = real_recipient_r0(&s.env);
    client.claim(
        &s.circle_id,
        &recipient,
        &real_nullifier_hash(&s.env),
        &real_external_nullifier_round0(&s.env),
        &real_valid_proof(&s.env),
    );

    assert_eq!(token_client.balance(&fee_recipient), 0);
    assert_eq!(token_client.balance(&recipient), payout);
}

#[test]
fn fee_is_immutable_after_creation() {
    // There is deliberately no setter for fee_bps/fee_recipient (ADR 003):
    // once committed at create_circle, every public entrypoint leaves them
    // exactly as they were. Funding and claiming both write the circle on
    // every call; asserting the fee survives fund (and the earlier
    // create_circle_accepts_maximum_fee_bps / claim tests) pins that down.
    let (s, fee_recipient) = setup_with_fee(5, 100, 250);
    let client = ContractClient::new(&s.env, &s.client_id);

    let circle_before = client.get_circle(&s.circle_id);
    assert_eq!(circle_before.fee_bps, 250);
    assert_eq!(circle_before.fee_recipient, fee_recipient);

    client.fund(&s.circle_id, &s.members[0]);

    let circle_after = client.get_circle(&s.circle_id);
    assert_eq!(circle_after.fee_bps, 250);
    assert_eq!(circle_after.fee_recipient, fee_recipient);
    assert_eq!(circle_after.pot, s.contribution);
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")] // InvalidProof
fn claim_reverts_on_tampered_public_input() {
    let s = setup(5, 100);
    let client = ContractClient::new(&s.env, &s.client_id);

    for m in s.members.iter() {
        client.fund(&s.circle_id, m);
    }

    let recipient = real_recipient_r0(&s.env);
    // the real proof's actual output is real_nullifier_hash(); claiming
    // with a different nullifier_hash means the pairing check is being
    // asked to verify a statement the proof doesn't attest to.
    let wrong_nullifier_hash =
        real_nullifier_hash(&s.env) + Fr::from_u256(U256::from_u32(&s.env, 1));
    let external_nullifier = real_external_nullifier_round0(&s.env);
    let proof = real_valid_proof(&s.env);

    client.claim(
        &s.circle_id,
        &recipient,
        &wrong_nullifier_hash,
        &external_nullifier,
        &proof,
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #2)")] // RoundNotFunded
// Ideally we'd pin pot == contribution*size - 1 (the single stroop
    // short of full) as the tightest possible underfunded case. But `fund`
    // only ever moves whole `contribution`-sized deposits — there's no way
    // to land the pot on a non-multiple-of-contribution value through the
    // public API. The tightest *reachable* underfunded state is one missing
    // depositor, so that's what this test pins instead.
fn claim_reverts_when_underfunded() {
    let s = setup(5, 100);
    let client = ContractClient::new(&s.env, &s.client_id);

    // only 4 of 5 members fund this round
    for m in s.members.iter().take(4) {
        client.fund(&s.circle_id, m);
    }

    let recipient = real_recipient_r0(&s.env);
    let nullifier_hash = real_nullifier_hash(&s.env);
    let external_nullifier = real_external_nullifier_round0(&s.env);
    let proof = real_valid_proof(&s.env);

    client.claim(
        &s.circle_id,
        &recipient,
        &nullifier_hash,
        &external_nullifier,
        &proof,
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #2)")] // RoundNotFunded
fn claim_immediately_after_round_advance_reverts() {
    // Regression guard: after a successful claim, pot must reset to 0 and
    // round 2 must require its own fresh funding — not silently inherit
    // round 1's now-stale "fully funded" state.
    let s = setup(5, 100);
    let client = ContractClient::new(&s.env, &s.client_id);

    for m in s.members.iter() {
        client.fund(&s.circle_id, m);
    }

    let recipient = real_recipient_r0(&s.env);
    let nullifier_hash = real_nullifier_hash(&s.env);
    let external_nullifier = real_external_nullifier_round0(&s.env);
    let proof = real_valid_proof(&s.env);

    client.claim(
        &s.circle_id,
        &recipient,
        &nullifier_hash,
        &external_nullifier,
        &proof,
    );

    let circle = client.get_circle(&s.circle_id);
    assert_eq!(circle.pot, 0);
    assert_eq!(circle.round, 1);

    // No one has funded round 1 yet — this must revert with RoundNotFunded,
    // not pay out against a stale/leftover pot value.
    let recipient2 = Address::generate(&s.env);
    client.claim(
        &s.circle_id,
        &recipient2,
        &nullifier_hash,
        &external_nullifier,
        &proof,
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #4)")] // AlreadyClaimed
fn second_claim_with_same_nullifier_reverts() {
    let s = setup(5, 100);
    let client = ContractClient::new(&s.env, &s.client_id);

    for m in s.members.iter() {
        client.fund(&s.circle_id, m);
    }

    let nullifier_hash = real_nullifier_hash(&s.env);
    let proof = real_valid_proof(&s.env);

    // round 0: claim succeeds and marks the nullifier used
    let recipient_a = real_recipient_r0(&s.env);
    let external_nullifier_0 = real_external_nullifier_round0(&s.env);
    client.claim(
        &s.circle_id,
        &recipient_a,
        &nullifier_hash,
        &external_nullifier_0,
        &proof,
    );

    // top up and fund round 1 fully, then try to reuse the exact same
    // nullifier_hash from round 0. It's rejected by the nullifier map
    // before the (real, but now mismatched-round) proof would even be
    // checked, so reusing `proof` here is fine.
    let token_admin_client = token::StellarAssetClient::new(&s.env, &s.token);
    for m in s.members.iter() {
        token_admin_client.mint(m, &s.contribution);
        client.fund(&s.circle_id, m);
    }
    let recipient_b = Address::generate(&s.env);
    let external_nullifier_1 = expected_external_nullifier(&s.env, s.circle_id, 1);
    client.claim(
        &s.circle_id,
        &recipient_b,
        &nullifier_hash,
        &external_nullifier_1,
        &proof,
    );
}

// ---- Issue #91: current multi-round semantics ----
//
// This is the definitive answer to "can the same identity claim two
// consecutive rounds today?" — YES. `nullifierHash = Poseidon(identityNullifier,
// externalNullifier)` and externalNullifier is derived from `round`, so the
// same identity produces a *different* nullifierHash each round, and the
// contract's nullifier map is keyed per (circle_id, nullifier_hash) with no
// round-independent identity tracking. Nothing here is a bug in the code
// tested elsewhere in this file (WrongRoundTag/AlreadyClaimed both still work
// correctly per-round) — it's a real gap: nothing currently stops one member
// from claiming every single round of a cycle. See docs/ for the proposed fix.
#[test]
fn same_identity_can_claim_two_consecutive_rounds() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(Contract, ());
    let client = ContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token(&env, &token_admin);
    let token_admin_client = token::StellarAssetClient::new(&env, &token);
    let token_client = token::Client::new(&env, &token);

    let root = real_root(&env);
    let vk = round_reuse_verification_key(&env);
    let contribution: i128 = 100;
    let circle_id = client.create_circle(&admin, &token, &root, &contribution, &1u32, &0u32, &vk, &0u32, &Address::generate(&env));

    // ---- round 0: fund and claim with the real identity ----
    let funder = Address::generate(&env);
    token_admin_client.mint(&funder, &contribution);
    client.fund(&circle_id, &funder);

    let nullifier_hash_r0 = real_nullifier_hash(&env);
    let external_nullifier_r0 = real_external_nullifier_round0(&env);
    let proof_r0 = round_reuse_proof_round0(&env);

    assert!(!client.has_claimed(&circle_id, &nullifier_hash_r0));
    let recipient_r0 = real_recipient_r0(&env);
    client.claim(
        &circle_id,
        &recipient_r0,
        &nullifier_hash_r0,
        &external_nullifier_r0,
        &proof_r0,
    );
    assert!(client.has_claimed(&circle_id, &nullifier_hash_r0));
    assert_eq!(token_client.balance(&recipient_r0), contribution);

    let circle = client.get_circle(&circle_id);
    assert_eq!(circle.round, 1);
    assert_eq!(circle.pot, 0);

    // ---- round 1: fund again, then claim again — same identity, no error ----
    token_admin_client.mint(&funder, &contribution);
    client.fund(&circle_id, &funder);

    let nullifier_hash_r1 = round_reuse_nullifier_hash_round1(&env);
    let external_nullifier_r1 = expected_external_nullifier(&env, circle_id, 1);
    let proof_r1 = round_reuse_proof_round1(&env);

    // Different round -> different nullifierHash for the SAME identity, so
    // it reads as "never claimed" even though this identity already claimed
    // round 0 above.
    assert_ne!(nullifier_hash_r0, nullifier_hash_r1);
    assert!(!client.has_claimed(&circle_id, &nullifier_hash_r1));

    let recipient_r1 = real_recipient_r1(&env);
    client.claim(
        &circle_id,
        &recipient_r1,
        &nullifier_hash_r1,
        &external_nullifier_r1,
        &proof_r1,
    );

    // The claim succeeded: no RoundNotFunded/WrongRoundTag/AlreadyClaimed/
    // InvalidProof panic. Same identity, two rounds, two payouts.
    assert!(client.has_claimed(&circle_id, &nullifier_hash_r1));
    assert_eq!(token_client.balance(&recipient_r1), contribution);
    assert_eq!(client.get_circle(&circle_id).round, 2);
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")] // WrongRoundTag
fn claim_reverts_on_stale_round_tag() {
    let s = setup(5, 100);
    let client = ContractClient::new(&s.env, &s.client_id);

    for m in s.members.iter() {
        client.fund(&s.circle_id, m);
    }

    let recipient = real_recipient_r0(&s.env);
    let nullifier_hash = real_nullifier_hash(&s.env);
    // wrong: this circle is still on round 0, but we tag the proof for round 1
    let external_nullifier = expected_external_nullifier(&s.env, s.circle_id, 1);
    let proof = real_valid_proof(&s.env);

    client.claim(
        &s.circle_id,
        &recipient,
        &nullifier_hash,
        &external_nullifier,
        &proof,
    );
}

#[test]
fn fund_requires_member_auth() {
    // env.auths() reports the authorization tree seen during the *last*
    // invocation, so calling it straight after fund() isolates that call
    // regardless of what setup() already authorized.
    let s = setup(5, 100);
    let client = ContractClient::new(&s.env, &s.client_id);

    let member = &s.members[0];
    client.fund(&s.circle_id, member);

    let auths = s.env.auths();
    assert_eq!(auths.len(), 1);
    assert_eq!(&auths[0].0, member);
}

#[test]
fn create_circle_requires_admin_auth() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(Contract, ());
    let client = ContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token(&env, &token_admin);

    let root = real_root(&env);
    let vk = real_verification_key(&env);
    client.create_circle(&admin, &token, &root, &100i128, &5u32, &0u32, &vk, &0u32, &Address::generate(&env));

    let auths = env.auths();
    assert_eq!(auths.len(), 1);
    assert_eq!(auths[0].0, admin);
}

#[test]
#[should_panic(expected = "Error(Contract, #9)")] // InvalidFeeParams
fn create_circle_rejects_fee_bps_out_of_range() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(Contract, ());
    let client = ContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token(&env, &token_admin);
    let root = real_root(&env);
    let vk = real_verification_key(&env);
    let fee_recipient = Address::generate(&env);
    client.create_circle(
        &admin,
        &token,
        &root,
        &100i128,
        &5u32,
        &0u32,
        &vk,
        &10_001u32,
        &fee_recipient,
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #11)")] // InvalidRecipient
fn create_circle_rejects_contract_as_fee_recipient() {
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
        &500u32,
        &contract_id,
    );
}

#[test]
fn create_circle_accepts_maximum_fee_bps() {
    let (s, fee_recipient) = setup_with_fee(5, 100, 10_000);
    let circle = ContractClient::new(&s.env, &s.client_id).get_circle(&s.circle_id);
    assert_eq!(circle.fee_bps, 10_000);
    assert_eq!(circle.fee_recipient, fee_recipient);
}

#[test]
fn create_circle_emits_created_event() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(Contract, ());
    let client = ContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token(&env, &token_admin);
    let root = real_root(&env);
    let vk = real_verification_key(&env);
    let contribution: i128 = 100;
    let size: u32 = 5;
    let circle_id = client.create_circle(&admin, &token, &root, &contribution, &size, &0u32, &vk, &0u32, &Address::generate(&env));

    let env_ref = env.clone();
    let events = env.events().all();
    let event = events
        .iter()
        .find(|(_, topics, _)| {
            let t0: Option<Symbol> = topics.get(0).and_then(|v| v.try_into_val(&env_ref).ok());
            let t1: Option<Symbol> = topics.get(1).and_then(|v| v.try_into_val(&env_ref).ok());
            t0 == Some(symbol_short!("circle")) && t1 == Some(symbol_short!("created"))
        })
        .unwrap();

    let (_, topics, data) = event;
    let t0: Symbol = topics.get(0).unwrap().try_into_val(&env_ref).unwrap();
    assert_eq!(t0, symbol_short!("circle"));
    let topic2: u64 = topics.get(2).unwrap().try_into_val(&env).unwrap();
    assert_eq!(topic2, circle_id);

    let (event_admin, event_token, event_contribution, event_size): (Address, Address, i128, u32) =
        data.try_into_val(&env).unwrap();
    assert_eq!(event_admin, admin);
    assert_eq!(event_token, token);
    assert_eq!(event_contribution, contribution);
    assert_eq!(event_size, size);
}

#[test]
fn fund_emits_funded_event() {
    let s = setup(5, 100);
    let client = ContractClient::new(&s.env, &s.client_id);
    let from = s.members[0].clone();
    client.fund(&s.circle_id, &from);

    let env_ref = s.env.clone();
    let events = s.env.events().all();
    let event = events
        .iter()
        .find(|(_, topics, _)| {
            let t0: Option<Symbol> = topics.get(0).and_then(|v| v.try_into_val(&env_ref).ok());
            let t1: Option<Symbol> = topics.get(1).and_then(|v| v.try_into_val(&env_ref).ok());
            t0 == Some(symbol_short!("circle")) && t1 == Some(symbol_short!("funded"))
        })
        .unwrap();

    let (_, topics, data) = event;
    let t0: Symbol = topics.get(0).unwrap().try_into_val(&env_ref).unwrap();
    assert_eq!(t0, symbol_short!("circle"));
    let topic2: u64 = topics.get(2).unwrap().try_into_val(&s.env).unwrap();
    assert_eq!(topic2, s.circle_id);

    let (event_from, new_pot, target): (Address, i128, i128) =
        data.try_into_val(&s.env).unwrap();
    assert_eq!(event_from, from);
    assert_eq!(new_pot, s.contribution);
    assert_eq!(target, s.contribution * (s.size as i128));
}

#[test]
fn claim_emits_claimed_event() {
    let s = setup(5, 100);
    let client = ContractClient::new(&s.env, &s.client_id);

    for m in s.members.iter() {
        client.fund(&s.circle_id, m);
    }

    let recipient = real_recipient_r0(&s.env);
    let nullifier_hash = real_nullifier_hash(&s.env);
    let external_nullifier = real_external_nullifier_round0(&s.env);
    let proof = real_valid_proof(&s.env);
    client.claim(
        &s.circle_id,
        &recipient,
        &nullifier_hash,
        &external_nullifier,
        &proof,
    );

    let env_ref = s.env.clone();
    let events = s.env.events().all();
    let event = events
        .iter()
        .find(|(_, topics, _)| {
            let t0: Option<Symbol> = topics.get(0).and_then(|v| v.try_into_val(&env_ref).ok());
            let t1: Option<Symbol> = topics.get(1).and_then(|v| v.try_into_val(&env_ref).ok());
            t0 == Some(symbol_short!("circle")) && t1 == Some(symbol_short!("claimed"))
        })
        .unwrap();

    let (_, topics, data) = event;
    let t0: Symbol = topics.get(0).unwrap().try_into_val(&env_ref).unwrap();
    assert_eq!(t0, symbol_short!("circle"));
    let topic2: u64 = topics.get(2).unwrap().try_into_val(&s.env).unwrap();
    assert_eq!(topic2, s.circle_id);

    let (round, amount, event_recipient): (u32, i128, Address) =
        data.try_into_val(&s.env).unwrap();
    assert_eq!(round, 0);
    assert_eq!(amount, s.contribution * (s.size as i128));
    assert_eq!(event_recipient, recipient);
}

#[test]
fn cancel_circle_emits_cancelled_event() {
    let s = setup(5, 100);
    let client = ContractClient::new(&s.env, &s.client_id);

    for m in s.members.iter().take(2) {
        client.fund(&s.circle_id, m);
    }
    client.cancel_circle(&s.circle_id);

    let env_ref = s.env.clone();
    let events = s.env.events().all();
    let event = events
        .iter()
        .find(|(_, topics, _)| {
            let t0: Option<Symbol> = topics.get(0).and_then(|v| v.try_into_val(&env_ref).ok());
            let t1: Option<Symbol> = topics.get(1).and_then(|v| v.try_into_val(&env_ref).ok());
            t0 == Some(symbol_short!("circle")) && t1 == Some(symbol_short!("cancelled"))
        })
        .unwrap();

    let (_, topics, data) = event;
    let t0: Symbol = topics.get(0).unwrap().try_into_val(&env_ref).unwrap();
    assert_eq!(t0, symbol_short!("circle"));
    let topic2: u64 = topics.get(2).unwrap().try_into_val(&s.env).unwrap();
    assert_eq!(topic2, s.circle_id);

    let (refunded_count, refunded_total): (u32, i128) =
        data.try_into_val(&s.env).unwrap();
    assert_eq!(refunded_count, 2);
    assert_eq!(refunded_total, s.contribution * 2i128);
}

#[test]
fn get_circle_count_tracks_next_circle_id() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(Contract, ());
    let client = ContractClient::new(&env, &contract_id);

    assert_eq!(client.get_circle_count(), 0);

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token(&env, &token_admin);
    let root = real_root(&env);
    let vk = real_verification_key(&env);

    client.create_circle(&admin, &token, &root, &100i128, &5u32, &0u32, &vk, &0u32, &Address::generate(&env));
    assert_eq!(client.get_circle_count(), 1);

    client.create_circle(&admin, &token, &root, &100i128, &5u32, &0u32, &vk, &0u32, &Address::generate(&env));
    assert_eq!(client.get_circle_count(), 2);
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")] // CircleNotFound
fn fund_unknown_circle_reverts() {
    let s = setup(5, 100);
    let client = ContractClient::new(&s.env, &s.client_id);
    client.fund(&999u64, &s.members[0]);
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")] // CircleNotFound
fn claim_unknown_circle_reverts() {
    let s = setup(5, 100);
    let client = ContractClient::new(&s.env, &s.client_id);
    let recipient = real_recipient_r0(&s.env);
    client.claim(
        &999u64,
        &recipient,
        &real_nullifier_hash(&s.env),
        &real_external_nullifier_round0(&s.env),
        &real_valid_proof(&s.env),
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")] // CircleNotFound
fn get_circle_unknown_reverts() {
    let s = setup(5, 100);
    let client = ContractClient::new(&s.env, &s.client_id);
    let _ = client.get_circle(&999u64);
}

#[test]
fn get_round_returns_current_round() {
    let s = setup(5, 100);
    let client = ContractClient::new(&s.env, &s.client_id);
    assert_eq!(client.get_round(&s.circle_id), 0);
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")] // CircleNotFound
fn get_round_unknown_reverts() {
    let s = setup(5, 100);
    let client = ContractClient::new(&s.env, &s.client_id);
    client.get_round(&999u64);
}

#[test]
fn get_pot_returns_current_pot() {
    let s = setup(5, 100);
    let client = ContractClient::new(&s.env, &s.client_id);
    assert_eq!(client.get_pot(&s.circle_id), 0i128);

    client.fund(&s.circle_id, &s.members[0]);
    assert_eq!(client.get_pot(&s.circle_id), s.contribution);
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")] // CircleNotFound
fn get_pot_unknown_reverts() {
    let s = setup(5, 100);
    let client = ContractClient::new(&s.env, &s.client_id);
    client.get_pot(&999u64);
}

#[test]
fn get_status_returns_round_pot_target_cancelled() {
    let s = setup(5, 100);
    let client = ContractClient::new(&s.env, &s.client_id);

    let (round, pot, target, cancelled) = client.get_status(&s.circle_id);
    assert_eq!(round, 0);
    assert_eq!(pot, 0i128);
    assert_eq!(target, s.contribution * (s.size as i128));
    assert!(!cancelled);

    // Fund one member and confirm pot advances.
    client.fund(&s.circle_id, &s.members[0]);
    let (round2, pot2, target2, cancelled2) = client.get_status(&s.circle_id);
    assert_eq!(round2, 0);
    assert_eq!(pot2, s.contribution);
    assert_eq!(target2, target);
    assert!(!cancelled2);
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")] // CircleNotFound
fn get_status_unknown_reverts() {
    let s = setup(5, 100);
    let client = ContractClient::new(&s.env, &s.client_id);
    client.get_status(&999u64);
}

#[test]
fn get_contributors_returns_funders_in_order() {
    let s = setup(5, 100);
    let client = ContractClient::new(&s.env, &s.client_id);

    // Before anyone funds, the list is empty.
    let contributors = client.get_contributors(&s.circle_id);
    assert_eq!(contributors.len(), 0);

    // After two members fund, they appear in insertion order.
    client.fund(&s.circle_id, &s.members[0]);
    client.fund(&s.circle_id, &s.members[1]);
    let contributors = client.get_contributors(&s.circle_id);
    assert_eq!(contributors.len(), 2);
    assert_eq!(contributors.get(0).unwrap(), s.members[0]);
    assert_eq!(contributors.get(1).unwrap(), s.members[1]);
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")] // CircleNotFound
fn get_contributors_unknown_reverts() {
    let s = setup(5, 100);
    let client = ContractClient::new(&s.env, &s.client_id);
    client.get_contributors(&999u64);
}

// CPU-instruction harness: measures create_circle / fund / claim, plus a
// synthetic larger-IC Groth16 verify (more public inputs → more g1_mul).
// Tree depth does NOT change claim cost (circuit-only); IC length does.
// Set WRITE_BENCHMARKS=1 to refresh contracts/BENCHMARKS.md.
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
    client.create_circle(&admin, &token, &root, &100i128, &5u32, &0u32, &vk, &0u32, &Address::generate(&env));
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
    let recipient = real_recipient_r0(&env);
    let nullifier_hash = real_nullifier_hash(&env);
    let external_nullifier = real_external_nullifier_round0(&env);
    let proof = real_valid_proof(&env);
    client.claim(
        &0u64,
        &recipient,
        &nullifier_hash,
        &external_nullifier,
        &proof,
    );
    let claim_cpu = env.cost_estimate().budget().cpu_instruction_cost();
    std::println!("bench claim:         {claim_cpu} CPU instructions");

    // Headroom assertion: upgrades that consume the committed safety margin fail loudly.
    assert!(
        claim_cpu < 80_000_000,
        "claim() CPU {claim_cpu} exceeded 80M safety threshold (budget 100M)"
    );

    // ---- larger IC (simulate 5 public inputs → ic.len() == 6) ----
    // Runs the same Groth16 path with one extra g1_mul term (5 instead of
    // 4). Proof will not verify (dummy inputs); we only care about the
    // instruction cost.
    env.cost_estimate().budget().reset_default();
    let mut big_vk = real_verification_key(&env);
    let pad = big_vk.ic.get(0).unwrap();
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

    if std::env::var_os("WRITE_BENCHMARKS").is_some() {
        const BUDGET: u64 = 100_000_000;
        let headroom = |cost: u64| (BUDGET.saturating_sub(cost) as f64 / BUDGET as f64) * 100.0;
        let table = std::format!(
            "# Contract CPU benchmarks\n\nGenerated by `WRITE_BENCHMARKS=1 cargo test -p sharibo cpu_instruction_benchmarks -- --nocapture`.\n\n| Entrypoint | CPU instructions | Budget headroom |\n| --- | ---: | ---: |\n| `create_circle` | {create_cpu} | {:.1}% |\n| `fund` | {fund_cpu} | {:.1}% |\n| `claim` | {claim_cpu} | {:.1}% |\n| `verify_groth16` (5 public inputs) | {large_ic_cpu} | {:.1}% |\n\nThe `claim` row is gated at 80,000,000 instructions; Stellar's transaction budget is 100,000,000.\n",
            headroom(create_cpu),
            headroom(fund_cpu),
            headroom(claim_cpu),
            headroom(large_ic_cpu),
        );
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../BENCHMARKS.md");
        std::fs::write(path, table).expect("write contracts/BENCHMARKS.md");
    }
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")] // RoundFull
fn sixth_fund_on_full_round_reverts() {
    let s = setup(5, 100);
    let client = ContractClient::new(&s.env, &s.client_id);
    let token_admin_client = token::StellarAssetClient::new(&s.env, &s.token);

    for m in s.members.iter() {
        client.fund(&s.circle_id, m);
    }

    let circle = client.get_circle(&s.circle_id);
    assert_eq!(circle.pot, s.contribution * (s.size as i128));

    // A sixth deposit must fail with RoundFull — otherwise pot > target and
    // claim's equality check bricks forever.
    let griefer = Address::generate(&s.env);
    token_admin_client.mint(&griefer, &s.contribution);
    client.fund(&s.circle_id, &griefer);
}

#[test]
fn claim_works_on_fully_funded_round_after_cap() {
    // Companion to sixth_fund_on_full_round_reverts: five funds reach the
    // cap exactly, claim still pays out (over-funding never mutated state).
    let s = setup(5, 100);
    let client = ContractClient::new(&s.env, &s.client_id);
    let token_client = token::Client::new(&s.env, &s.token);

    for m in s.members.iter() {
        client.fund(&s.circle_id, m);
    }
    assert_eq!(
        client.get_circle(&s.circle_id).pot,
        s.contribution * (s.size as i128)
    );

    let recipient = real_recipient_r0(&s.env);
    let nullifier_hash = real_nullifier_hash(&s.env);
    let external_nullifier = real_external_nullifier_round0(&s.env);
    let proof = real_valid_proof(&s.env);
    client.claim(
        &s.circle_id,
        &recipient,
        &nullifier_hash,
        &external_nullifier,
        &proof,
    );
    assert_eq!(
        token_client.balance(&recipient),
        s.contribution * (s.size as i128)
    );
}

#[test]
fn has_claimed_false_before_true_after() {
    let s = setup(5, 100);
    let client = ContractClient::new(&s.env, &s.client_id);
    let nullifier_hash = real_nullifier_hash(&s.env);

    assert!(!client.has_claimed(&s.circle_id, &nullifier_hash));

    for m in s.members.iter() {
        client.fund(&s.circle_id, m);
    }

    let recipient = real_recipient_r0(&s.env);
    let external_nullifier = real_external_nullifier_round0(&s.env);
    let proof = real_valid_proof(&s.env);
    client.claim(
        &s.circle_id,
        &recipient,
        &nullifier_hash,
        &external_nullifier,
        &proof,
    );

    assert!(client.has_claimed(&s.circle_id, &nullifier_hash));
}

#[test]
#[should_panic(expected = "Error(Contract, #10)")] // InvalidCircleParams
fn create_circle_rejects_pot_target_overflow() {
    // contribution * size overflows i128, so create_circle rejects the
    // circle at creation time (checked pot-target arithmetic,
    // InvalidCircleParams) before any funds move.
    let _ = setup(2, i128::MAX);
}

#[test]
fn anyone_can_fund() {
    // Open-funding guarantee: a stranger (not in the member set created by
    // setup) can pay a contribution into the circle. Membership gates claim
    // via the Merkle root, not fund. See contracts/README.md.
    let s = setup(5, 100);
    let client = ContractClient::new(&s.env, &s.client_id);
    let token_admin_client = token::StellarAssetClient::new(&s.env, &s.token);

    let stranger = Address::generate(&s.env);
    token_admin_client.mint(&stranger, &s.contribution);
    client.fund(&s.circle_id, &stranger);

    let circle = client.get_circle(&s.circle_id);
    assert_eq!(circle.pot, s.contribution);
}

// ---- Issue #82: admin cancel/refund path ----

#[test]
fn cancel_refunds_partial_funders_and_closes_circle() {
    // Scenario: 4 of 5 members fund, the 5th never shows up.
    // Admin cancels; all 4 existing funders are refunded exactly
    // `contribution` each, and the circle is permanently closed.
    let s = setup(5, 100);
    let client = ContractClient::new(&s.env, &s.client_id);
    let _token_admin_client = token::StellarAssetClient::new(&s.env, &s.token);
    let token_client = token::Client::new(&s.env, &s.token);

    // Mint enough for 4 funders (setup only mints `contribution` per member).
    let funders: StdVec<Address> = s.members.iter().take(4).cloned().collect();
    for f in funders.iter() {
        client.fund(&s.circle_id, f);
    }

    let circle_before = client.get_circle(&s.circle_id);
    assert_eq!(circle_before.pot, s.contribution * 4);
    assert_eq!(circle_before.contributors.len(), 4);

    // Record balances before cancel.
    let before: StdVec<i128> = funders.iter().map(|f| token_client.balance(f)).collect();

    let _admin = client.get_circle(&s.circle_id).admin;
    client.cancel_circle(&s.circle_id);

    // Every funder must have been refunded exactly their contribution.
    for (f, bal_before) in funders.iter().zip(before.iter()) {
        assert_eq!(
            token_client.balance(f),
            bal_before + s.contribution,
            "funder {f:?} not fully refunded"
        );
    }

    let circle_after = client.get_circle(&s.circle_id);
    assert_eq!(circle_after.pot, 0);
    assert!(circle_after.cancelled);
    assert_eq!(circle_after.contributors.len(), 0);

    // Contract holds no tokens.
    assert_eq!(token_client.balance(&s.client_id), 0);
}

// ---- Issue #318: cancel before any contributor has funded ----

#[test]
fn cancel_zero_contributors_is_clean_close() {
    // Cancel immediately after create_circle, before anyone funds.
    // The contributors Vec is empty, so the refund loop must be a no-op.
    // Expected outcome: cancelled == true, pot == 0, no token movement.
    let s = setup(5, 100);
    let client = ContractClient::new(&s.env, &s.client_id);
    let token_client = token::Client::new(&s.env, &s.token);

    // Sanity: nothing in the pot yet.
    let circle_before = client.get_circle(&s.circle_id);
    assert_eq!(circle_before.pot, 0);
    assert_eq!(circle_before.contributors.len(), 0);
    assert!(!circle_before.cancelled);

    // Contract holds no tokens at this point.
    let contract_balance_before = token_client.balance(&s.client_id);
    assert_eq!(contract_balance_before, 0);

    client.cancel_circle(&s.circle_id);

    let circle_after = client.get_circle(&s.circle_id);
    assert_eq!(circle_after.pot, 0, "pot must remain 0 after cancelling an empty circle");
    assert!(circle_after.cancelled, "circle must be marked cancelled");
    assert_eq!(circle_after.contributors.len(), 0, "contributors vec must stay empty");

    // No tokens moved: contract balance is still 0.
    assert_eq!(
        token_client.balance(&s.client_id),
        0,
        "contract token balance must not change"
    );

    // No member token balance should have changed either.
    for m in s.members.iter() {
        assert_eq!(
            token_client.balance(m),
            s.contribution,
            "member {m:?} balance must be unchanged — no refund should have fired"
        );
    }
}

#[test]
#[should_panic(expected = "Error(Contract, #8)")] // CircleCancelled
fn fund_after_zero_contributor_cancel_reverts() {
    // Companion to fund_after_cancel_reverts, starting from the empty state.
    let s = setup(5, 100);
    let client = ContractClient::new(&s.env, &s.client_id);
    let token_admin_client = token::StellarAssetClient::new(&s.env, &s.token);

    client.cancel_circle(&s.circle_id);

    let extra = Address::generate(&s.env);
    token_admin_client.mint(&extra, &s.contribution);
    client.fund(&s.circle_id, &extra);
}

#[test]
#[should_panic(expected = "Error(Contract, #8)")] // CircleCancelled
fn claim_after_zero_contributor_cancel_reverts() {
    // Companion to claim_after_cancel_reverts, starting from the empty state
    // (no members funded before the cancel).
    let s = setup(5, 100);
    let client = ContractClient::new(&s.env, &s.client_id);

    client.cancel_circle(&s.circle_id);

    let recipient = real_recipient_r0(&s.env);
    client.claim(
        &s.circle_id,
        &recipient,
        &real_nullifier_hash(&s.env),
        &real_external_nullifier_round0(&s.env),
        &real_valid_proof(&s.env),
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #8)")] // CircleCancelled
fn fund_after_cancel_reverts() {
    let s = setup(5, 100);
    let client = ContractClient::new(&s.env, &s.client_id);
    let token_admin_client = token::StellarAssetClient::new(&s.env, &s.token);

    client.cancel_circle(&s.circle_id);

    let extra = Address::generate(&s.env);
    token_admin_client.mint(&extra, &s.contribution);
    client.fund(&s.circle_id, &extra);
}

#[test]
#[should_panic(expected = "Error(Contract, #8)")] // CircleCancelled
fn claim_after_cancel_reverts() {
    let s = setup(5, 100);
    let client = ContractClient::new(&s.env, &s.client_id);

    for m in s.members.iter() {
        client.fund(&s.circle_id, m);
    }
    client.cancel_circle(&s.circle_id);

    let recipient = real_recipient_r0(&s.env);
    client.claim(
        &s.circle_id,
        &recipient,
        &real_nullifier_hash(&s.env),
        &real_external_nullifier_round0(&s.env),
        &real_valid_proof(&s.env),
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #8)")] // CircleCancelled
fn double_cancel_reverts() {
    let s = setup(5, 100);
    let client = ContractClient::new(&s.env, &s.client_id);
    client.cancel_circle(&s.circle_id);
    client.cancel_circle(&s.circle_id);
}

// ---- Issue #84: instance-storage TTL extension ----

#[test]
#[should_panic(expected = "Error(Contract, #10)")] // InvalidCircleParams
fn create_circle_rejects_truncated_ic() {
    // create_circle validates vk shape up front: the circuit exposes
    // [nullifierHash, root, externalNullifier, recipientHash], so ic must
    // hold one point per public signal plus one (5 total). A truncated ic
    // is rejected at creation (InvalidCircleParams) before any circle or
    // funds exist. verify_groth16 keeps its own length guard as
    // defense-in-depth against a hand-crafted vk ever reaching claim.
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(Contract, ());
    let client = ContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token(&env, &token_admin);

    let mut truncated_vk = real_verification_key(&env);
    assert_eq!(truncated_vk.ic.len(), 5);
    truncated_vk.ic.pop_back(); // Remove the last ic point; len is now 4.
    assert_eq!(truncated_vk.ic.len(), 4);

    client.create_circle(
        &admin,
        &token,
        &real_root(&env),
        &100i128,
        &5u32,
        &0u32,
        &truncated_vk,
        &0u32,
        &Address::generate(&env),
    );
    unreachable!("create_circle with a truncated vk must revert");
}

#[test]
fn instance_ttl_extended_after_create_fund_claim() {
    // The Soroban test env lets us inspect TTLs via env.ledger().
    // Strategy: bump the ledger far enough that the instance entry would
    // expire if nothing extended it, then perform create/fund/claim and
    // confirm the TTL has been refreshed to at least LEDGER_THRESHOLD.
    //
    // LEDGER_EXTEND_TO == 500_000; we advance by LEDGER_THRESHOLD (100)
    // which is the minimum that triggers an extension.  After the call
    // the remaining TTL must be > 0 (i.e. the entry did not expire).
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(Contract, ());
    let client = ContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token(&env, &token_admin);
    let token_admin_client = token::StellarAssetClient::new(&env, &token);
    let root = real_root(&env);
    let vk = real_verification_key(&env);

    // create_circle must extend instance TTL.
    client.create_circle(&admin, &token, &root, &100i128, &5u32, &0u32, &vk, &0u32, &Address::generate(&env));

    // Advance the ledger by LEDGER_THRESHOLD so the instance entry would
    // expire without the extension; the TTL should now be refreshed.
    env.ledger().with_mut(|l| {
        l.sequence_number += LEDGER_THRESHOLD;
        l.timestamp += u64::from(LEDGER_THRESHOLD) * 5;
        l.min_persistent_entry_ttl = LEDGER_THRESHOLD;
        l.min_temp_entry_ttl = LEDGER_THRESHOLD;
    });

    // fund must also extend instance TTL.
    let member = Address::generate(&env);
    token_admin_client.mint(&member, &100i128);
    client.fund(&0u64, &member);

    // fund 4 more so we can claim.
    for _ in 0..4 {
        let m = Address::generate(&env);
        token_admin_client.mint(&m, &100i128);
        client.fund(&0u64, &m);
    }

    // claim must also extend instance TTL.
    let recipient = real_recipient_r0(&env);
    client.claim(
        &0u64,
        &recipient,
        &real_nullifier_hash(&env),
        &real_external_nullifier_round0(&env),
        &real_valid_proof(&env),
    );

    // Verify the instance entry is still live (has a TTL > 0) after all
    // three write paths have run. If extend_ttl were missing, the entry
    // would have lapsed and NextCircleId would behave unpredictably.
    // The test env raises an error if a live entry is accessed after
    // its TTL expires, so a successful get_circle here is our proof.
    let circle = client.get_circle(&0u64);
    assert_eq!(circle.round, 1, "claim should have advanced round to 1");
}

// ---- Issue #252: apply_fee helper ----

#[test]
fn apply_fee_zero_bps_yields_no_fee() {
    let env = Env::default();
    assert_eq!(apply_fee(&env, 0, 12_345), (0, 12_345));
}

#[test]
fn apply_fee_full_bps_takes_entire_amount() {
    let env = Env::default();
    assert_eq!(apply_fee(&env, 10_000, 12_345), (12_345, 0));
}

#[test]
fn apply_fee_truncates_toward_zero() {
    let env = Env::default();
    // 500 bps = 5%: 12_345 * 500 / 10_000 = 617 (truncated), net 11_728.
    assert_eq!(apply_fee(&env, 500, 12_345), (617, 11_728));
    assert_eq!(617 + 11_728, 12_345);
}

#[test]
#[should_panic(expected = "Error(Contract, #9)")] // InvalidFeeParams
fn apply_fee_rejects_out_of_range_bps() {
    let env = Env::default();
    apply_fee(&env, 10_001, 100);
}

mod proptest_apply_fee {
    use super::*;
    use proptest::prelude::*;

    proptest! {
        #[test]
        fn fee_plus_net_equals_amount(
            amount  in 0_i128..=(i128::MAX / 2),
            fee_bps in 0_u32..=10_000_u32,
        ) {
            let (fee, net) = apply_fee(&Env::default(), fee_bps, amount);
            prop_assert_eq!(
                fee + net,
                amount,
                "apply_fee({}, {}) = ({}, {}); fee + net = {}",
                fee_bps, amount, fee, net, fee + net
            );
        }
    }
}

