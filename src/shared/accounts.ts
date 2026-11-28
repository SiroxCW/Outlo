import type { WebAccountKind } from './api';

// The domains Microsoft hands out for personal mailboxes, in all their country variants.
const PERSONAL = /@(outlook|hotmail|live|msn|windowslive)\.[a-z]{2,3}(\.[a-z]{2})?$/i;

// A first guess from the address, for the choice in the add-account dialog. A personal Microsoft
// account can have any address, so the user can always choose differently.
export function guessWebAccountKind(email: string): WebAccountKind {
  return PERSONAL.test(email.trim()) ? 'personal' : 'work';
}
