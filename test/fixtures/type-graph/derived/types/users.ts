import { type InferSelectModel, users } from '../schemas/users';

export type User = InferSelectModel<typeof users>;

export type UserRow = typeof users.$inferSelect;
