import { DxfMapBase, lockDxfProperties } from './DxfMapBase.js';
import { DxfClassMap } from './DxfClassMap.js';
import { DxfProperty } from './DxfProperty.js';
import { getClassMetadata } from './Metadata/MetadataStore.js';

export class DxfMap extends DxfMapBase {
	private static readonly _cache: Map<string, DxfMap> = new Map();

	public subClasses: Map<string, DxfClassMap> = new Map();

	// Single-entry memo for the per-token subclass lookups in the section
	// readers. Invalidated via the size guard: reader-side mutations only
	// ever ADD subclass entries (dimension subtype maps), never replace one.
	private _lastSubclassName: string | null = null;
	private _lastSubclass: DxfClassMap | undefined;
	private _lastSubclassSize: number = -1;

	public getSubclass(name: string): DxfClassMap | undefined {
		if (name === this._lastSubclassName && this._lastSubclassSize === this.subClasses.size) {
			return this._lastSubclass;
		}
		const result = this.subClasses.get(name);
		this._lastSubclassName = name;
		this._lastSubclass = result;
		this._lastSubclassSize = this.subClasses.size;
		return result;
	}

	public static create(type: Function | string, name?: string): DxfMap {
		const typeName = typeof type === 'string' ? type : type.name;
		if (DxfMap._cache.has(typeName)) {
			return DxfMap._clone(DxfMap._cache.get(typeName)!, name);
		}

		const map = new DxfMap();
		const metadata = getClassMetadata(typeName);
		map.name = name ?? metadata?.dxfName ?? "";

		let isDimensionStyle = false;
		let current = metadata;
		while (current) {
			if (current.typeName === 'DimensionStyle') {
				isDimensionStyle = true;
			}

			if (current.typeName === 'CadObject') {
				DxfMap.addClassProperties(map, current.typeName);
				break;
			}

			if (current.dxfSubClassName && current.dxfSubClassIsEmpty) {
				const classMap = [...map.subClasses.values()].at(-1);
				if (classMap) {
					DxfMap.addClassProperties(classMap, current.typeName);
				}

				map.subClasses.set(current.dxfSubClassName, new DxfClassMap(current.dxfSubClassName));
			} else if (current.dxfSubClassName) {
				const classMap = new DxfClassMap(current.dxfSubClassName);
				DxfMap.addClassProperties(classMap, current.typeName);
				map.subClasses.set(classMap.name, classMap);
			}

			current = current.baseTypeName ? getClassMetadata(current.baseTypeName) : undefined;
		}

		if (isDimensionStyle && map.dxfProperties.has(5)) {
			map.dxfProperties.set(105, map.dxfProperties.get(5)!);
			map.dxfProperties.delete(5);
		}

		if (map.subClasses.size > 1) {
			map.subClasses = new Map([...map.subClasses.entries()].reverse());
		}

		// Cached maps (and their subclass maps) are shared across every clone
		// and read; lock so accidental mutation fails loudly instead of
		// corrupting subsequent documents.
		lockDxfProperties(map);
		for (const subClass of map.subClasses.values()) {
			lockDxfProperties(subClass);
		}
		DxfMap._cache.set(typeName, map);
		return DxfMap._clone(map, name);
	}

	public static clearCache(): void {
		DxfMap._cache.clear();
	}

	public toString(): string {
		return `DxfMap:${this.name}`;
	}

	private static _clone(source: DxfMap, name?: string): DxfMap {
		const map = new DxfMap();
		map.name = name ?? source.name;
		// dxfProperties is never mutated after construction (only subClasses is),
		// so clones can share the cached Map instead of copying it per entity.
		map.dxfProperties = source.dxfProperties;
		map.subClasses = new Map(source.subClasses);
		return map;
	}
}
