export interface Table<Row> {
  readonly $inferSelect: Row;
}

export type InferSelectModel<Source extends Table<unknown>> = Source['$inferSelect'];

export declare const users: Table<{ readonly id: string }>;
