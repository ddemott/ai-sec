export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainError";
  }
}

export class AvailabilityError extends DomainError {
  constructor(message = "The requested time slot is no longer available.") {
    super(message);
    this.name = "AvailabilityError";
  }
}

export class ValidationError extends DomainError {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}
