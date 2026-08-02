import { describe, expect, it } from 'vitest';
import { DwgLZ77AC18Decompressor } from '../../../src/IO/DWG/DwgStreamReaders/DwgLZ77AC18Decompressor.js';
import { DwgLZ77AC21Decompressor } from '../../../src/IO/DWG/DwgStreamReaders/DwgLZ77AC21Decompressor.js';
import { DwgReader } from '../../../src/IO/DWG/DwgReader.js';
import { DwgReaderConfiguration } from '../../../src/IO/DWG/DwgReaderConfiguration.js';
import { getDwgFiles, readFileAsArrayBuffer } from '../../testHelpers.js';

describe('DWG decompressor input validation', () => {
  it('rejects invalid AC18 allocation sizes and offsets', () => {
    expect(() => DwgLZ77AC18Decompressor.decompress(Uint8Array.of(0x11), 0, -1)).toThrow(RangeError);
    expect(() => DwgLZ77AC18Decompressor.decompressToDest(
      Uint8Array.of(0x11),
      2,
      new Uint8Array(1),
    )).toThrow(RangeError);
  });

  it('rejects truncated AC18 literal lengths', () => {
    expect(() => DwgLZ77AC18Decompressor.decompress(
      Uint8Array.of(0x00, 0x00),
      0,
      16,
    )).toThrow(/literal length/i);
  });

  it('rejects invalid AC21 source ranges', () => {
    expect(() => DwgLZ77AC21Decompressor.decompress(
      Uint8Array.of(0),
      1,
      1,
      new Uint8Array(8),
    )).toThrow(RangeError);
  });

  it('enforces the configured decompressed section limit', () => {
    const sample = getDwgFiles().find((file) => file.fileName.includes('AC1018'));
    expect(sample).toBeDefined();

    const configuration = new DwgReaderConfiguration();
    configuration.maxDecompressedSectionSize = 1;

    expect(() => DwgReader.readFromStreamWithConfig(
      readFileAsArrayBuffer(sample!.path),
      configuration,
    )).toThrow(/configured limit/i);
  });
});
