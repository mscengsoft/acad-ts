import { DxfCode } from './DxfCode.js';
import { GroupCodeValueType } from './GroupCodeValueType.js';

const groupCodeTypes = new Uint8Array(1072);
const setGroupCodeType = (start: number, end: number, type: GroupCodeValueType): void => {
	groupCodeTypes.fill(type, start, end + 1);
};

setGroupCodeType(0, 4, GroupCodeValueType.String);
groupCodeTypes[5] = GroupCodeValueType.Handle;
setGroupCodeType(6, 9, GroupCodeValueType.String);
setGroupCodeType(10, 39, GroupCodeValueType.Point3D);
setGroupCodeType(40, 59, GroupCodeValueType.Double);
setGroupCodeType(60, 79, GroupCodeValueType.Int16);
setGroupCodeType(90, 99, GroupCodeValueType.Int32);
setGroupCodeType(100, 102, GroupCodeValueType.String);
groupCodeTypes[105] = GroupCodeValueType.Handle;
setGroupCodeType(110, 149, GroupCodeValueType.Double);
setGroupCodeType(160, 169, GroupCodeValueType.Int64);
setGroupCodeType(170, 179, GroupCodeValueType.Int16);
setGroupCodeType(210, 239, GroupCodeValueType.Double);
setGroupCodeType(270, 279, GroupCodeValueType.Int16);
setGroupCodeType(280, 289, GroupCodeValueType.Byte);
setGroupCodeType(290, 299, GroupCodeValueType.Bool);
setGroupCodeType(300, 309, GroupCodeValueType.String);
setGroupCodeType(310, 319, GroupCodeValueType.Chunk);
setGroupCodeType(320, 329, GroupCodeValueType.Handle);
setGroupCodeType(330, 369, GroupCodeValueType.ObjectId);
setGroupCodeType(370, 389, GroupCodeValueType.Int16);
setGroupCodeType(390, 399, GroupCodeValueType.ObjectId);
setGroupCodeType(400, 409, GroupCodeValueType.Int16);
setGroupCodeType(410, 419, GroupCodeValueType.String);
setGroupCodeType(420, 429, GroupCodeValueType.Int32);
setGroupCodeType(430, 439, GroupCodeValueType.String);
setGroupCodeType(440, 459, GroupCodeValueType.Int32);
setGroupCodeType(460, 469, GroupCodeValueType.Double);
setGroupCodeType(470, 479, GroupCodeValueType.String);
setGroupCodeType(480, 481, GroupCodeValueType.Handle);
groupCodeTypes[999] = GroupCodeValueType.Comment;
setGroupCodeType(1000, 1003, GroupCodeValueType.ExtendedDataString);
groupCodeTypes[1004] = GroupCodeValueType.ExtendedDataChunk;
setGroupCodeType(1005, 1009, GroupCodeValueType.ExtendedDataHandle);
setGroupCodeType(1010, 1059, GroupCodeValueType.ExtendedDataDouble);
setGroupCodeType(1060, 1070, GroupCodeValueType.ExtendedDataInt16);
groupCodeTypes[1071] = GroupCodeValueType.ExtendedDataInt32;

export class GroupCodeValue {
	public static isValidCode(code: DxfCode, value: unknown): boolean {
		return GroupCodeValue.isValidGroupCode(GroupCodeValue.transformValue(code as number), value);
	}

	public static isValidGroupCode(groupCode: GroupCodeValueType, value: unknown): boolean {
		switch (groupCode) {
			case GroupCodeValueType.String:
			case GroupCodeValueType.ExtendedDataString:
			case GroupCodeValueType.Comment:
				return typeof value === 'string';
			case GroupCodeValueType.Point3D:
				return value != null && typeof value === 'object';
			case GroupCodeValueType.Double:
			case GroupCodeValueType.ExtendedDataDouble:
				return typeof value === 'number';
			case GroupCodeValueType.Byte:
				return typeof value === 'number';
			case GroupCodeValueType.Int16:
			case GroupCodeValueType.ExtendedDataInt16:
				return typeof value === 'number';
			case GroupCodeValueType.Int32:
			case GroupCodeValueType.ExtendedDataInt32:
				return typeof value === 'number';
			case GroupCodeValueType.Int64:
				return typeof value === 'number' || typeof value === 'bigint';
			case GroupCodeValueType.Handle:
			case GroupCodeValueType.ObjectId:
			case GroupCodeValueType.ExtendedDataHandle:
				return typeof value === 'number';
			case GroupCodeValueType.Bool:
				return typeof value === 'boolean';
			case GroupCodeValueType.Chunk:
			case GroupCodeValueType.ExtendedDataChunk:
				return value instanceof Uint8Array || Array.isArray(value);
			case GroupCodeValueType.None:
			default:
				return false;
		}
	}

	public static transformValue(code: number): GroupCodeValueType {
		if (code < 0 || code >= groupCodeTypes.length) {
			return GroupCodeValueType.None;
		}
		return (groupCodeTypes[code] ?? GroupCodeValueType.None) as GroupCodeValueType;
	}
}

export { GroupCodeValueType } from './GroupCodeValueType.js';
