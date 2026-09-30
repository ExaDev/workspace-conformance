export interface Customer {
  readonly id: string;
}

export type Invoice = {
  readonly id: string;
  readonly total: number;
};
