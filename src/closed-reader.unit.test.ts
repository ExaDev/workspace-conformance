import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { onReaderClosed } from './closed-reader';

function writeError(code: string): NodeJS.ErrnoException {
  const error: NodeJS.ErrnoException = new Error(`write ${code}`);
  error.code = code;

  return error;
}

describe('onReaderClosed', () => {
  it('calls back when a write fails because the reader has gone', () => {
    const stream = new PassThrough();
    let closed = 0;
    onReaderClosed(stream, () => {
      closed += 1;
    });

    stream.emit('error', writeError('EPIPE'));

    expect(closed).toBe(1);
  });

  it('rethrows any other stream error', () => {
    const stream = new PassThrough();
    let closed = 0;
    onReaderClosed(stream, () => {
      closed += 1;
    });

    expect(() => stream.emit('error', writeError('EIO'))).toThrow('write EIO');
    expect(closed).toBe(0);
  });
});
