import { describe, expect, it } from 'vitest';

import { commandLines, commandSegments, scriptCommands } from './shared';

describe('commandLines', () => {
  it('joins lines ended by a backslash and drops comments and blank lines', () => {
    expect(commandLines('# build\nnpm run build \\\n  --flag\n\n  echo done\n')).toEqual(['npm run build --flag', 'echo done']);
  });

  it('keeps a trailing continuation as the last line', () => {
    expect(commandLines('echo a \\')).toEqual(['echo a']);
  });
});

describe('commandSegments', () => {
  it('splits at operators outside quotes only', () => {
    expect(commandSegments('git add . && git commit -m "a; b" || echo \'x | y\'; git push')).toEqual(['git add .', 'git commit -m "a; b"', "echo 'x | y'", 'git push']);
  });

  it('does not split inside an expression or at a redirection', () => {
    expect(commandSegments('echo ${{ a || b }} && git push origin main 2>&1 | tee log')).toEqual(['echo ${{ a || b }}', 'git push origin main 2>&1', 'tee log']);
    expect(commandSegments('make &>out.log; make >&2')).toEqual(['make &>out.log', 'make >&2']);
    expect(commandSegments('sleep 1 & echo ${{ unterminated')).toEqual(['sleep 1', 'echo ${{ unterminated']);
  });

  it('drops the variable assignments that prefix a command', () => {
    expect(commandSegments('HUSKY=0 CI=true pnpm exec semantic-release')).toEqual(['pnpm exec semantic-release']);
  });
});

describe('scriptCommands', () => {
  it('reads every command of a script, and none of no script', () => {
    expect(scriptCommands('a && b\nc')).toEqual(['a', 'b', 'c']);
    expect(scriptCommands(undefined)).toEqual([]);
  });
});
