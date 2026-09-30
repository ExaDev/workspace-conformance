import { types } from './types';

export default { rules: { 'type-enum': [2, 'always', types.map((entry) => entry.type)] } };
