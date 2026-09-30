import type { Writable } from 'node:stream';

/**
 * The `code` of the error a write fails with when the process reading the other end of the pipe has already exited, as `head` does after enough lines.
 */
const CLOSED_PIPE = 'EPIPE';

/**
 * Handle the failure of writes to `stream` after its reader has gone away: `onClosed` is called, and nothing is thrown, because the output has nowhere to go and is not an error of the checks. Any other stream error is rethrown, which fails the process.
 */
export function onReaderClosed(stream: Writable, onClosed: () => void): void {
  stream.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code !== CLOSED_PIPE) {
      throw error;
    }
    onClosed();
  });
}
