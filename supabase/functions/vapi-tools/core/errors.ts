export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainError";
  }
}

export class AvailabilityError extends DomainError {
  public readonly code: string;
  
  constructor(message = "The requested time slot is no longer available.", code = "NO_AVAILABILITY") {
    super(message);
    this.name = "AvailabilityError";
    this.code = code;
  }
}

export class ValidationError extends DomainError {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}
