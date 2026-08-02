import { ICompressor } from './ICompressor.js';

/**
 * @see DwgLZ77AC21Decompressor
 */
export class DwgLZ77AC21Compressor implements ICompressor {
	compress(_source: Uint8Array, _offset: number, _totalSize: number): Uint8Array {
		throw new Error('AC1021 DWG compression is not supported yet.');
	}
}
