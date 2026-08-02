import { DxfProperty } from './DxfProperty.js';
import { getClassPropertyMetadata } from './Metadata/MetadataStore.js';

/**
 * Map that can be locked once construction is complete. Cached DxfMap and
 * DxfClassMap instances share their dxfProperties across every clone (and
 * every subsequent document read), so silent mutation would corrupt all
 * later reads; locking turns that into an immediate, actionable error.
 * Note Object.freeze cannot do this — Map entries live in internal slots.
 */
export class LockableDxfPropertyMap extends Map<number, DxfProperty> {
	private _locked = false;

	public lock(): this {
		this._locked = true;
		return this;
	}

	public override set(key: number, value: DxfProperty): this {
		if (this._locked) throw new Error('This DXF map is a shared cached instance; its dxfProperties are read-only. Create a copy before mutating.');
		return super.set(key, value);
	}

	public override delete(key: number): boolean {
		if (this._locked) throw new Error('This DXF map is a shared cached instance; its dxfProperties are read-only. Create a copy before mutating.');
		return super.delete(key);
	}

	public override clear(): void {
		if (this._locked) throw new Error('This DXF map is a shared cached instance; its dxfProperties are read-only. Create a copy before mutating.');
		super.clear();
	}
}

export function lockDxfProperties(map: DxfMapBase): void {
	const locked = new LockableDxfPropertyMap();
	for (const [code, property] of map.dxfProperties) {
		locked.set(code, property);
	}
	map.dxfProperties = locked.lock();
}

export abstract class DxfMapBase {
	public name: string = "";
	public dxfProperties: Map<number, DxfProperty> = new Map();

	// Dense lookup table over the small DXF group-code range. Map.get on the
	// per-code path is the single hottest operation in DXF reading; an indexed
	// array load is several times cheaper. Built lazily and re-built if the
	// property map is ever mutated afterwards (size guard).
	private _codeIndex: (DxfProperty | undefined)[] | null = null;
	private _codeIndexSize = -1;

	public getProperty(code: number): DxfProperty | undefined {
		if (code >= 0 && code < 1072) {
			let index = this._codeIndex;
			if (index === null || this._codeIndexSize !== this.dxfProperties.size) {
				index = new Array(1072);
				for (const [c, property] of this.dxfProperties) {
					if (c >= 0 && c < 1072) index[c] = property;
				}
				this._codeIndex = index;
				this._codeIndexSize = this.dxfProperties.size;
			}
			return index[code];
		}
		return this.dxfProperties.get(code);
	}

	protected static addClassProperties(map: DxfMapBase, type: Function | string, obj?: object): void {
		for (const [code, property] of DxfMapBase.cadObjectMapDxf(type)) {
			map.dxfProperties.set(code, property);
			if (obj != null) {
				property.storedValue = property.getRawValue(obj);
			}
		}
	}

	protected static *cadObjectMapDxf(type: Function | string): IterableIterator<[number, DxfProperty]> {
		for (const metadata of getClassPropertyMetadata(type)) {
			for (const code of metadata.valueCodes) {
				yield [code, new DxfProperty(code, metadata)];
			}
		}
	}
}
