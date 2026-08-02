import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const libraryUrl = new URL(process.env.ACAD_TS_DIST ?? '../dist/index.js', import.meta.url);
const { DwgReader, DxfReader, DwgWriter, DxfWriter } = await import(libraryUrl);

const root = fileURLToPath(new URL('../', import.meta.url));
const measuredRuns = 11;
const warmupRuns = 3;
const outputCapacity = 64 * 1024 * 1024;

const dxfBytes = readFileSync(`${root}/samples/sample_AC1021_ascii.dxf`);
const dwgBytes = readFileSync(`${root}/samples/sample_AC1021.dwg`);
const dxfDocument = DxfReader.readFromStream(dxfBytes);
const dwgDocument = DwgReader.readFromStream(
  dwgBytes.buffer.slice(dwgBytes.byteOffset, dwgBytes.byteOffset + dwgBytes.byteLength),
);

const cases = [
  {
    name: 'DXF ASCII write',
    write: (target) => DxfWriter.writeToStream(target, dxfDocument, false),
  },
  {
    name: 'DXF binary write',
    write: (target) => DxfWriter.writeToStream(target, dxfDocument, true),
  },
  {
    name: 'DWG write',
    write: (target) => DwgWriter.writeToStream(target, dwgDocument),
  },
];

const results = [];
for (const benchmark of cases) {
  const target = new Uint8Array(outputCapacity);
  for (let index = 0; index < warmupRuns; index++) {
    benchmark.write(target);
  }

  const durations = [];
  for (let index = 0; index < measuredRuns; index++) {
    global.gc?.();
    const start = performance.now();
    benchmark.write(target);
    durations.push(performance.now() - start);
  }

  durations.sort((left, right) => left - right);
  results.push({
    writer: benchmark.name,
    medianMs: Number(durations[Math.floor(durations.length / 2)].toFixed(2)),
    minMs: Number(durations[0].toFixed(2)),
  });
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(results));
} else {
  console.table(results);
}
