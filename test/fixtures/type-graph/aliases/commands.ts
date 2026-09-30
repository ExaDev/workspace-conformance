import type { infer as Infer } from 'zod';
import { z } from 'zod';

const create = z.strictObject({ sku: z.string() });

type Base = z.infer<typeof create>;
type Deeper = Base;
type Loose = { readonly id: string };
type Generic<Value> = Value;

export type Direct = z.infer<typeof create>;
export type ViaIntermediate = Base;
export type ViaTwoAliases = Deeper;
export type Renamed = Infer<typeof create>;
export type ViaHandWritten = Loose;
export type ViaGeneric = Generic<Base>;
