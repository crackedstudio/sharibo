use soroban_sdk::contractevent;
use soroban_sdk::Address;

#[contractevent(topics = ["circle", "created"], data_format = "map")]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CircleCreated {
    #[topic]
    pub circle_id: u64,
    pub admin: Address,
    pub token: Address,
    pub contrib: i128,
    pub size: u32,
}

#[contractevent(topics = ["circle", "funded"], data_format = "map")]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CircleFunded {
    #[topic]
    pub circle_id: u64,
    pub from: Address,
    pub pot: i128,
    pub target: i128,
}

#[contractevent(topics = ["circle", "claimed"], data_format = "map")]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CircleClaimed {
    #[topic]
    pub circle_id: u64,
    pub cround: u32,
    pub payout: i128,
    pub recipient: Address,
}

#[contractevent(topics = ["prop_adm"], data_format = "map")]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdminProposed {
    #[topic]
    pub circle_id: u64,
    pub old_admin: Address,
    pub new_admin: Address,
}

#[contractevent(topics = ["acc_adm"], data_format = "map")]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdminAccepted {
    #[topic]
    pub circle_id: u64,
    pub old_admin: Address,
    pub new_admin: Address,
}

#[contractevent(topics = ["rnd_exp"], data_format = "map")]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RoundExpired {
    #[topic]
    pub circle_id: u64,
    pub eround: u32,
}

#[contractevent(topics = ["circle", "cancelled"], data_format = "map")]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CircleCancelled {
    #[topic]
    pub circle_id: u64,
    pub rcount: u32,
    pub rtotal: i128,
}
