import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const libraryUrl = new URL(process.env.ACAD_TS_DIST ?? '../dist/index.js', import.meta.url);
const { DwgReader, DxfReader } = await import(libraryUrl);

const root = fileURLToPath(new URL('../', import.meta.url));
const measuredRuns = 11;
const warmupRuns = 3;

const cases = [
  {
    name: 'DXF ASCII',
    path: 'samples/sample_AC1021_ascii.dxf',
    read: (bytes) => DxfReader.readFromStream(bytes),
  },
  {
    name: 'DXF binary',
    path: 'samples/sample_AC1021_binary.dxf',
    read: (bytes) => DxfReader.readFromStream(bytes),
  },
  {
    name: 'DWG',
    path: 'samples/sample_AC1021.dwg',
    read: (bytes) => DwgReader.readFromStream(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    ),
  },
];

const results = [];
for (const benchmark of cases) {
  const bytes = readFileSync(`${root}/${benchmark.path}`);
  for (let index = 0; index < warmupRuns; index++) {
    benchmark.read(bytes);
  }

  const durations = [];
  let entityCount = 0;
  for (let index = 0; index < measuredRuns; index++) {
    global.gc?.();
    const start = performance.now();
    const document = benchmark.read(bytes);
    durations.push(performance.now() - start);
    entityCount = document.entities.count;
  }

  durations.sort((left, right) => left - right);
  results.push({
    reader: benchmark.name,
    sizeMiB: Number((bytes.byteLength / 1024 / 1024).toFixed(2)),
    entities: entityCount,
    medianMs: Number(durations[Math.floor(durations.length / 2)].toFixed(2)),
    minMs: Number(durations[0].toFixed(2)),
  });
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(results));
} else {
  console.table(results);
}
