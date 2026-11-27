// Requests come from another process. Check their shape before they reach the database.

export function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function integer(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be a whole number from ${min} to ${max}`);
  }
  return value;
}

export function id(value: unknown, name: string): number {
  return integer(value, name, 1, Number.MAX_SAFE_INTEGER);
}

export function boolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${name} must be true or false`);
  return value;
}

export function text(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== 'string' || value.length > maxLength) {
    throw new Error(`${name} must be a text of at most ${maxLength} characters`);
  }
  return value;
}

export function oneOf<Option extends string>(
  value: unknown,
  name: string,
  options: readonly Option[],
): Option {
  if (!options.includes(value as Option)) {
    throw new Error(`${name} must be one of: ${options.join(', ')}`);
  }
  return value as Option;
}

export function timestamps(value: unknown, name: string, maxLength: number): number[] {
  if (!Array.isArray(value) || value.length > maxLength) {
    throw new Error(`${name} must be a list of at most ${maxLength} entries`);
  }
  return value.map((entry) => integer(entry, name, 0, Number.MAX_SAFE_INTEGER));
}

export function idList(value: unknown, name: string, maxLength: number): number[] {
  if (!Array.isArray(value) || value.length > maxLength) {
    throw new Error(`${name} must be a list of at most ${maxLength} entries`);
  }
  return value.map((entry) => id(entry, name));
}
