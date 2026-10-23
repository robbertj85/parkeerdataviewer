// Server-only: where the API routes read the hourly data files. In the Docker
// image the worker's volume is mounted here (PARKING_DATA_DIR); locally it is
// public/data. turbopackIgnore keeps Next from tracing the whole data dir into
// the standalone bundle.
import path from 'node:path';

const DATA_DIR = path.resolve(
  /*turbopackIgnore: true*/ process.env.PARKING_DATA_DIR || 'public/data',
);

export const dataPath = (...parts: string[]) => path.join(/*turbopackIgnore: true*/ DATA_DIR, ...parts);
