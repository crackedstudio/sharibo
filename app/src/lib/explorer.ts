import { config } from "../config.js";

export function explorerTx(hash: string): string {
  return `https://stellar.expert/explorer/testnet/tx/${hash}`;
}
export function explorerAccount(address: string): string {
  return `https://stellar.expert/explorer/testnet/account/${address}`;
}
export function explorerContract(): string {
  // `config` is null when validation failed; the app renders the setup screen
  // in that case, so an empty contract id here is never actually linked.
  return `https://stellar.expert/explorer/testnet/contract/${config?.contractId ?? ""}`;
}
export function short(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}
