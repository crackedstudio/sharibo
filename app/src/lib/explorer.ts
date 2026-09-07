import { config } from "../config.js";

export function explorerTx(hash: string): string {
  return `https://stellar.expert/explorer/testnet/tx/${hash}`;
}
export function explorerAccount(address: string): string {
  return `https://stellar.expert/explorer/testnet/account/${address}`;
}
export function explorerContract(): string {
  return `https://stellar.expert/explorer/testnet/contract/${config.contractId}`;
}
export function short(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}
