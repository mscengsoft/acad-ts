import { ACadVersion } from '../../../ACadVersion.js';
import { Color } from '../../../Color.js';
import { CadHeader } from '../../../Header/CadHeader.js';
import { AngularDirection } from '../../../Types/Units/AngularDirection.js';
import { AttributeVisibilityMode } from '../../../Header/AttributeVisibilityMode.js';
import { ObjectSnapMode } from '../../../Header/ObjectSnapMode.js';
import { SpaceLineTypeScaling } from '../../../Header/SpaceLineTypeScaling.js';
import { EntityPlotStyleType } from '../../../Header/EntityPlotStyleType.js';
import { ObjectSortingFlags } from '../../../Header/ObjectSortingFlags.js';
import { IndexCreationFlags } from '../../../Header/IndexCreationFlags.js';
import { DimensionAssociation } from '../../../Header/DimensionAssociation.js';
import { ShadowMode } from '../../../Header/ShadowMode.js';
import { XClipFrameType } from '../../../Header/XClipFrameType.js';
import { SplineType } from '../../../Header/SplineType.js';
import { ShadeEdgeType } from '../../../Header/ShadeEdgeType.js';
import { LinearUnitFormat } from '../../../Types/Units/LinearUnitFormat.js';
import { AngularUnitFormat } from '../../../Types/Units/AngularUnitFormat.js';
import { UnitsType } from '../../../Types/Units/UnitsType.js';
import { LineWeightType } from '../../../Types/LineWeightType.js';
import { NotificationType } from '../../NotificationEventHandler.js';
import { DwgSectionIO } from '../DwgSectionIO.js';
import { DwgSectionDefinition } from '../FileHeaders/DwgSectionDefinition.js';
import { DwgHeaderHandlesCollection } from '../DwgHeaderHandlesCollection.js';
import { IDwgStreamReader } from './IDwgStreamReader.js';
import { DwgStreamReaderBase } from './DwgStreamReaderBase.js';
import { DwgMergedReader } from './DwgMergedReader.js';

export class DwgHeaderReader extends DwgSectionIO {
	override get sectionName(): string {
		return DwgSectionDefinition.header;
	}

	private _reader: IDwgStreamReader;
	private _header: CadHeader;

	constructor(version: ACadVersion, reader: IDwgStreamReader, header: CadHeader) {
		super(version);
		this._reader = reader;
		this._header = header;
		this._header.version = version;
	}

	public read(acadMaintenanceVersion: number): { objectPointers: DwgHeaderHandlesCollection } {
		const mainreader = this._reader;
		const objectPointers = new DwgHeaderHandlesCollection();

		this.checkSentinel(this._reader, DwgSectionDefinition.startSentinels.get(this.sectionName)!);

		const size: number = this._reader.readRawLong();

		if (this.r2010Plus && acadMaintenanceVersion > 3 || this.r2018Plus) {
			const unknown: number = this._reader.readRawLong();
		}

		const initialPos: number = this._reader.positionInBits();

		if (this.r2007Plus) {
			const sizeInBits: number = this._reader.readRawLong();
			const lastPositionInBits: number = initialPos + sizeInBits - 1;

			const textReader: IDwgStreamReader = DwgStreamReaderBase.getStreamHandler(
				this._version, this._reader.stream);
			textReader.setPositionByFlag(lastPositionInBits);

			const referenceReader: IDwgStreamReader = DwgStreamReaderBase.getStreamHandler(
				this._version, this._reader.stream);
			referenceReader.setPositionInBits(lastPositionInBits + 1);

			this._reader = new DwgMergedReader(this._reader, textReader, referenceReader);
		}

		// Monomorphic local: this._reader is re-typed above (plain reader -> merged),
		// so property loads through the field stay polymorphic for all ~600 reads.
		const reader = this._reader;

		if (this.r2013Plus) {
			this._header.requiredVersions = reader.readBitLongLong();
		}

		// Common: Unknown values
		reader.readBitDouble();
		reader.readBitDouble();
		reader.readBitDouble();
		reader.readBitDouble();
		reader.readVariableText();
		reader.readVariableText();
		reader.readVariableText();
		reader.readVariableText();
		reader.readBitLong();
		reader.readBitLong();

		if (this.r13_14Only) {
			reader.readBitShort();
		}

		if (this.r2004Pre) {
			reader.handleReference();
		}

		// Common
		this._header.associatedDimensions = reader.readBit();
		this._header.updateDimensionsWhileDragging = reader.readBit();

		if (this.r13_14Only) {
			this._header.dimsav = reader.readBit() ? 1 : 0;
		}

		this._header.polylineLineTypeGeneration = reader.readBit();
		this._header.orthoMode = reader.readBit();
		this._header.regenerationMode = reader.readBit() ? 1 : 0;
		this._header.fillMode = reader.readBit();
		this._header.quickTextMode = reader.readBit();
		this._header.paperSpaceLineTypeScaling = reader.readBit() ? SpaceLineTypeScaling.Normal : SpaceLineTypeScaling.Viewport;
		this._header.limitCheckingOn = reader.readBit();

		if (this.r13_14Only) {
			this._header.blipMode = reader.readBit();
		}

		if (this.r2004Plus) {
			reader.readBit();
		}

		this._header.userTimer = reader.readBit();
		this._header.sketchPolylineType = (reader.readBit() ? 1 : 0) as SplineType;
		this._header.angularDirection = reader.readBitAsShort() as AngularDirection;
		this._header.showSplineControlPoints = reader.readBit();

		if (this.r13_14Only) {
			reader.readBit();
			reader.readBit();
		}

		this._header.mirrorText = reader.readBit();
		this._header.worldView = reader.readBit();

		if (this.r13_14Only) {
			reader.readBit();
		}

		this._header.showModelSpace = reader.readBit();
		this._header.paperSpaceLimitsChecking = reader.readBit();
		this._header.retainXRefDependentVisibilitySettings = reader.readBit();

		if (this.r13_14Only) {
			reader.readBit();
		}

		this._header.displaySilhouetteCurves = reader.readBit();
		this._header.createEllipseAsPolyline = reader.readBit();
		this._header.proxyGraphics = reader.readBitShortAsBool();

		if (this.r13_14Only) {
			reader.readBitShort();
		}

		this._header.spatialIndexMaxTreeDepth = reader.readBitShort();
		this._header.linearUnitFormat = reader.readBitShort() as LinearUnitFormat;
		const linearUnitPrecision = reader.readBitShort();
		if (linearUnitPrecision >= 0 && linearUnitPrecision <= 8) {
			this._header.linearUnitPrecision = linearUnitPrecision;
		}
		this._header.angularUnit = reader.readBitShort() as AngularUnitFormat;
		const angularUnitPrecision = reader.readBitShort();
		if (angularUnitPrecision >= 0 && angularUnitPrecision <= 8) {
			this._header.angularUnitPrecision = angularUnitPrecision;
		}

		if (this.r13_14Only) {
			this._header.objectSnapMode = reader.readBitShort() as ObjectSnapMode;
		}

		this._header.attributeVisibility = reader.readBitShort() as AttributeVisibilityMode;

		if (this.r13_14Only) {
			reader.readBitShort();
		}

		this._header.pointDisplayMode = reader.readBitShort();

		if (this.r13_14Only) {
			reader.readBitShort();
		}

		if (this.r2004Plus) {
			reader.readBitLong();
			reader.readBitLong();
			reader.readBitLong();
		}

		this._header.userShort1 = reader.readBitShort();
		this._header.userShort2 = reader.readBitShort();
		this._header.userShort3 = reader.readBitShort();
		this._header.userShort4 = reader.readBitShort();
		this._header.userShort5 = reader.readBitShort();

		this._header.numberOfSplineSegments = reader.readBitShort();
		this._header.surfaceDensityM = reader.readBitShort();
		this._header.surfaceDensityM = reader.readBitShort();
		this._header.surfaceType = reader.readBitShort();
		this._header.surfaceTabulation1 = reader.readBitShort();
		this._header.surfaceTabulation2 = reader.readBitShort();
		this._header.splineType = reader.readBitShort() as SplineType;
		this._header.shadeEdge = reader.readBitShort() as ShadeEdgeType;
		this._header.shadeDiffuseToAmbientPercentage = reader.readBitShort();
		this._header.unitMode = reader.readBitShort();
		this._header.maxViewportCount = reader.readBitShort();
		const surfaceIsoLineCount = reader.readBitShort();
		if (surfaceIsoLineCount >= 0 && surfaceIsoLineCount <= 2047) {
			this._header.surfaceIsolineCount = surfaceIsoLineCount;
		}
		this._header.currentMultiLineJustification = reader.readBitShort();
		const textQuality = reader.readBitShort();
		if (textQuality >= 0 && textQuality <= 100) {
			this._header.textQuality = textQuality;
		}
		this._header.lineTypeScale = reader.readBitDouble();
		this._header.textHeightDefault = reader.readBitDouble();
		this._header.traceWidthDefault = reader.readBitDouble();
		this._header.sketchIncrement = reader.readBitDouble();
		this._header.filletRadius = reader.readBitDouble();
		this._header.thicknessDefault = reader.readBitDouble();
		this._header.angleBase = reader.readBitDouble();
		this._header.pointDisplaySize = reader.readBitDouble();
		this._header.polylineWidthDefault = reader.readBitDouble();
		this._header.userDouble1 = reader.readBitDouble();
		this._header.userDouble2 = reader.readBitDouble();
		this._header.userDouble3 = reader.readBitDouble();
		this._header.userDouble4 = reader.readBitDouble();
		this._header.userDouble5 = reader.readBitDouble();
		this._header.chamferDistance1 = reader.readBitDouble();
		this._header.chamferDistance2 = reader.readBitDouble();
		this._header.chamferLength = reader.readBitDouble();
		this._header.chamferAngle = reader.readBitDouble();
		const facetResolution = reader.readBitDouble();
		if (facetResolution > 0 && facetResolution <= 10) {
			this._header.facetResolution = facetResolution;
		}
		this._header.currentMultilineScale = reader.readBitDouble();
		this._header.currentEntityLinetypeScale = reader.readBitDouble();

		this._header.menuFileName = reader.readVariableText();

		this._header.createDateTime = reader.readDateTime();
		this._header.updateDateTime = reader.readDateTime();

		if (this.r2004Plus) {
			reader.readBitLong();
			reader.readBitLong();
			reader.readBitLong();
		}

		this._header.totalEditingTime = reader.readTimeSpan();
		this._header.userElapsedTimeSpan = reader.readTimeSpan();

		this._header.currentEntityColor = reader.readCmColor();

		this._header.handleSeed = mainreader.handleReference();

		objectPointers.clayer = reader.handleReference();
		objectPointers.textstyle = reader.handleReference();
		objectPointers.celtype = reader.handleReference();

		if (this.r2007Plus) {
			objectPointers.cmaterial = reader.handleReference();
		}

		objectPointers.dimstyle = reader.handleReference();
		objectPointers.cmlstyle = reader.handleReference();

		if (this.r2000Plus) {
			this._header.viewportDefaultViewScaleFactor = reader.readBitDouble();
		}

		this._header.paperSpaceInsertionBase = reader.read3BitDouble();
		this._header.paperSpaceExtMin = reader.read3BitDouble();
		this._header.paperSpaceExtMax = reader.read3BitDouble();
		this._header.paperSpaceLimitsMin = reader.read2RawDouble();
		this._header.paperSpaceLimitsMax = reader.read2RawDouble();
		this._header.paperSpaceElevation = reader.readBitDouble();
		this._header.paperSpaceUcs.origin = reader.read3BitDouble();
		this._header.paperSpaceXAxis = reader.read3BitDouble();
		this._header.paperSpaceYAxis = reader.read3BitDouble();

		objectPointers.ucsname_pspace = reader.handleReference();

		if (this.r2000Plus) {
			objectPointers.pucsorthoref = reader.handleReference();
			reader.readBitShort(); // PUCSORTHOVIEW
			objectPointers.pucsbase = reader.handleReference();

			this._header.paperSpaceOrthographicTopDOrigin = reader.read3BitDouble();
			this._header.paperSpaceOrthographicBottomDOrigin = reader.read3BitDouble();
			this._header.paperSpaceOrthographicLeftDOrigin = reader.read3BitDouble();
			this._header.paperSpaceOrthographicRightDOrigin = reader.read3BitDouble();
			this._header.paperSpaceOrthographicFrontDOrigin = reader.read3BitDouble();
			this._header.paperSpaceOrthographicBackDOrigin = reader.read3BitDouble();
		}

		this._header.modelSpaceInsertionBase = reader.read3BitDouble();
		this._header.modelSpaceExtMin = reader.read3BitDouble();
		this._header.modelSpaceExtMax = reader.read3BitDouble();
		this._header.modelSpaceLimitsMin = reader.read2RawDouble();
		this._header.modelSpaceLimitsMax = reader.read2RawDouble();
		this._header.elevation = reader.readBitDouble();
		this._header.modelSpaceOrigin = reader.read3BitDouble();
		this._header.modelSpaceXAxis = reader.read3BitDouble();
		this._header.modelSpaceYAxis = reader.read3BitDouble();

		objectPointers.ucsname_mspace = reader.handleReference();

		if (this.r2000Plus) {
			objectPointers.ucsorthoref = reader.handleReference();
			reader.readBitShort(); // UCSORTHOVIEW
			objectPointers.ucsbase = reader.handleReference();

			this._header.modelSpaceOrthographicTopDOrigin = reader.read3BitDouble();
			this._header.modelSpaceOrthographicBottomDOrigin = reader.read3BitDouble();
			this._header.modelSpaceOrthographicLeftDOrigin = reader.read3BitDouble();
			this._header.modelSpaceOrthographicRightDOrigin = reader.read3BitDouble();
			this._header.modelSpaceOrthographicFrontDOrigin = reader.read3BitDouble();
			this._header.modelSpaceOrthographicBackDOrigin = reader.read3BitDouble();

			this._header.dimensionPostFix = reader.readVariableText();
			this._header.dimensionAlternateDimensioningSuffix = reader.readVariableText();
		}

		if (this.r13_14Only) {
			this._header.dimensionGenerateTolerances = reader.readBit();
			this._header.dimensionLimitsGeneration = reader.readBit();
			this._header.dimensionTextInsideHorizontal = reader.readBit();
			this._header.dimensionTextOutsideHorizontal = reader.readBit();
			this._header.dimensionSuppressFirstExtensionLine = reader.readBit();
			this._header.dimensionSuppressSecondExtensionLine = reader.readBit();
			this._header.dimensionAlternateUnitDimensioning = reader.readBit();
			this._header.dimensionTextOutsideExtensions = reader.readBit();
			this._header.dimensionSeparateArrowBlocks = reader.readBit();
			this._header.dimensionTextInsideExtensions = reader.readBit();
			this._header.dimensionSuppressOutsideExtensions = reader.readBit();
			this._header.dimensionAlternateUnitDecimalPlaces = reader.readRawChar();
			this._header.dimensionZeroHandling = reader.readRawChar();
			this._header.dimensionSuppressFirstDimensionLine = reader.readBit();
			this._header.dimensionSuppressSecondDimensionLine = reader.readBit();
			this._header.dimensionToleranceAlignment = reader.readRawChar();
			this._header.dimensionTextHorizontalAlignment = reader.readRawChar();
			this._header.dimensionFit = reader.readRawChar();
			this._header.dimensionCursorUpdate = reader.readBit();
			this._header.dimensionToleranceZeroHandling = reader.readRawChar();
			this._header.dimensionAlternateUnitZeroHandling = reader.readRawChar();
			this._header.dimensionAlternateUnitToleranceZeroHandling = reader.readRawChar();
			this._header.dimensionTextVerticalAlignment = reader.readRawChar();
			this._header.dimensionUnit = reader.readBitShort();
			this._header.dimensionAngularDimensionDecimalPlaces = reader.readBitShort();
			this._header.dimensionDecimalPlaces = reader.readBitShort();
			this._header.dimensionToleranceDecimalPlaces = reader.readBitShort();
			this._header.dimensionAlternateUnitFormat = reader.readBitShort() as LinearUnitFormat;
			this._header.dimensionAlternateUnitToleranceDecimalPlaces = reader.readBitShort();
			objectPointers.dimtxsty = reader.handleReference();
		}

		// Common dimension variables
		this._header.dimensionScaleFactor = reader.readBitDouble();
		this._header.dimensionArrowSize = reader.readBitDouble();
		this._header.dimensionExtensionLineOffset = reader.readBitDouble();
		this._header.dimensionLineIncrement = reader.readBitDouble();
		this._header.dimensionExtensionLineExtension = reader.readBitDouble();
		this._header.dimensionRounding = reader.readBitDouble();
		this._header.dimensionLineExtension = reader.readBitDouble();
		this._header.dimensionPlusTolerance = reader.readBitDouble();
		this._header.dimensionMinusTolerance = reader.readBitDouble();

		if (this.r2007Plus) {
			this._header.dimensionFixedExtensionLineLength = reader.readBitDouble();
			const dimJogAngle = reader.readBitDouble();
			const rounded = Math.round(dimJogAngle * 1000000) / 1000000;
			const degToRad5 = 5 * Math.PI / 180;
			if (rounded > degToRad5 && rounded < Math.PI / 2) {
				this._header.dimensionJoggedRadiusDimensionTransverseSegmentAngle = dimJogAngle;
			}
			this._header.dimensionTextBackgroundFillMode = reader.readBitShort();
			this._header.dimensionTextBackgroundColor = reader.readCmColor();
		}

		if (this.r2000Plus) {
			this._header.dimensionGenerateTolerances = reader.readBit();
			this._header.dimensionLimitsGeneration = reader.readBit();
			this._header.dimensionTextInsideHorizontal = reader.readBit();
			this._header.dimensionTextOutsideHorizontal = reader.readBit();
			this._header.dimensionSuppressFirstExtensionLine = reader.readBit();
			this._header.dimensionSuppressSecondExtensionLine = reader.readBit();
			this._header.dimensionTextVerticalAlignment = reader.readBitShort();
			this._header.dimensionZeroHandling = reader.readBitShort();
			this._header.dimensionAngularZeroHandling = reader.readBitShort();
		}

		if (this.r2007Plus) {
			this._header.dimensionArcLengthSymbolPosition = reader.readBitShort();
		}

		this._header.dimensionTextHeight = reader.readBitDouble();
		this._header.dimensionCenterMarkSize = reader.readBitDouble();
		this._header.dimensionTickSize = reader.readBitDouble();
		this._header.dimensionAlternateUnitScaleFactor = reader.readBitDouble();
		this._header.dimensionLinearScaleFactor = reader.readBitDouble();
		this._header.dimensionTextVerticalPosition = reader.readBitDouble();
		this._header.dimensionToleranceScaleFactor = reader.readBitDouble();
		this._header.dimensionLineGap = reader.readBitDouble();

		if (this.r13_14Only) {
			this._header.dimensionPostFix = reader.readVariableText();
			this._header.dimensionAlternateDimensioningSuffix = reader.readVariableText();
			this._header.dimensionBlockName = reader.readVariableText();
			this._header.dimensionBlockNameFirst = reader.readVariableText();
			this._header.dimensionBlockNameSecond = reader.readVariableText();
		}

		if (this.r2000Plus) {
			this._header.dimensionAlternateUnitRounding = reader.readBitDouble();
			this._header.dimensionAlternateUnitDimensioning = reader.readBit();
			this._header.dimensionAlternateUnitDecimalPlaces = reader.readBitShort() & 0xFF;
			this._header.dimensionTextOutsideExtensions = reader.readBit();
			this._header.dimensionSeparateArrowBlocks = reader.readBit();
			this._header.dimensionTextInsideExtensions = reader.readBit();
			this._header.dimensionSuppressOutsideExtensions = reader.readBit();
		}

		this._header.dimensionLineColor = reader.readCmColor();
		this._header.dimensionExtensionLineColor = reader.readCmColor();
		this._header.dimensionTextColor = reader.readCmColor();

		if (this.r2000Plus) {
			this._header.dimensionAngularDimensionDecimalPlaces = reader.readBitShort();
			this._header.dimensionDecimalPlaces = reader.readBitShort();
			this._header.dimensionToleranceDecimalPlaces = reader.readBitShort();
			this._header.dimensionAlternateUnitFormat = reader.readBitShort() as LinearUnitFormat;
			this._header.dimensionAlternateUnitToleranceDecimalPlaces = reader.readBitShort();
			this._header.dimensionAngularUnit = reader.readBitShort() as AngularUnitFormat;
			this._header.dimensionFractionFormat = reader.readBitShort();
			this._header.dimensionLinearUnitFormat = reader.readBitShort() as LinearUnitFormat;
			this._header.dimensionDecimalSeparator = String.fromCharCode(reader.readBitShort());
			this._header.dimensionTextMovement = reader.readBitShort();
			this._header.dimensionTextHorizontalAlignment = reader.readBitShort() & 0xFF;
			this._header.dimensionSuppressFirstDimensionLine = reader.readBit();
			this._header.dimensionSuppressSecondDimensionLine = reader.readBit();
			this._header.dimensionToleranceAlignment = reader.readBitShort() & 0xFF;
			this._header.dimensionToleranceZeroHandling = reader.readBitShort() & 0xFF;
			this._header.dimensionAlternateUnitZeroHandling = reader.readBitShort() & 0xFF;
			this._header.dimensionAlternateUnitToleranceZeroHandling = reader.readBitShort() & 0xFF;
			this._header.dimensionCursorUpdate = reader.readBit();
			this._header.dimensionDimensionTextArrowFit = reader.readBitShort();
		}

		if (this.r2007Plus) {
			this._header.dimensionIsExtensionLineLengthFixed = reader.readBit();
		}

		if (this.r2010Plus) {
			this._header.dimensionTextDirection = reader.readBit() ? 1 : 0;
			this._header.dimensionAltMzf = reader.readBitDouble();
			this._header.dimensionAltMzs = reader.readVariableText();
			this._header.dimensionFit = reader.readBitDouble();
			this._header.dimensionMzs = reader.readVariableText();
		}

		if (this.r2000Plus) {
			objectPointers.dimtxsty = reader.handleReference();
			objectPointers.dimldrblk = reader.handleReference();
			objectPointers.dimblk = reader.handleReference();
			objectPointers.dimblk1 = reader.handleReference();
			objectPointers.dimblk2 = reader.handleReference();
		}

		if (this.r2007Plus) {
			objectPointers.dimltype = reader.handleReference();
			objectPointers.dimltex1 = reader.handleReference();
			objectPointers.dimltex2 = reader.handleReference();
		}

		if (this.r2000Plus) {
			this._header.dimensionLineWeight = reader.readBitShort() as LineWeightType;
			this._header.extensionLineWeight = reader.readBitShort() as LineWeightType;
		}

		// Table control object handles
		objectPointers.block_control_object = reader.handleReference();
		objectPointers.layer_control_object = reader.handleReference();
		objectPointers.style_control_object = reader.handleReference();
		objectPointers.linetype_control_object = reader.handleReference();
		objectPointers.view_control_object = reader.handleReference();
		objectPointers.ucs_control_object = reader.handleReference();
		objectPointers.vport_control_object = reader.handleReference();
		objectPointers.appid_control_object = reader.handleReference();
		objectPointers.dimstyle_control_object = reader.handleReference();

		if (this.r13_15Only) {
			objectPointers.viewport_entity_header_control_object = reader.handleReference();
		}

		objectPointers.dictionary_acad_group = reader.handleReference();
		objectPointers.dictionary_acad_mlinestyle = reader.handleReference();
		objectPointers.dictionary_named_objects = reader.handleReference();

		if (this.r2000Plus) {
			this._header.stackedTextAlignment = reader.readBitShort();
			this._header.stackedTextSizePercentage = reader.readBitShort();
			this._header.hyperLinkBase = reader.readVariableText();
			this._header.styleSheetName = reader.readVariableText();

			objectPointers.dictionary_layouts = reader.handleReference();
			objectPointers.dictionary_plotsettings = reader.handleReference();
			objectPointers.dictionary_plotstyles = reader.handleReference();
		}

		if (this.r2004Plus) {
			objectPointers.dictionary_materials = reader.handleReference();
			objectPointers.dictionary_colors = reader.handleReference();
		}

		if (this.r2007Plus) {
			objectPointers.dictionary_visualstyle = reader.handleReference();

			if (this.r2013Plus) {
				objectPointers.dictionary_visualstyle = reader.handleReference();
			}
		}

		if (this.r2000Plus) {
			const flags: number = reader.readBitLong();
			this._header.currentEntityLineWeight = (flags & 0x1F) as LineWeightType;
			this._header.endCaps = flags & 0x60;
			this._header.joinStyle = flags & 0x180;
			this._header.displayLineWeight = (flags & 0x200) === 1;
			this._header.xEdit = (flags & 0x400) === 1;
			this._header.extendedNames = (flags & 0x800) === 1;
			this._header.plotStyleMode = flags & 0x2000;
			this._header.loadOLEObject = (flags & 0x4000) === 1;

			this._header.insUnits = reader.readBitShort() as UnitsType;
			this._header.currentEntityPlotStyle = reader.readBitShort() as EntityPlotStyleType;

			if (this._header.currentEntityPlotStyle === EntityPlotStyleType.ByObjectId) {
				objectPointers.cpsnid = reader.handleReference();
			}

			this._header.fingerPrintGuid = reader.readVariableText();
			this._header.versionGuid = reader.readVariableText();
		}

		if (this.r2004Plus) {
			this._header.entitySortingFlags = reader.readByte() as ObjectSortingFlags;
			this._header.indexCreationFlags = reader.readByte() as IndexCreationFlags;
			this._header.hideText = reader.readByte();
			this._header.externalReferenceClippingBoundaryType = reader.readByte() as XClipFrameType;
			this._header.dimensionAssociativity = reader.readByte() as DimensionAssociation;
			this._header.haloGapPercentage = reader.readByte();
			this._header.obscuredColor = new Color(reader.readBitShort());
			this._header.interfereColor = new Color(reader.readBitShort());
			this._header.obscuredType = reader.readByte();
			this._header.intersectionDisplay = reader.readByte();
			this._header.projectName = reader.readVariableText();
		}

		objectPointers.paper_space = reader.handleReference();
		objectPointers.model_space = reader.handleReference();
		objectPointers.bylayer = reader.handleReference();
		objectPointers.byblock = reader.handleReference();
		objectPointers.continuous = reader.handleReference();

		if (this.r2007Plus) {
			this._header.cameraDisplayObjects = reader.readBit();
			reader.readBitLong();
			reader.readBitLong();
			reader.readBitDouble();

			const stepsPerSecond = reader.readBitDouble();
			if (stepsPerSecond >= 1 && stepsPerSecond <= 30) {
				this._header.stepsPerSecond = stepsPerSecond;
			}
			this._header.stepSize = reader.readBitDouble();
			this._header.dw3DPrecision = reader.readBitDouble();
			this._header.lensLength = reader.readBitDouble();
			this._header.cameraHeight = reader.readBitDouble();
			this._header.solidsRetainHistory = reader.readRawChar() !== 0;
			this._header.showSolidsHistory = reader.readRawChar() !== 0;
			this._header.sweptSolidWidth = reader.readBitDouble();
			this._header.sweptSolidHeight = reader.readBitDouble();
			this._header.draftAngleFirstCrossSection = reader.readBitDouble();
			this._header.draftAngleSecondCrossSection = reader.readBitDouble();
			this._header.draftMagnitudeFirstCrossSection = reader.readBitDouble();
			this._header.draftMagnitudeSecondCrossSection = reader.readBitDouble();
			this._header.solidLoftedShape = reader.readBitShort();
			this._header.loftedObjectNormals = String.fromCharCode(reader.readRawChar());
			this._header.latitude = reader.readBitDouble();
			this._header.longitude = reader.readBitDouble();
			this._header.northDirection = reader.readBitDouble();
			this._header.timeZone = reader.readBitLong();
			this._header.displayLightGlyphs = String.fromCharCode(reader.readRawChar());
			reader.readRawChar(); // TILEMODELIGHTSYNCH
			this._header.dwgUnderlayFramesVisibility = String.fromCharCode(reader.readRawChar());
			this._header.dgnUnderlayFramesVisibility = String.fromCharCode(reader.readRawChar());
			reader.readBit(); // unknown

			this._header.interfereColor = reader.readCmColor();

			objectPointers.interfereobjvs = reader.handleReference();
			objectPointers.interferevpvs = reader.handleReference();
			objectPointers.dragvs = reader.handleReference();

			this._header.shadowMode = reader.readByte() as ShadowMode;
			this._header.shadowPlaneLocation = reader.readBitDouble();
		}

		try {
			mainreader.setPositionInBits(initialPos + size * 8);
			mainreader.resetShift();
			this.checkSentinel(this._reader, DwgSectionDefinition.endSentinels.get(this.sectionName)!);
		} catch (ex) {
			this.notify('An error ocurred at the end of the Header reading',
				NotificationType.Error, ex instanceof Error ? ex : undefined);
		}

		return { objectPointers };
	}
}
