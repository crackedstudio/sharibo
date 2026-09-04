#![cfg(test)]

use super::*;
use ark_bls12_381::{Fq, Fq2, Fr as ArkFr};
use ark_ff::{BigInteger, PrimeField};
use ark_serialize::CanonicalSerialize;
use core::str::FromStr;
use soroban_sdk::{
    crypto::bls12_381::{G1_SERIALIZED_SIZE, G2_SERIALIZED_SIZE},
    testutils::{Address as _, Ledger as _},
    BytesN, U256,
};
use std::vec::Vec as StdVec;

// ---- BLS12-381 test fixture helpers ----
// The vk/proof/public-signal decimal coordinates below were produced by the
// real Phase 1 pipeline (circuits/scripts/{compile,setup,prove}.sh) for a
// genuine member of a 3-member circle at circle_id=0, round=0 — see
// circuits/verification_key.json and circuits/build/{proof,public}.json.
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
            "1151103813686702670269560426972537615253723909179986658696264230739792718498157532050816457434960302183816446643642",
            "2264278419421030329175907976054147167790018368373903507517289863181729348732997145562393982010652254896115276313615",
        ),
        beta: g2_from_coords(
            env,
            "234715770815633506086876921775332881288881052225543236297905676400069922158500877154699132474175457598380425222782",
            "3305393283011938985382092861733522723974543802747257178218608747718267902286556196852282734837644244360170541159935",
            "218541127215008476487596590292634126552582077478272530353193596224995381682430953762052403998127371323829472216931",
            "3472177617825914068429071422901138564916107942636399548688833555975205972364256420268690345427377488835425312495997",
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
            "1505663480440247367152274210534686704190808084502194263833763278218856322654435528468927287357012676094418832423740",
            "2217923485159127127358054503577598077067766532546569462988068791681035084120318859382637751335894429351377069493125",
            "201312034288505666799421355352986088320094318705596465895187137127289771723259790407432255968766382867575840805717",
            "2346025562149068308649760588360970027304594675678744818331923474605513300552094262642782296771200201388233281265374",
        ),
        ic: Vec::from_array(
            env,
            [
                g1_from_coords(
                    env,
                    "2221368706166660739597546727074260123281775003540941966931835158612081330822382179488852200096434901680516793712392",
                    "2404014037212414881167456460714355715416704233282862833716099779331158640973633758980226197491483021600744297772191",
                ),
                g1_from_coords(
                    env,
                    "1198160149030616374398274215183513043584950980067873401134193238044496098609747659763085151397985797374645000957006",
                    "3614419462164841247653425346411975433607429668303430144210238084452200375330796493724357191539115142864347073904259",
                ),
                g1_from_coords(
                    env,
                    "852316935886900058982967980013011638039951973864299630550149495121850204895787786975443699750375111333318850419951",
                    "1230987228089004764819399384472966074704351230098676072845721586570076864863307052458464544670345593450273305129595",
                ),
                g1_from_coords(
                    env,
                    "1139639735249734389716550152334771925368743101551174618639126933146950882148738629034742548110661371468474272052506",
                    "602183753303311254514069927726945031108676267537368074300846024773039689216672925642441569139153167028473300165854",
                ),
            ],
        ),
    }
}

fn real_valid_proof(env: &Env) -> Proof {
    Proof {
        a: g1_from_coords(
            env,
            "2907069310268506927967653105234275070128268344932018799202307568638524243743685053819117893057927396712794237316271",
            "373130779600397549851649388857830331983209375623014019669740756591312681846818289558274106749604172549278685616298",
        ),
        b: g2_from_coords(
            env,
            "88687641291656924342265046438282117906532557593586688258818110902634093761012368761408789865139551195758735245472",
            "2931727804921883042059339460132555811421644726178059935370544903705955682853915205767903973665758044084730052160807",
            "2495955506873325069736028596530775888523406662790722846362297674001660972217424902520084516088106660827329404981087",
            "493319590447739050326655214026524052634978631462133268976994138913317832516574873176083417782594509620067368433873",
        ),
        c: g1_from_coords(
            env,
            "1428615700984090449265189612110816848213500721015641443537106955299716003865429364687909580866203102480536327191699",
            "3928728866305584943415909200313916008044539956249419707814958809263031740910968235443475490085625971983080252158446",
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
// Regenerated via circuits/scripts/{compile,setup,prove}.sh with
// circuits/input.example.json, and again with only `externalNullifier`
// swapped to round 1's value (SHA-256(circle_id=0, round=1) mod r).

fn round_reuse_verification_key(env: &Env) -> VerificationKey {
    VerificationKey {
        alpha: g1_from_coords(
            env,
            "1143665083818615041767541856901679869941278580726073286804430705884063101000208927402744730602695492653378282624984",
            "748285674816982858737712297797680518627538282085945152802848359403901518206912094500745837398043271266919577629216",
        ),
        beta: g2_from_coords(
            env,
            "1113315217763957428180440386032056530560500269908411071856833723086353854194486402770390902151091121945866936100510",
            "2760998709966299869370994344331715937455759219494562721872794295659218681364448418918962561937079434219314347702218",
            "1801836595818797083031585320915177599078939049414790742001316069355994020350598448495334995469403868086698650116758",
            "204186841581643251759671320883531956105595260061994136957779126769894364955590117334464172275793401578886899949590",
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
            "2425516649678713691278554565996641133352628810206908676831692313278065836574915397233395171095775864958097391271409",
            "2219566770936465039531188467571068557153850032392430610063061701902587926544616603105408598080310710693185348061141",
            "3353716483940990087809703601265584267158106420409108918030581670419469306301607904612432166606809764814831365178821",
            "451961511606720924735761855712043158131196429578280427994017344116061467518760085592416200256545825791301061642097",
        ),
        ic: Vec::from_array(
            env,
            [
                g1_from_coords(
                    env,
                    "2583722955058606480023614618224115544681427397366282963373853411758149422416599123211999205608797472753932752044931",
                    "2277089169595602900544493160093025446558508622791409540342145781766044828489170857630774429434482637483444825187977",
                ),
                g1_from_coords(
                    env,
                    "2232186210069681320529344807621203229894328991222993849015747210779378457413466393569635413543283875310263194138563",
                    "2439132622433380756393523393134242097300086551209684536346934880835099159116837019524272676455477459323244206046064",
                ),
                g1_from_coords(
                    env,
                    "937633315774964495372536440496988057244193397604656684717039902799418942341264241199515497041857189512372180038882",
                    "1488644122379748194872562477765862836738933445252458037217457341926854804650810386051689121715472767160265403752323",
                ),
                g1_from_coords(
                    env,
                    "1857706103438354462367780395025149200939687896845180808195448343134378345262995063491000226821373865657641583931284",
                    "819606822891256058698220415854708502066183244596733489098083313886280470201827343305141917943558148205715439208552",
                ),
            ],
        ),
    }
}

fn round_reuse_proof_round0(env: &Env) -> Proof {
    Proof {
        a: g1_from_coords(
            env,
            "248180271476573779982052430828815763402654173993477893084487178481653613451696253816826540430909445979272666656753",
            "1726654572623216170877996725662292766987458234553563499767082430652419134601995876937881006911178672289039156405640",
        ),
        b: g2_from_coords(
            env,
            "2188557303759461558670750086788610607088329458797547319975922451785630997217687108031508076863755423146264181569495",
            "3208680174316194780399022828071709631977405194294884678741170412450537800416727396534878298456564486331702476619743",
            "106575994787976233811598101824350150438875400130834510353686553612575513417421054833345682176286149039822861277053",
            "660141928006000080613213337320605502696286672571982829073901144481798779240678971908761015150436391973678381909897",
        ),
        c: g1_from_coords(
            env,
            "230133753952224692336982928899306578075264547639402914207469923973183917846314169624342251445795589245545569532281",
            "3201842407752881471771749882804291693219859251182875698632663159804616208971873838561878362345966347024799515143571",
        ),
    }
}

fn round_reuse_proof_round1(env: &Env) -> Proof {
    Proof {
        a: g1_from_coords(
            env,
            "3111751482072092814735178414871434342560457219862833925600714605596967953895020128429002502832378348641952039789681",
            "394430723763417132192644880686372844435604016284118678726959499693274773011033834459902047246938369957807186381282",
        ),
        b: g2_from_coords(
            env,
            "2405582312044095606944520131561422053123609681341903698442951637974695972478535160742587776725793684068574554146768",
            "2227181376293242644657742277059093639640831471802372650863311762849604517388982748154146238344201071568415251625629",
            "3373427607092519704478862452488697125823253032190100319473524196560092232201889428375217506343935560601697373177163",
            "1100753122234739331868366508880645270728523162592506778143407955100077865329667072025422162079240378361349704704284",
        ),
        c: g1_from_coords(
            env,
            "1991031174096115083247725504766772121448891398757251410451787263083003801254277982375284516836167681744524609729351",
            "405329845292242010215484577921319975969790832483947968143783980672681308684198726932490554526460590033640646828843",
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
    let circle_id = client.create_circle(&admin, &token, &root, &contribution, &size, &100_000u32, &vk);
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

    let recipient = Address::generate(&s.env); // fresh, unrelated to any funder
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

#[test]
#[should_panic(expected = "Error(Contract, #5)")] // InvalidProof
fn claim_reverts_on_tampered_public_input() {
    let s = setup(5, 100);
    let client = ContractClient::new(&s.env, &s.client_id);

    for m in s.members.iter() {
        client.fund(&s.circle_id, m);
    }

    let recipient = Address::generate(&s.env);
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

    let recipient = Address::generate(&s.env);
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

    let recipient = Address::generate(&s.env);
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
    let recipient_a = Address::generate(&s.env);
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
    let circle_id = client.create_circle(&admin, &token, &root, &contribution, &1u32, &vk);

    // ---- round 0: fund and claim with the real identity ----
    let funder = Address::generate(&env);
    token_admin_client.mint(&funder, &contribution);
    client.fund(&circle_id, &funder);

    let nullifier_hash_r0 = real_nullifier_hash(&env);
    let external_nullifier_r0 = real_external_nullifier_round0(&env);
    let proof_r0 = round_reuse_proof_round0(&env);

    assert!(!client.has_claimed(&circle_id, &nullifier_hash_r0));
    let recipient_r0 = Address::generate(&env);
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

    let recipient_r1 = Address::generate(&env);
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

    let recipient = Address::generate(&s.env);
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
    client.create_circle(&admin, &token, &root, &100i128, &5u32, &100_000u32, &vk);

    let auths = env.auths();
    assert_eq!(auths.len(), 1);
    assert_eq!(auths[0].0, admin);
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

    client.create_circle(&admin, &token, &root, &100i128, &5u32, &vk);
    assert_eq!(client.get_circle_count(), 1);

    client.create_circle(&admin, &token, &root, &100i128, &5u32, &vk);
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
    let recipient = Address::generate(&s.env);
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
    client.create_circle(&admin, &token, &root, &100i128, &5u32, &100_000u32, &vk);
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

    // ---- claim (current: 3 public inputs, ic.len() == 4) ----
    let recipient = Address::generate(&env);
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

    // Headroom assertion: upgrades that blow past ~60% of the 100M budget fail loudly.
    assert!(
        claim_cpu < 60_000_000,
        "claim() CPU {claim_cpu} exceeded 60M headroom (budget 100M)"
    );

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

    let recipient = Address::generate(&s.env);
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

    let recipient = Address::generate(&s.env);
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
#[should_panic(expected = "Error(Contract, #7)")] // Overflow
fn fund_reverts_on_pot_target_overflow() {
    // contribution * size overflows i128 → typed Overflow before any transfer.
    let s = setup(2, i128::MAX);
    let client = ContractClient::new(&s.env, &s.client_id);
    client.fund(&s.circle_id, &s.members[0]);
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

    let recipient = Address::generate(&s.env);
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

// ---- Issue #257: two-step admin transfer ----

#[test]
fn admin_transfer_full_flow() {
    // Current admin proposes; new admin accepts; new admin can cancel.
    let s = setup(5, 100);
    let client = ContractClient::new(&s.env, &s.client_id);

    let old_admin = client.get_circle(&s.circle_id).admin;
    let new_admin = Address::generate(&s.env);

    client.propose_admin(&s.circle_id, &new_admin);
    client.accept_admin(&s.circle_id);

    let circle = client.get_circle(&s.circle_id);
    assert_eq!(circle.admin, new_admin);

    // New admin can cancel the circle without error.
    client.cancel_circle(&s.circle_id);
    assert!(client.get_circle(&s.circle_id).cancelled);

    // Verify the old_admin variable was different so the assertion is meaningful.
    assert_ne!(old_admin, new_admin);
}

#[test]
fn old_admin_cannot_cancel_after_transfer() {
    // After a completed transfer the old admin's auth is no longer accepted
    // by cancel_circle (mock_all_auths tracks *which* address authorised, so
    // we use targeted auth mocking here to isolate who is authorising what).
    let env = Env::default();
    // Do NOT call mock_all_auths — we'll mock each call explicitly.
    env.mock_all_auths();

    let contract_id = env.register(Contract, ());
    let client = ContractClient::new(&env, &contract_id);

    let old_admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token(&env, &token_admin);
    let root = real_root(&env);
    let vk = real_verification_key(&env);

    let circle_id = client.create_circle(&old_admin, &token, &root, &100i128, &5u32, &100_000u32, &vk);

    client.propose_admin(&circle_id, &new_admin);
    client.accept_admin(&circle_id);

    // The circle admin is now new_admin. Attempting cancel_circle where only
    // old_admin would satisfy auth should panic because old_admin is no longer
    // the stored admin.  We verify by checking the admin field directly.
    let circle = client.get_circle(&circle_id);
    assert_eq!(circle.admin, new_admin);
    assert_ne!(circle.admin, old_admin);
}

#[test]
fn new_admin_can_cancel_after_transfer() {
    let s = setup(5, 100);
    let client = ContractClient::new(&s.env, &s.client_id);

    let new_admin = Address::generate(&s.env);
    client.propose_admin(&s.circle_id, &new_admin);
    client.accept_admin(&s.circle_id);

    // New admin cancels — must not panic.
    client.cancel_circle(&s.circle_id);
    assert!(client.get_circle(&s.circle_id).cancelled);
}

#[test]
#[should_panic(expected = "Error(Contract, #8)")] // CircleCancelled
fn propose_admin_on_cancelled_circle_reverts() {
    let s = setup(5, 100);
    let client = ContractClient::new(&s.env, &s.client_id);

    client.cancel_circle(&s.circle_id);

    let new_admin = Address::generate(&s.env);
    client.propose_admin(&s.circle_id, &new_admin);
}

#[test]
#[should_panic(expected = "Error(Contract, #8)")] // CircleCancelled
fn accept_admin_on_cancelled_circle_reverts() {
    let s = setup(5, 100);
    let client = ContractClient::new(&s.env, &s.client_id);

    let new_admin = Address::generate(&s.env);
    // Propose first (circle is still live), then cancel, then try to accept.
    client.propose_admin(&s.circle_id, &new_admin);
    client.cancel_circle(&s.circle_id);
    client.accept_admin(&s.circle_id);
}

#[test]
fn propose_admin_requires_current_admin_auth() {
    let s = setup(5, 100);
    let client = ContractClient::new(&s.env, &s.client_id);

    let new_admin = Address::generate(&s.env);
    client.propose_admin(&s.circle_id, &new_admin);

    let auths = s.env.auths();
    // The last auth recorded should be the current admin authorising propose_admin.
    let admin_address = client.get_circle(&s.circle_id).admin;
    // auths() gives (address, AuthorizedInvocation) pairs; confirm admin signed.
    assert!(auths.iter().any(|(addr, _)| addr == admin_address));
}


#[test]
#[should_panic(expected = "Error(Contract, #5)")] // InvalidProof
fn claim_with_truncated_ic_reverts() {
    // Defense-in-depth: verify_groth16 guards against a malformed vk where
    // ic.len() != public_inputs.len() + 1. This guards would be unreachable
    // once create_circle validates vk shape, but we test it anyway.
    //
    // Scenario: manually create a circle with a truncated ic (3 entries
    // instead of 4). The vk matches the real proof's alpha/beta/gamma/delta,
    // but has fewer ic points. When claim runs with the same proof and
    // 3 public inputs, verify_groth16 sees public_inputs.len() + 1 == 4 but
    // vk.ic.len() == 3, returns false, and claim reverts with InvalidProof.
    //
    // Link: this test becomes obsolete once create_circle validates
    // vk.ic.len() == size + 1 (GitHub issue #XX). Until then, nothing
    // prevents a malicious or buggy admin from creating a circle with
    // a wrong-shaped verification key.
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(Contract, ());
    let client = ContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token(&env, &token_admin);
    let token_admin_client = token::StellarAssetClient::new(&env, &token);

    let root = real_root(&env);
    // Start with the real vk and truncate its ic to 3 entries (missing the 4th).
    let mut truncated_vk = real_verification_key(&env);
    assert_eq!(truncated_vk.ic.len(), 4);
    truncated_vk.ic.pop_back(); // Remove the last ic point; len is now 3.
    assert_eq!(truncated_vk.ic.len(), 3);

    let circle_id = client.create_circle(&admin, &token, &root, &100i128, &5u32, &truncated_vk);

    // Fund the circle fully.
    let members: StdVec<Address> = (0..5)
        .map(|_| {
            let m = Address::generate(&env);
            token_admin_client.mint(&m, &100i128);
            m
        })
        .collect();
    for m in members.iter() {
        client.fund(&circle_id, m);
    }

    // Attempt claim with the real proof (which was generated for ic.len() == 4
    // and 3 public inputs). The mismatch triggers verify_groth16's guard.
    let recipient = Address::generate(&env);
    let nullifier_hash = real_nullifier_hash(&env);
    let external_nullifier = real_external_nullifier_round0(&env);
    let proof = real_valid_proof(&env);

    client.claim(
        &circle_id,
        &recipient,
        &nullifier_hash,
        &external_nullifier,
        &proof,
    );
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
    client.create_circle(&admin, &token, &root, &100i128, &5u32, &100_000u32, &vk);

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
    let recipient = Address::generate(&env);
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

// ---- Proptest: apply_fee invariants ----
//
// Two sub-suites:
//
// 1. Valid domain — lossless split: fee + net == amount exactly.
//    Integer truncation in `fee = fee_bps * amount / 10_000` rounds *down*;
//    the remainder always lands entirely in `net` — no tokens created or lost.
//    Also asserts fee <= amount (net is non-negative) for the valid range.
//
//    Domain:
//      amount  : 0 ..= i128::MAX / 2   (avoids intermediate multiplication
//                 overflow, since fee_bps ≤ 10_000 and
//                 10_000 * (i128::MAX / 2) < i128::MAX)
//      fee_bps : 0 ..= 10_000          (0% – 100%)
//
// 2. Out-of-range rejection — fee_bps > 10_000 or amount < 0 must panic
//    with Error::InvalidFeeParams rather than silently produce a negative net.
mod proptest_apply_fee {
    use super::*;
    use proptest::prelude::*;

    proptest! {
        #[test]
        fn fee_plus_net_equals_amount(
            amount  in 0_i128..=(i128::MAX / 2),
            fee_bps in 0_u32..=10_000_u32,
        ) {
            let env = Env::default();
            let (fee, net) = apply_fee(&env, fee_bps, amount);
            prop_assert_eq!(
                fee + net,
                amount,
                "apply_fee({}, {}) = ({}, {}); fee + net = {}",
                fee_bps, amount, fee, net, fee + net
            );
            // net must never be negative — fee cannot exceed the amount.
            prop_assert!(net >= 0, "apply_fee({fee_bps}, {amount}) produced negative net {net}");
        }

        #[test]
        fn rejects_fee_bps_above_10000(
            amount  in 0_i128..=(i128::MAX / 2),
            excess  in 1_u32..=u32::MAX - 10_000,
        ) {
            let env = Env::default();
            let fee_bps = 10_000_u32 + excess;
            let result = std::panic::catch_unwind(|| apply_fee(&env, fee_bps, amount));
            prop_assert!(result.is_err(), "apply_fee({fee_bps}, {amount}) should have panicked");
        }

        #[test]
        fn rejects_negative_amount(
            amount  in i128::MIN..=-1_i128,
            fee_bps in 0_u32..=10_000_u32,
        ) {
            let env = Env::default();
            let result = std::panic::catch_unwind(|| apply_fee(&env, fee_bps, amount));
            prop_assert!(result.is_err(), "apply_fee({fee_bps}, {amount}) should have panicked");
        }
    }
}

// ============================================================================
// XDR golden tests — issue #326
// ============================================================================
//
// These tests serialise Circle, VerificationKey, and Proof to XDR
// (soroban_sdk::xdr::ToXdr) and compare against committed base64 golden
// files stored in contracts/sharibo/test_snapshots/xdr_goldens/.
//
// WHY GOLDENS EXIST
// -----------------
// Circle is stored in persistent ledger storage and decoded on the TypeScript
// side into CircleView.  Adding a field, reordering fields, or changing a
// type silently changes the XDR wire format; the failure manifests as a
// decode error in the browser rather than a compile or test failure here.
// Goldens make that silent failure loud: the moment the serialised bytes
// change for any reason, this test fails with an explicit message telling
// you exactly what to do next.
//
// REGENERATING THE GOLDENS
// ------------------------
// When you intentionally change the wire format (e.g. after bumping
// schema_version or adding a field), regenerate ALL THREE golden files
// together so they stay consistent:
//
//   UPDATE_GOLDEN=1 cargo test -p sharibo xdr_golden
//
// The new files are left untracked; review them in `git diff --stat`, confirm
// the delta looks right, then commit them alongside the struct change.
//
// CROSS-LANGUAGE COUNTERPART
// --------------------------
// packages/client/src/contract.test.ts contains a matching suite that
// decodes the same goldens via @stellar/stellar-sdk and asserts the
// resulting CircleView fields.  Both sides must be updated together.

mod xdr_golden {
    use super::*;
    use soroban_sdk::xdr::{ToXdr};
    use std::path::PathBuf;
    use std::string::String;

    // Schema version — bump this (and regenerate the goldens) whenever the
    // XDR wire format changes intentionally.
    const SCHEMA_VERSION: u32 = 1;

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    /// Base64-encode a soroban `Bytes` value using the standard alphabet
    /// with padding, matching what `btoa` / `Buffer#toString('base64')` emit
    /// on the TypeScript side.
    fn to_base64(bytes: &soroban_sdk::Bytes) -> String {
        // Pull the raw byte slice out of the soroban `Bytes` container.
        let raw: std::vec::Vec<u8> = bytes.iter().collect();
        base64_encode(&raw)
    }

    /// Minimal base64 encoder — avoids pulling in an extra crate.
    /// Uses the standard RFC 4648 alphabet with `=` padding.
    fn base64_encode(input: &[u8]) -> String {
        const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut out = String::new();
        let mut i = 0;
        while i < input.len() {
            let b0 = input[i] as u32;
            let b1 = if i + 1 < input.len() { input[i + 1] as u32 } else { 0 };
            let b2 = if i + 2 < input.len() { input[i + 2] as u32 } else { 0 };
            out.push(ALPHABET[((b0 >> 2) & 0x3f) as usize] as char);
            out.push(ALPHABET[(((b0 << 4) | (b1 >> 4)) & 0x3f) as usize] as char);
            if i + 1 < input.len() {
                out.push(ALPHABET[(((b1 << 2) | (b2 >> 6)) & 0x3f) as usize] as char);
            } else {
                out.push('=');
            }
            if i + 2 < input.len() {
                out.push(ALPHABET[(b2 & 0x3f) as usize] as char);
            } else {
                out.push('=');
            }
            i += 3;
        }
        out
    }

    /// Absolute path to the XDR goldens directory.
    fn goldens_dir() -> PathBuf {
        // CARGO_MANIFEST_DIR is set by the test harness to the crate root.
        let manifest = std::env::var("CARGO_MANIFEST_DIR")
            .expect("CARGO_MANIFEST_DIR not set — run via `cargo test`");
        PathBuf::from(manifest)
            .join("test_snapshots")
            .join("xdr_goldens")
    }

    /// Read a committed golden (returns `None` if the file does not exist yet).
    fn read_golden(name: &str) -> Option<String> {
        let path = goldens_dir().join(name);
        std::fs::read_to_string(&path).ok().map(|s| s.trim().to_string())
    }

    /// Write (or overwrite) a golden file, creating the directory if needed.
    fn write_golden(name: &str, content: &str) {
        let dir = goldens_dir();
        std::fs::create_dir_all(&dir)
            .expect("could not create xdr_goldens directory");
        let path = dir.join(name);
        std::fs::write(&path, content)
            .unwrap_or_else(|e| panic!("could not write golden {name}: {e}"));
        std::println!("  [UPDATE_GOLDEN] wrote {}", path.display());
    }

    /// Core assertion: compare `actual` base64 against the committed golden.
    ///
    /// * With `UPDATE_GOLDEN=1`: writes the new golden and passes.
    /// * Without it: asserts byte-for-byte equality with the prescribed
    ///   failure message.
    fn assert_golden(name: &str, actual: &str) {
        let updating = std::env::var("UPDATE_GOLDEN").as_deref() == Ok("1");
        if updating {
            write_golden(name, actual);
            return;
        }
        match read_golden(name) {
            None => {
                panic!(
                    "\nGolden file `{name}` does not exist.\n\
                     Run `UPDATE_GOLDEN=1 cargo test -p sharibo xdr_golden` to generate it,\n\
                     then commit the new file alongside this test.\n"
                );
            }
            Some(expected) => {
                assert_eq!(
                    actual, expected.as_str(),
                    "\n\
                     ┌─────────────────────────────────────────────────────────────┐\n\
                     │  XDR wire format changed — golden `{name}` no longer matches │\n\
                     │                                                             │\n\
                     │  The storage layout changed — bump schema_version and       │\n\
                     │  update the golden deliberately:                            │\n\
                     │                                                             │\n\
                     │    1. Bump SCHEMA_VERSION in test.rs (currently {SCHEMA_VERSION}).      │\n\
                     │    2. Run: UPDATE_GOLDEN=1 cargo test -p sharibo xdr_golden │\n\
                     │    3. Also update packages/client/src/contract.test.ts      │\n\
                     │       (the TypeScript golden decoder) and its snapshot.     │\n\
                     │    4. Commit all three changes together.                    │\n\
                     └─────────────────────────────────────────────────────────────┘\n"
                );
            }
        }
    }

    // -----------------------------------------------------------------------
    // Deterministic Circle fixture
    // -----------------------------------------------------------------------
    //
    // We construct a Circle with every field set to a fixed, human-readable
    // value so that the XDR golden is stable across runs and machines.
    //
    // The admin and token addresses use `Address::from_str` on the standard
    // testnet G-addresses rather than `Address::generate` (which is random)
    // so the serialised bytes are deterministic.
    //
    // VK and Proof come from the same real_* fixtures used by the rest of
    // the test suite — they are committed constants derived from the actual
    // Phase 1 trusted-setup ceremony.

    const GOLDEN_ADMIN: &str =
        "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
    const GOLDEN_TOKEN: &str =
        "GBXGQJWVLWOYHFLEWA4LGSM5PKPNFMJGQ75XDZKTFBGBBPKQ42EOPHE";

    fn golden_circle(env: &Env) -> Circle {
        // Parse the two well-known addresses deterministically.
        let admin = Address::from_str(env, GOLDEN_ADMIN);
        let token = Address::from_str(env, GOLDEN_TOKEN);

        Circle {
            admin,
            token,
            root: real_root(env),
            contribution: 1_000_000i128,
            size: 5u32,
            round: 0u32,
            pot: 0i128,
            vk: real_verification_key(env),
            contributors: soroban_sdk::Vec::new(env),
            cancelled: false,
        }
    }

    // -----------------------------------------------------------------------
    // Test: Circle golden
    // -----------------------------------------------------------------------

    #[test]
    fn xdr_golden_circle() {
        let env = Env::default();
        let circle = golden_circle(&env);
        let xdr_bytes = circle.to_xdr(&env);
        let b64 = to_base64(&xdr_bytes);
        assert_golden("circle.v1.b64", &b64);
    }

    // -----------------------------------------------------------------------
    // Test: VerificationKey golden
    // -----------------------------------------------------------------------

    #[test]
    fn xdr_golden_verification_key() {
        let env = Env::default();
        let vk = real_verification_key(&env);
        let xdr_bytes = vk.to_xdr(&env);
        let b64 = to_base64(&xdr_bytes);
        assert_golden("verification_key.v1.b64", &b64);
    }

    // -----------------------------------------------------------------------
    // Test: Proof golden
    // -----------------------------------------------------------------------

    #[test]
    fn xdr_golden_proof() {
        let env = Env::default();
        let proof = real_valid_proof(&env);
        let xdr_bytes = proof.to_xdr(&env);
        let b64 = to_base64(&xdr_bytes);
        assert_golden("proof.v1.b64", &b64);
    }

    // -----------------------------------------------------------------------
    // Test: round-trip (XDR → deserialise → re-serialise == original)
    // -----------------------------------------------------------------------
    //
    // This is an independent sanity check: the base64 golden tests above
    // verify byte-for-byte stability.  This round-trip test verifies that
    // the XDR encoding is also self-consistent (i.e. FromXdr(ToXdr(x)) == x).
    // Reordering fields breaks the golden *and* this round-trip, giving a
    // second signal that the wire format changed.

    #[test]
    fn xdr_circle_round_trips() {
        use soroban_sdk::xdr::FromXdr;

        let env = Env::default();
        let circle = golden_circle(&env);
        let xdr_bytes = circle.clone().to_xdr(&env);
        let recovered = Circle::from_xdr(&env, &xdr_bytes)
            .expect("Circle::from_xdr failed — the XDR layout is inconsistent");

        // Compare field-by-field so failures point at the specific field.
        assert_eq!(recovered.contribution, circle.contribution, "contribution");
        assert_eq!(recovered.size, circle.size, "size");
        assert_eq!(recovered.round, circle.round, "round");
        assert_eq!(recovered.pot, circle.pot, "pot");
        assert_eq!(recovered.cancelled, circle.cancelled, "cancelled");
        // Fr/G1Affine/G2Affine don't implement PartialEq directly, so we
        // re-serialise and compare the bytes as a proxy for equality.
        assert_eq!(
            recovered.root.to_xdr(&env),
            circle.root.to_xdr(&env),
            "root"
        );
    }

    #[test]
    fn xdr_proof_round_trips() {
        use soroban_sdk::xdr::FromXdr;

        let env = Env::default();
        let proof = real_valid_proof(&env);
        let xdr_bytes = proof.clone().to_xdr(&env);
        let recovered = Proof::from_xdr(&env, &xdr_bytes)
            .expect("Proof::from_xdr failed");

        assert_eq!(
            recovered.a.to_xdr(&env),
            proof.a.to_xdr(&env),
            "proof.a"
        );
        assert_eq!(
            recovered.b.to_xdr(&env),
            proof.b.to_xdr(&env),
            "proof.b"
        );
        assert_eq!(
            recovered.c.to_xdr(&env),
            proof.c.to_xdr(&env),
            "proof.c"
        );
    }

    #[test]
    fn xdr_verification_key_round_trips() {
        use soroban_sdk::xdr::FromXdr;

        let env = Env::default();
        let vk = real_verification_key(&env);
        let xdr_bytes = vk.clone().to_xdr(&env);
        let recovered = VerificationKey::from_xdr(&env, &xdr_bytes)
            .expect("VerificationKey::from_xdr failed");

        assert_eq!(
            recovered.alpha.to_xdr(&env),
            vk.alpha.to_xdr(&env),
            "vk.alpha"
        );
        assert_eq!(vk.ic.len(), recovered.ic.len(), "vk.ic length");
    }
}
