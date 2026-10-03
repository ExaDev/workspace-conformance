import type { User } from './user';

export function encodeUser(user: User): string {
  return JSON.stringify(user);
}

export const decodeUser = (text: string): User => {
  const [id = '', name = ''] = text.split(',');

  return { id, name };
};

export function normaliseName(name: string): string {
  return name.trim();
}

export interface encodeOptions {
  readonly pretty: boolean;
}
