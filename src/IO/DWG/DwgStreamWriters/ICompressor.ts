export interface ICompressor {
	/** Compresses `totalSize` bytes of `source` starting at `offset` and returns the compressed bytes. */
	compress(source: Uint8Array, offset: number, totalSize: number): Uint8Array;
}
