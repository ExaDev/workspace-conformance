export interface Ship {
  readonly orderId: string;
}

export interface CustomSchema<Value> {
  readonly '~standard': {
    readonly version: 1;
    readonly vendor: 'custom';
    readonly validate: (value: unknown) => { readonly value: Value };
    readonly types?: { readonly input: Value; readonly output: Value };
  };
}

export type output<Schema extends CustomSchema<never>> = NonNullable<Schema['~standard']['types']>['output'];

export declare const ship: CustomSchema<Ship>;
