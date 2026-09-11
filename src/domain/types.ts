export interface Link {
  readonly id: string;
  readonly url: string;
  readonly title: string;
  readonly tags: readonly string[];
  /** ISO-8601 timestamp. */
  readonly createdAt: string;
  readonly read: boolean;
}

export interface NewLink {
  readonly url: string;
  readonly title?: string;
  readonly tags?: readonly string[];
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends Error {
  constructor(id: string) {
    super(`No link with id ${id}`);
    this.name = 'NotFoundError';
  }
}
