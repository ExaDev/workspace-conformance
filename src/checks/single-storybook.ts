import { posix } from 'node:path';

import type { CheckFunction } from '../check';
import { excludedFrom, findDirectories } from '../files';
import type { SingleStorybookOptions } from '../options';

const STORYBOOK_DIRECTORY = '.storybook';

/**
 * At most one Storybook exists, in the permitted directory (the workspace root unless the options say otherwise), and none in a package such as a UI package. A Storybook is a `.storybook` directory.
 */
export const singleStorybook: CheckFunction<SingleStorybookOptions> = async ({ cwd, options }) => {
  const location = posix.normalize(options.location ?? '.');
  const permitted = posix.normalize(posix.join(location, STORYBOOK_DIRECTORY));
  const found = await findDirectories(cwd, [`**/${STORYBOOK_DIRECTORY}`, ...excludedFrom(options.exclude)]);

  return found
    .filter((directory) => directory !== permitted)
    .map((directory) => ({
      code: 'single-storybook/misplaced',
      message: `${directory} is a Storybook outside ${location === '.' ? 'the workspace root' : location}; keep the one Storybook there`,
      file: directory,
    }));
};
