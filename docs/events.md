# Contract Events

This document describes the event schema emitted by the Sharibo contract. Each event is typed via a `#[contractevent]` struct, making the schema discoverable by indexers and SDK clients without reading Rust source.

## Event Types

| Event Struct      | Topic(s)              | Data Fields                                                                        |
| ----------------- | --------------------- | ---------------------------------------------------------------------------------- |
| `CircleCreated`   | `circle`, `created`   | `circle_id: u64`, `admin: Address`, `token: Address`, `contrib: i128`, `size: u32` |
| `CircleFunded`    | `circle`, `funded`    | `circle_id: u64`, `from: Address`, `pot: i128`, `target: i128`                     |
| `CircleClaimed`   | `circle`, `claimed`   | `circle_id: u64`, `cround: u32`, `payout: i128`, `recipient: Address`              |
| `AdminProposed`   | `prop_adm`            | `circle_id: u64`, `old_admin: Address`, `new_admin: Address`                       |
| `AdminAccepted`   | `acc_adm`             | `circle_id: u64`, `old_admin: Address`, `new_admin: Address`                       |
| `RoundExpired`    | `rnd_exp`             | `circle_id: u64`, `eround: u32`                                                    |
| `CircleCancelled` | `circle`, `cancelled` | `circle_id: u64`, `rcount: u32`, `rtotal: i128`                                    |

## Topic Format

Each event has fixed symbol topics followed by dynamic topic fields. The first topic(s) identify the event type; subsequent topics carry indexed values (e.g. `circle_id`) for efficient filtering.

## Data Format

Data fields are emitted as a `Map<Symbol, Val>` keyed by the field names listed above. Indexers and clients can deserialize the map to access named fields.

## Event Lifecycle

- **CircleCreated** — emitted once per `create_circle` call
- **CircleFunded** — emitted once per `fund` call
- **CircleClaimed** — emitted once per `claim` call
- **AdminProposed** — emitted once per `propose_admin` call
- **AdminAccepted** — emitted once per `accept_admin` call
- **RoundExpired** — emitted once per `expire_round` call
- **CircleCancelled** — emitted once per `cancel_circle` call

## Source

Event definitions are in `contracts/sharibo/src/events.rs`. Each struct uses the `#[contractevent]` macro from `soroban-sdk` with `data_format = "map"`.
