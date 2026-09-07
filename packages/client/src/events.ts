export type SdkEvent =
  | { type: "rpc:attempt" }
  | { type: "rpc:retry"; attempt: number; delay: number; error: unknown }
  | { type: "rpc:success"; duration: number }
  | { type: "tx:submitted"; hash: string }
  | { type: "tx:confirmed"; hash: string }
  | { type: "proof:started" }
  | { type: "proof:finished" };

export type OnEventFn = (event: SdkEvent) => void;

export class SdkEventEmitter {
  constructor(private onEvent?: OnEventFn) {}

  emit(event: SdkEvent) {
    if (this.onEvent) {
      this.onEvent(event);
    }
  }
}
