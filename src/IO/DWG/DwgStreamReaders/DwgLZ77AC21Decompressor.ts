type CopyDelegate = (src: Uint8Array, srcIndex: number, dst: Uint8Array, dstIndex: number) => void;

export class DwgLZ77AC21Decompressor {
	public static decompress(source: Uint8Array, initialOffset: number, length: number, buffer: Uint8Array): void {
		if (!Number.isSafeInteger(initialOffset) || !Number.isSafeInteger(length) ||
			initialOffset < 0 || length < 0 || initialOffset + length > source.length) {
			throw new RangeError('Invalid LZ77AC21 source range.');
		}
		if (length === 0) return;

		// Decoder state kept in locals (was static _m_* fields) so V8 can register-allocate it.
		let sourceIndex: number = initialOffset;
		let opCode: number = source[sourceIndex];
		let runLength: number = 0;
		let sourceOffset: number = 0;
		let destIndex: number = 0;
		const endIndex: number = sourceIndex + length;

		++sourceIndex;

		if (sourceIndex >= endIndex) {
			return;
		}

		if ((opCode & 240) === 32) {
			sourceIndex += 3;
			runLength = source[sourceIndex - 1] & 7;
		}

		while (sourceIndex < endIndex) {
			// Literal run (inlined _nextIndex/_readLiteralLength)
			if (runLength === 0) {
				runLength = opCode + 8;
				if (runLength === 0x17) {
					let n: number = source[sourceIndex];
					++sourceIndex;
					runLength += n;

					if (n === 0xFF) {
						do {
							n = source[sourceIndex];
							++sourceIndex;
							n |= source[sourceIndex] << 8;
							++sourceIndex;
							runLength += n;
						} while (n === 0xFFFF);
					}
				}
			}

			DwgLZ77AC21Decompressor._copyRaw(source, sourceIndex, buffer, destIndex, runLength);
			sourceIndex += runLength;
			destIndex += runLength;

			if (sourceIndex >= endIndex) {
				break;
			}

			// Back-reference chunks (inlined _copyDecompressedChunks/_readInstructions)
			runLength = 0;
			opCode = source[sourceIndex];
			++sourceIndex;

			while (true) {
				switch (opCode >> 4) {
					case 0:
						runLength = (opCode & 0xF) + 0x13;
						sourceOffset = source[sourceIndex];
						++sourceIndex;
						opCode = source[sourceIndex];
						++sourceIndex;
						runLength = (opCode >> 3 & 0x10) + runLength;
						sourceOffset = ((opCode & 0x78) << 5) + 1 + sourceOffset;
						break;
					case 1:
						runLength = (opCode & 0xF) + 3;
						sourceOffset = source[sourceIndex];
						++sourceIndex;
						opCode = source[sourceIndex];
						++sourceIndex;
						sourceOffset = ((opCode & 248) << 5) + 1 + sourceOffset;
						break;
					case 2:
						sourceOffset = source[sourceIndex];
						++sourceIndex;
						sourceOffset = ((source[sourceIndex] << 8) & 0xFF00) | sourceOffset;
						++sourceIndex;
						runLength = opCode & 7;
						if ((opCode & 8) === 0) {
							opCode = source[sourceIndex];
							++sourceIndex;
							runLength = (opCode & 0xF8) + runLength;
						} else {
							++sourceOffset;
							runLength = ((source[sourceIndex] << 3) + runLength);
							++sourceIndex;
							opCode = source[sourceIndex];
							++sourceIndex;
							runLength = ((opCode & 0xF8) << 8) + runLength + 0x100;
						}
						break;
					default:
						runLength = opCode >> 4;
						sourceOffset = opCode & 15;
						opCode = source[sourceIndex];
						++sourceIndex;
						sourceOffset = ((opCode & 0xF8) << 1) + sourceOffset + 1;
						break;
				}

				DwgLZ77AC21Decompressor._copyBytes(buffer, destIndex, runLength, sourceOffset);

				destIndex += runLength;

				runLength = opCode & 0x07;

				if (runLength !== 0 || sourceIndex >= endIndex) {
					break;
				}

				opCode = source[sourceIndex];
				++sourceIndex;

				if (opCode >> 4 === 0) {
					break;
				}

				if (opCode >> 4 === 15) {
					opCode &= 15;
				}
			}
		}
	}

	private static _copyBytes(dst: Uint8Array, dstIndex: number, length: number, srcOffset: number): void {
		if (length === 0) {
			// Degenerate instructions encode a zero-length match; treat as no-op
			// like the pre-hardening decoder instead of rejecting the stream.
			return;
		}
		let initialIndex: number = dstIndex - srcOffset;
		if (!Number.isSafeInteger(length) || length < 0 || srcOffset <= 0 || initialIndex < 0 ||
			dstIndex < 0 || dstIndex + length > dst.length) {
			throw new RangeError('Invalid LZ77AC21 back-reference.');
		}
		const maxIndex: number = initialIndex + length;

		if (length > 16 && srcOffset >= length) {
			// Distance >= length: ranges cannot overlap, so a bulk move is byte-identical
			// to the forward byte copy required for self-referencing back-references.
			dst.copyWithin(dstIndex, initialIndex, maxIndex);
			return;
		}

		while (initialIndex < maxIndex) {
			dst[dstIndex++] = dst[initialIndex++];
		}
	}

	private static _copyRaw(src: Uint8Array, srcIndex: number, dst: Uint8Array, dstIndex: number, length: number): void {
		if (!Number.isSafeInteger(length) || length < 0 || srcIndex < 0 || dstIndex < 0 ||
			srcIndex + length > src.length || dstIndex + length > dst.length) {
			throw new RangeError('Invalid LZ77AC21 literal run.');
		}
		for (; length >= 32; length -= 32) {
			// Inlined scrambled block copy (4-byte groups in order 24,28,16,20,8,12,0,4)
			dst[dstIndex] = src[srcIndex + 24];
			dst[dstIndex + 1] = src[srcIndex + 25];
			dst[dstIndex + 2] = src[srcIndex + 26];
			dst[dstIndex + 3] = src[srcIndex + 27];
			dst[dstIndex + 4] = src[srcIndex + 28];
			dst[dstIndex + 5] = src[srcIndex + 29];
			dst[dstIndex + 6] = src[srcIndex + 30];
			dst[dstIndex + 7] = src[srcIndex + 31];
			dst[dstIndex + 8] = src[srcIndex + 16];
			dst[dstIndex + 9] = src[srcIndex + 17];
			dst[dstIndex + 10] = src[srcIndex + 18];
			dst[dstIndex + 11] = src[srcIndex + 19];
			dst[dstIndex + 12] = src[srcIndex + 20];
			dst[dstIndex + 13] = src[srcIndex + 21];
			dst[dstIndex + 14] = src[srcIndex + 22];
			dst[dstIndex + 15] = src[srcIndex + 23];
			dst[dstIndex + 16] = src[srcIndex + 8];
			dst[dstIndex + 17] = src[srcIndex + 9];
			dst[dstIndex + 18] = src[srcIndex + 10];
			dst[dstIndex + 19] = src[srcIndex + 11];
			dst[dstIndex + 20] = src[srcIndex + 12];
			dst[dstIndex + 21] = src[srcIndex + 13];
			dst[dstIndex + 22] = src[srcIndex + 14];
			dst[dstIndex + 23] = src[srcIndex + 15];
			dst[dstIndex + 24] = src[srcIndex];
			dst[dstIndex + 25] = src[srcIndex + 1];
			dst[dstIndex + 26] = src[srcIndex + 2];
			dst[dstIndex + 27] = src[srcIndex + 3];
			dst[dstIndex + 28] = src[srcIndex + 4];
			dst[dstIndex + 29] = src[srcIndex + 5];
			dst[dstIndex + 30] = src[srcIndex + 6];
			dst[dstIndex + 31] = src[srcIndex + 7];

			srcIndex += 32;
			dstIndex += 32;
		}
		if (length <= 0) {
			return;
		}

		DwgLZ77AC21Decompressor._m_copyMethods[length]!(src, srcIndex, dst, dstIndex);
	}

	private static _copy1b(src: Uint8Array, srcIndex: number, dst: Uint8Array, dstIndex: number): void {
		dst[dstIndex] = src[srcIndex];
	}

	private static _copy2b(src: Uint8Array, srcIndex: number, dst: Uint8Array, dstIndex: number): void {
		dst[dstIndex] = src[srcIndex + 1];
		dst[dstIndex + 1] = src[srcIndex];
	}

	private static _copy3b(src: Uint8Array, srcIndex: number, dst: Uint8Array, dstIndex: number): void {
		dst[dstIndex] = src[srcIndex + 2];
		dst[dstIndex + 1] = src[srcIndex + 1];
		dst[dstIndex + 2] = src[srcIndex];
	}

	private static _copy4b(src: Uint8Array, srcIndex: number, dst: Uint8Array, dstIndex: number): void {
		dst[dstIndex] = src[srcIndex];
		dst[dstIndex + 1] = src[srcIndex + 1];
		dst[dstIndex + 2] = src[srcIndex + 2];
		dst[dstIndex + 3] = src[srcIndex + 3];
	}

	private static _copy8b(src: Uint8Array, srcIndex: number, dst: Uint8Array, dstIndex: number): void {
		DwgLZ77AC21Decompressor._copy4b(src, srcIndex, dst, dstIndex);
		DwgLZ77AC21Decompressor._copy4b(src, srcIndex + 4, dst, dstIndex + 4);
	}

	private static _copy16b(src: Uint8Array, srcIndex: number, dst: Uint8Array, dstIndex: number): void {
		DwgLZ77AC21Decompressor._copy8b(src, srcIndex + 8, dst, dstIndex);
		DwgLZ77AC21Decompressor._copy8b(src, srcIndex, dst, dstIndex + 8);
	}

	private static readonly _m_copyMethods: (CopyDelegate | null)[] = [
		null,
		(src, si, dst, di) => { DwgLZ77AC21Decompressor._copy1b(src, si, dst, di); },
		(src, si, dst, di) => { DwgLZ77AC21Decompressor._copy2b(src, si, dst, di); },
		(src, si, dst, di) => { DwgLZ77AC21Decompressor._copy3b(src, si, dst, di); },
		(src, si, dst, di) => { DwgLZ77AC21Decompressor._copy4b(src, si, dst, di); },
		(src, si, dst, di) => {
			DwgLZ77AC21Decompressor._copy1b(src, si + 4, dst, di);
			DwgLZ77AC21Decompressor._copy4b(src, si, dst, di + 1);
		},
		(src, si, dst, di) => {
			DwgLZ77AC21Decompressor._copy1b(src, si + 5, dst, di);
			DwgLZ77AC21Decompressor._copy4b(src, si + 1, dst, di + 1);
			DwgLZ77AC21Decompressor._copy1b(src, si, dst, di + 5);
		},
		(src, si, dst, di) => {
			DwgLZ77AC21Decompressor._copy2b(src, si + 5, dst, di);
			DwgLZ77AC21Decompressor._copy4b(src, si + 1, dst, di + 2);
			DwgLZ77AC21Decompressor._copy1b(src, si, dst, di + 6);
		},
		(src, si, dst, di) => { DwgLZ77AC21Decompressor._copy8b(src, si, dst, di); },
		(src, si, dst, di) => {
			DwgLZ77AC21Decompressor._copy1b(src, si + 8, dst, di);
			DwgLZ77AC21Decompressor._copy8b(src, si, dst, di + 1);
		},
		(src, si, dst, di) => {
			DwgLZ77AC21Decompressor._copy1b(src, si + 9, dst, di);
			DwgLZ77AC21Decompressor._copy8b(src, si + 1, dst, di + 1);
			DwgLZ77AC21Decompressor._copy1b(src, si, dst, di + 9);
		},
		(src, si, dst, di) => {
			DwgLZ77AC21Decompressor._copy2b(src, si + 9, dst, di);
			DwgLZ77AC21Decompressor._copy8b(src, si + 1, dst, di + 2);
			DwgLZ77AC21Decompressor._copy1b(src, si, dst, di + 10);
		},
		(src, si, dst, di) => {
			DwgLZ77AC21Decompressor._copy4b(src, si + 8, dst, di);
			DwgLZ77AC21Decompressor._copy8b(src, si, dst, di + 4);
		},
		(src, si, dst, di) => {
			DwgLZ77AC21Decompressor._copy1b(src, si + 12, dst, di);
			DwgLZ77AC21Decompressor._copy4b(src, si + 8, dst, di + 1);
			DwgLZ77AC21Decompressor._copy8b(src, si, dst, di + 5);
		},
		(src, si, dst, di) => {
			DwgLZ77AC21Decompressor._copy1b(src, si + 13, dst, di);
			DwgLZ77AC21Decompressor._copy4b(src, si + 9, dst, di + 1);
			DwgLZ77AC21Decompressor._copy8b(src, si + 1, dst, di + 5);
			DwgLZ77AC21Decompressor._copy1b(src, si, dst, di + 13);
		},
		(src, si, dst, di) => {
			DwgLZ77AC21Decompressor._copy2b(src, si + 13, dst, di);
			DwgLZ77AC21Decompressor._copy4b(src, si + 9, dst, di + 2);
			DwgLZ77AC21Decompressor._copy8b(src, si + 1, dst, di + 6);
			DwgLZ77AC21Decompressor._copy1b(src, si, dst, di + 14);
		},
		(src, si, dst, di) => { DwgLZ77AC21Decompressor._copy16b(src, si, dst, di); },
		(src, si, dst, di) => {
			DwgLZ77AC21Decompressor._copy8b(src, si + 9, dst, di);
			DwgLZ77AC21Decompressor._copy1b(src, si + 8, dst, di + 8);
			DwgLZ77AC21Decompressor._copy8b(src, si, dst, di + 9);
		},
		(src, si, dst, di) => {
			DwgLZ77AC21Decompressor._copy1b(src, si + 17, dst, di);
			DwgLZ77AC21Decompressor._copy16b(src, si + 1, dst, di + 1);
			DwgLZ77AC21Decompressor._copy1b(src, si, dst, di + 17);
		},
		(src, si, dst, di) => {
			DwgLZ77AC21Decompressor._copy3b(src, si + 16, dst, di);
			DwgLZ77AC21Decompressor._copy16b(src, si, dst, di + 3);
		},
		(src, si, dst, di) => {
			DwgLZ77AC21Decompressor._copy4b(src, si + 16, dst, di);
			DwgLZ77AC21Decompressor._copy8b(src, si + 8, dst, di + 4);
			DwgLZ77AC21Decompressor._copy8b(src, si, dst, di + 12);
		},
		(src, si, dst, di) => {
			DwgLZ77AC21Decompressor._copy1b(src, si + 20, dst, di);
			DwgLZ77AC21Decompressor._copy4b(src, si + 16, dst, di + 1);
			DwgLZ77AC21Decompressor._copy8b(src, si + 8, dst, di + 5);
			DwgLZ77AC21Decompressor._copy8b(src, si, dst, di + 13);
		},
		(src, si, dst, di) => {
			DwgLZ77AC21Decompressor._copy2b(src, si + 20, dst, di);
			DwgLZ77AC21Decompressor._copy4b(src, si + 16, dst, di + 2);
			DwgLZ77AC21Decompressor._copy8b(src, si + 8, dst, di + 6);
			DwgLZ77AC21Decompressor._copy8b(src, si, dst, di + 14);
		},
		(src, si, dst, di) => {
			DwgLZ77AC21Decompressor._copy3b(src, si + 20, dst, di);
			DwgLZ77AC21Decompressor._copy4b(src, si + 16, dst, di + 3);
			DwgLZ77AC21Decompressor._copy8b(src, si + 8, dst, di + 7);
			DwgLZ77AC21Decompressor._copy8b(src, si, dst, di + 15);
		},
		(src, si, dst, di) => {
			DwgLZ77AC21Decompressor._copy8b(src, si + 16, dst, di);
			DwgLZ77AC21Decompressor._copy16b(src, si, dst, di + 8);
		},
		(src, si, dst, di) => {
			DwgLZ77AC21Decompressor._copy8b(src, si + 17, dst, di);
			DwgLZ77AC21Decompressor._copy1b(src, si + 16, dst, di + 8);
			DwgLZ77AC21Decompressor._copy16b(src, si, dst, di + 9);
		},
		(src, si, dst, di) => {
			DwgLZ77AC21Decompressor._copy1b(src, si + 25, dst, di);
			DwgLZ77AC21Decompressor._copy8b(src, si + 17, dst, di + 1);
			DwgLZ77AC21Decompressor._copy1b(src, si + 16, dst, di + 9);
			DwgLZ77AC21Decompressor._copy16b(src, si, dst, di + 10);
		},
		(src, si, dst, di) => {
			DwgLZ77AC21Decompressor._copy2b(src, si + 25, dst, di);
			DwgLZ77AC21Decompressor._copy8b(src, si + 17, dst, di + 2);
			DwgLZ77AC21Decompressor._copy1b(src, si + 16, dst, di + 10);
			DwgLZ77AC21Decompressor._copy16b(src, si, dst, di + 11);
		},
		(src, si, dst, di) => {
			DwgLZ77AC21Decompressor._copy4b(src, si + 24, dst, di);
			DwgLZ77AC21Decompressor._copy8b(src, si + 16, dst, di + 4);
			DwgLZ77AC21Decompressor._copy8b(src, si + 8, dst, di + 12);
			DwgLZ77AC21Decompressor._copy8b(src, si, dst, di + 20);
		},
		(src, si, dst, di) => {
			DwgLZ77AC21Decompressor._copy1b(src, si + 28, dst, di);
			DwgLZ77AC21Decompressor._copy4b(src, si + 24, dst, di + 1);
			DwgLZ77AC21Decompressor._copy8b(src, si + 16, dst, di + 5);
			DwgLZ77AC21Decompressor._copy8b(src, si + 8, dst, di + 13);
			DwgLZ77AC21Decompressor._copy8b(src, si, dst, di + 21);
		},
		(src, si, dst, di) => {
			DwgLZ77AC21Decompressor._copy2b(src, si + 28, dst, di);
			DwgLZ77AC21Decompressor._copy4b(src, si + 24, dst, di + 2);
			DwgLZ77AC21Decompressor._copy8b(src, si + 16, dst, di + 6);
			DwgLZ77AC21Decompressor._copy8b(src, si + 8, dst, di + 14);
			DwgLZ77AC21Decompressor._copy8b(src, si, dst, di + 22);
		},
		(src, si, dst, di) => {
			DwgLZ77AC21Decompressor._copy1b(src, si + 30, dst, di);
			DwgLZ77AC21Decompressor._copy4b(src, si + 26, dst, di + 1);
			DwgLZ77AC21Decompressor._copy8b(src, si + 18, dst, di + 5);
			DwgLZ77AC21Decompressor._copy8b(src, si + 10, dst, di + 13);
			DwgLZ77AC21Decompressor._copy8b(src, si + 2, dst, di + 21);
			DwgLZ77AC21Decompressor._copy2b(src, si, dst, di + 29);
		},
	];
}
