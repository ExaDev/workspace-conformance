import type * as dependencyCruiser from 'dependency-cruiser';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConformanceError } from '../errors';
import { importsLayout } from '../../test/support/layouts';
import { fixturePath, removeTempDirs } from '../../test/support/temp';
import { importUphill } from './import-uphill';

const transpilers = vi.hoisted(() => ({ typescript: { name: 'typescript', version: '>=2.0.0 <7.0.0', available: false } }));

vi.mock('dependency-cruiser', async (importOriginal) => {
  const original = await importOriginal<typeof dependencyCruiser>();

  return { ...original, getAvailableTranspilers: () => [transpilers.typescript] };
});

afterEach(removeTempDirs);

describe('an import check when dependency-cruiser cannot load TypeScript', () => {
  it('fails instead of reporting a clean workspace', async () => {
    const run = importUphill({ cwd: fixturePath('imports', 'violating'), layout: importsLayout, options: {} });

    await expect(run).rejects.toThrow(ConformanceError);
    await expect(run).rejects.toThrow("install a version in >=2.0.0 <7.0.0 as the 'typescript' of this workspace");
  });
});
