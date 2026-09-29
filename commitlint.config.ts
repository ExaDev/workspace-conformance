import { RuleConfigSeverity, type UserConfig } from '@commitlint/types';

import { commitTypes } from './release.config';

const config: UserConfig = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [RuleConfigSeverity.Error, 'always', commitTypes.map((t) => t.type)],
  },
};

export default config;
