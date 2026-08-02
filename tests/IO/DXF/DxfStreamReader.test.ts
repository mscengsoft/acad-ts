import { describe, expect, it } from 'vitest';
import { DxfTextReader } from '../../../src/IO/DXF/DxfStreamReader/DxfTextReader.js';

function createReader(lines: string[]): DxfTextReader {
  return new DxfTextReader(new TextEncoder().encode(`${lines.join('\r\n')}\r\n`));
}

describe('DxfTextReader', () => {
  it('decodes hexadecimal chunks without losing the raw value', () => {
    const reader = createReader(['310', '00ff7A']);

    reader.readNext();

		expect(reader.value).toEqual(Uint8Array.of(0x00, 0xFF, 0x7A));
    expect(reader.valueAsBinaryChunk).toEqual(Uint8Array.of(0x00, 0xFF, 0x7A));
    expect(reader.valueRaw).toBe('00ff7A');
  });

  it('preserves odd and invalid hexadecimal chunk behavior', () => {
    const oddReader = createReader(['310', 'F']);
    oddReader.readNext();
    expect(oddReader.valueAsBinaryChunk).toEqual(Uint8Array.of(0x0F));

    const partiallyValidReader = createReader(['310', '0G']);
    partiallyValidReader.readNext();
    expect(partiallyValidReader.valueAsBinaryChunk).toEqual(Uint8Array.of(0));

    const invalidReader = createReader(['310', 'G0']);
    invalidReader.readNext();
    expect(invalidReader.valueAsBinaryChunk).toEqual(new Uint8Array(0));
  });

  it('parses signed integers lazily while retaining their raw representation', () => {
    const reader = createReader(['90', '  -42  ']);

    reader.readNext();

    expect(reader.valueAsInt).toBe(-42);
    expect(reader.valueRaw).toBe('-42');
  });

  it('normalizes DXF caret escapes in string values', () => {
    const reader = createReader(['1', 'A^JB^MC^ID^ E']);

    reader.readNext();

    expect(reader.valueAsString).toBe('A\nB\rC\tD^E');
    expect(reader.valueRaw).toBe('A^JB^MC^ID^ E');
  });
});
