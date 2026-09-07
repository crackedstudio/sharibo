export class ShariboError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class InvalidInputError extends ShariboError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}
