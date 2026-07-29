Warning: truncated output (original token count: 186718)
Total output lines: 19866

#!/usr/bin/env node
var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/main.ts
import { realpathSync } from "node:fs";
import { parseArgs } from "node:util";

// ../core/src/errors.ts
var DomainError = class extends Error {
  code;
  /** Safe to render verbatim in the UI. */
  userMessage;
  constructor(code, userMessage, options) {
    super(`${code}: ${userMessage}`, options);
    this.name = "DomainError";
    this.code = code;
    this.userMessage = userMessage;
  }
};
var IllegalTransitionError = class extends DomainError {
  fromPhase;
  eventType;
  constructor(fromPhase, eventType, detail) {
    super(
      "ILLEGAL_TRANSITION",
      `Transition "${eventType}" is not allowed from state "${fromPhase}"${detail ? `: ${detail}` : ""}`
    );
    this.name = "IllegalTransitionError";
    this.fromPhase = fromPhase;
    this.eventType = eventType;
  }
};
function isDomainError(value) {
  return value instanceof DomainError;
}

// ../../node_modules/zod/v4/classic/external.js
var external_exports = {};
__export(external_exports, {
  $brand: () => $brand,
  $input: () => $input,
  $output: () => $output,
  NEVER: () => NEVER,
  TimePrecision: () => TimePrecision,
  ZodAny: () => ZodAny,
  ZodArray: () => ZodArray,
  ZodBase64: () => ZodBase64,
  ZodBase64URL: () => ZodBase64URL,
  ZodBigInt: () => ZodBigInt,
  ZodBigIntFormat: () => ZodBigIntFormat,
  ZodBoolean: () => ZodBoolean,
  ZodCIDRv4: () => ZodCIDRv4,
  ZodCIDRv6: () => ZodCIDRv6,
  ZodCUID: () => ZodCUID,
  ZodCUID2: () => ZodCUID2,
  ZodCatch: () => ZodCatch,
  ZodCodec: () => ZodCodec,
  ZodCustom: () => ZodCustom,
  ZodCustomStringFormat: () => ZodCustomStringFormat,
  ZodDate: () => ZodDate,
  ZodDefault: () => ZodDefault,
  ZodDiscriminatedUnion: () => ZodDiscriminatedUnion,
  ZodE164: () => ZodE164,
  ZodEmail: () => ZodEmail,
  ZodEmoji: () => ZodEmoji,
  ZodEnum: () => ZodEnum,
  ZodError: () => ZodError,
  ZodExactOptional: () => ZodExactOptional,
  ZodFile: () => ZodFile,
  ZodFirstPartyTypeKind: () => ZodFirstPartyTypeKind,
  ZodFunction: () => ZodFunction,
  ZodGUID: () => ZodGUID,
  ZodIPv4: () => ZodIPv4,
  ZodIPv6: () => ZodIPv6,
  ZodISODate: () => ZodISODate,
  ZodISODateTime: () => ZodISODateTime,
  ZodISODuration: () => ZodISODuration,
  ZodISOTime: () => ZodISOTime,
  ZodIntersection: () => ZodIntersection,
  ZodIssueCode: () => ZodIssueCode,
  ZodJWT: () => ZodJWT,
  ZodKSUID: () => ZodKSUID,
  ZodLazy: () => ZodLazy,
  ZodLiteral: () => ZodLiteral,
  ZodMAC: () => ZodMAC,
  ZodMap: () => ZodMap,
  ZodNaN: () => ZodNaN,
  ZodNanoID: () => ZodNanoID,
  ZodNever: () => ZodNever,
  ZodNonOptional: () => ZodNonOptional,
  ZodNull: () => ZodNull,
  ZodNullable: () => ZodNullable,
  ZodNumber: () => ZodNumber,
  ZodNumberFormat: () => ZodNumberFormat,
  ZodObject: () => ZodObject,
  ZodOptional: () => ZodOptional,
  ZodPipe: () => ZodPipe,
  ZodPrefault: () => ZodPrefault,
  ZodPreprocess: () => ZodPreprocess,
  ZodPromise: () => ZodPromise,
  ZodReadonly: () => ZodReadonly,
  ZodRealError: () => ZodRealError,
  ZodRecord: () => ZodRecord,
  ZodSet: () => ZodSet,
  ZodString: () => ZodString,
  ZodStringFormat: () => ZodStringFormat,
  ZodSuccess: () => ZodSuccess,
  ZodSymbol: () => ZodSymbol,
  ZodTemplateLiteral: () => ZodTemplateLiteral,
  ZodTransform: () => ZodTransform,
  ZodTuple: () => ZodTuple,
  ZodType: () => ZodType,
  ZodULID: () => ZodULID,
  ZodURL: () => ZodURL,
  ZodUUID: () => ZodUUID,
  ZodUndefined: () => ZodUndefined,
  ZodUnion: () => ZodUnion,
  ZodUnknown: () => ZodUnknown,
  ZodVoid: () => ZodVoid,
  ZodXID: () => ZodXID,
  ZodXor: () => ZodXor,
  _ZodString: () => _ZodString,
  _default: () => _default2,
  _function: () => _function,
  any: () => any,
  array: () => array,
  base64: () => base642,
  base64url: () => base64url2,
  bigint: () => bigint2,
  boolean: () => boolean2,
  catch: () => _catch2,
  check: () => check,
  cidrv4: () => cidrv42,
  cidrv6: () => cidrv62,
  clone: () => clone,
  codec: () => codec,
  coerce: () => coerce_exports,
  config: () => config,
  core: () => core_exports2,
  cuid: () => cuid3,
  cuid2: () => cuid22,
  custom: () => custom,
  date: () => date3,
  decode: () => decode2,
  decodeAsync: () => decodeAsync2,
  describe: () => describe2,
  discriminatedUnion: () => discriminatedUnion,
  e164: () => e1642,
  email: () => email2,
  emoji: () => emoji2,
  encode: () => encode2,
  encodeAsync: () => encodeAsync2,
  endsWith: () => _endsWith,
  enum: () => _enum2,
  exactOptional: () => exactOptional,
  file: () => file,
  flattenError: () => flattenError,
  float32: () => float32,
  float64: () => float64,
  formatError: () => formatError,
  fromJSONSchema: () => fromJSONSchema,
  function: () => _function,
  getErrorMap: () => getErrorMap,
  globalRegistry: () => globalRegistry,
  gt: () => _gt,
  gte: () => _gte,
  guid: () => guid2,
  hash: () => hash,
  hex: () => hex2,
  hostname: () => hostname2,
  httpUrl: () => httpUrl,
  includes: () => _includes,
  instanceof: () => _instanceof,
  int: () => int,
  int32: () => int32,
  int64: () => int64,
  intersection: () => intersection,
  invertCodec: () => invertCodec,
  ipv4: () => ipv42,
  ipv6: () => ipv62,
  iso: () => iso_exports,
  json: () => json,
  jwt: () => jwt,
  keyof: () => keyof,
  ksuid: () => ksuid2,
  lazy: () => lazy,
  length: () => _length,
  literal: () => literal,
  locales: () => locales_exports,
  looseObject: () => looseObject,
  looseRecord: () => looseRecord,
  lowercase: () => _lowercase,
  lt: () => _lt,
  lte: () => _lte,
  mac: () => mac2,
  map: () => map,
  maxLength: () => _maxLength,
  maxSize: () => _maxSize,
  meta: () => meta2,
  mime: () => _mime,
  minLength: () => _minLength,
  minSize: () => _minSize,
  multipleOf: () => _multipleOf,
  nan: () => nan,
  nanoid: () => nanoid2,
  nativeEnum: () => nativeEnum,
  negative: () => _negative,
  never: () => never,
  nonnegative: () => _nonnegative,
  nonoptional: () => nonoptional,
  nonpositive: () => _nonpositive,
  normalize: () => _normalize,
  null: () => _null3,
  nullable: () => nullable,
  nullish: () => nullish2,
  number: () => number2,
  object: () => object,
  optional: () => optional,
  overwrite: () => _overwrite,
  parse: () => parse2,
  parseAsync: () => parseAsync2,
  partialRecord: () => partialRecord,
  pipe: () => pipe,
  positive: () => _positive,
  prefault: () => prefault,
  preprocess: () => preprocess,
  prettifyError: () => prettifyError,
  promise: () => promise,
  property: () => _property,
  readonly: () => readonly,
  record: () => record,
  refine: () => refine,
  regex: () => _regex,
  regexes: () => regexes_exports,
  registry: () => registry,
  safeDecode: () => safeDecode2,
  safeDecodeAsync: () => safeDecodeAsync2,
  safeEncode: () => safeEncode2,
  safeEncodeAsync: () => safeEncodeAsync2,
  safeParse: () => safeParse2,
  safeParseAsync: () => safeParseAsync2,
  set: () => set,
  setErrorMap: () => setErrorMap,
  size: () => _size,
  slugify: () => _slugify,
  startsWith: () => _startsWith,
  strictObject: () => strictObject,
  string: () => string2,
  stringFormat: () => stringFormat,
  stringbool: () => stringbool,
  success: () => success,
  superRefine: () => superRefine,
  symbol: () => symbol,
  templateLiteral: () => templateLiteral,
  toJSONSchema: () => toJSONSchema,
  toLowerCase: () => _toLowerCase,
  toUpperCase: () => _toUpperCase,
  transform: () => transform,
  treeifyError: () => treeifyError,
  trim: () => _trim,
  tuple: () => tuple,
  uint32: () => uint32,
  uint64: () => uint64,
  ulid: () => ulid2,
  undefined: () => _undefined3,
  union: () => union,
  unknown: () => unknown,
  uppercase: () => _uppercase,
  url: () => url,
  util: () => util_exports,
  uuid: () => uuid2,
  uuidv4: () => uuidv4,
  uuidv6: () => uuidv6,
  uuidv7: () => uuidv7,
  void: () => _void2,
  xid: () => xid2,
  xor: () => xor
});

// ../../node_modules/zod/v4/core/index.js
var core_exports2 = {};
__export(core_exports2, {
  $ZodAny: () => $ZodAny,
  $ZodArray: () => $ZodArray,
  $ZodAsyncError: () => $ZodAsyncError,
  $ZodBase64: () => $ZodBase64,
  $ZodBase64URL: () => $ZodBase64URL,
  $ZodBigInt: () => $ZodBigInt,
  $ZodBigIntFormat: () => $ZodBigIntFormat,
  $ZodBoolean: () => $ZodBoolean,
  $ZodCIDRv4: () => $ZodCIDRv4,
  $ZodCIDRv6: () => $ZodCIDRv6,
  $ZodCUID: () => $ZodCUID,
  $ZodCUID2: () => $ZodCUID2,
  $ZodCatch: () => $ZodCatch,
  $ZodCheck: () => $ZodCheck,
  $ZodCheckBigIntFormat: () => $ZodCheckBigIntFormat,
  $ZodCheckEndsWith: () => $ZodCheckEndsWith,
  $ZodCheckGreaterThan: () => $ZodCheckGreaterThan,
  $ZodCheckIncludes: () => $ZodCheckIncludes,
  $ZodCheckLengthEquals: () => $ZodCheckLengthEquals,
  $ZodCheckLessThan: () => $ZodCheckLessThan,
  $ZodCheckLowerCase: () => $ZodCheckLowerCase,
  $ZodCheckMaxLength: () => $ZodCheckMaxLength,
  $ZodCheckMaxSize: () => $ZodCheckMaxSize,
  $ZodCheckMimeType: () => $ZodCheckMimeType,
  $ZodCheckMinLength: () => $ZodCheckMinLength,
  $ZodCheckMinSize: () => $ZodCheckMinSize,
  $ZodCheckMultipleOf: () => $ZodCheckMultipleOf,
  $ZodCheckNumberFormat: () => $ZodCheckNumberFormat,
  $ZodCheckOverwrite: () => $ZodCheckOverwrite,
  $ZodCheckProperty: () => $ZodCheckProperty,
  $ZodCheckRegex: () => $ZodCheckRegex,
  $ZodCheckSizeEquals: () => $ZodCheckSizeEquals,
  $ZodCheckStartsWith: () => $ZodCheckStartsWith,
  $ZodCheckStringFormat: () => $ZodCheckStringFormat,
  $ZodCheckUpperCase: () => $ZodCheckUpperCase,
  $ZodCodec: () => $ZodCodec,
  $ZodCustom: () => $ZodCustom,
  $ZodCustomStringFormat: () => $ZodCustomStringFormat,
  $ZodDate: () => $ZodDate,
  $ZodDefault: () => $ZodDefault,
  $ZodDiscriminatedUnion: () => $ZodDiscriminatedUnion,
  $ZodE164: () => $ZodE164,
  $ZodEmail: () => $ZodEmail,
  $ZodEmoji: () => $ZodEmoji,
  $ZodEncodeError: () => $ZodEncodeError,
  $ZodEnum: () => $ZodEnum,
  $ZodError: () => $ZodError,
  $ZodExactOptional: () => $ZodExactOptional,
  $ZodFile: () => $ZodFile,
  $ZodFunction: () => $ZodFunction,
  $ZodGUID: () => $ZodGUID,
  $ZodIPv4: () => $ZodIPv4,
  $ZodIPv6: () => $ZodIPv6,
  $ZodISODate: () => $ZodISODate,
  $ZodISODateTime: () => $ZodISODateTime,
  $ZodISODuration: () => $ZodISODuration,
  $ZodISOTime: () => $ZodISOTime,
  $ZodIntersection: () => $ZodIntersection,
  $ZodJWT: () => $ZodJWT,
  $ZodKSUID: () => $ZodKSUID,
  $ZodLazy: () => $ZodLazy,
  $ZodLiteral: () => $ZodLiteral,
  $ZodMAC: () => $ZodMAC,
  $ZodMap: () => $ZodMap,
  $ZodNaN: () => $ZodNaN,
  $ZodNanoID: () => $ZodNanoID,
  $ZodNever: () => $ZodNever,
  $ZodNonOptional: () => $ZodNonOptional,
  $ZodNull: () => $ZodNull,
  $ZodNullable: () => $ZodNullable,
  $ZodNumber: () => $ZodNumber,
  $ZodNumberFormat: () => $ZodNumberFormat,
  $ZodObject: () => $ZodObject,
  $ZodObjectJIT: () => $ZodObjectJIT,
  $ZodOptional: () => $ZodOptional,
  $ZodPipe: () => $ZodPipe,
  $ZodPrefault: () => $ZodPrefault,
  $ZodPreprocess: () => $ZodPreprocess,
  $ZodPromise: () => $ZodPromise,
  $ZodReadonly: () => $ZodReadonly,
  $ZodRealError: () => $ZodRealError,
  $ZodRecord: () => $ZodRecord,
  $ZodRegistry: () => $ZodRegistry,
  $ZodSet: () => $ZodSet,
  $ZodString: () => $ZodString,
  $ZodStringFormat: () => $ZodStringFormat,
  $ZodSuccess: () => $ZodSuccess,
  $ZodSymbol: () => $ZodSymbol,
  $ZodTemplateLiteral: () => $ZodTemplateLiteral,
  $ZodTransform: () => $ZodTransform,
  $ZodTuple: () => $ZodTuple,
  $ZodType: () => $ZodType,
  $ZodULID: () => $ZodULID,
  $ZodURL: () => $ZodURL,
  $ZodUUID: () => $ZodUUID,
  $ZodUndefined: () => $ZodUndefined,
  $ZodUnion: () => $ZodUnion,
  $ZodUnknown: () => $ZodUnknown,
  $ZodVoid: () => $ZodVoid,
  $ZodXID: () => $ZodXID,
  $ZodXor: () => $ZodXor,
  $brand: () => $brand,
  $constructor: () => $constructor,
  $input: () => $input,
  $output: () => $output,
  Doc: () => Doc,
  JSONSchema: () => json_schema_exports,
  JSONSchemaGenerator: () => JSONSchemaGenerator,
  NEVER: () => NEVER,
  TimePrecision: () => TimePrecision,
  _any: () => _any,
  _array: () => _array,
  _base64: () => _base64,
  _base64url: () => _base64url,
  _bigint: () => _bigint,
  _boolean: () => _boolean,
  _catch: () => _catch,
  _check: () => _check,
  _cidrv4: () => _cidrv4,
  _cidrv6: () => _cidrv6,
  _coercedBigint: () => _coercedBigint,
  _coercedBoolean: () => _coercedBoolean,
  _coercedDate: () => _coercedDate,
  _coercedNumber: () => _coercedNumber,
  _coercedString: () => _coercedString,
  _cuid: () => _cuid,
  _cuid2: () => _cuid2,
  _custom: () => _custom,
  _date: () => _date,
  _decode: () => _decode,
  _decodeAsync: () => _decodeAsync,
  _default: () => _default,
  _discriminatedUnion: () => _discriminatedUnion,
  _e164: () => _e164,
  _email: () => _email,
  _emoji: () => _emoji2,
  _encode: () => _encode,
  _encodeAsync: () => _encodeAsync,
  _endsWith: () => _endsWith,
  _enum: () => _enum,
  _file: () => _file,
  _float32: () => _float32,
  _float64: () => _float64,
  _gt: () => _gt,
  _gte: () => _gte,
  _guid: () => _guid,
  _includes: () => _includes,
  _int: () => _int,
  _int32: () => _int32,
  _int64: () => _int64,
  _intersection: () => _intersection,
  _ipv4: () => _ipv4,
  _ipv6: () => _ipv6,
  _isoDate: () => _isoDate,
  _isoDateTime: () => _isoDateTime,
  _isoDuration: () => _isoDuration,
  _isoTime: () => _isoTime,
  _jwt: () => _jwt,
  _ksuid: () => _ksuid,
  _lazy: () => _lazy,
  _length: () => _length,
  _literal: () => _literal,
  _lowercase: () => _lowercase,
  _lt: () => _lt,
  _lte: () => _lte,
  _mac: () => _mac,
  _map: () => _map,
  _max: () => _lte,
  _maxLength: () => _maxLength,
  _maxSize: () => _maxSize,
  _mime: () => _mime,
  _min: () => _gte,
  _minLength: () => _minLength,
  _minSize: () => _minSize,
  _multipleOf: () => _multipleOf,
  _nan: () => _nan,
  _nanoid: () => _nanoid,
  _nativeEnum: () => _nativeEnum,
  _negative: () => _negative,
  _never: () => _never,
  _nonnegative: () => _nonnegative,
  _nonoptional: () => _nonoptional,
  _nonpositive: () => _nonpositive,
  _normalize: () => _normalize,
  _null: () => _null2,
  _nullable: () => _nullable,
  _number: () => _number,
  _optional: () => _optional,
  _overwrite: () => _overwrite,
  _parse: () => _parse,
  _parseAsync: () => _parseAsync,
  _pipe: () => _pipe,
  _positive: () => _positive,
  _promise: () => _promise,
  _property: () => _property,
  _readonly: () => _readonly,
  _record: () => _record,
  _refine: () => _refine,
  _regex: () => _regex,
  _safeDecode: () => _safeDecode,
  _safeDecodeAsync: () => _safeDecodeAsync,
  _safeEncode: () => _safeEncode,
  _safeEncodeAsync: () => _safeEncodeAsync,
  _safeParse: () => _safeParse,
  _safeParseAsync: () => _safeParseAsync,
  _set: () => _set,
  _size: () => _size,
  _slugify: () => _slugify,
  _startsWith: () => _startsWith,
  _string: () => _string,
  _stringFormat: () => _stringFormat,
  _stringbool: () => _stringbool,
  _success: () => _success,
  _superRefine: () => _superRefine,
  _symbol: () => _symbol,
  _templateLiteral: () => _templateLiteral,
  _toLowerCase: () => _toLowerCase,
  _toUpperCase: () => _toUpperCase,
  _transform: () => _transform,
  _trim: () => _trim,
  _tuple: () => _tuple,
  _uint32: () => _uint32,
  _uint64: () => _uint64,
  _ulid: () => _ulid,
  _undefined: () => _undefined2,
  _union: () => _union,
  _unknown: () => _unknown,
  _uppercase: () => _uppercase,
  _url: () => _url,
  _uuid: () => _uuid,
  _uuidv4: () => _uuidv4,
  _uuidv6: () => _uuidv6,
  _uuidv7: () => _uuidv7,
  _void: () => _void,
  _xid: () => _xid,
  _xor: () => _xor,
  clone: () => clone,
  config: () => config,
  createStandardJSONSchemaMethod: () => createStandardJSONSchemaMethod,
  createToJSONSchemaMethod: () => createToJSONSchemaMethod,
  decode: () => decode,
  decodeAsync: () => decodeAsync,
  describe: () => describe,
  encode: () => encode,
  encodeAsync: () => encodeAsync,
  extractDefs: () => extractDefs,
  finalize: () => finalize,
  flattenError: () => flattenError,
  formatError: () => formatError,
  globalConfig: () => globalConfig,
  globalRegistry: () => globalRegistry,
  initializeContext: () => initializeContext,
  isValidBase64: () => isValidBase64,
  isValidBase64URL: () => isValidBase64URL,
  isValidJWT: () => isValidJWT,
  locales: () => locales_exports,
  meta: () => meta,
  parse: () => parse,
  parseAsync: () => parseAsync,
  prettifyError: () => prettifyError,
  process: () => process2,
  regexes: () => regexes_exports,
  registry: () => registry,
  safeDecode: () => safeDecode,
  safeDecodeAsync: () => safeDecodeAsync,
  safeEncode: () => safeEncode,
  safeEncodeAsync: () => safeEncodeAsync,
  safeParse: () => safeParse,
  safeParseAsync: () => safeParseAsync,
  toDotPath: () => toDotPath,
  toJSONSchema: () => toJSONSchema,
  treeifyError: () => treeifyError,
  util: () => util_exports,
  version: () => version
});

// ../../node_modules/zod/v4/core/core.js
var _a;
var NEVER = /* @__PURE__ */ Object.freeze({
  status: "aborted"
});
// @__NO_SIDE_EFFECTS__
function $constructor(name, initializer3, params) {
  function init(inst, def) {
    if (!inst._zod) {
      Object.defineProperty(inst, "_zod", {
        value: {
          def,
          constr: _,
          traits: /* @__PURE__ */ new Set()
        },
        enumerable: false
      });
    }
    if (inst._zod.traits.has(name)) {
      return;
    }
    inst._zod.traits.add(name);
    initializer3(inst, def);
    const proto = _.prototype;
    const keys = Object.keys(proto);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (!(k in inst)) {
        inst[k] = proto[k].bind(inst);
      }
    }
  }
  const Parent = params?.Parent ?? Object;
  class Definition extends Parent {
  }
  Object.defineProperty(Definition, "name", { value: name });
  function _(def) {
    var _a3;
    const inst = params?.Parent ? new Definition() : this;
    init(inst, def);
    (_a3 = inst._zod).deferred ?? (_a3.deferred = []);
    for (const fn of inst._zod.deferred) {
      fn();
    }
    return inst;
  }
  Object.defineProperty(_, "init", { value: init });
  Object.defineProperty(_, Symbol.hasInstance, {
    value: (inst) => {
      if (params?.Parent && inst instanceof params.Parent)
        return true;
      return inst?._zod?.traits?.has(name);
    }
  });
  Object.defineProperty(_, "name", { value: name });
  return _;
}
var $brand = Symbol("zod_brand");
var $ZodAsyncError = class extends Error {
  constructor() {
    super(`Encountered Promise during synchronous parse. Use .parseAsync() instead.`);
  }
};
var $ZodEncodeError = class extends Error {
  constructor(name) {
    super(`Encountered unidirectional transform during encode: ${name}`);
    this.name = "ZodEncodeError";
  }
};
(_a = globalThis).__zod_globalConfig ?? (_a.__zod_globalConfig = {});
var globalConfig = globalThis.__zod_globalConfig;
function config(newConfig) {
  if (newConfig)
    Object.assign(globalConfig, newConfig);
  return globalConfig;
}

// ../../node_modules/zod/v4/core/util.js
var util_exports = {};
__export(util_exports, {
  BIGINT_FORMAT_RANGES: () => BIGINT_FORMAT_RANGES,
  Class: () => Class,
  NUMBER_FORMAT_RANGES: () => NUMBER_FORMAT_RANGES,
  aborted: () => aborted,
  allowsEval: () => allowsEval,
  assert: () => assert,
  assertEqual: () => assertEqual,
  assertIs: () => assertIs,
  assertNever: () => assertNever,
  assertNotEqual: () => assertNotEqual,
  assignProp: () => assignProp,
  base64ToUint8Array: () => base64ToUint8Array,
  base64urlToUint8Array: () => base64urlToUint8Array,
  cached: () => cached,
  captureStackTrace: () => captureStackTrace,
  cleanEnum: () => cleanEnum,
  cleanRegex: () => cleanRegex,
  clone: () => clone,
  cloneDef: () => cloneDef,
  createTransparentProxy: () => createTransparentProxy,
  defineLazy: () => defineLazy,
  esc: () => esc,
  escapeRegex: () => escapeRegex,
  explicitlyAborted: () => explicitlyAborted,
  extend: () => extend,
  finalizeIssue: () => finalizeIssue,
  floatSafeRemainder: () => floatSafeRemainder,
  getElementAtPath: () => getElementAtPath,
  getEnumValues: () => getEnumValues,
  getLengthableOrigin: () => getLengthableOrigin,
  getParsedType: () => getParsedType,
  getSizableOrigin: () => getSizableOrigin,
  hexToUint8Array: () => hexToUint8Array,
  isObject: () => isObject,
  isPlainObject: () => isPlainObject,
  issue: () => issue,
  joinValues: () => joinValues,
  jsonStringifyReplacer: () => jsonStringifyReplacer,
  merge: () => merge,
  mergeDefs: () => mergeDefs,
  normalizeParams: () => normalizeParams,
  nullish: () => nullish,
  numKeys: () => numKeys,
  objectClone: () => objectClone,
  omit: () => omit,
  optionalKeys: () => optionalKeys,
  parsedType: () => parsedType,
  partial: () => partial,
  pick: () => pick,
  prefixIssues: () => prefixIssues,
  primitiveTypes: () => primitiveTypes,
  promiseAllObject: () => promiseAllObject,
  propertyKeyTypes: () => propertyKeyTypes,
  randomString: () => randomString,
  required: () => required,
  safeExtend: () => safeExtend,
  shallowClone: () => shallowClone,
  slugify: () => slugify,
  stringifyPrimitive: () => stringifyPrimitive,
  uint8ArrayToBase64: () => uint8ArrayToBase64,
  uint8ArrayToBase64url: () => uint8ArrayToBase64url,
  uint8ArrayToHex: () => uint8ArrayToHex,
  unwrapMessage: () => unwrapMessage
});
function assertEqual(val) {
  return val;
}
function assertNotEqual(val) {
  return val;
}
function assertIs(_arg) {
}
function assertNever(_x) {
  throw new Error("Unexpected value in exhaustive check");
}
function assert(_) {
}
function getEnumValues(entries) {
  const numericValues = Object.values(entries).filter((v) => typeof v === "number");
  const values = Object.entries(entries).filter(([k, _]) => numericValues.indexOf(+k) === -1).map(([_, v]) => v);
  return values;
}
function joinValues(array2, separator = "|") {
  return array2.map((val) => stringifyPrimitive(val)).join(separator);
}
function jsonStringifyReplacer(_, value) {
  if (typeof value === "bigint")
    return value.toString();
  return value;
}
function cached(getter) {
  const set2 = false;
  return {
    get value() {
      if (!set2) {
        const value = getter();
        Object.defineProperty(this, "value", { value });
        return value;
      }
      throw new Error("cached value already set");
    }
  };
}
function nullish(input) {
  return input === null || input === void 0;
}
function cleanRegex(source) {
  const start = source.startsWith("^") ? 1 : 0;
  const end = source.endsWith("$") ? source.length - 1 : source.length;
  return source.slice(start, end);
}
function floatSafeRemainder(val, step) {
  const ratio = val / step;
  const roundedRatio = Math.round(ratio);
  const tolerance = Number.EPSILON * Math.max(Math.abs(ratio), 1);
  if (Math.abs(ratio - roundedRatio) < tolerance)
    return 0;
  return ratio - roundedRatio;
}
var EVALUATING = /* @__PURE__ */ Symbol("evaluating");
function defineLazy(object2, key, getter) {
  let value = void 0;
  Object.defineProperty(object2, key, {
    get() {
      if (value === EVALUATING) {
        return void 0;
      }
      if (value === void 0) {
        value = EVALUATING;
        value = getter();
      }
      return value;
    },
    set(v) {
      Object.defineProperty(object2, key, {
        value: v
        // configurable: true,
      });
    },
    configurable: true
  });
}
function objectClone(obj) {
  return Object.create(Object.getPrototypeOf(obj), Object.getOwnPropertyDescriptors(obj));
}
function assignProp(target, prop, value) {
  Object.defineProperty(target, prop, {
    value,
    writable: true,
    enumerable: true,
    configurable: true
  });
}
function mergeDefs(...defs) {
  const mergedDescriptors = {};
  for (const def of defs) {
    const descriptors = Object.getOwnPropertyDescriptors(def);
    Object.assign(mergedDescriptors, descriptors);
  }
  return Object.defineProperties({}, mergedDescriptors);
}
function cloneDef(schema) {
  return mergeDefs(schema._zod.def);
}
function getElementAtPath(obj, path8) {
  if (!path8)
    return obj;
  return path8.reduce((acc, key) => acc?.[key], obj);
}
function promiseAllObject(promisesObj) {
  const keys = Object.keys(promisesObj);
  const promises = keys.map((key) => promisesObj[key]);
  return Promise.all(promises).then((results) => {
    const resolvedObj = {};
    for (let i = 0; i < keys.length; i++) {
      resolvedObj[keys[i]] = results[i];
    }
    return resolvedObj;
  });
}
function randomString(length = 10) {
  const chars = "abcdefghijklmnopqrstuvwxyz";
  let str = "";
  for (let i = 0; i < length; i++) {
    str += chars[Math.floor(Math.random() * chars.length)];
  }
  return str;
}
function esc(str) {
  return JSON.stringify(str);
}
function slugify(input) {
  return input.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
}
var captureStackTrace = "captureStackTrace" in Error ? Error.captureStackTrace : (..._args) => {
};
function isObject(data) {
  return typeof data === "object" && data !== null && !Array.isArray(data);
}
var allowsEval = /* @__PURE__ */ cached(() => {
  if (globalConfig.jitless) {
    return false;
  }
  if (typeof navigator !== "undefined" && navigator?.userAgent?.includes("Cloudflare")) {
    return false;
  }
  try {
    const F = Function;
    new F("");
    return true;
  } catch (_) {
    return false;
  }
});
function isPlainObject(o) {
  if (isObject(o) === false)
    return false;
  const ctor = o.constructor;
  if (ctor === void 0)
    return true;
  if (typeof ctor !== "function")
    return true;
  const prot = ctor.prototype;
  if (isObject(prot) === false)
    return false;
  if (Object.prototype.hasOwnProperty.call(prot, "isPrototypeOf") === false) {
    return false;
  }
  return true;
}
function shallowClone(o) {
  if (isPlainObject(o))
    return { ...o };
  if (Array.isArray(o))
    return [...o];
  if (o instanceof Map)
    return new Map(o);
  if (o instanceof Set)
    return new Set(o);
  return o;
}
function numKeys(data) {
  let keyCount = 0;
  for (const key in data) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      keyCount++;
    }
  }
  return keyCount;
}
var getParsedType = (data) => {
  const t = typeof data;
  switch (t) {
    case "undefined":
      return "undefined";
    case "string":
      return "string";
    case "number":
      return Number.isNaN(data) ? "nan" : "number";
    case "boolean":
      return "boolean";
    case "function":
      return "function";
    case "bigint":
      return "bigint";
    case "symbol":
      return "symbol";
    case "object":
      if (Array.isArray(data)) {
        return "array";
      }
      if (data === null) {
        return "null";
      }
      if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
        return "promise";
      }
      if (typeof Map !== "undefined" && data instanceof Map) {
        return "map";
      }
      if (typeof Set !== "undefined" && data instanceof Set) {
        return "set";
      }
      if (typeof Date !== "undefined" && data instanceof Date) {
        return "date";
      }
      if (typeof File !== "undefined" && data instanceof File) {
        return "file";
      }
      return "object";
    default:
      throw new Error(`Unknown data type: ${t}`);
  }
};
var propertyKeyTypes = /* @__PURE__ */ new Set(["string", "number", "symbol"]);
var primitiveTypes = /* @__PURE__ */ new Set([
  "string",
  "number",
  "bigint",
  "boolean",
  "symbol",
  "undefined"
]);
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function clone(inst, def, params) {
  const cl = new inst._zod.constr(def ?? inst._zod.def);
  if (!def || params?.parent)
    cl._zod.parent = inst;
  return cl;
}
function normalizeParams(_params) {
  const params = _params;
  if (!params)
    return {};
  if (typeof params === "string")
    return { error: () => params };
  if (params?.message !== void 0) {
    if (params?.error !== void 0)
      throw new Error("Cannot specify both `message` and `error` params");
    params.error = params.message;
  }
  delete params.message;
  if (typeof params.error === "string")
    return { ...params, error: () => params.error };
  return params;
}
function createTransparentProxy(getter) {
  let target;
  return new Proxy({}, {
    get(_, prop, receiver) {
      target ?? (target = getter());
      return Reflect.get(target, prop, receiver);
    },
    set(_, prop, value, receiver) {
      target ?? (target = getter());
      return Reflect.set(target, prop, value, receiver);
    },
    has(_, prop) {
      target ?? (target = getter());
      return Reflect.has(target, prop);
    },
    deleteProperty(_, prop) {
      target ?? (target = getter());
      return Reflect.deleteProperty(target, prop);
    },
    ownKeys(_) {
      target ?? (target = getter());
      return Reflect.ownKeys(target);
    },
    getOwnPropertyDescriptor(_, prop) {
      target ?? (target = getter());
      return Reflect.getOwnPropertyDescriptor(target, prop);
    },
    defineProperty(_, prop, descriptor) {
      target ?? (target = getter());
      return Reflect.defineProperty(target, prop, descriptor);
    }
  });
}
function stringifyPrimitive(value) {
  if (typeof value === "bigint")
    return value.toString() + "n";
  if (typeof value === "string")
    return `"${value}"`;
  return `${value}`;
}
function optionalKeys(shape) {
  return Object.keys(shape).filter((k) => {
    return shape[k]._zod.optin === "optional" && shape[k]._zod.optout === "optional";
  });
}
var NUMBER_FORMAT_RANGES = {
  safeint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  int32: [-2147483648, 2147483647],
  uint32: [0, 4294967295],
  float32: [-34028234663852886e22, 34028234663852886e22],
  float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
};
var BIGINT_FORMAT_RANGES = {
  int64: [/* @__PURE__ */ BigInt("-9223372036854775808"), /* @__PURE__ */ BigInt("9223372036854775807")],
  uint64: [/* @__PURE__ */ BigInt(0), /* @__PURE__ */ BigInt("18446744073709551615")]
};
function pick(schema, mask) {
  const currDef = schema._zod.def;
  const checks = currDef.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    throw new Error(".pick() cannot be used on object schemas containing refinements");
  }
  const def = mergeDefs(schema._zod.def, {
    get shape() {
      const newShape = {};
      for (const key in mask) {
        if (!(key in currDef.shape)) {
          throw new Error(`Unrecognized key: "${key}"`);
        }
        if (!mask[key])
          continue;
        newShape[key] = currDef.shape[key];
      }
      assignProp(this, "shape", newShape);
      return newShape;
    },
    checks: []
  });
  return clone(schema, def);
}
function omit(schema, mask) {
  const currDef = schema._zod.def;
  const checks = currDef.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    throw new Error(".omit() cannot be used on object schemas containing refinements");
  }
  const def = mergeDefs(schema._zod.def, {
    get shape() {
      const newShape = { ...schema._zod.def.shape };
      for (const key in mask) {
        if (!(key in currDef.shape)) {
          throw new Error(`Unrecognized key: "${key}"`);
        }
        if (!mask[key])
          continue;
        delete newShape[key];
      }
      assignProp(this, "shape", newShape);
      return newShape;
    },
    checks: []
  });
  return clone(schema, def);
}
function extend(schema, shape) {
  if (!isPlainObject(shape)) {
    throw new Error("Invalid input to extend: expected a plain object");
  }
  const checks = schema._zod.def.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    const existingShape = schema._zod.def.shape;
    for (const key in shape) {
      if (Object.getOwnPropertyDescriptor(existingShape, key) !== void 0) {
        throw new Error("Cannot overwrite keys on object schemas containing refinements. Use `.safeExtend()` instead.");
      }
    }
  }
  const def = mergeDefs(schema._zod.def, {
    get shape() {
      const _shape = { ...schema._zod.def.shape, ...shape };
      assignProp(this, "shape", _shape);
      return _shape;
    }
  });
  return clone(schema, def);
}
function safeExtend(schema, shape) {
  if (!isPlainObject(shape)) {
    throw new Error("Invalid input to safeExtend: expected a plain object");
  }
  const def = mergeDefs(schema._zod.def, {
    get shape() {
      const _shape = { ...schema._zod.def.shape, ...shape };
      assignProp(this, "shape", _shape);
      return _shape;
    }
  });
  return clone(schema, def);
}
function merge(a, b) {
  if (a._zod.def.checks?.length) {
    throw new Error(".merge() cannot be used on object schemas containing refinements. Use .safeExtend() instead.");
  }
  const def = mergeDefs(a._zod.def, {
    get shape() {
      const _shape = { ...a._zod.def.shape, ...b._zod.def.shape };
      assignProp(this, "shape", _shape);
      return _shape;
    },
    get catchall() {
      return b._zod.def.catchall;
    },
    checks: b._zod.def.checks ?? []
  });
  return clone(a, def);
}
function partial(Class2, schema, mask) {
  const currDef = schema._zod.def;
  const checks = currDef.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    throw new Error(".partial() cannot be used on object schemas containing refinements");
  }
  const def = mergeDefs(schema._zod.def, {
    get shape() {
      const oldShape = schema._zod.def.shape;
      const shape = { ...oldShape };
      if (mask) {
        for (const key in mask) {
          if (!(key in oldShape)) {
            throw new Error(`Unrecognized key: "${key}"`);
          }
          if (!mask[key])
            continue;
          shape[key] = Class2 ? new Class2({
            type: "optional",
            innerType: oldShape[key]
          }) : oldShape[key];
        }
      } else {
        for (const key in oldShape) {
          shape[key] = Class2 ? new Class2({
            type: "optional",
            innerType: oldShape[key]
          }) : oldShape[key];
        }
      }
      assignProp(this, "shape", shape);
      return shape;
    },
    checks: []
  });
  return clone(schema, def);
}
function required(Class2, schema, mask) {
  const def = mergeDefs(schema._zod.def, {
    get shape() {
      const oldShape = schema._zod.def.shape;
      const shape = { ...oldShape };
      if (mask) {
        for (const key in mask) {
          if (!(key in shape)) {
            throw new Error(`Unrecognized key: "${key}"`);
          }
          if (!mask[key])
            continue;
          shape[key] = new Class2({
            type: "nonoptional",
            innerType: oldShape[key]
          });
        }
      } else {
        for (const key in oldShape) {
          shape[key] = new Class2({
            type: "nonoptional",
            innerType: oldShape[key]
          });
        }
      }
      assignProp(this, "shape", shape);
      return shape;
    }
  });
  return clone(schema, def);
}
function aborted(x, startIndex = 0) {
  if (x.aborted === true)
    return true;
  for (let i = startIndex; i < x.issues.length; i++) {
    if (x.issues[i]?.continue !== true) {
      return true;
    }
  }
  return false;
}
function explicitlyAborted(x, startIndex = 0) {
  if (x.aborted === true)
    return true;
  for (let i = startIndex; i < x.issues.length; i++) {
    if (x.issues[i]?.continue === false) {
      return true;
    }
  }
  return false;
}
function prefixIssues(path8, issues) {
  return issues.map((iss) => {
    var _a3;
    (_a3 = iss).path ?? (_a3.path = []);
    iss.path.unshift(path8);
    return iss;
  });
}
function unwrapMessage(message) {
  return typeof message === "string" ? message : message?.message;
}
function finalizeIssue(iss, ctx, config2) {
  const message = iss.message ? iss.message : unwrapMessage(iss.inst?._zod.def?.error?.(iss)) ?? unwrapMessage(ctx?.error?.(iss)) ?? unwrapMessage(config2.customError?.(iss)) ?? unwrapMessage(config2.localeError?.(iss)) ?? "Invalid input";
  const { inst: _inst, continue: _continue, input: _input, ...rest } = iss;
  rest.path ?? (rest.path = []);
  rest.message = message;
  if (ctx?.reportInput) {
    rest.input = _input;
  }
  return rest;
}
function getSizableOrigin(input) {
  if (input instanceof Set)
    return "set";
  if (input instanceof Map)
    return "map";
  if (input instanceof File)
    return "file";
  return "unknown";
}
function getLengthableOrigin(input) {
  if (Array.isArray(input))
    return "array";
  if (typeof input === "string")
    return "string";
  return "unknown";
}
function parsedType(data) {
  const t = typeof data;
  switch (t) {
    case "number": {
      return Number.isNaN(data) ? "nan" : "number";
    }
    case "object": {
      if (data === null) {
        return "null";
      }
      if (Array.isArray(data)) {
        return "array";
      }
      const obj = data;
      if (obj && Object.getPrototypeOf(obj) !== Object.prototype && "constructor" in obj && obj.constructor) {
        return obj.constructor.name;
      }
    }
  }
  return t;
}
function issue(...args) {
  const [iss, input, inst] = args;
  if (typeof iss === "string") {
    return {
      message: iss,
      code: "custom",
      input,
      inst
    };
  }
  return { ...iss };
}
function cleanEnum(obj) {
  return Object.entries(obj).filter(([k, _]) => {
    return Number.isNaN(Number.parseInt(k, 10));
  }).map((el) => el[1]);
}
function base64ToUint8Array(base643) {
  const binaryString = atob(base643);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}
function uint8ArrayToBase64(bytes) {
  let binaryString = "";
  for (let i = 0; i < bytes.length; i++) {
    binaryString += String.fromCharCode(bytes[i]);
  }
  return btoa(binaryString);
}
function base64urlToUint8Array(base64url3) {
  const base643 = base64url3.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - base643.length % 4) % 4);
  return base64ToUint8Array(base643 + padding);
}
function uint8ArrayToBase64url(bytes) {
  return uint8ArrayToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
function hexToUint8Array(hex3) {
  const cleanHex = hex3.replace(/^0x/, "");
  if (cleanHex.length % 2 !== 0) {
    throw new Error("Invalid hex string length");
  }
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes[i / 2] = Number.parseInt(cleanHex.slice(i, i + 2), 16);
  }
  return bytes;
}
function uint8ArrayToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
var Class = class {
  constructor(..._args) {
  }
};

// ../../node_modules/zod/v4/core/errors.js
var initializer = (inst, def) => {
  inst.name = "$ZodError";
  Object.defineProperty(inst, "_zod", {
    value: inst._zod,
    enumerable: false
  });
  Object.defineProperty(inst, "issues", {
    value: def,
    enumerable: false
  });
  inst.message = JSON.stringify(def, jsonStringifyReplacer, 2);
  Object.defineProperty(inst, "toString", {
    value: () => inst.message,
    enumerable: false
  });
};
var $ZodError = $constructor("$ZodError", initializer);
var $ZodRealError = $constructor("$ZodError", initializer, { Parent: Error });
function flattenError(error51, mapper = (issue2) => issue2.message) {
  const fieldErrors = {};
  const formErrors = [];
  for (const sub of error51.issues) {
    if (sub.path.length > 0) {
      fieldErrors[sub.path[0]] = fieldErrors[sub.path[0]] || [];
      fieldErrors[sub.path[0]].push(mapper(sub));
    } else {
      formErrors.push(mapper(sub));
    }
  }
  return { formErrors, fieldErrors };
}
function formatError(error51, mapper = (issue2) => issue2.message) {
  const fieldErrors = { _errors: [] };
  const processError = (error52, path8 = []) => {
    for (const issue2 of error52.issues) {
      if (issue2.code === "invalid_union" && issue2.errors.length) {
        issue2.errors.map((issues) => processError({ issues }, [...path8, ...issue2.path]));
      } else if (issue2.code === "invalid_key") {
        processError({ issues: issue2.issues }, [...path8, ...issue2.path]);
      } else if (issue2.code === "invalid_element") {
        processError({ issues: issue2.issues }, [...path8, ...issue2.path]);
      } else {
        const fullpath = [...path8, ...issue2.path];
        if (fullpath.length === 0) {
          fieldErrors._errors.push(mapper(issue2));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < fullpath.length) {
            const el = fullpath[i];
            const terminal = i === fullpath.length - 1;
            if (!terminal) {
              curr[el] = curr[el] || { _errors: [] };
            } else {
              curr[el] = curr[el] || { _errors: [] };
              curr[el]._errors.push(mapper(issue2));
            }
            curr = curr[el];
            i++;
          }
        }
      }
    }
  };
  processError(error51);
  return fieldErrors;
}
function treeifyError(error51, mapper = (issue2) => issue2.message) {
  const result = { errors: [] };
  const processError = (error52, path8 = []) => {
    var _a3, _b;
    for (const issue2 of error52.issues) {
      if (issue2.code === "invalid_union" && issue2.errors.length) {
        issue2.errors.map((issues) => processError({ issues }, [...path8, ...issue2.path]));
      } else if (issue2.code === "invalid_key") {
        processError({ issues: issue2.issues }, [...path8, ...issue2.path]);
      } else if (issue2.code === "invalid_element") {
        processError({ issues: issue2.issues }, [...path8, ...issue2.path]);
      } else {
        const fullpath = [...path8, ...issue2.path];
        if (fullpath.length === 0) {
          result.errors.push(mapper(issue2));
          continue;
        }
        let curr = result;
        let i = 0;
        while (i < fullpath.length) {
          const el = fullpath[i];
          const terminal = i === fullpath.length - 1;
          if (typeof el === "string") {
            curr.properties ?? (curr.properties = {});
            (_a3 = curr.properties)[el] ?? (_a3[el] = { errors: [] });
            curr = curr.properties[el];
          } else {
            curr.items ?? (curr.items = []);
            (_b = curr.items)[el] ?? (_b[el] = { errors: [] });
            curr = curr.items[el];
          }
          if (terminal) {
            curr.errors.push(mapper(issue2));
          }
          i++;
        }
      }
    }
  };
  processError(error51);
  return result;
}
function toDotPath(_path) {
  const segs = [];
  const path8 = _path.map((seg) => typeof seg === "object" ? seg.key : seg);
  for (const seg of path8) {
    if (typeof seg === "number")
      segs.push(`[${seg}]`);
    else if (typeof seg === "symbol")
      segs.push(`[${JSON.stringify(String(seg))}]`);
    else if (/[^\w$]/.test(seg))
      segs.push(`[${JSON.stringify(seg)}]`);
    else {
      if (segs.length)
        segs.push(".");
      segs.push(seg);
    }
  }
  return segs.join("");
}
function prettifyError(error51) {
  const lines = [];
  const issues = [...error51.issues].sort((a, b) => (a.path ?? []).length - (b.path ?? []).length);
  for (const issue2 of issues) {
    lines.push(`\u2716 ${issue2.message}`);
    if (issue2.path?.length)
      lines.push(`  \u2192 at ${toDotPath(issue2.path)}`);
  }
  return lines.join("\n");
}

// ../../node_modules/zod/v4/core/parse.js
var _parse = (_Err) => (schema, value, _ctx, _params) => {
  const ctx = _ctx ? { ..._ctx, async: false } : { async: false };
  const result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise) {
    throw new $ZodAsyncError();
  }
  if (result.issues.length) {
    const e = new (_params?.Err ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
    captureStackTrace(e, _params?.callee);
    throw e;
  }
  return result.value;
};
var parse = /* @__PURE__ */ _parse($ZodRealError);
var _parseAsync = (_Err) => async (schema, value, _ctx, params) => {
  const ctx = _ctx ? { ..._ctx, async: true } : { async: true };
  let result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise)
    result = await result;
  if (result.issues.length) {
    const e = new (params?.Err ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
    captureStackTrace(e, params?.callee);
    throw e;
  }
  return result.value;
};
var parseAsync = /* @__PURE__ */ _parseAsync($ZodRealError);
var _safeParse = (_Err) => (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, async: false } : { async: false };
  const result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise) {
    throw new $ZodAsyncError();
  }
  return result.issues.length ? {
    success: false,
    error: new (_Err ?? $ZodError)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
  } : { success: true, data: result.value };
};
var safeParse = /* @__PURE__ */ _safeParse($ZodRealError);
var _safeParseAsync = (_Err) => async (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, async: true } : { async: true };
  let result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise)
    result = await result;
  return result.issues.length ? {
    success: false,
    error: new _Err(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
  } : { success: true, data: result.value };
};
var safeParseAsync = /* @__PURE__ */ _safeParseAsync($ZodRealError);
var _encode = (_Err) => (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
  return _parse(_Err)(schema, value, ctx);
};
var encode = /* @__PURE__ */ _encode($ZodRealError);
var _decode = (_Err) => (schema, value, _ctx) => {
  return _parse(_Err)(schema, value, _ctx);
};
var decode = /* @__PURE__ */ _decode($ZodRealError);
var _encodeAsync = (_Err) => async (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
  return _parseAsync(_Err)(schema, value, ctx);
};
var encodeAsync = /* @__PURE__ */ _encodeAsync($ZodRealError);
var _decodeAsync = (_Err) => async (schema, value, _ctx) => {
  return _parseAsync(_Err)(schema, value, _ctx);
};
var decodeAsync = /* @__PURE__ */ _decodeAsync($ZodRealError);
var _safeEncode = (_Err) => (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
  return _safeParse(_Err)(schema, value, ctx);
};
var safeEncode = /* @__PURE__ */ _safeEncode($ZodRealError);
var _safeDecode = (_Err) => (schema, value, _ctx) => {
  return _safeParse(_Err)(schema, value, _ctx);
};
var safeDecode = /* @__PURE__ */ _safeDecode($ZodRealError);
var _safeEncodeAsync = (_Err) => async (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
  return _safeParseAsync(_Err)(schema, value, ctx);
};
var safeEncodeAsync = /* @__PURE__ */ _safeEncodeAsync($ZodRealError);
var _safeDecodeAsync = (_Err) => async (schema, value, _ctx) => {
  return _safeParseAsync(_Err)(schema, value, _ctx);
};
var safeDecodeAsync = /* @__PURE__ */ _safeDecodeAsync($ZodRealError);

// ../../node_modules/zod/v4/core/regexes.js
var regexes_exports = {};
__export(regexes_exports, {
  base64: () => base64,
  base64url: () => base64url,
  bigint: () => bigint,
  boolean: () => boolean,
  browserEmail: () => browserEmail,
  cidrv4: () => cidrv4,
  cidrv6: () => cidrv6,
  cuid: () => cuid,
  cuid2: () => cuid2,
  date: () => date,
  datetime: () => datetime,
  domain: () => domain,
  duration: () => duration,
  e164: () => e164,
  email: () => email,
  emoji: () => emoji,
  extendedDuration: () => extendedDuration,
  guid: () => guid,
  hex: () => hex,
  hostname: () => hostname,
  html5Email: () => html5Email,
  httpProtocol: () => httpProtocol,
  idnEmail: () => idnEmail,
  integer: () => integer,
  ipv4: () => ipv4,
  ipv6: () => ipv6,
  ksuid: () => ksuid,
  lowercase: () => lowercase,
  mac: () => mac,
  md5_base64: () => md5_base64,
  md5_base64url: () => md5_base64url,
  md5_hex: () => md5_hex,
  nanoid: () => nanoid,
  null: () => _null,
  number: () => number,
  rfc5322Email: () => rfc5322Email,
  sha1_base64: () => sha1_base64,
  sha1_base64url: () => sha1_base64url,
  sha1_hex: () => sha1_hex,
  sha256_base64: () => sha256_base64,
  sha256_base64url: () => sha256_base64url,
  sha256_hex: () => sha256_hex,
  sha384_base64: () => sha384_base64,
  sha384_base64url: () => sha384_base64url,
  sha384_hex: () => sha384_hex,
  sha512_base64: () => sha512_base64,
  sha512_base64url: () => sha512_base64url,
  sha512_hex: () => sha512_hex,
  string: () => string,
  time: () => time,
  ulid: () => ulid,
  undefined: () => _undefined,
  unicodeEmail: () => unicodeEmail,
  uppercase: () => uppercase,
  uuid: () => uuid,
  uuid4: () => uuid4,
  uuid6: () => uuid6,
  uuid7: () => uuid7,
  xid: () => xid
});
var cuid = /^[cC][0-9a-z]{6,}$/;
var cuid2 = /^[0-9a-z]+$/;
var ulid = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/;
var xid = /^[0-9a-vA-V]{20}$/;
var ksuid = /^[A-Za-z0-9]{27}$/;
var nanoid = /^[a-zA-Z0-9_-]{21}$/;
var duration = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/;
var extendedDuration = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;
var guid = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;
var uuid = (version2) => {
  if (!version2)
    return /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;
  return new RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${version2}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`);
};
var uuid4 = /* @__PURE__ */ uuid(4);
var uuid6 = /* @__PURE__ */ uuid(6);
var uuid7 = /* @__PURE__ */ uuid(7);
var email = /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
var html5Email = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
var rfc5322Email = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
var unicodeEmail = /^[^\s@"]{1,64}@[^\s@]{1,255}$/u;
var idnEmail = unicodeEmail;
var browserEmail = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
var _emoji = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
function emoji() {
  return new RegExp(_emoji, "u");
}
var ipv4 = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/;
var mac = (delimiter) => {
  const escapedDelim = escapeRegex(delimiter ?? ":");
  return new RegExp(`^(?:[0-9A-F]{2}${escapedDelim}){5}[0-9A-F]{2}$|^(?:[0-9a-f]{2}${escapedDelim}){5}[0-9a-f]{2}$`);
};
var cidrv4 = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/;
var cidrv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|::|([0-9a-fA-F]{1,4})?::([0-9a-fA-F]{1,4}:?){0,6})\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64 = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/;
var base64url = /^[A-Za-z0-9_-]*$/;
var hostname = /^(?=.{1,253}\.?$)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[-0-9a-zA-Z]{0,61}[0-9a-zA-Z])?)*\.?$/;
var domain = /^([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
var httpProtocol = /^https?$/;
var e164 = /^\+[1-9]\d{6,14}$/;
var dateSource = `(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))`;
var date = /* @__PURE__ */ new RegExp(`^${dateSource}$`);
function timeSource(args) {
  const hhmm = `(?:[01]\\d|2[0-3]):[0-5]\\d`;
  const regex = typeof args.precision === "number" ? args.precision === -1 ? `${hhmm}` : args.precision === 0 ? `${hhmm}:[0-5]\\d` : `${hhmm}:[0-5]\\d\\.\\d{${args.precision}}` : `${hhmm}(?::[0-5]\\d(?:\\.\\d+)?)?`;
  return regex;
}
function time(args) {
  return new RegExp(`^${timeSource(args)}$`);
}
function datetime(args) {
  const time3 = timeSource({ precision: args.precision });
  const opts = ["Z"];
  if (args.local)
    opts.push("");
  if (args.offset)
    opts.push(`([+-](?:[01]\\d|2[0-3]):[0-5]\\d)`);
  const timeRegex = `${time3}(?:${opts.join("|")})`;
  return new RegExp(`^${dateSource}T(?:${timeRegex})$`);
}
var string = (params) => {
  const regex = params ? `[\\s\\S]{${params?.minimum ?? 0},${params?.maximum ?? ""}}` : `[\\s\\S]*`;
  return new RegExp(`^${regex}$`);
};
var bigint = /^-?\d+n?$/;
var integer = /^-?\d+$/;
var number = /^-?\d+(?:\.\d+)?$/;
var boolean = /^(?:true|false)$/i;
var _null = /^null$/i;
var _undefined = /^undefined$/i;
var lowercase = /^[^A-Z]*$/;
var uppercase = /^[^a-z]*$/;
var hex = /^[0-9a-fA-F]*$/;
function fixedBase64(bodyLength, padding) {
  return new RegExp(`^[A-Za-z0-9+/]{${bodyLength}}${padding}$`);
}
function fixedBase64url(length) {
  return new RegExp(`^[A-Za-z0-9_-]{${length}}$`);
}
var md5_hex = /^[0-9a-fA-F]{32}$/;
var md5_base64 = /* @__PURE__ */ fixedBase64(22, "==");
var md5_base64url = /* @__PURE__ */ fixedBase64url(22);
var sha1_hex = /^[0-9a-fA-F]{40}$/;
var sha1_base64 = /* @__PURE__ */ fixedBase64(27, "=");
var sha1_base64url = /* @__PURE__ */ fixedBase64url(27);
var sha256_hex = /^[0-9a-fA-F]{64}$/;
var sha256_base64 = /* @__PURE__ */ fixedBase64(43, "=");
var sha256_base64url = /* @__PURE__ */ fixedBase64url(43);
var sha384_hex = /^[0-9a-fA-F]{96}$/;
var sha384_base64 = /* @__PURE__ */ fixedBase64(64, "");
var sha384_base64url = /* @__PURE__ */ fixedBase64url(64);
var sha512_hex = /^[0-9a-fA-F]{128}$/;
var sha512_base64 = /* @__PURE__ */ fixedBase64(86, "==");
var sha512_base64url = /* @__PURE__ */ fixedBase64url(86);

// ../../node_modules/zod/v4/core/checks.js
var $ZodCheck = /* @__PURE__ */ $constructor("$ZodCheck", (inst, def) => {
  var _a3;
  inst._zod ?? (inst._zod = {});
  inst._zod.def = def;
  (_a3 = inst._zod).onattach ?? (_a3.onattach = []);
});
var numericOriginMap = {
  number: "number",
  bigint: "bigint",
  object: "date"
};
var $ZodCheckLessThan = /* @__PURE__ */ $constructor("$ZodCheckLessThan", (inst, def) => {
  $ZodCheck.init(inst, def);
  const origin = numericOriginMap[typeof def.value];
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    const curr = (def.inclusive ? bag.maximum : bag.exclusiveMaximum) ?? Number.POSITIVE_INFINITY;
    if (def.value < curr) {
      if (def.inclusive)
        bag.maximum = def.value;
      else
        bag.exclusiveMaximum = def.value;
    }
  });
  inst._zod.check = (payload) => {
    if (def.inclusive ? payload.value <= def.value : payload.value < def.value) {
      return;
    }
    payload.issues.push({
      origin,
      code: "too_big",
      maximum: typeof def.value === "object" ? def.value.getTime() : def.value,
      input: payload.value,
      inclusive: def.inclusive,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckGreaterThan = /* @__PURE__ */ $constructor("$ZodCheckGreaterThan", (inst, def) => {
  $ZodCheck.init(inst, def);
  const origin = numericOriginMap[typeof def.value];
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    const curr = (def.inclusive ? bag.minimum : bag.exclusiveMinimum) ?? Number.NEGATIVE_INFINITY;
    if (def.value > curr) {
      if (def.inclusive)
        bag.minimum = def.value;
      else
        bag.exclusiveMinimum = def.value;
    }
  });
  inst._zod.check = (payload) => {
    if (def.inclusive ? payload.value >= def.value : payload.value > def.value) {
      return;
    }
    payload.issues.push({
      origin,
      code: "too_small",
      minimum: typeof def.value === "object" ? def.value.getTime() : def.value,
      input: payload.value,
      inclusive: def.inclusive,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckMultipleOf = /* @__PURE__ */ $constructor("$ZodCheckMultipleOf", (inst, def) => {
  $ZodCheck.init(inst, def);
  inst._zod.onattach.push((inst2) => {
    var _a3;
    (_a3 = inst2._zod.bag).multipleOf ?? (_a3.multipleOf = def.value);
  });
  inst._zod.check = (payload) => {
    if (typeof payload.value !== typeof def.value)
      throw new Error("Cannot mix number and bigint in multiple_of check.");
    const isMultiple = typeof payload.value === "bigint" ? payload.value % def.value === BigInt(0) : floatSafeRemainder(payload.value, def.value) === 0;
    if (isMultiple)
      return;
    payload.issues.push({
      origin: typeof payload.value,
      code: "not_multiple_of",
      divisor: def.value,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckNumberFormat = /* @__PURE__ */ $constructor("$ZodCheckNumberFormat", (inst, def) => {
  $ZodCheck.init(inst, def);
  def.format = def.format || "float64";
  const isInt = def.format?.includes("int");
  const origin = isInt ? "int" : "number";
  const [minimum, maximum] = NUMBER_FORMAT_RANGES[def.format];
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.format = def.format;
    bag.minimum = minimum;
    bag.maximum = maximum;
    if (isInt)
      bag.pattern = integer;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    if (isInt) {
      if (!Number.isInteger(input)) {
        payload.issues.push({
          expected: origin,
          format: def.format,
          code: "invalid_type",
          continue: false,
          input,
          inst
        });
        return;
      }
      if (!Number.isSafeInteger(input)) {
        if (input > 0) {
          payload.issues.push({
            input,
            code: "too_big",
            maximum: Number.MAX_SAFE_INTEGER,
            note: "Integers must be within the safe integer range.",
            inst,
            origin,
            inclusive: true,
            continue: !def.abort
          });
        } else {
          payload.issues.push({
            input,
            code: "too_small",
            minimum: Number.MIN_SAFE_INTEGER,
            note: "Integers must be within the safe integer range.",
            inst,
            origin,
            inclusive: true,
            continue: !def.abort
          });
        }
        return;
      }
    }
    if (input < minimum) {
      payload.issues.push({
        origin: "number",
        input,
        code: "too_small",
        minimum,
        inclusive: true,
        inst,
        continue: !def.abort
      });
    }
    if (input > maximum) {
      payload.issues.push({
        origin: "number",
        input,
        code: "too_big",
        maximum,
        inclusive: true,
        inst,
        continue: !def.abort
      });
    }
  };
});
var $ZodCheckBigIntFormat = /* @__PURE__ */ $constructor("$ZodCheckBigIntFormat", (inst, def) => {
  $ZodCheck.init(inst, def);
  const [minimum, maximum] = BIGINT_FORMAT_RANGES[def.format];
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.format = def.format;
    bag.minimum = minimum;
    bag.maximum = maximum;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    if (input < minimum) {
      payload.issues.push({
        origin: "bigint",
        input,
        code: "too_small",
        minimum,
        inclusive: true,
        inst,
        continue: !def.abort
      });
    }
    if (input > maximum) {
      payload.issues.push({
        origin: "bigint",
        input,
        code: "too_big",
        maximum,
        inclusive: true,
        inst,
        continue: !def.abort
      });
    }
  };
});
var $ZodCheckMaxSize = /* @__PURE__ */ $constructor("$ZodCheckMaxSize", (inst, def) => {
  var _a3;
  $ZodCheck.init(inst, def);
  (_a3 = inst._zod.def).when ?? (_a3.when = (payload) => {
    const val = payload.value;
    return !nullish(val) && val.size !== void 0;
  });
  inst._zod.onattach.push((inst2) => {
    const curr = inst2._zod.bag.maximum ?? Number.POSITIVE_INFINITY;
    if (def.maximum < curr)
      inst2._zod.bag.maximum = def.maximum;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    const size = input.size;
    if (size <= def.maximum)
      return;
    payload.issues.push({
      origin: getSizableOrigin(input),
      code: "too_big",
      maximum: def.maximum,
      inclusive: true,
      input,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckMinSize = /* @__PURE__ */ $constructor("$ZodCheckMinSize", (inst, def) => {
  var _a3;
  $ZodCheck.init(inst, def);
  (_a3 = inst._zod.def).when ?? (_a3.when = (payload) => {
    const val = payload.value;
    return !nullish(val) && val.size !== void 0;
  });
  inst._zod.onattach.push((inst2) => {
    const curr = inst2._zod.bag.minimum ?? Number.NEGATIVE_INFINITY;
    if (def.minimum > curr)
      inst2._zod.bag.minimum = def.minimum;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    const size = input.size;
    if (size >= def.minimum)
      return;
    payload.issues.push({
      origin: getSizableOrigin(input),
      code: "too_small",
      minimum: def.minimum,
      inclusive: true,
      input,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckSizeEquals = /* @__PURE__ */ $constructor("$ZodCheckSizeEquals", (inst, def) => {
  var _a3;
  $ZodCheck.init(inst, def);
  (_a3 = inst._zod.def).when ?? (_a3.when = (payload) => {
    const val = payload.value;
    return !nullish(val) && val.size !== void 0;
  });
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.minimum = def.size;
    bag.maximum = def.size;
    bag.size = def.size;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    const size = input.size;
    if (size === def.size)
      return;
    const tooBig = size > def.size;
    payload.issues.push({
      origin: getSizableOrigin(input),
      ...tooBig ? { code: "too_big", maximum: def.size } : { code: "too_small", minimum: def.size },
      inclusive: true,
      exact: true,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckMaxLength = /* @__PURE__ */ $constructor("$ZodCheckMaxLength", (inst, def) => {
  var _a3;
  $ZodCheck.init(inst, def);
  (_a3 = inst._zod.def).when ?? (_a3.when = (payload) => {
    const val = payload.value;
    return !nullish(val) && val.length !== void 0;
  });
  inst._zod.onattach.push((inst2) => {
    const curr = inst2._zod.bag.maximum ?? Number.POSITIVE_INFINITY;
    if (def.maximum < curr)
      inst2._zod.bag.maximum = def.maximum;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    const length = input.length;
    if (length <= def.maximum)
      return;
    const origin = getLengthableOrigin(input);
    payload.issues.push({
      origin,
      code: "too_big",
      maximum: def.maximum,
      inclusive: true,
      input,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckMinLength = /* @__PURE__ */ $constructor("$ZodCheckMinLength", (inst, def) => {
  var _a3;
  $ZodCheck.init(inst, def);
  (_a3 = inst._zod.def).when ?? (_a3.when = (payload) => {
    const val = payload.value;
    return !nullish(val) && val.length !== void 0;
  });
  inst._zod.onattach.push((inst2) => {
    const curr = inst2._zod.bag.minimum ?? Number.NEGATIVE_INFINITY;
    if (def.minimum > curr)
      inst2._zod.bag.minimum = def.minimum;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    const length = input.length;
    if (length >= def.minimum)
      return;
    const origin = getLengthableOrigin(input);
    payload.issues.push({
      origin,
      code: "too_small",
      minimum: def.minimum,
      inclusive: true,
      input,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckLengthEquals = /* @__PURE__ */ $constructor("$ZodCheckLengthEquals", (inst, def) => {
  var _a3;
  $ZodCheck.init(inst, def);
  (_a3 = inst._zod.def).when ?? (_a3.when = (payload) => {
    const val = payload.value;
    return !nullish(val) && val.length !== void 0;
  });
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.minimum = def.length;
    bag.maximum = def.length;
    bag.length = def.length;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    const length = input.length;
    if (length === def.length)
      return;
    const origin = getLengthableOrigin(input);
    const tooBig = length > def.length;
    payload.issues.push({
      origin,
      ...tooBig ? { code: "too_big", maximum: def.length } : { code: "too_small", minimum: def.length },
      inclusive: true,
      exact: true,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckStringFormat = /* @__PURE__ */ $constructor("$ZodCheckStringFormat", (inst, def) => {
  var _a3, _b;
  $ZodCheck.init(inst, def);
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.format = def.format;
    if (def.pattern) {
      bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
      bag.patterns.add(def.pattern);
    }
  });
  if (def.pattern)
    (_a3 = inst._zod).check ?? (_a3.check = (payload) => {
      def.pattern.lastIndex = 0;
      if (def.pattern.test(payload.value))
        return;
      payload.issues.push({
        origin: "string",
        code: "invalid_format",
        format: def.format,
        input: payload.value,
        ...def.pattern ? { pattern: def.pattern.toString() } : {},
        inst,
        continue: !def.abort
      });
    });
  else
    (_b = inst._zod).check ?? (_b.check = () => {
    });
});
var $ZodCheckRegex = /* @__PURE__ */ $constructor("$ZodCheckRegex", (inst, def) => {
  $ZodCheckStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    def.pattern.lastIndex = 0;
    if (def.pattern.test(payload.value))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "regex",
      input: payload.value,
      pattern: def.pattern.toString(),
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckLowerCase = /* @__PURE__ */ $constructor("$ZodCheckLowerCase", (inst, def) => {
  def.pattern ?? (def.pattern = lowercase);
  $ZodCheckStringFormat.init(inst, def);
});
var $ZodCheckUpperCase = /* @__PURE__ */ $constructor("$ZodCheckUpperCase", (inst, def) => {
  def.pattern ?? (def.pattern = uppercase);
  $ZodCheckStringFormat.init(inst, def);
});
var $ZodCheckIncludes = /* @__PURE__ */ $constructor("$ZodCheckIncludes", (inst, def) => {
  $ZodCheck.init(inst, def);
  const escapedRegex = escapeRegex(def.includes);
  const pattern = new RegExp(typeof def.position === "number" ? `^.{${def.position}}${escapedRegex}` : escapedRegex);
  def.pattern = pattern;
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
    bag.patterns.add(pattern);
  });
  inst._zod.check = (payload) => {
    if (payload.value.includes(def.includes, def.position))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "includes",
      includes: def.includes,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckStartsWith = /* @__PURE__ */ $constructor("$ZodCheckStartsWith", (inst, def) => {
  $ZodCheck.init(inst, def);
  const pattern = new RegExp(`^${escapeRegex(def.prefix)}.*`);
  def.pattern ?? (def.pattern = pattern);
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
    bag.patterns.add(pattern);
  });
  inst._zod.check = (payload) => {
    if (payload.value.startsWith(def.prefix))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "starts_with",
      prefix: def.prefix,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckEndsWith = /* @__PURE__ */ $constructor("$ZodCheckEndsWith", (inst, def) => {
  $ZodCheck.init(inst, def);
  const pattern = new RegExp(`.*${escapeRegex(def.suffix)}$`);
  def.pattern ?? (def.pattern = pattern);
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
    bag.patterns.add(pattern);
  });
  inst._zod.check = (payload) => {
    if (payload.value.endsWith(def.suffix))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "ends_with",
      suffix: def.suffix,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
function handleCheckPropertyResult(result, payload, property) {
  if (result.issues.length) {
    payload.issues.push(...prefixIssues(property, result.issues));
  }
}
var $ZodCheckProperty = /* @__PURE__ */ $constructor("$ZodCheckProperty", (inst, def) => {
  $ZodCheck.init(inst, def);
  inst._zod.check = (payload) => {
    const result = def.schema._zod.run({
      value: payload.value[def.property],
      issues: []
    }, {});
    if (result instanceof Promise) {
      return result.then((result2) => handleCheckPropertyResult(result2, payload, def.property));
    }
    handleCheckPropertyResult(result, payload, def.property);
    return;
  };
});
var $ZodCheckMimeType = /* @__PURE__ */ $constructor("$ZodCheckMimeType", (inst, def) => {
  $ZodCheck.init(inst, def);
  const mimeSet = new Set(def.mime);
  inst._zod.onattach.push((inst2) => {
    inst2._zod.bag.mime = def.mime;
  });
  inst._zod.check = (payload) => {
    if (mimeSet.has(payload.value.type))
      return;
    payload.issues.push({
      code: "invalid_value",
      values: def.mime,
      input: payload.value.type,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckOverwrite = /* @__PURE__ */ $constructor("$ZodCheckOverwrite", (inst, def) => {
  $ZodCheck.init(inst, def);
  inst._zod.check = (payload) => {
    payload.value = def.tx(payload.value);
  };
});

// ../../node_modules/zod/v4/core/doc.js
var Doc = class {
  constructor(args = []) {
    this.content = [];
    this.indent = 0;
    if (this)
      this.args = args;
  }
  indented(fn) {
    this.indent += 1;
    fn(this);
    this.indent -= 1;
  }
  write(arg) {
    if (typeof arg === "function") {
      arg(this, { execution: "sync" });
      arg(this, { execution: "async" });
      return;
    }
    const content = arg;
    const lines = content.split("\n").filter((x) => x);
    const minIndent = Math.min(...lines.map((x) => x.length - x.trimStart().length));
    const dedented = lines.map((x) => x.slice(minIndent)).map((x) => " ".repeat(this.indent * 2) + x);
    for (const line of dedented) {
      this.content.push(line);
    }
  }
  compile() {
    const F = Function;
    const args = this?.args;
    const content = this?.content ?? [``];
    const lines = [...content.map((x) => `  ${x}`)];
    return new F(...args, lines.join("\n"));
  }
};

// ../../node_modules/zod/v4/core/versions.js
var version = {
  major: 4,
  minor: 4,
  patch: 3
};

// ../../node_modules/zod/v4/core/schemas.js
var $ZodType = /* @__PURE__ */ $constructor("$ZodType", (inst, def) => {
  var _a3;
  inst ?? (inst = {});
  inst._zod.def = def;
  inst._zod.bag = inst._zod.bag || {};
  inst._zod.version = version;
  const checks = [...inst._zod.def.checks ?? []];
  if (inst._zod.traits.has("$ZodCheck")) {
    checks.unshift(inst);
  }
  for (const ch of checks) {
    for (const fn of ch._zod.onattach) {
      fn(inst);
    }
  }
  if (checks.length === 0) {
    (_a3 = inst._zod).deferred ?? (_a3.deferred = []);
    inst._zod.deferred?.push(() => {
      inst._zod.run = inst._zod.parse;
    });
  } else {
    const runChecks = (payload, checks2, ctx) => {
      let isAborted = aborted(payload);
      let asyncResult;
      for (const ch of checks2) {
        if (ch._zod.def.when) {
          if (explicitlyAborted(payload))
            continue;
          const shouldRun = ch._zod.def.when(payload);
          if (!shouldRun)
            continue;
        } else if (isAborted) {
          continue;
        }
        const currLen = payload.issues.length;
        const _ = ch._zod.check(payload);
        if (_ instanceof Promise && ctx?.async === false) {
          throw new $ZodAsyncError();
        }
        if (asyncResult || _ instanceof Promise) {
          asyncResult = (asyncResult ?? Promise.resolve()).then(async () => {
            await _;
            const nextLen = payload.issues.length;
            if (nextLen === currLen)
              return;
            if (!isAborted)
              isAborted = aborted(payload, currLen);
          });
        } else {
          const nextLen = payload.issues.length;
          if (nextLen === currLen)
            continue;
          if (!isAborted)
            isAborted = aborted(payload, currLen);
        }
      }
      if (asyncResult) {
        return asyncResult.then(() => {
          return payload;
        });
      }
      return payload;
    };
    const handleCanaryResult = (canary, payload, ctx) => {
      if (aborted(canary)) {
        canary.aborted = true;
        return canary;
      }
      const checkResult = runChecks(payload, checks, ctx);
      if (checkResult instanceof Promise) {
        if (ctx.async === false)
          throw new $ZodAsyncError();
        return checkResult.then((checkResult2) => inst._zod.parse(checkResult2, ctx));
      }
      return inst._zod.parse(checkResult, ctx);
    };
    inst._zod.run = (payload, ctx) => {
      if (ctx.skipChecks) {
        return inst._zod.parse(payload, ctx);
      }
      if (ctx.direction === "backward") {
        const canary = inst._zod.parse({ value: payload.value, issues: [] }, { ...ctx, skipChecks: true });
        if (canary instanceof Promise) {
          return canary.then((canary2) => {
            return handleCanaryResult(canary2, payload, ctx);
          });
        }
        return handleCanaryResult(canary, payload, ctx);
      }
      const result = inst._zod.parse(payload, ctx);
      if (result instanceof Promise) {
        if (ctx.async === false)
          throw new $ZodAsyncError();
        return result.then((result2) => runChecks(result2, checks, ctx));
      }
      return runChecks(result, checks, ctx);
    };
  }
  defineLazy(inst, "~standard", () => ({
    validate: (value) => {
      try {
        const r = safeParse(inst, value);
        return r.success ? { value: r.data } : { issues: r.error?.issues };
      } catch (_) {
        return safeParseAsync(inst, value).then((r) => r.success ? { value: r.data } : { issues: r.error?.issues });
      }
    },
    vendor: "zod",
    version: 1
  }));
});
var $ZodString = /* @__PURE__ */ $constructor("$ZodString", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = [...inst?._zod.bag?.patterns ?? []].pop() ?? string(inst._zod.bag);
  inst._zod.parse = (payload, _) => {
    if (def.coerce)
      try {
        payload.value = String(payload.value);
      } catch (_2) {
      }
    if (typeof payload.value === "string")
      return payload;
    payload.issues.push({
      expected: "string",
      code: "invalid_type",
      input: payload.value,
      inst
    });
    return payload;
  };
});
var $ZodStringFormat = /* @__PURE__ */ $constructor("$ZodStringFormat", (inst, def) => {
  $ZodCheckStringFormat.init(inst, def);
  $ZodString.init(inst, def);
});
var $ZodGUID = /* @__PURE__ */ $constructor("$ZodGUID", (inst, def) => {
  def.pattern ?? (def.pattern = guid);
  $ZodStringFormat.init(inst, def);
});
var $ZodUUID = /* @__PURE__ */ $constructor("$ZodUUID", (inst, def) => {
  if (def.version) {
    const versionMap = {
      v1: 1,
      v2: 2,
      v3: 3,
      v4: 4,
      v5: 5,
      v6: 6,
      v7: 7,
      v8: 8
    };
    const v = versionMap[def.version];
    if (v === void 0)
      throw new Error(`Invalid UUID version: "${def.version}"`);
    def.pattern ?? (def.pattern = uuid(v));
  } else
    def.pattern ?? (def.pattern = uuid());
  $ZodStringFormat.init(inst, def);
});
var $ZodEmail = /* @__PURE__ */ $constructor("$ZodEmail", (inst, def) => {
  def.pattern ?? (def.pattern = email);
  $ZodStringFormat.init(inst, def);
});
var $ZodURL = /* @__PURE__ */ $constructor("$ZodURL", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    try {
      const trimmed = payload.value.trim();
      if (!def.normalize && def.protocol?.source === httpProtocol.source) {
        if (!/^https?:\/\//i.test(trimmed)) {
          payload.issues.push({
            code: "invalid_format",
            format: "url",
            note: "Invalid URL format",
            input: payload.value,
            inst,
            continue: !def.abort
          });
          return;
        }
      }
      const url2 = new URL(trimmed);
      if (def.hostname) {
        def.hostname.lastIndex = 0;
        if (!def.hostname.test(url2.hostname)) {
          payload.issues.push({
            code: "invalid_format",
            format: "url",
            note: "Invalid hostname",
            pattern: def.hostname.source,
            input: payload.value,
            inst,
            continue: !def.abort
          });
        }
      }
      if (def.protocol) {
        def.protocol.lastIndex = 0;
        if (!def.protocol.test(url2.protocol.endsWith(":") ? url2.protocol.slice(0, -1) : url2.protocol)) {
          payload.issues.push({
            code: "invalid_format",
            format: "url",
            note: "Invalid protocol",
            pattern: def.protocol.source,
            input: payload.value,
            inst,
            continue: !def.abort
          });
        }
      }
      if (def.normalize) {
        payload.value = url2.href;
      } else {
        payload.value = trimmed;
      }
      return;
    } catch (_) {
      payload.issues.push({
        code: "invalid_format",
        format: "url",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
});
var $ZodEmoji = /* @__PURE__ */ $constructor("$ZodEmoji", (inst, def) => {
  def.pattern ?? (def.pattern = emoji());
  $ZodStringFormat.init(inst, def);
});
var $ZodNanoID = /* @__PURE__ */ $constructor("$ZodNanoID", (inst, def) => {
  def.pattern ?? (def.pattern = nanoid);
  $ZodStringFormat.init(inst, def);
});
var $ZodCUID = /* @__PURE__ */ $constructor("$ZodCUID", (inst, def) => {
  def.pattern ?? (def.pattern = cuid);
  $ZodStringFormat.init(inst, def);
});
var $ZodCUID2 = /* @__PURE__ */ $constructor("$ZodCUID2", (inst, def) => {
  def.pattern ?? (def.pattern = cuid2);
  $ZodStringFormat.init(inst, def);
});
var $ZodULID = /* @__PURE__ */ $constructor("$ZodULID", (inst, def) => {
  def.pattern ?? (def.pattern = ulid);
  $ZodStringFormat.init(inst, def);
});
var $ZodXID = /* @__PURE__ */ $constructor("$ZodXID", (inst, def) => {
  def.pattern ?? (def.pattern = xid);
  $ZodStringFormat.init(inst, def);
});
var $ZodKSUID = /* @__PURE__ */ $constructor("$ZodKSUID", (inst, def) => {
  def.pattern ?? (def.pattern = ksuid);
  $ZodStringFormat.init(inst, def);
});
var $ZodISODateTime = /* @__PURE__ */ $constructor("$ZodISODateTime", (inst, def) => {
  def.pattern ?? (def.pattern = datetime(def));
  $ZodStringFormat.init(inst, def);
});
var $ZodISODate = /* @__PURE__ */ $constructor("$ZodISODate", (inst, def) => {
  def.pattern ?? (def.pattern = date);
  $ZodStringFormat.init(inst, def);
});
var $ZodISOTime = /* @__PURE__ */ $constructor("$ZodISOTime", (inst, def) => {
  def.pattern ?? (def.pattern = time(def));
  $ZodStringFormat.init(inst, def);
});
var $ZodISODuration = /* @__PURE__ */ $constructor("$ZodISODuration", (inst, def) => {
  def.pattern ?? (def.pattern = duration);
  $ZodStringFormat.init(inst, def);
});
var $ZodIPv4 = /* @__PURE__ */ $constructor("$ZodIPv4", (inst, def) => {
  def.pattern ?? (def.pattern = ipv4);
  $ZodStringFormat.init(inst, def);
  inst._zod.bag.format = `ipv4`;
});
var $ZodIPv6 = /* @__PURE__ */ $constructor("$ZodIPv6", (inst, def) => {
  def.pattern ?? (def.pattern = ipv6);
  $ZodStringFormat.init(inst, def);
  inst._zod.bag.format = `ipv6`;
  inst._zod.check = (payload) => {
    try {
      new URL(`http://[${payload.value}]`);
    } catch {
      payload.issues.push({
        code: "invalid_format",
        format: "ipv6",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
});
var $ZodMAC = /* @__PURE__ */ $constructor("$ZodMAC", (inst, def) => {
  def.pattern ?? (def.pattern = mac(def.delimiter));
  $ZodStringFormat.init(inst, def);
  inst._zod.bag.format = `mac`;
});
var $ZodCIDRv4 = /* @__PURE__ */ $constructor("$ZodCIDRv4", (inst, def) => {
  def.pattern ?? (def.pattern = cidrv4);
  $ZodStringFormat.init(inst, def);
});
var $ZodCIDRv6 = /* @__PURE__ */ $constructor("$ZodCIDRv6", (inst, def) => {
  def.pattern ?? (def.pattern = cidrv6);
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    const parts = payload.value.split("/");
    try {
      if (parts.length !== 2)
        throw new Error();
      const [address, prefix] = parts;
      if (!prefix)
        throw new Error();
      const prefixNum = Number(prefix);
      if (`${prefixNum}` !== prefix)
        throw new Error();
      if (prefixNum < 0 || prefixNum > 128)
        throw new Error();
      new URL(`http://[${address}]`);
    } catch {
      payload.issues.push({
        code: "invalid_format",
        format: "cidrv6",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
});
function isValidBase64(data) {
  if (data === "")
    return true;
  if (/\s/.test(data))
    return false;
  if (data.length % 4 !== 0)
    return false;
  try {
    atob(data);
    return true;
  } catch {
    return false;
  }
}
var $ZodBase64 = /* @__PURE__ */ $constructor("$ZodBase64", (inst, def) => {
  def.pattern ?? (def.pattern = base64);
  $ZodStringFormat.init(inst, def);
  inst._zod.bag.contentEncoding = "base64";
  inst._zod.check = (payload) => {
    if (isValidBase64(payload.value))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "base64",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
function isValidBase64URL(data) {
  if (!base64url.test(data))
    return false;
  const base643 = data.replace(/[-_]/g, (c) => c === "-" ? "+" : "/");
  const padded = base643.padEnd(Math.ceil(base643.length / 4) * 4, "=");
  return isValidBase64(padded);
}
var $ZodBase64URL = /* @__PURE__ */ $constructor("$ZodBase64URL", (inst, def) => {
  def.pattern ?? (def.pattern = base64url);
  $ZodStringFormat.init(inst, def);
  inst._zod.bag.contentEncoding = "base64url";
  inst._zod.check = (payload) => {
    if (isValidBase64URL(payload.value))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "base64url",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodE164 = /* @__PURE__ */ $constructor("$ZodE164", (inst, def) => {
  def.pattern ?? (def.pattern = e164);
  $ZodStringFormat.init(inst, def);
});
function isValidJWT(token, algorithm = null) {
  try {
    const tokensParts = token.split(".");
    if (tokensParts.length !== 3)
      return false;
    const [header] = tokensParts;
    if (!header)
      return false;
    const parsedHeader = JSON.parse(atob(header));
    if ("typ" in parsedHeader && parsedHeader?.typ !== "JWT")
      return false;
    if (!parsedHeader.alg)
      return false;
    if (algorithm && (!("alg" in parsedHeader) || parsedHeader.alg !== algorithm))
      return false;
    return true;
  } catch {
    return false;
  }
}
var $ZodJWT = /* @__PURE__ */ $constructor("$ZodJWT", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    if (isValidJWT(payload.value, def.alg))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "jwt",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCustomStringFormat = /* @__PURE__ */ $constructor("$ZodCustomStringFormat", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    if (def.fn(payload.value))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: def.format,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodNumber = /* @__PURE__ */ $constructor("$ZodNumber", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = inst._zod.bag.pattern ?? number;
  inst._zod.parse = (payload, _ctx) => {
    if (def.coerce)
      try {
        payload.value = Number(payload.value);
      } catch (_) {
      }
    const input = payload.value;
    if (typeof input === "number" && !Number.isNaN(input) && Number.isFinite(input)) {
      return payload;
    }
    const received = typeof input === "number" ? Number.isNaN(input) ? "NaN" : !Number.isFinite(input) ? "Infinity" : void 0 : void 0;
    payload.issues.push({
      expected: "number",
      code: "invalid_type",
      input,
      inst,
      ...received ? { received } : {}
    });
    return payload;
  };
});
var $ZodNumberFormat = /* @__PURE__ */ $constructor("$ZodNumberFormat", (inst, def) => {
  $ZodCheckNumberFormat.init(inst, def);
  $ZodNumber.init(inst, def);
});
var $ZodBoolean = /* @__PURE__ */ $constructor("$ZodBoolean", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = boolean;
  inst._zod.parse = (payload, _ctx) => {
    if (def.coerce)
      try {
        payload.value = Boolean(payload.value);
      } catch (_) {
      }
    const input = payload.value;
    if (typeof input === "boolean")
      return payload;
    payload.issues.push({
      expected: "boolean",
      code: "invalid_type",
      input,
      inst
    });
    return payload;
  };
});
var $ZodBigInt = /* @__PURE__ */ $constructor("$ZodBigInt", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = bigint;
  inst._zod.parse = (payload, _ctx) => {
    if (def.coerce)
      try {
        payload.value = BigInt(payload.value);
      } catch (_) {
      }
    if (typeof payload.value === "bigint")
      return payload;
    payload.issues.push({
      expected: "bigint",
      code: "invalid_type",
      input: payload.value,
      inst
    });
    return payload;
  };
});
var $ZodBigIntFormat = /* @__PURE__ */ $constructor("$ZodBigIntFormat", (inst, def) => {
  $ZodCheckBigIntFormat.init(inst, def);
  $ZodBigInt.init(inst, def);
});
var $ZodSymbol = /* @__PURE__ */ $constructor("$ZodSymbol", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (typeof input === "symbol")
      return payload;
    payload.issues.push({
      expected: "symbol",
      code: "invalid_type",
      input,
      inst
    });
    return payload;
  };
});
var $ZodUndefined = /* @__PURE__ */ $constructor("$ZodUndefined", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = _undefined;
  inst._zod.values = /* @__PURE__ */ new Set([void 0]);
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (typeof input === "undefined")
      return payload;
    payload.issues.push({
      expected: "undefined",
      code: "invalid_type",
      input,
      inst
    });
    return payload;
  };
});
var $ZodNull = /* @__PURE__ */ $constructor("$ZodNull", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = _null;
  inst._zod.values = /* @__PURE__ */ new Set([null]);
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (input === null)
      return payload;
    payload.issues.push({
      expected: "null",
      code: "invalid_type",
      input,
      inst
    });
    return payload;
  };
});
var $ZodAny = /* @__PURE__ */ $constructor("$ZodAny", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload) => payload;
});
var $ZodUnknown = /* @__PURE__ */ $constructor("$ZodUnknown", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload) => payload;
});
var $ZodNever = /* @__PURE__ */ $constructor("$ZodNever", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _ctx) => {
    payload.issues.push({
      expected: "never",
      code: "invalid_type",
      input: payload.value,
      inst
    });
    return payload;
  };
});
var $ZodVoid = /* @__PURE__ */ $constructor("$ZodVoid", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (typeof input === "undefined")
      return payload;
    payload.issues.push({
      expected: "void",
      code: "invalid_type",
      input,
      inst
    });
    return payload;
  };
});
var $ZodDate = /* @__PURE__ */ $constructor("$ZodDate", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _ctx) => {
    if (def.coerce) {
      try {
        payload.value = new Date(payload.value);
      } catch (_err) {
      }
    }
    const input = payload.value;
    const isDate = input instanceof Date;
    const isValidDate = isDate && !Number.isNaN(input.getTime());
    if (isValidDate)
      return payload;
    payload.issues.push({
      expected: "date",
      code: "invalid_type",
      input,
      ...isDate ? { received: "Invalid Date" } : {},
      inst
    });
    return payload;
  };
});
function handleArrayResult(result, final, index) {
  if (result.issues.length) {
    final.issues.push(...prefixIssues(index, result.issues));
  }
  final.value[index] = result.value;
}
var $ZodArray = /* @__PURE__ */ $constructor("$ZodArray", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!Array.isArray(input)) {
      payload.issues.push({
        expected: "array",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    payload.value = Array(input.length);
    const proms = [];
    for (let i = 0; i < input.length; i++) {
      const item = input[i];
      const result = def.element._zod.run({
        value: item,
        issues: []
      }, ctx);
      if (result instanceof Promise) {
        proms.push(result.then((result2) => handleArrayResult(result2, payload, i)));
      } else {
        handleArrayResult(result, payload, i);
      }
    }
    if (proms.length) {
      return Promise.all(proms).then(() => payload);
    }
    return payload;
  };
});
function handlePropertyResult(result, final, key, input, isOptionalIn, isOptionalOut) {
  const isPresent = key in input;
  if (result.issues.length) {
    if (isOptionalIn && isOptionalOut && !isPresent) {
      return;
    }
    final.issues.push(...prefixIssues(key, result.issues));
  }
  if (!isPresent && !isOptionalIn) {
    if (!result.issues.length) {
      final.issues.push({
        code: "invalid_type",
        expected: "nonoptional",
        input: void 0,
        path: [key]
      });
    }
    return;
  }
  if (result.value === void 0) {
    if (isPresent) {
      final.value[key] = void 0;
    }
  } else {
    final.value[key] = result.value;
  }
}
function normalizeDef(def) {
  const keys = Object.keys(def.shape);
  for (const k of keys) {
    if (!def.shape?.[k]?._zod?.traits?.has("$ZodType")) {
      throw new Error(`Invalid element at key "${k}": expected a Zod schema`);
    }
  }
  const okeys = optionalKeys(def.shape);
  return {
    ...def,
    keys,
    keySet: new Set(keys),
    numKeys: keys.length,
    optionalKeys: new Set(okeys)
  };
}
function handleCatchall(proms, input, payload, ctx, def, inst) {
  const unrecognized = [];
  const keySet = def.keySet;
  const _catchall = def.catchall._zod;
  const t = _catchall.def.type;
  const isOptionalIn = _catchall.optin === "optional";
  const isOptionalOut = _catchall.optout === "optional";
  for (const key in input) {
    if (key === "__proto__")
      continue;
    if (keySet.has(key))
      continue;
    if (t === "never") {
      unrecognized.push(key);
      continue;
    }
    const r = _catchall.run({ value: input[key], issues: [] }, ctx);
    if (r instanceof Promise) {
      proms.push(r.then((r2) => handlePropertyResult(r2, payload, key, input, isOptionalIn, isOptionalOut)));
    } else {
      handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut);
    }
  }
  if (unrecognized.length) {
    payload.issues.push({
      code: "unrecognized_keys",
      keys: unrecognized,
      input,
      inst
    });
  }
  if (!proms.length)
    return payload;
  return Promise.all(proms).then(() => {
    return payload;
  });
}
var $ZodObject = /* @__PURE__ */ $constructor("$ZodObject", (inst, def) => {
  $ZodType.init(inst, def);
  const desc = Object.getOwnPropertyDescriptor(def, "shape");
  if (!desc?.get) {
    const sh = def.shape;
    Object.defineProperty(def, "shape", {
      get: () => {
        const newSh = { ...sh };
        Object.defineProperty(def, "shape", {
          value: newSh
        });
        return newSh;
      }
    });
  }
  const _normalized = cached(() => normalizeDef(def));
  defineLazy(inst._zod, "propValues", () => {
    const shape = def.shape;
    const propValues = {};
    for (const key in shape) {
      const field = shape[key]._zod;
      if (field.values) {
        propValues[key] ?? (propValues[key] = /* @__PURE__ */ new Set());
        for (const v of field.values)
          propValues[key].add(v);
      }
    }
    return propValues;
  });
  const isObject2 = isObject;
  const catchall = def.catchall;
  let value;
  inst._zod.parse = (payload, ctx) => {
    value ?? (value = _normalized.value);
    const input = payload.value;
    if (!isObject2(input)) {
      payload.issues.push({
        expected: "object",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    payload.value = {};
    const proms = [];
    const shape = value.shape;
    for (const key of value.keys) {
      const el = shape[key];
      const isOptionalIn = el._zod.optin === "optional";
      const isOptionalOut = el._zod.optout === "optional";
      const r = el._zod.run({ value: input[key], issues: [] }, ctx);
      if (r instanceof Promise) {
        proms.push(r.then((r2) => handlePropertyResult(r2, payload, key, input, isOptionalIn, isOptionalOut)));
      } else {
        handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut);
      }
    }
    if (!catchall) {
      return proms.length ? Promise.all(proms).then(() => payload) : payload;
    }
    return handleCatchall(proms, input, payload, ctx, _normalized.value, inst);
  };
});
var $ZodObjectJIT = /* @__PURE__ */ $constructor("$ZodObjectJIT", (inst, def) => {
  $ZodObject.init(inst, def);
  const superParse = inst._zod.parse;
  const _normalized = cached(() => normalizeDef(def));
  const generateFastpass = (shape) => {
    const doc = new Doc(["shape", "payload", "ctx"]);
    const normalized = _normalized.value;
    const parseStr = (key) => {
      const k = esc(key);
      return `shape[${k}]._zod.run({ value: input[${k}], issues: [] }, ctx)`;
    };
    doc.write(`const input = payload.value;`);
    const ids = /* @__PURE__ */ Object.create(null);
    let counter = 0;
    for (const key of normalized.keys) {
      ids[key] = `key_${counter++}`;
    }
    doc.write(`const newResult = {};`);
    for (const key of normalized.keys) {
      const id = ids[key];
      const k = esc(key);
      const schema = shape[key];
      const isOptionalIn = schema?._zod?.optin === "optional";
      const isOptionalOut = schema?._zod?.optout === "optional";
      doc.write(`const ${id} = ${parseStr(key)};`);
      if (isOptionalIn && isOptionalOut) {
        doc.write(`
        if (${id}.issues.length) {
          if (${k} in input) {
            payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
              ...iss,
              path: iss.path ? [${k}, ...iss.path] : [${k}]
            })));
          }
        }
        
        if (${id}.value === undefined) {
          if (${k} in input) {
            newResult[${k}] = undefined;
          }
        } else {
          newResult[${k}] = ${id}.value;
        }
        
      `);
      } else if (!isOptionalIn) {
        doc.write(`
        const ${id}_present = ${k} in input;
        if (${id}.issues.length) {
          payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${k}, ...iss.path] : [${k}]
          })));
        }
        if (!${id}_present && !${id}.issues.length) {
          payload.issues.push({
            code: "invalid_type",
            expected: "nonoptional",
            input: undefined,
            path: [${k}]
          });
        }

        if (${id}_present) {
          if (${id}.value === undefined) {
            newResult[${k}] = undefined;
          } else {
            newResult[${k}] = ${id}.value;
          }
        }

      `);
      } else {
        doc.write(`
        if (${id}.issues.length) {
          payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${k}, ...iss.path] : [${k}]
          })));
        }
        
        if (${id}.value === undefined) {
          if (${k} in input) {
            newResult[${k}] = undefined;
          }
        } else {
          newResult[${k}] = ${id}.value;
        }
        
      `);
      }
    }
    doc.write(`payload.value = newResult;`);
    doc.write(`return payload;`);
    const fn = doc.compile();
    return (payload, ctx) => fn(shape, payload, ctx);
  };
  let fastpass;
  const isObject2 = isObject;
  const jit = !globalConfig.jitless;
  const allowsEval2 = allowsEval;
  const fastEnabled = jit && allowsEval2.value;
  const catchall = def.catchall;
  let value;
  inst._zod.parse = (payload, ctx) => {
    value ?? (value = _normalized.value);
    const input = payload.value;
    if (!isObject2(input)) {
      payload.issues.push({
        expected: "object",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    if (jit && fastEnabled && ctx?.async === false && ctx.jitless !== true) {
      if (!fastpass)
        fastpass = generateFastpass(def.shape);
      payload = fastpass(payload, ctx);
      if (!catchall)
        return payload;
      return handleCatchall([], input, payload, ctx, value, inst);
    }
    return superParse(payload, ctx);
  };
});
functi…136718 tokens truncated…lSchemas.proposal;
function normalizeAction(actions) {
  if (actions.length === 2) return "replace";
  const [action] = actions;
  switch (action) {
    case "create":
    case "update":
    case "delete":
    case "read":
      return action;
    default:
      return "no-op";
  }
}
function slugify2(address) {
  const slug = address.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "resource";
}
function readTags(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const tags = {};
  for (const key of ["tags", "labels", "tags_all"]) {
    const candidate = value[key];
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) continue;
    for (const [tagKey, tagValue] of Object.entries(candidate)) {
      if (typeof tagValue === "string") tags[tagKey] = tagValue;
    }
  }
  return tags;
}
function normalizePlan(raw, options = {}) {
  const parsed = TerraformPlanSchema.safeParse(raw);
  if (!parsed.success) {
    throw new DomainError(
      "SCHEMA_VALIDATION",
      "The file is not recognizable Terraform plan JSON. Produce it with: terraform show -json <planfile>"
    );
  }
  const resourceChanges = parsed.data.resource_changes ?? [];
  const seenSlugs = /* @__PURE__ */ new Map();
  const changes = [];
  resourceChanges.forEach((resource, index) => {
    const action = normalizeAction(resource.change.actions);
    if (action === "no-op" || action === "read") return;
    const base = slugify2(resource.address);
    const seen = seenSlugs.get(base) ?? 0;
    seenSlugs.set(base, seen + 1);
    const slug = seen === 0 ? base : `${base}-${seen + 1}`;
    const after = resource.change.after ?? null;
    const before = resource.change.before ?? null;
    changes.push({
      // Evidence for "we are deleting the database" is the plan entry itself.
      evidenceId: `ev-plan-${index}`,
      address: resource.address,
      slug,
      resourceType: resource.type,
      moduleAddress: resource.module_address ?? "root",
      action,
      before,
      after,
      tags: { ...readTags(before), ...readTags(after) }
    });
  });
  const context = (options.context ?? []).map((entry, index) => ({
    evidenceId: `ev-context-${index}`,
    kind: entry.kind,
    text: entry.text
  }));
  return TerraformInputSchema.parse({
    planId: options.planId ?? "plan-terraform",
    terraformVersion: parsed.data.terraform_version ?? null,
    changes,
    context
  });
}
var ACTION_TO_OP = {
  create: "add",
  update: "replace",
  delete: "remove",
  replace: "replace"
};
function deriveProposal(input) {
  if (input.changes.length === 0) {
    throw new DomainError(
      "REQUEST_INVALID",
      "The plan contains no create, update, delete, or replace actions \u2014 there is nothing to gate."
    );
  }
  const operations = input.changes.map((change) => ({
    op: ACTION_TO_OP[change.action],
    path: `/resources/${change.slug}`,
    value: change.action === "delete" ? null : change.after,
    reason: `Terraform plans to ${change.action} ${change.address}`.slice(0, 500),
    evidenceIds: [change.evidenceId]
  }));
  const counts = /* @__PURE__ */ new Map();
  for (const change of input.changes) {
    counts.set(change.action, (counts.get(change.action) ?? 0) + 1);
  }
  const summary2 = [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([action, count]) => `${count} ${action}`).join(", ");
  return TerraformChangeProposalSchema.parse({
    proposalId: "prop-terraform-plan",
    summary: `Terraform plan: ${summary2}.`,
    diagnosis: {
      likelyCause: "Derived mechanically from Terraform plan output. No model produced this diagnosis; the plan states what will change and this restates it for the gate.",
      // Advisory field, unused by every policy. Zero is the honest value for
      // a mechanical derivation that made no judgement.
      confidence: 0,
      evidenceIds: input.changes.map((change) => change.evidenceId),
      assumptions: [
        "The plan was produced from the code under review against current state",
        "Provider behaviour matches what the plan reports"
      ]
    },
    operations,
    // Terraform plans carry no inverse; REVERSIBILITY answers that question
    // instead, and this domain skips ROLLBACK_COMPLETE for exactly that reason.
    rollbackOperations: [],
    verificationSteps: []
  });
}

// src/io.ts
import { readFileSync } from "node:fs";
import path from "node:path";
var UsageError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "UsageError";
  }
};
function readJsonFile(filePath, label) {
  let text;
  try {
    text = readFileSync(filePath, "utf8");
  } catch {
    throw new UsageError(`cannot read ${label}: ${path.resolve(filePath)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new UsageError(`${label} is not valid JSON: ${path.resolve(filePath)}`);
  }
}
function readTextFile(filePath, label) {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    throw new UsageError(`cannot read ${label}: ${path.resolve(filePath)}`);
  }
}
function parseOrThrow(schema, value, label) {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const issues = result.error.issues.slice(0, 5).map((issue2) => `  ${issue2.path.join(".") || "(root)"}: ${issue2.message}`).join("\n");
  const more = result.error.issues.length > 5 ? `
  \u2026 and ${result.error.issues.length - 5} more` : "";
  throw new UsageError(`${label} failed validation:
${issues}${more}`);
}

// src/domains.ts
function hasProposalKey(raw) {
  return typeof raw === "object" && raw !== null && "proposal" in raw;
}
var network = {
  id: "network",
  adapter: networkDomain,
  inputDescription: "an incident bundle (scenarios/*/incident.json)",
  parseInput(raw) {
    const bundle = parseOrThrow(IncidentBundleSchema, raw, "incident bundle");
    return { input: bundle, inputId: bundle.incidentId };
  },
  parseProposal(raw) {
    if (hasProposalKey(raw)) {
      const fixture = parseOrThrow(NetworkReplayFixtureSchema, raw, "replay fixture");
      return {
        proposal: fixture.proposal,
        provenance: fixture.provenance,
        fixtureId: fixture.fixtureId
      };
    }
    const proposal = parseOrThrow(NetworkChangeProposalSchema, raw, "change proposal");
    return { proposal, provenance: null, fixtureId: null };
  }
};
var terraform = {
  id: "terraform",
  adapter: terraformDomain,
  inputDescription: "terraform show -json output",
  derivesProposalFromInput: true,
  parseInput(raw, context) {
    const input = normalizePlan(raw, { context });
    return { input, inputId: input.planId };
  },
  deriveProposal(input) {
    return deriveProposal(input);
  },
  parseProposal(raw) {
    throw new UsageError(
      "the terraform domain derives its proposal from the plan; pass only --input"
    );
    void raw;
  }
};
var DOMAINS = { network, terraform };
var DOMAIN_IDS = Object.keys(DOMAINS);
function resolveDomain(id) {
  const domain2 = DOMAINS[id];
  if (!domain2) {
    throw new UsageError(
      `unknown domain "${id}". Available: ${DOMAIN_IDS.join(", ")}`
    );
  }
  return domain2;
}
var ExpectationsFileSchema = external_exports.looseObject({ scenarioId: external_exports.string() });

// src/gate.ts
import { writeFileSync } from "node:fs";
import path2 from "node:path";

// src/version.ts
var CLI_PACKAGE_VERSION = "0.2.0";
var CLI_APP_VERSION = `changesafe-cli-${CLI_PACKAGE_VERSION}`;
var SERVER_APP_VERSION = `changesafe-server-${CLI_PACKAGE_VERSION}`;

// src/output.ts
var EXIT_OK = 0;
var EXIT_BLOCKED = 1;
var EXIT_USAGE = 2;
function createConsole(options = {}) {
  const color = options.color ?? (process.env.NO_COLOR === void 0 && process.stdout.isTTY === true);
  return {
    out: (line) => process.stdout.write(`${line}
`),
    err: (line) => process.stderr.write(`${line}
`),
    color
  };
}
var CODES = {
  reset: "\x1B[0m",
  dim: "\x1B[2m",
  bold: "\x1B[1m",
  green: "\x1B[32m",
  yellow: "\x1B[33m",
  red: "\x1B[31m"
};
function paint(color, code, text) {
  return color ? `${CODES[code]}${text}${CODES.reset}` : text;
}
var STATUS_COLOR = {
  PASS: "green",
  WARN: "yellow",
  BLOCK: "red"
};
var RISK_COLOR = {
  LOW: "green",
  MEDIUM: "yellow",
  HIGH: "yellow",
  CRITICAL: "red"
};
function formatFindings(console, findings, riskLevel) {
  const lines = [];
  const width = Math.max(...findings.map((finding) => finding.policyId.length));
  for (const finding of findings) {
    const status = paint(console.color, STATUS_COLOR[finding.status], finding.status.padEnd(5));
    lines.push(`  ${status}  ${finding.policyId.padEnd(width)}  ${finding.title}`);
    if (finding.status !== "PASS") {
      lines.push(`         ${paint(console.color, "dim", finding.explanation)}`);
      for (const resource of finding.affectedResources) {
        lines.push(`         ${paint(console.color, "dim", `\xB7 ${resource}`)}`);
      }
      if (finding.remediation) {
        lines.push(`         ${paint(console.color, "dim", `\u2192 ${finding.remediation}`)}`);
      }
    }
  }
  const counts = ["PASS", "WARN", "BLOCK"].map((status) => {
    const count = findings.filter((finding) => finding.status === status).length;
    return paint(console.color, STATUS_COLOR[status], `${count} ${status}`);
  });
  lines.push("");
  lines.push(
    `  ${counts.join(paint(console.color, "dim", " \xB7 "))}   risk: ${paint(
      console.color,
      RISK_COLOR[riskLevel],
      paint(console.color, "bold", riskLevel)
    )}`
  );
  return lines;
}

// src/gate.ts
function sourceIdFromPath(filePath) {
  const slug = path2.basename(filePath).replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^[^a-z]+/, "").replace(/-+$/g, "");
  return slug.length >= 2 ? slug.slice(0, 64) : "cli-gate";
}
async function runGate(options, console) {
  const domain2 = resolveDomain(options.domain);
  let inputPath = options.input;
  let proposalPath = options.proposal;
  let sourceId = options.sourceId;
  if (options.scenario) {
    inputPath ??= path2.join(options.scenario, "incident.json");
    proposalPath ??= path2.join(options.scenario, "replay-fixture.json");
    sourceId ??= path2.basename(path2.resolve(options.scenario));
  }
  if (!inputPath) {
    throw new UsageError(
      `--input is required (${domain2.inputDescription})` + (domain2.derivesProposalFromInput ? "" : ", or use --scenario <dir>")
    );
  }
  if (!proposalPath && !domain2.derivesProposalFromInput) {
    throw new UsageError("--proposal is required, or use --scenario <dir>");
  }
  const context = options.context ? [{ kind: "context", text: readTextFile(options.context, "context") }] : [];
  const { input, inputId } = domain2.parseInput(
    readJsonFile(inputPath, domain2.derivesProposalFromInput ? "plan" : "incident bundle"),
    context
  );
  const { proposal, provenance, fixtureId } = proposalPath !== void 0 ? domain2.parseProposal(readJsonFile(proposalPath, "proposal")) : {
    proposal: domain2.deriveProposal?.(input),
    provenance: null,
    fixtureId: null
  };
  if (!proposal) {
    throw new UsageError(`the ${domain2.id} domain could not derive a proposal from the input`);
  }
  return gateParsedProposal(
    {
      domain: domain2,
      input,
      inputId,
      proposal,
      provenance: provenance ?? null,
      fixtureId,
      sourceId: sourceId ?? sourceIdFromPath(inputPath),
      policyPack: options.policyPack,
      receipt: options.receipt,
      signKey: options.signKey,
      receiptId: options.receiptId,
      format: options.format,
      // The proposal was handed to us; this run produced nothing and attests
      // nothing about how it was written.
      mode: "offline",
      model: null,
      now: options.now,
      appVersion: options.appVersion
    },
    console
  );
}
async function gateParsedProposal(options, console) {
  const { domain: domain2, input, inputId, proposal } = options;
  const policyPack = options.policyPack ? parseOrThrow(PolicyPackSchema, readJsonFile(options.policyPack, "policy pack"), "policy pack") : null;
  validateProposalEvidence(domain2.adapter, input, proposal);
  const { findings, riskLevel } = evaluatePolicies(
    domain2.adapter,
    input,
    proposal,
    { policyPack }
  );
  const blocked = hasBlockingFinding(findings);
  if (options.receipt) {
    const unsigned = await createReceipt({
      receiptId: options.receiptId,
      sourceId: options.sourceId,
      inputId,
      input,
      proposal,
      appVersion: options.appVersion ?? CLI_APP_VERSION,
      // The adapter already composes core's version with its own.
      policyVersion: domain2.adapter.policyVersion,
      mode: options.mode,
      model: options.model,
      fixtureProvenance: options.provenance,
      findings,
      riskLevel,
      // Never "approved": the CLI gates, and a human decides elsewhere.
      decision: blocked ? "blocked" : "gate_only",
      simulation: null,
      createdAtUtc: options.now
    });
    const record2 = options.signKey ? await signReceipt(
      unsigned,
      await importSigningKeyPair(readTextFile(options.signKey, "signing key")),
      { signedAtUtc: options.now }
    ) : unsigned;
    writeFileSync(options.receipt, `${JSON.stringify(record2, null, 2)}
`);
  }
  if (options.format === "json") {
    console.out(
      JSON.stringify(
        {
          domain: domain2.id,
          inputId,
          proposalId: proposal.proposalId,
          fixtureId: options.fixtureId,
          provenance: options.provenance,
          mode: options.mode,
          model: options.model,
          findings,
          riskLevel,
          blocked,
          decision: blocked ? "blocked" : "gate_only"
        },
        null,
        2
      )
    );
    return blocked ? EXIT_BLOCKED : EXIT_OK;
  }
  console.out("");
  console.out(
    `  ${paint(console.color, "bold", "ChangeSafe gate")} ${paint(
      console.color,
      "dim",
      `\xB7 domain ${domain2.id} \xB7 input ${inputId}`
    )}`
  );
  if (options.note) {
    console.out(`  ${paint(console.color, "dim", options.note)}`);
  }
  if (options.provenance) {
    console.out(`  ${paint(console.color, "dim", `proposal provenance: ${options.provenance}`)}`);
  }
  console.out("");
  for (const line of formatFindings(console, findings, riskLevel)) {
    console.out(line);
  }
  console.out("");
  console.out(
    blocked ? `  ${paint(console.color, "red", "BLOCKED")} \u2014 this change cannot be approved.` : `  ${paint(console.color, "green", "no blocking findings")} \u2014 a human decision is still required.`
  );
  if (options.receipt) {
    console.out(`  ${paint(console.color, "dim", `receipt written to ${options.receipt}`)}`);
  }
  console.out("");
  return blocked ? EXIT_BLOCKED : EXIT_OK;
}

// src/analyze.ts
async function runAnalyze(options, console) {
  const analysisDomain = resolveAnalysisDomain(options.domain);
  const gateDomain = resolveDomain(options.domain);
  const inputPath = options.input ?? (options.scenario ? path3.join(options.scenario, "incident.json") : void 0);
  if (!inputPath) {
    throw new UsageError(
      `--input is required (${gateDomain.inputDescription}), or use --scenario <dir>`
    );
  }
  const provider = pickProvider(options.provider);
  const model = resolveModel(provider, process.env, options.model);
  if (options.format === "pretty") {
    console.err(
      `  ${paint(console.color, "dim", `asking ${provider.label} (${model}) for a proposal\u2026`)}`
    );
  }
  const analysis = await analysisDomain.analyze(readJsonFile(inputPath, "incident bundle"), {
    provider,
    model
  });
  const sourceId = options.sourceId ?? (options.scenario ? path3.basename(path3.resolve(options.scenario)) : void 0) ?? "cli-analyze";
  if (options.out) {
    writeFileSync2(options.out, `${JSON.stringify(analysis.proposal, null, 2)}
`);
  }
  if (options.capture) {
    const fixture = captureFixture(analysis, {
      scenarioId: sourceId,
      capturedAtUtc: options.now ?? (/* @__PURE__ */ new Date()).toISOString()
    });
    writeFileSync2(options.capture, `${JSON.stringify(fixture, null, 2)}
`);
  }
  const { inputId } = gateDomain.parseInput(analysis.input);
  const exitCode = await gateParsedProposal(
    {
      domain: gateDomain,
      input: analysis.input,
      inputId,
      proposal: analysis.proposal,
      // A live analysis is not a fixture; it has no fixture provenance.
      provenance: null,
      fixtureId: null,
      sourceId,
      policyPack: options.policyPack,
      receipt: options.receipt,
      signKey: options.signKey,
      receiptId: options.receiptId,
      format: options.format,
      mode: "live",
      model: analysis.model,
      note: `proposed live by ${provider.label} \xB7 model ${analysis.model}`,
      now: options.receiptCreatedAtUtc
    },
    console
  );
  if (options.format === "pretty") {
    if (options.out) {
      console.out(`  ${paint(console.color, "dim", `proposal written to ${options.out}`)}`);
    }
    if (options.capture) {
      console.out(
        `  ${paint(console.color, "dim", `capture written to ${options.capture} (review before promoting it to a bundled fixture)`)}`
      );
    }
    if (options.out || options.capture) console.out("");
  }
  return exitCode;
}
function pickProvider(requested) {
  if (requested) {
    const provider2 = resolveProvider(requested);
    if (!provider2.isConfigured(process.env)) {
      throw new UsageError(
        provider2.credentialEnvVar ? `${provider2.label} needs ${provider2.credentialEnvVar} to be set` : `${provider2.label} is not available`
      );
    }
    return provider2;
  }
  const provider = defaultProvider(process.env);
  if (!provider) {
    const options = ALL_PROVIDERS.map(
      (candidate) => candidate.credentialEnvVar ? `--provider ${candidate.id} (needs ${candidate.credentialEnvVar})` : `--provider ${candidate.id} (local, no credential)`
    );
    throw new UsageError(
      `no model provider is configured. Choose one:
  ${options.join("\n  ")}`
    );
  }
  return provider;
}

// src/eval.ts
import { existsSync, readdirSync, writeFileSync as writeFileSync3 } from "node:fs";
import path4 from "node:path";
var EVAL_REPORT_VERSION = 2;
var EMPTY_OUTCOMES = {
  accepted: 0,
  call_failed: 0,
  no_output: 0,
  schema_invalid: 0,
  ungrounded: 0
};
function createScenarioReport(expectations, attempts) {
  return {
    scenarioId: expectations.scenarioId,
    adversarial: expectations.corpus.adversarial,
    expectsBlock: Object.values(expectations.policies).includes("BLOCK"),
    attempts,
    outcomes: { ...EMPTY_OUTCOMES },
    blocked: 0,
    clean: 0,
    notes: []
  };
}
async function runEval(options, console) {
  const provider = resolveProvider(options.provider);
  if (!provider.isConfigured(process.env)) {
    throw new UsageError(
      provider.credentialEnvVar ? `${provider.label} needs ${provider.credentialEnvVar} to be set` : `${provider.label} is not available`
    );
  }
  if (!Number.isInteger(options.runs) || options.runs < 1 || options.runs > 20) {
    throw new UsageError("--runs must be an integer between 1 and 20");
  }
  const root = path4.resolve(options.dir);
  if (!existsSync(root)) throw new UsageError(`scenario directory does not exist: ${root}`);
  const directories = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).filter((name) => existsSync(path4.join(root, name, "expectations.json"))).sort();
  if (directories.length === 0) throw new UsageError(`no scenarios found in ${root}`);
  const model = resolveModel(provider, process.env, options.model);
  if (options.format === "pretty") {
    console.err(
      `  ${paint(console.color, "dim", `evaluating ${provider.label} ${model} over ${directories.length} scenarios \xD7 ${options.runs} run(s) \u2014 this spends API credit`)}`
    );
  }
  const reports = [];
  for (const name of directories) {
    reports.push(await evaluateScenario(path4.join(root, name), provider.id, model, options.runs));
  }
  return report(reports, { provider: provider.label, model }, options, console);
}
async function evaluateScenario(dir, providerId, model, runs) {
  const bundle = parseOrThrow(
    IncidentBundleSchema,
    readJsonFile(path4.join(dir, "incident.json"), "incident bundle"),
    "incident bundle"
  );
  const expectations = parseOrThrow(
    ScenarioExpectationsSchema,
    readJsonFile(path4.join(dir, "expectations.json"), "expectations"),
    "expectations"
  );
  const report2 = createScenarioReport(expectations, runs);
  for (let run2 = 0; run2 < runs; run2 += 1) {
    const verdict = await probeProposal(networkAnalysisPrompt, bundle, {
      provider: resolveProvider(providerId),
      model
    });
    report2.outcomes[verdict.outcome] += 1;
    if (verdict.outcome === "accepted") {
      const { findings } = evaluatePolicies(
        networkDomain,
        bundle,
        verdict.proposal
      );
      if (hasBlockingFinding(findings)) report2.blocked += 1;
      else report2.clean += 1;
    } else if (report2.notes.length < 3) {
      report2.notes.push(`${verdict.outcome}: ${"detail" in verdict ? verdict.detail : ""}`.trim());
    }
  }
  return report2;
}
function buildEvalArtifact(reports, target, context) {
  const total = (pick2) => reports.reduce((sum, report2) => sum + pick2(report2), 0);
  const attempts = total((entry) => entry.attempts);
  const callFailed2 = total((entry) => entry.outcomes.call_failed);
  const answered = attempts - callFailed2;
  const accepted = total((entry) => entry.outcomes.accepted);
  const ungrounded = total((entry) => entry.outcomes.ungrounded);
  const schemaValid = accepted + ungrounded;
  const blockExpected = reports.filter((entry) => entry.expectsBlock);
  const redTeamAccepted = blockExpected.reduce(
    (sum, entry) => sum + entry.outcomes.accepted,
    0
  );
  const redTeamBlocked = blockExpected.reduce(
    (sum, entry) => sum + entry.blocked,
    0
  );
  const rate = (numerator, denominator) => denominator === 0 ? null : Math.round(numerator / denominator * 1e3) / 10;
  const summary2 = {
    provider: target.provider,
    model: target.model,
    attempts,
    answered,
    callFailed: callFailed2,
    schemaValidPct: rate(schemaValid, answered),
    evidenceGroundedPct: rate(accepted, answered),
    redTeamBlockedPct: rate(redTeamBlocked, redTeamAccepted)
  };
  return {
    reportVersion: EVAL_REPORT_VERSION,
    generatedAtUtc: context.generatedAtUtc,
    target: { provider: target.provider, model: target.model },
    corpus: {
      directory: context.directory,
      scenarios: reports.length,
      adversarial: reports.filter((entry) => entry.adversarial).length,
      runsPerScenario: context.runsPerScenario
    },
    summary: summary2,
    scenarios: [...reports]
  };
}
function report(reports, target, options, console) {
  const artifact = buildEvalArtifact(reports, target, {
    directory: options.dir,
    generatedAtUtc: options.now ?? (/* @__PURE__ */ new Date()).toISOString(),
    runsPerScenario: options.runs
  });
  const { summary: summary2 } = artifact;
  const redTeamAccepted = reports.filter((entry) => entry.expectsBlock).reduce((sum, entry) => sum + entry.outcomes.accepted, 0);
  if (options.report) {
    writeFileSync3(options.report, `${JSON.stringify(artifact, null, 2)}
`);
  }
  if (options.format === "json") {
    console.out(JSON.stringify({ summary: summary2, scenarios: reports }, null, 2));
    return EXIT_OK;
  }
  const pct = (value) => value === null ? "n/a" : `${value.toFixed(1)}%`;
  console.out("");
  console.out(
    `  ${paint(console.color, "bold", "ChangeSafe eval")} ${paint(console.color, "dim", `\xB7 ${target.provider} \xB7 ${target.model}`)}`
  );
  console.out("");
  for (const scenario of reports) {
    const tag2 = scenario.expectsBlock ? paint(console.color, "dim", "expects BLOCK") : paint(console.color, "dim", "expects clean");
    console.out(`  ${scenario.scenarioId.padEnd(30)} ${tag2}`);
    console.out(
      `    ${paint(console.color, "dim", `accepted ${scenario.outcomes.accepted}/${scenario.attempts} \xB7 gate: ${scenario.blocked} blocked, ${scenario.clean} clean`)}`
    );
    for (const note of scenario.notes) {
      console.out(`    ${paint(console.color, "dim", `\xB7 ${note}`)}`);
    }
  }
  console.out("");
  console.out(`  schema-valid       ${pct(summary2.schemaValidPct)}  (of ${summary2.answered} answered)`);
  console.out(
    `  evidence-grounded  ${pct(summary2.evidenceGroundedPct)}  (of ${summary2.answered} answered)`
  );
  console.out(
    `  red-team blocked   ${pct(summary2.redTeamBlockedPct)}  (of ${redTeamAccepted} accepted on block-expected scenarios)`
  );
  if (summary2.callFailed > 0) {
    console.out(
      `  ${paint(console.color, "dim", `${summary2.callFailed} call(s) failed and are excluded from every rate`)}`
    );
  }
  console.out("");
  console.out(
    `  ${paint(console.color, "dim", "Read these as proposal quality, not safety. A low red-team block rate means")}`
  );
  console.out(
    `  ${paint(console.color, "dim", "the model resisted the injected instruction; a high one means it did not and")}`
  );
  console.out(
    `  ${paint(console.color, "dim", "the gate caught it. Neither number changes what the gate blocks.")}`
  );
  console.out("");
  return EXIT_OK;
}

// src/gallery.ts
import { existsSync as existsSync2, readFileSync as readFileSync2, readdirSync as readdirSync2, writeFileSync as writeFileSync4 } from "node:fs";
import path5 from "node:path";
var RISK_ORDER = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
function runGallery(options, console) {
  const root = path5.resolve(options.dir);
  if (!existsSync2(root)) throw new UsageError(`scenario directory does not exist: ${root}`);
  const entries = readdirSync2(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).filter((name) => existsSync2(path5.join(root, name, "expectations.json"))).sort().map((name) => readEntry(path5.join(root, name)));
  if (entries.length === 0) throw new UsageError(`no scenarios found in ${root}`);
  const markdown = render(entries);
  if (options.format === "json") {
    console.out(
      JSON.stringify(
        {
          scenarios: entries.length,
          coverage: coverage(entries),
          adversarial: entries.filter((e) => e.expectations.corpus.adversarial).length
        },
        null,
        2
      )
    );
    return EXIT_OK;
  }
  if (options.check) {
    const current = existsSync2(options.out) ? readFileSync2(options.out, "utf8") : "";
    if (current === markdown) {
      console.out("");
      console.out(`  ${paint(console.color, "green", "gallery is current")} ${paint(console.color, "dim", `\xB7 ${entries.length} scenarios`)}`);
      console.out("");
      return EXIT_OK;
    }
    console.out("");
    console.out(`  ${paint(console.color, "red", "gallery is out of date")}`);
    console.out(`  ${paint(console.color, "dim", `regenerate it: changesafe scenario gallery --out ${options.out}`)}`);
    console.out("");
    return EXIT_BLOCKED;
  }
  writeFileSync4(options.out, markdown);
  console.out("");
  console.out(
    `  ${paint(console.color, "green", "wrote")} ${options.out} ${paint(console.color, "dim", `\xB7 ${entries.length} scenarios`)}`
  );
  console.out("");
  return EXIT_OK;
}
function readEntry(dir) {
  const expectations = parseOrThrow(
    ScenarioExpectationsSchema,
    readJsonFile(path5.join(dir, "expectations.json"), "expectations"),
    "expectations"
  );
  const incident = readJsonFile(path5.join(dir, "incident.json"), "incident bundle");
  return {
    scenarioId: expectations.scenarioId,
    title: typeof incident.title === "string" ? incident.title : expectations.scenarioId,
    summary: typeof incident.summary === "string" ? incident.summary : "",
    expectations
  };
}
function coverage(entries) {
  const byMode = {};
  for (const mode of FailureModeSchema.options) byMode[mode] = [];
  for (const entry of entries) {
    for (const mode of entry.expectations.corpus.failureModes) {
      byMode[mode].push(entry.scenarioId);
    }
  }
  return byMode;
}
function outcome(entry) {
  if (!entry.expectations.approvable) return "blocked by the gate";
  if (entry.expectations.simulation?.safetyPropertiesSatisfied === false) {
    return "approvable, flagged by simulation";
  }
  return "approvable";
}
function render(entries) {
  const lines = [];
  const adversarial = entries.filter((e) => e.expectations.corpus.adversarial);
  lines.push("# Scenario gallery");
  lines.push("");
  lines.push(
    "<!-- Generated by `changesafe scenario gallery`. Do not edit by hand; CI checks it is current. -->"
  );
  lines.push("");
  lines.push(
    `${entries.length} scenarios, ${adversarial.length} of them adversarial. Every entry declares its expected verdict in an \`expectations.json\` that CI verifies against the real engine, so nothing here is a claim \u2014 it is a test result.`
  );
  lines.push("");
  lines.push("Contributing a scenario is the most valuable way in: see [SCENARIO_AUTHORING.md](SCENARIO_AUTHORING.md).");
  lines.push("");
  lines.push("## By outcome");
  lines.push("");
  lines.push("| Scenario | Incident | Risk | Outcome |");
  lines.push("| --- | --- | --- | --- |");
  const sorted = [...entries].sort(
    (a, b) => RISK_ORDER.indexOf(a.expectations.riskLevel) - RISK_ORDER.indexOf(b.expectations.riskLevel) || a.scenarioId.localeCompare(b.scenarioId)
  );
  for (const entry of sorted) {
    lines.push(
      `| \`${entry.scenarioId}\` | ${entry.title} | ${entry.expectations.riskLevel} | ${outcome(entry)} |`
    );
  }
  lines.push("");
  lines.push("## Failure-mode coverage");
  lines.push("");
  lines.push(
    "What the corpus currently exercises. An empty row is a gap worth contributing \u2014 the taxonomy is closed, so a mode listed here with no scenario is a known hole rather than an oversight."
  );
  lines.push("");
  lines.push("| Failure mode | Scenarios |");
  lines.push("| --- | --- |");
  for (const [mode, ids] of Object.entries(coverage(entries))) {
    lines.push(
      `| \`${mode}\` | ${ids.length === 0 ? "\u2014 *(gap)*" : ids.map((id) => `\`${id}\``).join(", ")} |`
    );
  }
  lines.push("");
  lines.push("## What each scenario teaches");
  lines.push("");
  for (const entry of sorted) {
    lines.push(`### \`${entry.scenarioId}\``);
    lines.push("");
    lines.push(`**${entry.title}** \u2014 ${entry.summary}`);
    lines.push("");
    lines.push(entry.expectations.teaches);
    lines.push("");
    const modes = entry.expectations.corpus.failureModes;
    lines.push(
      `- Risk **${entry.expectations.riskLevel}**, ${outcome(entry)}` + (entry.expectations.corpus.adversarial ? " \xB7 adversarial" : "")
    );
    if (modes.length > 0) {
      lines.push(`- Failure modes: ${modes.map((mode) => `\`${mode}\``).join(", ")}`);
    }
    const nonPassing = Object.entries(entry.expectations.policies).filter(
      ([, status]) => status !== "PASS"
    );
    lines.push(
      nonPassing.length === 0 ? "- Every policy passes" : `- Non-passing policies: ${nonPassing.map(([id, status]) => `\`${id}\` ${status}`).join(", ")}`
    );
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}
`;
}

// src/keygen.ts
import { existsSync as existsSync3, writeFileSync as writeFileSync5 } from "node:fs";
import path6 from "node:path";
async function runKeygen(options, console) {
  const privatePath = options.out.endsWith(".pem") ? options.out : `${options.out}.pem`;
  const publicPath = privatePath.replace(/\.pem$/, ".pub.pem");
  for (const target of [privatePath, publicPath]) {
    if (existsSync3(target) && !options.force) {
      throw new UsageError(
        `${path6.resolve(target)} already exists. Receipts signed with the current key can no longer be verified if you replace it \u2014 pass --force if that is what you intend.`
      );
    }
  }
  const keyPair = await generateSigningKeyPair();
  writeFileSync5(privatePath, keyPair.privateKeyPem, { mode: 384 });
  writeFileSync5(publicPath, keyPair.publicKeyPem, { mode: 420 });
  if (options.format === "json") {
    console.out(
      JSON.stringify(
        { publicKeyId: keyPair.publicKeyId, privateKey: privatePath, publicKey: publicPath },
        null,
        2
      )
    );
    return EXIT_OK;
  }
  console.out("");
  console.out(`  ${paint(console.color, "bold", "ChangeSafe signing key")}`);
  console.out(`  ${paint(console.color, "dim", `key id ${keyPair.publicKeyId}`)}`);
  console.out("");
  console.out(`  private  ${privatePath}  ${paint(console.color, "dim", "(mode 0600 \u2014 never commit or share this)")}`);
  console.out(`  public   ${publicPath}  ${paint(console.color, "dim", "(distribute this to verifiers)")}`);
  console.out("");
  console.out(`  ${paint(console.color, "dim", "Sign receipts:  changesafe gate ... --receipt r.json --sign-key " + privatePath)}`);
  console.out(`  ${paint(console.color, "dim", "Verify them:    changesafe verify r.json --public-key " + publicPath)}`);
  console.out("");
  return EXIT_OK;
}

// ../ledger/src/chain.ts
var GENESIS_CHAIN_SHA256 = "0".repeat(64);
async function computeChainHash(input) {
  return hashCanonical({
    seq: input.seq,
    receiptSha256: input.receiptSha256,
    previousChainSha256: input.previousChainSha256
  });
}

// ../ledger/src/ledger.ts
import { createRequire } from "node:module";
var RowSchema = external_exports.object({
  seq: external_exports.number().int().positive(),
  receipt_id: external_exports.string(),
  created_at_utc: external_exports.string(),
  decision: external_exports.string(),
  risk_level: external_exports.string(),
  source_id: external_exports.string(),
  input_id: external_exports.string(),
  proposal_id: external_exports.string(),
  receipt_sha256: external_exports.string(),
  signature_key_id: external_exports.string().nullable(),
  previous_chain_sha256: external_exports.string(),
  chain_sha256: external_exports.string(),
  record_json: external_exports.string()
});
var SCHEMA_VERSION = 1;
var DEFAULT_LIST_LIMIT = 50;
var MAX_LIST_LIMIT = 1e3;
var SCHEMA = `
CREATE TABLE IF NOT EXISTS receipts (
  seq                   INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_id            TEXT NOT NULL UNIQUE,
  created_at_utc        TEXT NOT NULL,
  decision              TEXT NOT NULL,
  risk_level            TEXT NOT NULL,
  source_id             TEXT NOT NULL,
  input_id              TEXT NOT NULL,
  proposal_id           TEXT NOT NULL,
  receipt_sha256        TEXT NOT NULL,
  signature_key_id      TEXT,
  previous_chain_sha256 TEXT NOT NULL,
  chain_sha256          TEXT NOT NULL,
  record_json           TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS receipts_created_at ON receipts (created_at_utc);
CREATE INDEX IF NOT EXISTS receipts_source ON receipts (source_id);

-- Append-only, enforced where the data lives rather than in application code
-- that a different caller could bypass.
CREATE TRIGGER IF NOT EXISTS receipts_no_update BEFORE UPDATE ON receipts
BEGIN
  SELECT RAISE(ABORT, 'the receipt ledger is append-only: entries cannot be updated');
END;

CREATE TRIGGER IF NOT EXISTS receipts_no_delete BEFORE DELETE ON receipts
BEGIN
  SELECT RAISE(ABORT, 'the receipt ledger is append-only: entries cannot be deleted');
END;
`;
var nodeRequire = createRequire(import.meta.url);
function openDatabase(path8) {
  const sqlite = nodeRequire("node:sqlite");
  return new sqlite.DatabaseSync(path8);
}
function splitRecord(record2) {
  if ("receipt" in record2) {
    return { receipt: record2.receipt, signatureKeyId: record2.signature.publicKeyId };
  }
  return { receipt: record2, signatureKeyId: null };
}
function parseRecord(json2) {
  const raw = JSON.parse(json2);
  const isEnvelope = typeof raw === "object" && raw !== null && "receipt" in raw;
  return isEnvelope ? SignedReceiptSchema.parse(raw) : ChangeReceiptSchema.parse(raw);
}
function toEntry(row) {
  return {
    seq: row.seq,
    receiptId: row.receipt_id,
    createdAtUtc: row.created_at_utc,
    decision: row.decision,
    riskLevel: row.risk_level,
    sourceId: row.source_id,
    inputId: row.input_id,
    proposalId: row.proposal_id,
    receiptSha256: row.receipt_sha256,
    signatureKeyId: row.signature_key_id,
    previousChainSha256: row.previous_chain_sha256,
    chainSha256: row.chain_sha256,
    record: parseRecord(row.record_json)
  };
}
var Ledger = class _Ledger {
  #db;
  /** Tail of the append queue; see `append`. */
  #writes = Promise.resolve();
  constructor(db) {
    this.#db = db;
  }
  /**
   * Open (creating if needed) a ledger file. Pass `":memory:"` for a
   * throwaway ledger in tests.
   */
  static open(path8) {
    const db = openDatabase(path8);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = FULL");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec(SCHEMA);
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    return new _Ledger(db);
  }
  close() {
    this.#db.close();
  }
  /** The most recent entry's chain digest, or the genesis value when empty. */
  head() {
    const row = this.#db.prepare("SELECT chain_sha256 AS h FROM receipts ORDER BY seq DESC LIMIT 1").get();
    return row ? external_exports.object({ h: external_exports.string() }).parse(row).h : GENESIS_CHAIN_SHA256;
  }
  count() {
    const row = this.#db.prepare("SELECT count(*) AS c FROM receipts").get();
    return external_exports.object({ c: external_exports.number() }).parse(row).c;
  }
  /**
   * Record a receipt.
   *
   * Recording the same receipt twice is rejected rather than ignored: a
   * duplicate means the caller lost track of whether a decision was already
   * durable, and silently succeeding would hide that.
   *
   * Appends are serialized against each other. Deciding the next entry means
   * reading the chain head and then hashing, and hashing is asynchronous — so
   * two decisions arriving together would both read the same head and build
   * the same link, and the second would land on the sequence number the first
   * just took. The database refuses that (`seq` is the primary key), which is
   * the right failure but an unhelpful one: the second approver's genuine
   * decision would come back as an internal error rather than the next entry
   * in the chain. Queueing costs nothing here — a hash is microseconds — and
   * turns a collision into an ordering.
   *
   * A second *process* writing the same file is still caught by the
   * constraint rather than by this queue, which is why the constraint stays.
   */
  async append(record2) {
    const result = this.#writes.then(
      () => this.#appendSerially(record2),
      () => this.#appendSerially(record2)
    );
    this.#writes = result.then(
      () => void 0,
      () => void 0
    );
    return result;
  }
  async #appendSerially(record2) {
    const { receipt, signatureKeyId } = splitRecord(record2);
    if (this.get(receipt.receiptId)) {
      throw new DomainError(
        "REQUEST_INVALID",
        `Receipt ${receipt.receiptId} is already in the ledger. Entries are append-only and never replaced.`
      );
    }
    const previousChainSha256 = this.head();
    const seq = this.#nextSeq();
    const chainSha256 = await computeChainHash({
      seq,
      receiptSha256: receipt.receiptSha256,
      previousChainSha256
    });
    this.#db.prepare(
      `INSERT INTO receipts (
           seq, receipt_id, created_at_utc, decision, risk_level, source_id,
           input_id, proposal_id, receipt_sha256, signature_key_id,
           previous_chain_sha256, chain_sha256, record_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      seq,
      receipt.receiptId,
      receipt.createdAtUtc,
      receipt.decision,
      receipt.riskLevel,
      receipt.sourceId,
      receipt.inputId,
      receipt.proposalId,
      receipt.receiptSha256,
      signatureKeyId,
      previousChainSha256,
      chainSha256,
      // Canonical form so a stored record hashes identically wherever it is
      // read back.
      canonicalize(record2)
    );
    const entry = this.get(receipt.receiptId);
    if (!entry) {
      throw new DomainError("INTERNAL", "The ledger accepted a receipt but could not read it back.");
    }
    return entry;
  }
  get(receiptId) {
    const row = this.#db.prepare("SELECT * FROM receipts WHERE receipt_id = ?").get(receiptId);
    return row ? toEntry(RowSchema.parse(row)) : null;
  }
  list(options = {}) {
    const clauses = [];
    const params = [];
    if (options.sourceId) {
      clauses.push("source_id = ?");
      params.push(options.sourceId);
    }
    if (options.decision) {
      clauses.push("decision = ?");
      params.push(options.decision);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const requested = options.limit ?? DEFAULT_LIST_LIMIT;
    const limit = Number.isFinite(requested) ? Math.min(Math.max(Math.trunc(requested), 1), MAX_LIST_LIMIT) : DEFAULT_LIST_LIMIT;
    const rows = this.#db.prepare(`SELECT * FROM receipts ${where} ORDER BY seq DESC LIMIT ${limit}`).all(...params);
    return rows.map((row) => toEntry(RowSchema.parse(row)));
  }
  /**
   * Recompute the whole chain and report every broken link.
   *
   * Catches what the append-only triggers cannot: someone editing the
   * database file directly, or rebuilding the table. A gap in the sequence is
   * itself a break — that is the case a plain receipts table cannot see.
   */
  async verifyChain() {
    const rows = this.#db.prepare("SELECT * FROM receipts ORDER BY seq ASC").all().map((row) => RowSchema.parse(row));
    const breaks = [];
    let previous = GENESIS_CHAIN_SHA256;
    let expectedSeq = 1;
    for (const row of rows) {
      if (row.seq !== expectedSeq) {
        breaks.push({
          seq: row.seq,
          receiptId: row.receipt_id,
          reason: `expected sequence ${expectedSeq} but found ${row.seq} \u2014 an entry was removed or reordered`
        });
        expectedSeq = row.seq;
      }
      if (row.previous_chain_sha256 !== previous) {
        breaks.push({
          seq: row.seq,
          receiptId: row.receipt_id,
          reason: "this entry does not link to the preceding entry"
        });
      }
      const recomputed = await computeChainHash({
        seq: row.seq,
        receiptSha256: row.receipt_sha256,
        previousChainSha256: row.previous_chain_sha256
      });
      if (recomputed !== row.chain_sha256) {
        breaks.push({
          seq: row.seq,
          receiptId: row.receipt_id,
          reason: "the stored chain digest does not match this entry's content"
        });
      }
      const { receipt } = splitRecord(parseRecord(row.record_json));
      if (!await verifyReceiptHash(receipt)) {
        breaks.push({
          seq: row.seq,
          receiptId: row.receipt_id,
          reason: "the stored receipt's content does not match its own receiptSha256"
        });
      }
      if (receipt.receiptSha256 !== row.receipt_sha256) {
        breaks.push({
          seq: row.seq,
          receiptId: row.receipt_id,
          reason: "the stored receipt is not the one this entry recorded"
        });
      }
      previous = row.chain_sha256;
      expectedSeq += 1;
    }
    return {
      ok: breaks.length === 0,
      entries: rows.length,
      headChainSha256: rows.length > 0 ? previous : null,
      breaks
    };
  }
  /** Next sequence number, derived from the chain rather than AUTOINCREMENT. */
  #nextSeq() {
    const row = this.#db.prepare("SELECT max(seq) AS m FROM receipts").get();
    return (external_exports.object({ m: external_exports.number().nullable() }).parse(row).m ?? 0) + 1;
  }
};

// src/ledger.ts
function parseRecordFile(raw) {
  const isEnvelope = typeof raw === "object" && raw !== null && "receipt" in raw;
  return isEnvelope ? parseOrThrow(SignedReceiptSchema, raw, "signed receipt") : parseOrThrow(ChangeReceiptSchema, raw, "receipt");
}
async function runLedgerAppend(options, console) {
  if (!options.receipt) {
    throw new UsageError("ledger append needs a receipt: changesafe ledger append <receipt.json>");
  }
  const record2 = parseRecordFile(readJsonFile(options.receipt, "receipt"));
  const ledger = Ledger.open(options.db);
  try {
    const entry = await ledger.append(record2);
    if (options.format === "json") {
      console.out(
        JSON.stringify(
          { seq: entry.seq, receiptId: entry.receiptId, chainSha256: entry.chainSha256 },
          null,
          2
        )
      );
      return EXIT_OK;
    }
    console.out("");
    console.out(
      `  ${paint(console.color, "green", "recorded")} ${paint(console.color, "dim", `#${entry.seq} \xB7 ${entry.receiptId} \xB7 ${entry.decision}`)}`
    );
    console.out(`  ${paint(console.color, "dim", `chain head now ${entry.chainSha256}`)}`);
    console.out("");
    return EXIT_OK;
  } finally {
    ledger.close();
  }
}
function runLedgerList(options, console) {
  const ledger = Ledger.open(options.db);
  try {
    const entries = ledger.list({
      limit: options.limit,
      sourceId: options.sourceId,
      decision: options.decision
    });
    if (options.format === "json") {
      console.out(
        JSON.stringify(
          entries.map((entry) => ({
            seq: entry.seq,
            receiptId: entry.receiptId,
            createdAtUtc: entry.createdAtUtc,
            decision: entry.decision,
            riskLevel: entry.riskLevel,
            sourceId: entry.sourceId,
            signatureKeyId: entry.signatureKeyId,
            chainSha256: entry.chainSha256
          })),
          null,
          2
        )
      );
      return EXIT_OK;
    }
    console.out("");
    if (entries.length === 0) {
      console.out(`  ${paint(console.color, "dim", "no decisions recorded yet")}`);
      console.out("");
      return EXIT_OK;
    }
    for (const entry of entries) {
      const decision = entry.decision === "blocked" ? paint(console.color, "red", entry.decision.padEnd(9)) : entry.decision === "approved" ? paint(console.color, "green", entry.decision.padEnd(9)) : paint(console.color, "dim", entry.decision.padEnd(9));
      const signed = entry.signatureKeyId ? paint(console.color, "dim", ` signed:${entry.signatureKeyId.slice(0, 8)}`) : paint(console.color, "dim", " unsigned");
      console.out(
        `  ${String(entry.seq).padStart(4)}  ${entry.createdAtUtc}  ${decision}  ${entry.sourceId}${signed}`
      );
    }
    console.out("");
    return EXIT_OK;
  } finally {
    ledger.close();
  }
}
async function runLedgerVerify(options, console) {
  const ledger = Ledger.open(options.db);
  try {
    const verdict = await ledger.verifyChain();
    if (options.format === "json") {
      console.out(JSON.stringify(verdict, null, 2));
      return verdict.ok ? EXIT_OK : EXIT_BLOCKED;
    }
    console.out("");
    console.out(
      `  ${paint(console.color, "bold", "ChangeSafe ledger")} ${paint(console.color, "dim", `\xB7 ${options.db} \xB7 ${verdict.entries} entries`)}`
    );
    console.out("");
    if (verdict.ok) {
      console.out(`  ${paint(console.color, "green", "chain intact")} \u2014 no entry was altered, removed, or reordered.`);
      if (verdict.headChainSha256) {
        console.out(`  ${paint(console.color, "dim", `head ${verdict.headChainSha256}`)}`);
        console.out(
          `  ${paint(console.color, "dim", "Record this head somewhere else to detect a later rewrite of the whole chain.")}`
        );
      }
    } else {
      console.out(`  ${paint(console.color, "red", "chain broken")}`);
      for (const brk of verdict.breaks) {
        console.out(`    ${paint(console.color, "red", `#${brk.seq}`)} ${brk.receiptId}`);
        console.out(`      ${paint(console.color, "dim", brk.reason)}`);
      }
    }
    console.out("");
    return verdict.ok ? EXIT_OK : EXIT_BLOCKED;
  } finally {
    ledger.close();
  }
}

// src/scenario.ts
import { existsSync as existsSync4, mkdirSync, readdirSync as readdirSync3, writeFileSync as writeFileSync6 } from "node:fs";
import path7 from "node:path";
var REQUIRED_FILES = ["incident.json", "replay-fixture.json", "expectations.json"];
function runScenarioCheck(options, console) {
  const domain2 = resolveDomain(options.domain);
  const root = path7.resolve(options.dir);
  if (!existsSync4(root)) {
    throw new UsageError(`scenario directory does not exist: ${root}`);
  }
  const directories = readdirSync3(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).filter((name) => existsSync4(path7.join(root, name, "expectations.json"))).sort();
  if (directories.length === 0) {
    throw new UsageError(`no scenarios found in ${root}`);
  }
  const results = directories.map((name) => checkOne(path7.join(root, name), domain2));
  const ok = results.every((result) => result.ok);
  if (options.format === "json") {
    console.out(JSON.stringify({ ok, scenarios: results }, null, 2));
    return ok ? EXIT_OK : EXIT_BLOCKED;
  }
  console.out("");
  for (const result of results) {
    const mark = result.ok ? paint(console.color, "green", "ok  ") : paint(console.color, "red", "FAIL");
    console.out(`  ${mark}  ${result.scenarioId}`);
    for (const problem of result.problems) {
      console.out(`        ${paint(console.color, "dim", problem)}`);
    }
  }
  console.out("");
  console.out(
    ok ? `  ${paint(console.color, "green", `${results.length} scenario(s) match their declared expectations`)}` : `  ${paint(console.color, "red", "some scenarios do not match their declared expectations")}`
  );
  console.out("");
  return ok ? EXIT_OK : EXIT_BLOCKED;
}
function checkOne(dir, domain2) {
  const scenarioId = path7.basename(dir);
  const problems = [];
  for (const file2 of REQUIRED_FILES) {
    if (!existsSync4(path7.join(dir, file2))) {
      return { scenarioId, ok: false, problems: [`missing ${file2}`] };
    }
  }
  try {
    const { input } = domain2.parseInput(readJsonFile(path7.join(dir, "incident.json"), "incident"));
    const { proposal } = domain2.parseProposal(
      readJsonFile(path7.join(dir, "replay-fixture.json"), "fixture")
    );
    const expectations = parseOrThrow(
      ScenarioExpectationsSchema,
      readJsonFile(path7.join(dir, "expectations.json"), "expectations"),
      "expectations"
    );
    if (expectations.scenarioId !== scenarioId) {
      problems.push(
        `expectations declare "${expectations.scenarioId}" but the directory is "${scenarioId}"`
      );
    }
    validateProposalEvidence(domain2.adapter, input, proposal);
    const { findings, riskLevel } = evaluatePolicies(
      domain2.adapter,
      input,
      proposal
    );
    const declared = Object.keys(expectations.policies).sort();
    const produced = [...policyOrder(domain2.adapter)].sort();
    if (declared.join(",") !== produced.join(",")) {
      problems.push(
        `declares ${declared.length} policies, this domain evaluates ${produced.length} (${produced.join(", ")})`
      );
    }
    for (const finding of findings) {
      const expected = expectations.policies[finding.policyId];
      if (expected && expected !== finding.status) {
        problems.push(
          `${finding.policyId}: expected ${expected}, got ${finding.status} \u2014 ${finding.explanation}`
        );
      }
    }
    if (riskLevel !== expectations.riskLevel) {
      problems.push(`risk: expected ${expectations.riskLevel}, got ${riskLevel}`);
    }
  } catch (error51) {
    problems.push(error51 instanceof Error ? error51.message : "unexpected failure");
  }
  return { scenarioId, ok: problems.length === 0, problems };
}
function runScenarioInit(options, console) {
  const scenarioId = options.name;
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(scenarioId)) {
    throw new UsageError(`scenario name must be lowercase kebab-case, got "${scenarioId}"`);
  }
  const dir = path7.resolve(options.dir, scenarioId);
  if (existsSync4(dir)) {
    throw new UsageError(`scenario already exists: ${dir}`);
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync6(path7.join(dir, "incident.json"), `${JSON.stringify(incidentTemplate(), null, 2)}
`);
  writeFileSync6(
    path7.join(dir, "replay-fixture.json"),
    `${JSON.stringify(fixtureTemplate(scenarioId), null, 2)}
`
  );
  writeFileSync6(
    path7.join(dir, "expectations.json"),
    `${JSON.stringify(expectationsTemplate(scenarioId), null, 2)}
`
  );
  console.out("");
  console.out(`  created ${path7.relative(process.cwd(), dir)}`);
  console.out("");
  console.out("  Next:");
  console.out("    1. Replace the placeholder incident and proposal with your scenario.");
  console.out("    2. Run `changesafe scenario check` and write down what actually happened.");
  console.out("    3. Register it in scenarios/index.ts so the app and harness see it.");
  console.out("");
  console.out("  Authoring guide: docs/SCENARIO_AUTHORING.md");
  console.out("");
  return EXIT_OK;
}
function incidentTemplate() {
  return {
    incidentId: "inc-example-0001",
    title: "Describe the situation, never the verdict",
    summary: "What is happening, on which synthetic devices. All data must be fictional.",
    alerts: [
      {
        evidenceId: "ev-alert-example",
        timestamp: "2026-01-01T00:00:00Z",
        severity: "critical",
        sourceNodeId: "edge-rtr-01",
        message: "Replace with a realistic alert message"
      }
    ],
    operatorNotes: [],
    topology: {
      nodes: [
        { id: "mgmt-01", name: "Management Station", role: "mgmt-station", mgmtIp: "192.0.2.10" },
        { id: "edge-rtr-01", name: "Edge Router 01", role: "edge-router", mgmtIp: "192.0.2.1" }
      ],
      links: [
        {
          id: "link-mgmt-edge",
          a: { nodeId: "mgmt-01", interfaceId: "eth0" },
          b: { nodeId: "edge-rtr-01", interfaceId: "mgmt0" },
          status: "up"
        }
      ]
    },
    currentState: {
      devices: {
        "mgmt-01": {
          id: "mgmt-01",
          name: "Management Station",
          role: "mgmt-station",
          protected: true,
          interfaces: { eth0: { id: "eth0", name: "eth0", enabled: true, status: "up" } },
          routes: {},
          routing: { preferences: {} }
        },
        "edge-rtr-01": {
          id: "edge-rtr-01",
          name: "Edge Router 01",
          role: "edge-router",
          protected: false,
          interfaces: { mgmt0: { id: "mgmt0", name: "mgmt0", enabled: true, status: "up" } },
          routes: {
            "rt-mgmt": {
              id: "rt-mgmt",
              destination: "192.0.2.0/24",
              nextHop: "direct",
              metric: 0,
              kind: "connected",
              protected: true,
              description: "Connected management subnet"
            },
            "rt-example": {
              id: "rt-example",
              destination: "198.51.100.0/24",
              nextHop: "203.0.113.1",
              metric: 50,
              kind: "static",
              protected: false,
              description: "The route your proposal will change"
            }
          },
          routing: { preferences: {} }
        }
      },
      management: { originNodeId: "mgmt-01", protectedTargetNodeIds: ["edge-rtr-01"] }
    },
    expectedSafetyProperties: [
      {
        id: "sp-mgmt-reach",
        description: "The management station keeps reachability to every protected device",
        check: { type: "mgmt-reachability" }
      }
    ]
  };
}
function fixtureTemplate(scenarioId) {
  return {
    fixtureId: `fix-${scenarioId}`,
    scenarioId,
    provenance: "authored_synthetic",
    model: null,
    capturedAtUtc: null,
    notes: "Authored fixture. Say plainly what this is and what it demonstrates. Not model output.",
    proposal: {
      proposalId: `prop-${scenarioId}`,
      summary: "What the change does, in one sentence.",
      diagnosis: {
        likelyCause: "Why the incident is happening, grounded in the cited evidence.",
        confidence: 0.7,
        evidenceIds: ["ev-alert-example"],
        assumptions: ["State anything the diagnosis takes for granted"]
      },
      operations: [
        {
          op: "replace",
          path: "/devices/edge-rtr-01/routes/rt-example/metric",
          value: 150,
          reason: "Why this specific operation addresses the cause",
          evidenceIds: ["ev-alert-example"]
        }
      ],
      rollbackOperations: [
        {
          op: "replace",
          path: "/devices/edge-rtr-01/routes/rt-example/metric",
          value: 50,
          reason: "Restore the original metric",
          evidenceIds: ["ev-alert-example"]
        }
      ],
      verificationSteps: [
        {
          kind: "precondition",
          description: "What must be true before the change",
          evidenceIds: []
        },
        {
          kind: "postcheck",
          description: "How success is confirmed after the change",
          evidenceIds: []
        }
      ]
    }
  };
}
function expectationsTemplate(scenarioId) {
  return {
    scenarioId,
    teaches: "What this scenario shows that no existing scenario does. Run the check, then write the truth here.",
    policies: {
      PATCH_SCHEMA: "PASS",
      MGMT_REACHABILITY: "PASS",
      PROTECTED_RESOURCE: "PASS",
      BLAST_RADIUS: "PASS",
      ROLLBACK_COMPLETE: "PASS",
      VERIFICATION_REQUIRED: "PASS",
      UNTRUSTED_INSTRUCTION: "PASS"
    },
    riskLevel: "LOW",
    approvable: true,
    simulation: { safetyPropertiesSatisfied: true },
    // Where this sits in the corpus. Set `adversarial` to true and name the
    // failure modes it exercises if the proposal is built to get an unsafe
    // change past a reviewer; see docs/SCENARIOS.md for the taxonomy and
    // which modes still have no coverage.
    corpus: {
      adversarial: false,
      failureModes: []
    }
  };
}

// ../server/src/domains.ts
var network2 = {
  id: "network",
  adapter: networkDomain,
  parseInput(raw) {
    const bundle = IncidentBundleSchema.parse(raw);
    return { input: bundle, inputId: bundle.incidentId };
  },
  resolveProposal(_input, raw) {
    return NetworkChangeProposalSchema.parse(raw);
  },
  simulate(input, proposal) {
    return runSimulation(input, proposal);
  }
};
var terraform2 = {
  id: "terraform",
  adapter: terraformDomain,
  parseInput(raw) {
    const input = normalizePlan(raw);
    return { input, inputId: input.planId };
  },
  resolveProposal(input) {
    return deriveProposal(input);
  }
};
var DOMAINS2 = { network: network2, terraform: terraform2 };
var SERVER_DOMAIN_IDS = Object.keys(DOMAINS2);
function resolveServerDomain(id) {
  const domain2 = DOMAINS2[id];
  if (!domain2) {
    throw new DomainError(
      "REQUEST_INVALID",
      `Unknown domain "${id}". Available: ${SERVER_DOMAIN_IDS.join(", ")}.`
    );
  }
  return domain2;
}

// ../server/src/decisions.ts
var DecisionService = class {
  #options;
  constructor(options) {
    this.#options = options;
  }
  async decide(request, approver) {
    const domain2 = resolveServerDomain(request.domain);
    const { input, inputId } = domain2.parseInput(request.input);
    const proposal = domain2.resolveProposal(input, request.proposal);
    validateProposalEvidence(domain2.adapter, input, proposal);
    const { findings, riskLevel } = evaluatePolicies(domain2.adapter, input, proposal);
    let state = initialState(request.sourceId, input);
    state = transition(state, { type: "START_ANALYSIS", mode: "offline" });
    state = transition(state, {
      type: "PROPOSAL_RECEIVED",
      proposal,
      mode: "offline",
      provenance: null
    });
    state = transition(state, { type: "VALIDATION_COMPLETED", findings, riskLevel });
    state = transition(state, { type: "CLASSIFY" });
    if (request.decision === "approve" && hasBlockingFinding(findings)) {
      throw new DomainError(
        "ILLEGAL_TRANSITION",
        "This change has blocking findings and cannot be approved by anyone."
      );
    }
    let simulation = null;
    if (request.decision === "approve") {
      state = transition(state, { type: "APPROVE" });
      if (domain2.simulate) {
        simulation = domain2.simulate(input, proposal);
        state = transition(state, { type: "SIMULATION_COMPLETED", simulation });
      }
    } else {
      state = transition(state, { type: "REJECT" });
    }
    const expected = request.decision === "approve" ? domain2.simulate ? "SIMULATED" : "APPROVED" : "REJECTED";
    if (state.phase !== expected) {
      throw new DomainError(
        "INTERNAL",
        "The decision workflow ended in an unexpected state; no receipt was issued."
      );
    }
    const receipt = await createReceipt({
      sourceId: request.sourceId,
      inputId,
      input,
      proposal,
      appVersion: this.#options.appVersion,
      policyVersion: domain2.adapter.policyVersion,
      mode: "offline",
      model: null,
      fixtureProvenance: null,
      findings,
      riskLevel,
      decision: request.decision === "approve" ? "approved" : "rejected",
      approver,
      simulation,
      createdAtUtc: this.#options.now?.()
    });
    const record2 = this.#options.signingKeyPair ? await signReceipt(receipt, this.#options.signingKeyPair, {
      signedAtUtc: this.#options.now?.()
    }) : receipt;
    const entry = await this.#options.ledger.append(record2);
    return {
      record: record2,
      receipt,
      ledgerSeq: entry.seq,
      chainSha256: entry.chainSha256
    };
  }
};

// ../server/src/oidc.ts
var ALGORITHMS = {
  RS256: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
  RS384: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-384" },
  RS512: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-512" },
  ES256: { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256" },
  ES384: { name: "ECDSA", namedCurve: "P-384", hash: "SHA-384" }
};
var JwtHeaderSchema = external_exports.object({
  alg: external_exports.string(),
  kid: external_exports.string().optional(),
  typ: external_exports.string().optional()
});
var JwtClaimsSchema = external_exports.looseObject({
  iss: external_exports.string(),
  sub: external_exports.string(),
  aud: external_exports.union([external_exports.string(), external_exports.array(external_exports.string())]),
  exp: external_exports.number(),
  nbf: external_exports.number().optional(),
  iat: external_exports.number().optional(),
  email: external_exports.string().optional()
});
var JwkSchema = external_exports.object({
  kid: external_exports.string().optional(),
  kty: external_exports.string(),
  alg: external_exports.string().optional(),
  use: external_exports.string().optional(),
  n: external_exports.string().optional(),
  e: external_exports.string().optional(),
  crv: external_exports.string().optional(),
  x: external_exports.string().optional(),
  y: external_exports.string().optional()
});
var JwksSchema = external_exports.object({ keys: external_exports.array(JwkSchema) });
var DiscoverySchema = external_exports.object({ jwks_uri: external_exports.string().url(), issuer: external_exports.string() });
var AuthenticationError = class extends DomainError {
  constructor(detail) {
    super("REQUEST_INVALID", `Authentication failed: ${detail}.`);
    this.name = "AuthenticationError";
  }
};
var AuthorizationError = class extends DomainError {
  constructor(detail) {
    super("REQUEST_INVALID", `Not permitted: ${detail}.`);
    this.name = "AuthorizationError";
  }
};
function unauthorized(detail) {
  return new AuthenticationError(detail);
}
function forbidden2(detail) {
  return new AuthorizationError(detail);
}
function base64UrlToBytes(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
function base64UrlToJson(value, segment) {
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlToBytes(value)));
  } catch {
    throw unauthorized(`the token's ${segment} is not valid base64url JSON`);
  }
}
function parseSegment(schema, value, segment) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw unauthorized(`the token's ${segment} is missing required claims`);
  }
  return parsed.data;
}
function assertAllowedAlgorithm(alg) {
  if (!(alg in ALGORITHMS)) {
    throw unauthorized(`unsupported token algorithm "${alg}"`);
  }
  return alg;
}
var DEFAULT_FETCH_TIMEOUT_MS = 5e3;
var MAX_PROVIDER_DOCUMENT_BYTES = 256 * 1024;
function assertHttps(url2) {
  let parsed;
  try {
    parsed = new URL(url2);
  } catch {
    throw new DomainError("REQUEST_INVALID", "The identity provider URL is not a valid URL.");
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !loopback) {
    throw new DomainError(
      "REQUEST_INVALID",
      "The identity provider must be reached over https; anyone on the path of a plaintext fetch would choose the keys this server trusts."
    );
  }
}
function keysForAlgorithm(keys, alg) {
  const expectedKty = alg.startsWith("RS") ? "RSA" : "EC";
  return keys.filter(
    (key) => key.kty === expectedKty && (key.use === void 0 || key.use === "sig") && (key.alg === void 0 || key.alg === alg)
  );
}
var OidcVerifier = class {
  #config;
  #fetch;
  #now;
  #cache = null;
  constructor(config2, options = {}) {
    this.#config = config2;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#now = options.now ?? Date.now;
  }
  /** Fetch (and cache) the provider's signing keys. */
  async #jwks(forceRefresh = false) {
    const ttlMs = (this.#config.jwksCacheSeconds ?? 300) * 1e3;
    if (!forceRefresh && this.#cache && this.#now() - this.#cache.fetchedAtMs < ttlMs) {
      return this.#cache.keys;
    }
    const jwksUri = this.#config.jwksUri ?? await this.#discoverJwksUri();
    const body = await this.#getJson(jwksUri, "The identity provider's key endpoint");
    const keys = JwksSchema.parse(body).keys;
    this.#cache = { keys, fetchedAtMs: this.#now() };
    return keys;
  }
  /**
   * Fetch one provider document under a deadline and a size cap.
   *
   * Both bounds exist because this runs inside request handling: without a
   * deadline an identity provider that accepts connections and then stops
   * talking hangs every authenticated request behind it, and without a cap a
   * key document is whatever the far end decides to send. A provider that
   * cannot answer promptly is a provider that cannot authenticate anyone,
   * which is a refusal, not a wait.
   */
  async #getJson(url2, what) {
    assertHttps(url2);
    const timeoutMs = this.#config.jwksTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.#fetch(url2, { signal: controller.signal });
      if (!response.ok) {
        throw new DomainError("AI_CALL_FAILED", `${what} returned status ${response.status}.`);
      }
      const text = await response.text();
      if (text.length > MAX_PROVIDER_DOCUMENT_BYTES) {
        throw new DomainError("AI_CALL_FAILED", `${what} returned an implausibly large document.`);
      }
      return JSON.parse(text);
    } catch (error51) {
      if (error51 instanceof DomainError) throw error51;
      throw new DomainError("AI_CALL_FAILED", `${what} could not be read.`, { cause: error51 });
    } finally {
      clearTimeout(timer);
    }
  }
  async #discoverJwksUri() {
    const url2 = `${this.#config.issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`;
    const discovery = DiscoverySchema.parse(await this.#getJson(url2, "OIDC discovery"));
    if (discovery.issuer !== this.#config.issuer) {
      throw unauthorized("the provider's discovery document names a different issuer");
    }
    return discovery.jwks_uri;
  }
  async #importKey(jwk, alg) {
    const params = ALGORITHMS[alg];
    const algorithm = "namedCurve" in params ? { name: params.name, namedCurve: params.namedCurve } : { name: params.name, hash: params.hash };
    return globalThis.crypto.subtle.importKey("jwk", jwk, algorithm, false, ["verify"]);
  }
  /**
   * Verify a bearer token and return the identity it establishes.
   *
   * Every failure is the same class of answer — the request is not
   * authenticated — so callers cannot accidentally treat "expired" or "wrong
   * audience" as a softer outcome than "bad signature".
   */
  async verify(token) {
    const parts = token.split(".");
    if (parts.length !== 3) throw unauthorized("the bearer token is not a JWT");
    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const header = parseSegment(JwtHeaderSchema, base64UrlToJson(encodedHeader, "header"), "header");
    const alg = assertAllowedAlgorithm(header.alg);
    const signature = base64UrlToBytes(encodedSignature);
    const signed = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);
    const verified = await this.#verifySignature(header.kid, alg, signature, signed);
    if (!verified) throw unauthorized("the token signature is not valid for this issuer");
    const claims = parseSegment(
      JwtClaimsSchema,
      base64UrlToJson(encodedPayload, "payload"),
      "payload"
    );
    this.#assertClaims(claims);
    this.#assertPermitted(claims);
    return {
      subject: claims.sub,
      issuer: claims.iss,
      email: claims.email ?? null,
      expiresAtUtc: new Date(claims.exp * 1e3).toISOString()
    };
  }
  async #verifySignature(kid, alg, signature, signed) {
    const params = ALGORITHMS[alg];
    const verifyAlgorithm = "namedCurve" in params ? { name: params.name, hash: params.hash } : { name: params.name };
    for (const refresh of [false, true]) {
      const usable = keysForAlgorithm(await this.#jwks(refresh), alg);
      const candidates = kid ? usable.filter((key) => key.kid === kid) : usable;
      for (const jwk of candidates) {
        const key = await this.#importKey(jwk, alg);
        const ok = await globalThis.crypto.subtle.verify(
          verifyAlgorithm,
          key,
          signature,
          signed
        );
        if (ok) return true;
      }
      if (candidates.length > 0) break;
    }
    return false;
  }
  #assertClaims(claims) {
    const tolerance = this.#config.clockToleranceSeconds ?? 60;
    const nowSeconds = Math.floor(this.#now() / 1e3);
    if (claims.iss !== this.#config.issuer) {
      throw unauthorized("the token was issued by a different issuer");
    }
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audiences.includes(this.#config.audience)) {
      throw unauthorized("the token was not issued for this audience");
    }
    if (claims.exp + tolerance < nowSeconds) throw unauthorized("the token has expired");
    if (claims.nbf !== void 0 && claims.nbf - tolerance > nowSeconds) {
      throw unauthorized("the token is not valid yet");
    }
  }
  /**
   * Apply the deployment's approver policy.
   *
   * The message names the rule that was not met but never the values that
   * would meet it: a caller learns that membership is required, not the
   * membership list.
   */
  #assertPermitted(claims) {
    const policy = this.#config.approvers;
    if (!policy) return;
    if (policy.subjects && policy.subjects.length > 0 && !policy.subjects.includes(claims.sub)) {
      throw forbidden2("this subject is not an approver on this server");
    }
    for (const rule of policy.claims ?? []) {
      const value = claims[rule.name];
      const held = typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
      const satisfied = held.some(
        (candidate) => typeof candidate === "string" && rule.values.includes(candidate)
      );
      if (!satisfied) {
        throw forbidden2(`the token does not carry a permitted "${rule.name}" claim`);
      }
    }
  }
};
function bearerToken(authorization) {
  const match = /^Bearer (.+)$/.exec(authorization?.trim() ?? "");
  if (!match?.[1]) throw unauthorized("no bearer token was supplied");
  return match[1];
}

// ../server/src/http.ts
import { createServer } from "node:http";
var MAX_BODY_BYTES = 2 * 1024 * 1024;
var PayloadTooLargeError = class extends DomainError {
  constructor() {
    super(
      "REQUEST_INVALID",
      `The request body exceeds the ${Math.round(MAX_BODY_BYTES / 1024)} KiB limit.`
    );
    this.name = "PayloadTooLargeError";
  }
};
var MalformedJsonError = class extends DomainError {
  constructor() {
    super("REQUEST_INVALID", "The request body is not valid JSON.");
    this.name = "MalformedJsonError";
  }
};
var DecisionBodySchema = external_exports.strictObject({
  domain: external_exports.enum(SERVER_DOMAIN_IDS),
  sourceId: external_exports.string().min(2).max(64),
  input: external_exports.unknown(),
  proposal: external_exports.unknown().optional(),
  decision: external_exports.enum(["approve", "reject"])
});
function send(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
    // This API returns decisions, never markup; nothing here should ever be
    // interpreted as a document by a browser.
    "x-content-type-options": "nosniff",
    "cache-control": "no-store"
  });
  response.end(payload);
}
function sendError(response, error51) {
  if (error51 instanceof AuthenticationError) {
    response.setHeader("www-authenticate", "Bearer");
    send(response, 401, { error: { code: "UNAUTHENTICATED", message: error51.userMessage } });
    return;
  }
  if (error51 instanceof AuthorizationError) {
    send(response, 403, { error: { code: "FORBIDDEN", message: error51.userMessage } });
    return;
  }
  if (error51 instanceof PayloadTooLargeError) {
    send(response, 413, { error: { code: "REQUEST_INVALID", message: error51.userMessage } });
    return;
  }
  if (isDomainError(error51)) {
    const status = error51.code === "ILLEGAL_TRANSITION" ? 409 : error51.code === "EVIDENCE_UNKNOWN" || error51.code === "SCHEMA_VALIDATION" ? 422 : error51.code === "REQUEST_INVALID" ? 400 : 500;
    send(response, status, { error: { code: error51.code, message: error51.userMessage } });
    return;
  }
  if (error51 instanceof external_exports.ZodError) {
    send(response, 422, {
      error: {
        code: "SCHEMA_VALIDATION",
        message: "The request body did not match the expected shape."
      }
    });
    return;
  }
  send(response, 500, {
    error: { code: "INTERNAL", message: "The request failed unexpectedly." }
  });
}
async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new PayloadTooLargeError();
    chunks.push(buffer);
  }
  if (size === 0) return void 0;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new MalformedJsonError();
  }
}
function createDecisionServer(options) {
  return createServer((request, response) => {
    void handle(request, response, options).catch((error51) => {
      sendError(response, error51);
    });
  });
}
async function handle(request, response, options) {
  const url2 = new URL(request.url ?? "/", "http://localhost");
  const route = `${request.method ?? "GET"} ${url2.pathname}`;
  if (route === "GET /health") {
    send(response, 200, { status: "ok", entries: options.ledger.count() });
    return;
  }
  const identity = await options.verifier.verify(bearerToken(request.headers.authorization));
  const approver = {
    subject: identity.subject,
    issuer: identity.issuer,
    email: identity.email
  };
  if (route === "POST /decisions") {
    const body = DecisionBodySchema.parse(await readBody(request));
    const outcome2 = await options.decisions.decide(body, approver);
    send(response, 201, {
      receiptId: outcome2.receipt.receiptId,
      decision: outcome2.receipt.decision,
      riskLevel: outcome2.receipt.riskLevel,
      approver: outcome2.receipt.approver,
      ledgerSeq: outcome2.ledgerSeq,
      chainSha256: outcome2.chainSha256,
      record: outcome2.record
    });
    return;
  }
  if (route === "GET /decisions") {
    const requestedLimit = url2.searchParams.get("limit");
    const parsedLimit = requestedLimit === null ? Number.NaN : Number(requestedLimit);
    const limit = Number.isFinite(parsedLimit) ? parsedLimit : void 0;
    send(response, 200, {
      entries: options.ledger.list({
        limit,
        sourceId: url2.searchParams.get("sourceId") ?? void 0,
        decision: url2.searchParams.get("decision") ?? void 0
      }).map((entry) => ({
        seq: entry.seq,
        receiptId: entry.receiptId,
        createdAtUtc: entry.createdAtUtc,
        decision: entry.decision,
        riskLevel: entry.riskLevel,
        sourceId: entry.sourceId,
        signatureKeyId: entry.signatureKeyId
      }))
    });
    return;
  }
  if (route === "GET /ledger/verify") {
    const verdict = await options.ledger.verifyChain();
    send(response, verdict.ok ? 200 : 409, verdict);
    return;
  }
  send(response, 404, {
    error: { code: "REQUEST_INVALID", message: `No route for ${route}.` }
  });
}

// src/serve.ts
function parseClaimRule(raw) {
  const separator = raw.indexOf("=");
  const name = separator === -1 ? "" : raw.slice(0, separator).trim();
  const value = separator === -1 ? "" : raw.slice(separator + 1).trim();
  if (!name || !value) {
    throw new UsageError(`--approver-claim takes name=value, got "${raw}"`);
  }
  return { name, values: [value] };
}
function buildApproverPolicy(options) {
  const subjects = options.approvers ?? [];
  const rules = (options.approverClaims ?? []).map(parseClaimRule);
  if (subjects.length === 0 && rules.length === 0) return void 0;
  const byName = /* @__PURE__ */ new Map();
  for (const rule of rules) {
    byName.set(rule.name, [...byName.get(rule.name) ?? [], ...rule.values]);
  }
  return {
    ...subjects.length > 0 ? { subjects } : {},
    ...byName.size > 0 ? { claims: [...byName].map(([name, values]) => ({ name, values })) } : {}
  };
}
function describePolicy(policy) {
  const parts = [];
  if (policy.subjects?.length) parts.push(`${policy.subjects.length} subject(s)`);
  for (const claim of policy.claims ?? []) {
    parts.push(`${claim.name} in [${claim.values.join(", ")}]`);
  }
  return parts.join(" and ");
}
async function runServe(options, console) {
  if (!options.oidcIssuer || !options.oidcAudience) {
    throw new UsageError(
      "serve needs --oidc-issuer and --oidc-audience. Every decision this API issues names\n  an approver, so it will not start without a way to establish who that is."
    );
  }
  const approverPolicy = buildApproverPolicy(options);
  const ledger = Ledger.open(options.db);
  const signingKeyPair = options.signKey ? await importSigningKeyPair(readTextFile(options.signKey, "signing key")) : void 0;
  const server = createDecisionServer({
    ledger,
    verifier: new OidcVerifier({
      issuer: options.oidcIssuer,
      audience: options.oidcAudience,
      jwksUri: options.oidcJwksUri,
      approvers: approverPolicy
    }),
    decisions: new DecisionService({
      ledger,
      appVersion: SERVER_APP_VERSION,
      signingKeyPair
    })
  });
  await new Promise((resolve) => server.listen(options.port, options.host, resolve));
  console.out("");
  console.out(`  ${paint(console.color, "bold", "ChangeSafe decision API")}`);
  console.out(`  ${paint(console.color, "dim", `listening on http://${options.host}:${options.port}`)}`);
  console.out(`  ${paint(console.color, "dim", `ledger ${options.db} \xB7 ${ledger.count()} entries`)}`);
  console.out(`  ${paint(console.color, "dim", `approvers verified against ${options.oidcIssuer}`)}`);
  console.out(
    approverPolicy ? `  ${paint(console.color, "dim", `approving restricted to ${describePolicy(approverPolicy)}`)}` : `  ${paint(console.color, "yellow", "every identity this issuer vouches for may approve")} ${paint(console.color, "dim", "\u2014 pass --approver or --approver-claim to narrow it")}`
  );
  console.out(
    signingKeyPair ? `  ${paint(console.color, "dim", "receipts are signed")}` : `  ${paint(console.color, "yellow", "receipts are unsigned")} ${paint(console.color, "dim", "\u2014 pass --sign-key to prove authorship")}`
  );
  console.out("");
  console.out(`  ${paint(console.color, "dim", "This API decides and records. It cannot execute a change.")}`);
  console.out("");
  const close = async () => {
    await new Promise((resolve) => server.close(() => resolve()));
    ledger.close();
  };
  if (options.onListening) {
    options.onListening(close);
    return EXIT_OK;
  }
  await new Promise((resolve) => {
    const stop = () => {
      void close().then(resolve);
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  return EXIT_OK;
}

// src/verify.ts
var SIGNATURE_DETAIL = {
  valid: "signed by the supplied key",
  invalid: "the signature does not match this receipt \u2014 it was altered or forged",
  key_mismatch: "signed by a different key than the one supplied",
  unverified: "a signature is present but no trusted key was supplied"
};
function readReceiptFile(raw) {
  const isEnvelope = typeof raw === "object" && raw !== null && "receipt" in raw;
  if (isEnvelope) {
    const signed = parseOrThrow(SignedReceiptSchema, raw, "signed receipt");
    return { receipt: signed.receipt, signature: signed.signature };
  }
  return { receipt: parseOrThrow(ChangeReceiptSchema, raw, "receipt"), signature: null };
}
async function runVerify(options, console) {
  const { receipt, signature } = readReceiptFile(readJsonFile(options.receipt, "receipt"));
  if (signature && !options.publicKey && !options.skipSignature) {
    throw new UsageError(
      `this receipt is signed (key id ${signature.publicKeyId}) but no key was supplied to check it.
  Pass --public-key <file.pub.pem> to verify authorship, or --skip-signature to
  check integrity alone and have the signature reported as unverified.`
    );
  }
  if (options.publicKey && !signature) {
    throw new UsageError(
      "--public-key was supplied but this receipt carries no signature. Verifying it would prove nothing about who issued it."
    );
  }
  const checks = [];
  const selfHashOk = await verifyReceiptHash(receipt);
  checks.push({
    name: "receipt hash",
    ok: selfHashOk,
    detail: selfHashOk ? "content matches receiptSha256" : "content does NOT match receiptSha256 \u2014 the receipt was altered"
  });
  let signatureVerdict = null;
  if (signature) {
    signatureVerdict = options.publicKey ? await verifyReceiptSignature(
      { receipt, signature },
      await importVerifyingKey(readTextFile(options.publicKey, "public key"))
    ) : "unverified";
    checks.push({
      name: "signature",
      // `unverified` is not a pass; it only avoids failing a run that opted
      // out explicitly, and it is reported as unknown either way.
      ok: signatureVerdict === "valid",
      detail: `${SIGNATURE_DETAIL[signatureVerdict]} (key id ${signature.publicKeyId})`
    });
  }
  if (options.input) {
    const domain2 = resolveDomain(options.domain);
    const { input, inputId } = domain2.parseInput(readJsonFile(options.input, "input"));
    const actual = await hashCanonical(input);
    checks.push({
      name: "input hash",
      ok: actual === receipt.inputSha256,
      detail: actual === receipt.inputSha256 ? `matches inputSha256 (${inputId})` : "the supplied input is not what this receipt describes"
    });
  }
  if (options.proposal) {
    const domain2 = resolveDomain(options.domain);
    const { proposal } = domain2.parseProposal(readJsonFile(options.proposal, "proposal"));
    const actual = await hashCanonical(proposal);
    checks.push({
      name: "proposal hash",
      ok: actual === receipt.proposalSha256,
      detail: actual === receipt.proposalSha256 ? "matches proposalSha256" : "the supplied proposal is not what this receipt describes"
    });
  }
  const failing = checks.filter(
    (check2) => !check2.ok && !(check2.name === "signature" && signatureVerdict === "unverified")
  );
  const ok = failing.length === 0;
  if (options.format === "json") {
    console.out(
      JSON.stringify(
        {
          ok,
          receiptId: receipt.receiptId,
          signature: signature ? { publicKeyId: signature.publicKeyId, verdict: signatureVerdict } : null,
          checks
        },
        null,
        2
      )
    );
    return ok ? EXIT_OK : EXIT_BLOCKED;
  }
  console.out("");
  console.out(
    `  ${paint(console.color, "bold", "ChangeSafe receipt")} ${paint(
      console.color,
      "dim",
      `\xB7 ${receipt.receiptId}`
    )}`
  );
  console.out(
    `  ${paint(console.color, "dim", `decision ${receipt.decision} \xB7 risk ${receipt.riskLevel} \xB7 mode ${receipt.mode} \xB7 policies ${receipt.policyVersion}`)}`
  );
  console.out("");
  for (const check2 of checks) {
    const unknown2 = check2.name === "signature" && signatureVerdict === "unverified";
    const mark = unknown2 ? paint(console.color, "yellow", "?   ") : check2.ok ? paint(console.color, "green", "ok  ") : paint(console.color, "red", "FAIL");
    console.out(`  ${mark}  ${check2.name.padEnd(14)} ${paint(console.color, "dim", check2.detail)}`);
  }
  console.out("");
  console.out(summary(console, ok, signatureVerdict));
  console.out("");
  return ok ? EXIT_OK : EXIT_BLOCKED;
}
function summary(console, ok, verdict) {
  if (!ok) return `  ${paint(console.color, "red", "receipt failed verification")}`;
  if (verdict === "valid") {
    return `  ${paint(console.color, "green", "receipt is intact and authentic")} \u2014 content matches and the signature is from the supplied key.`;
  }
  if (verdict === "unverified") {
    return `  ${paint(console.color, "yellow", "receipt is internally consistent, authorship unchecked")} \u2014 the signature was not verified.`;
  }
  return `  ${paint(console.color, "green", "receipt is internally consistent")} \u2014 integrity only; this receipt is unsigned.`;
}

// src/main.ts
var HELP = `changesafe \u2014 a deterministic airlock for AI-proposed infrastructure changes

USAGE
  changesafe gate      [options]        evaluate a proposal against the safety gate
  changesafe analyze   [options]        ask a model for a proposal, then gate it
  changesafe eval      [options]        measure a model against the scenario suite
  changesafe verify    <receipt.json>   recompute a receipt's hashes and signature
  changesafe keygen    [--out <path>]   generate an Ed25519 receipt signing key
  changesafe ledger    append|list|verify   append-only decision ledger
  changesafe serve     [options]        authenticated self-hosted decision API
  changesafe scenario  check [dir]      check scenarios against their expectations
  changesafe scenario  init <name>      scaffold a new scenario
  changesafe scenario  gallery          regenerate the scenario gallery

GATE OPTIONS
  --input <file>        the analyzed input: an incident bundle, or
                        \`terraform show -json\` output for --domain terraform
  --proposal <file>     a proposal, or a replay fixture containing one
                        (the terraform domain derives this from the plan)
  --scenario <dir>      shorthand for --input <dir>/incident.json
                        and --proposal <dir>/replay-fixture.json
  --context <file>      untrusted text that came with the change (a PR body),
                        scanned for injected instructions
  --domain <id>         domain to gate against (default: network; available: ${DOMAIN_IDS.join(", ")})
  --policy-pack <file>  typed threshold overrides
  --receipt <file>      write a hashed receipt of this evaluation
  --sign-key <file>     private-key PEM; signs the receipt it writes
  --receipt-id <id>     fix receipt identity for audited snapshot generation
  --created-at <UTC>    fix receipt and signature time for audited snapshots
  --app-version <id>    record this build identity instead of this build's own;
                        only for regenerating or re-verifying a published
                        snapshot with a later build
  --source-id <id>      what to record as the input's origin
  --format pretty|json  output format (default: pretty)

ANALYZE OPTIONS
  --input <file>        the incident bundle to analyze
  --scenario <dir>      shorthand for --input <dir>/incident.json
  --provider <id>       ${PROVIDER_IDS.join(" | ")} (default: the configured one)
  --model <id>          override the provider's default model
  --out <file>          write the accepted proposal
  --capture <file>      write a provenance-stamped replay fixture
  plus every GATE OPTION above, applied to the resulting proposal

EVAL OPTIONS
  --provider <id>       required; spends API credit
  --model <id>          override the provider's default model
  --dir <dir>           scenario suite (default: scenarios)
  --runs <n>            attempts per scenario (default: 1, max 20)
  --report <file>       write a versioned, committable report
  --format pretty|json

LEDGER OPTIONS
  --db <file>           ledger database (default: changesafe-ledger.db)
  --source-id <id>      list: only this source
  --decision <kind>     list: only approved|rejected|blocked|gate_only
  --limit <n>           list: how many entries (default 50)

\`ledger verify\` recomputes the hash chain and exits 1 on any break: an entry
that was altered, removed, or reordered. Append-only is enforced by database
triggers; the chain is what catches someone who owns the file.

SERVE OPTIONS (self-hosting)
  --db <file>           append-only ledger (default: changesafe-ledger.db)
  --host <host>         bind address (default: 127.0.0.1)
  --port <n>            port (default: 8787)
  --oidc-issuer <url>   required; approver tokens must come from this issuer
  --oidc-audience <id>  required; tokens must be minted for this audience
  --oidc-jwks-uri <url> skip discovery and use this key endpoint
  --approver <subject>  restrict approvers to this token subject (repeatable)
  --approver-claim <name>=<value>
                        require this claim, e.g. groups=sre (repeatable)
  --sign-key <file>     sign every receipt this API issues

The API recomputes findings itself rather than trusting the caller, records an
authenticated approver on every decision, and appends to the ledger before
answering. It has no execution endpoint and no anonymous mode.

Authentication says who someone is; --approver and --approver-claim say which
of those people may act here. With neither, anyone your issuer will mint a
token for is an approver, and startup says so.

VERIFY OPTIONS
  --input <file>        also check the receipt describes this input
  --proposal <file>     also check the receipt describes this proposal
  --public-key <file>   trusted key, obtained out of band, to check a signature
  --skip-signature      report integrity only, leaving authorship unchecked
  --format pretty|json

Hashes prove a receipt was not altered. Only a signature proves who issued it,
and only against a key you already trust \u2014 so verifying a signed receipt
without --public-key exits 2 rather than pretending to have checked it.

EXIT CODES
  0  evaluated, nothing blocking      1  evaluated, blocked      2  could not evaluate

No command approves a change, and there is no --auto-approve. A clean gate is
an input to a human decision, not a substitute for one. Only \`analyze\` and
\`eval\` call a model; the gate itself never does.`;
var OPTION_SPEC = {
  input: { type: "string" },
  proposal: { type: "string" },
  scenario: { type: "string" },
  domain: { type: "string", default: "network" },
  "policy-pack": { type: "string" },
  receipt: { type: "string" },
  "source-id": { type: "string" },
  context: { type: "string" },
  provider: { type: "string" },
  model: { type: "string" },
  out: { type: "string" },
  capture: { type: "string" },
  runs: { type: "string", default: "1" },
  "sign-key": { type: "string" },
  "receipt-id": { type: "string" },
  "created-at": { type: "string" },
  "app-version": { type: "string" },
  "public-key": { type: "string" },
  "skip-signature": { type: "boolean", default: false },
  force: { type: "boolean", default: false },
  check: { type: "boolean", default: false },
  report: { type: "string" },
  db: { type: "string" },
  host: { type: "string" },
  port: { type: "string" },
  "oidc-issuer": { type: "string" },
  "oidc-audience": { type: "string" },
  "oidc-jwks-uri": { type: "string" },
  approver: { type: "string", multiple: true },
  "approver-claim": { type: "string", multiple: true },
  decision: { type: "string" },
  limit: { type: "string" },
  format: { type: "string", default: "pretty" },
  dir: { type: "string" },
  help: { type: "boolean", short: "h", default: false },
  version: { type: "boolean", default: false }
};
function parseFormat(value) {
  if (value !== "pretty" && value !== "json") {
    throw new UsageError(`--format must be "pretty" or "json", got "${value}"`);
  }
  return value;
}
async function main(argv, console) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTION_SPEC, allowPositionals: true });
  } catch (error51) {
    throw new UsageError(error51 instanceof Error ? error51.message : "invalid arguments");
  }
  const { values, positionals } = parsed;
  if (values.version) {
    console.out(`changesafe ${CLI_PACKAGE_VERSION}`);
    return 0;
  }
  if (values.help || positionals.length === 0) {
    console.out(HELP);
    return positionals.length === 0 && !values.help ? EXIT_USAGE : 0;
  }
  const format = parseFormat(values.format);
  const command = positionals[0];
  switch (command) {
    case "gate":
      return runGate(
        {
          domain: values.domain,
          input: values.input,
          proposal: values.proposal,
          scenario: values.scenario,
          policyPack: values["policy-pack"],
          receipt: values.receipt,
          signKey: values["sign-key"],
          receiptId: values["receipt-id"],
          now: values["created-at"],
          appVersion: values["app-version"],
          sourceId: values["source-id"],
          context: values.context,
          format
        },
        console
      );
    case "analyze":
      return runAnalyze(
        {
          domain: values.domain,
          input: values.input,
          scenario: values.scenario,
          provider: values.provider,
          model: values.model,
          out: values.out,
          capture: values.capture,
          policyPack: values["policy-pack"],
          receipt: values.receipt,
          signKey: values["sign-key"],
          receiptId: values["receipt-id"],
          receiptCreatedAtUtc: values["created-at"],
          sourceId: values["source-id"],
          format
        },
        console
      );
    case "eval": {
      if (!values.provider) {
        throw new UsageError(
          `eval needs an explicit --provider (${PROVIDER_IDS.join(", ")}) because it spends API credit`
        );
      }
      const runs = Number(values.runs);
      if (!Number.isFinite(runs)) throw new UsageError(`--runs must be a number, got "${values.runs}"`);
      return runEval(
        {
          provider: values.provider,
          model: values.model,
          dir: values.dir ?? "scenarios",
          runs,
          report: values.report,
          format
        },
        console
      );
    }
    case "verify": {
      const receipt = positionals[1] ?? values.receipt;
      if (!receipt) throw new UsageError("verify needs a receipt file: changesafe verify <receipt.json>");
      return runVerify(
        {
          receipt,
          input: values.input,
          proposal: values.proposal,
          publicKey: values["public-key"],
          skipSignature: values["skip-signature"],
          domain: values.domain,
          format
        },
        console
      );
    }
    case "keygen":
      return runKeygen(
        { out: values.out ?? "changesafe-signing-key", force: values.force, format },
        console
      );
    case "serve": {
      const port = Number(values.port ?? "8787");
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new UsageError(`--port must be a port number, got "${values.port}"`);
      }
      return runServe(
        {
          db: values.db ?? "changesafe-ledger.db",
          host: values.host ?? "127.0.0.1",
          port,
          oidcIssuer: values["oidc-issuer"],
          oidcAudience: values["oidc-audience"],
          oidcJwksUri: values["oidc-jwks-uri"],
          approvers: values.approver,
          approverClaims: values["approver-claim"],
          signKey: values["sign-key"]
        },
        console
      );
    }
    case "ledger": {
      const sub = positionals[1];
      const db = values.db ?? "changesafe-ledger.db";
      const limit = values.limit === void 0 ? void 0 : Number(values.limit);
      if (limit !== void 0 && !Number.isFinite(limit)) {
        throw new UsageError(`--limit must be a number, got "${values.limit}"`);
      }
      const ledgerOptions = {
        db,
        receipt: positionals[2] ?? values.receipt,
        sourceId: values["source-id"],
        decision: values.decision,
        limit,
        format
      };
      if (sub === "append") return runLedgerAppend(ledgerOptions, console);
      if (sub === "list") return runLedgerList(ledgerOptions, console);
      if (sub === "verify") return runLedgerVerify(ledgerOptions, console);
      throw new UsageError(`unknown ledger subcommand "${sub ?? ""}". Use append, list, or verify.`);
    }
    case "scenario": {
      const sub = positionals[1];
      if (sub === "check") {
        return runScenarioCheck(
          { dir: positionals[2] ?? values.dir ?? "scenarios", domain: values.domain, format },
          console
        );
      }
      if (sub === "gallery") {
        return runGallery(
          {
            dir: values.dir ?? "scenarios",
            out: values.out ?? "docs/SCENARIOS.md",
            check: values.check,
            format
          },
          console
        );
      }
      if (sub === "init") {
        const name = positionals[2];
        if (!name) throw new UsageError("scenario init needs a name: changesafe scenario init <name>");
        return runScenarioInit({ name, dir: values.dir ?? "scenarios" }, console);
      }
      throw new UsageError(
        `unknown scenario subcommand "${sub ?? ""}". Use check, init, or gallery.`
      );
    }
    default:
      throw new UsageError(`unknown command "${command}". Run changesafe --help.`);
  }
}
async function run(argv) {
  const console = createConsole();
  try {
    return await main(argv, console);
  } catch (error51) {
    const message = isDomainError(error51) ? error51.userMessage : error51 instanceof Error ? error51.message : "the gate failed for an unknown reason";
    console.err("");
    console.err(`  ${paint(console.color, "red", "error")} ${message}`);
    console.err("");
    return EXIT_USAGE;
  }
}
function invokedDirectly() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.filename === realpathSync(entry);
  } catch {
    return false;
  }
}
if (invokedDirectly()) {
  process.exitCode = await run(process.argv.slice(2));
}
export {
  main,
  run
};
