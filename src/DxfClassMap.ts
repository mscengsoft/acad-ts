import { DxfMapBase, lockDxfProperties } from './DxfMapBase.js';
import { DxfProperty } from './DxfProperty.js';
import { getClassMetadata } from './Metadata/MetadataStore.js';

export class DxfClassMap extends DxfMapBase {
	private static readonly _cache: Map<string, DxfClassMap> = new Map();

	constructor(name?: string);
	constructor(map: DxfClassMap);
	constructor(arg?: string | DxfClassMap) {
		super();
		if (arg instanceof DxfClassMap) {
			this.name = arg.name;
			// dxfProperties is never mutated after construction, so cloned class maps
			// can share the cached Map instead of copying every property entry.
			this.dxfProperties = arg.dxfProperties;
		} else if (typeof arg === 'string') {
			this.name = arg;
		}
	}

	public static createFromType(typeName: string, name?: string): DxfClassMap {
		// Class maps are read-only after construction (readers/writers only call
		// dxfProperties.get/has/iterate) and their DxfProperty values are already
		// shared by the previous shallow clones, so the cached instance can be
		// returned directly instead of copying the property map on every call.
		const cached = DxfClassMap._cache.get(typeName);
		if (cached) {
			return cached;
		}

		const classMap = new DxfClassMap();
		const metadata = getClassMetadata(typeName);
		if (!name && metadata?.dxfSubClassName == null) {
			throw new Error(`${typeName} is not a DXF subclass`);
		}

		classMap.name = name ?? metadata?.dxfSubClassName ?? typeName;
		DxfClassMap.addClassProperties(classMap, typeName);

		const baseMetadata = metadata?.baseTypeName ? getClassMetadata(metadata.baseTypeName) : undefined;
		if (baseMetadata?.dxfSubClassIsEmpty) {
			DxfClassMap.addClassProperties(classMap, baseMetadata.typeName);
		}

		// The cached instance is shared by all future calls; lock it so any
		// accidental mutation fails loudly instead of corrupting later reads.
		lockDxfProperties(classMap);
		DxfClassMap._cache.set(typeName, classMap);
		return classMap;
	}

	public static create(type: Function | string, name?: string): DxfClassMap {
		const typeName = typeof type === 'string' ? type : type.name;
		return DxfClassMap.createFromType(typeName, name);
	}

	public clearCache(): void {
		DxfClassMap._cache.clear();
	}

	public toString(): string {
		return `DxfClassMap:${this.name}`;
	}
}
