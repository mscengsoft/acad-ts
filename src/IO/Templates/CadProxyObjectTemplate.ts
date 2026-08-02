import { ProxyObject } from '../../Objects/ProxyObject.js';
import { CadTemplate } from './CadTemplate.js';

export class CadProxyObjectTemplate extends CadTemplate<ProxyObject> {
	entries: number[] = [];
	private readonly _binaryDataChunks: Uint8Array[] = [];
	private readonly _dataChunks: Uint8Array[] = [];
	private _binaryDataLength: number = 0;
	private _dataLength: number = 0;

	constructor(obj?: ProxyObject) {
		super(obj ?? new ProxyObject());
	}

	addBinaryDataChunk(chunk: Uint8Array): void {
		this._binaryDataChunks.push(chunk);
		this._binaryDataLength += chunk.length;
	}

	addDataChunk(chunk: Uint8Array): void {
		this._dataChunks.push(chunk);
		this._dataLength += chunk.length;
	}

	finalizeData(): void {
		const proxy = this.cadObject as ProxyObject;
		proxy.binaryData = this._concatChunks(this._binaryDataChunks, this._binaryDataLength);
		proxy.data = this._concatChunks(this._dataChunks, this._dataLength);
	}

	private _concatChunks(chunks: Uint8Array[], length: number): Uint8Array | null {
		if (chunks.length === 0) return null;
		if (chunks.length === 1) return new Uint8Array(chunks[0]);

		const result = new Uint8Array(length);
		let offset = 0;
		for (const chunk of chunks) {
			result.set(chunk, offset);
			offset += chunk.length;
		}
		return result;
	}
}
