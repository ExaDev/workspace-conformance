export interface Customer {
  readonly id: string;
}

export type Invoice = {
  readonly id: string;
  readonly total: number;
};

interface Internal {
  readonly secret: string;
}

export const notAType = 1;

export type UsesInternal = Internal;
