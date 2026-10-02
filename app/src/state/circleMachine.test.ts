import { ContractError } from "@sharibo/client";
import { toUiError } from "./circleMachine.js";

describe("toUiError", () => {
  const expected: Record<number, string> = {
    1: "error.circleNotFound",
    2: "error.roundNotFunded",
    3: "error.wrongRoundTag",
    4: "error.alreadyClaimed",
    5: "error.invalidProof",
    6: "error.roundFull",
    7: "error.overflow",
    8: "error.circleCancelled",
    9: "error.invalidFeeParams",
    10: "error.invalidCircleParams",
    11: "error.invalidRecipient",
    12: "error.roundNotExpired",
  };

  for (const [code, key] of Object.entries(expected)) {
    it(`maps contract code ${code}`, () => {
      expect(toUiError(new ContractError("contract failure", Number(code)))).toEqual({ key });
    });
  }
});
