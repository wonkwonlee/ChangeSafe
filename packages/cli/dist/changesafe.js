Warning: truncated output (original token count: 300409)
... 153057 bytes omitted ...

#!/usr/bin/env node
import { createRequire as makeRuntimeRequire } from "node:module"; const require = makeRuntimeRequire(import.meta.url);
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __commonJS = (cb, mod) => function __require2() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// ../../node_modules/yaml/dist/nodes/identity.js
var require_identity = __commonJS({
  "../../node_modules/yaml/dist/nodes/identity.js"(exports) {
    "use strict";
    var ALIAS = Symbol.for("yaml.alias");
    var DOC = Symbol.for("yaml.document");
    var MAP = Symbol.for("yaml.map");
    var PAIR = Symbol.for("yaml.pair");
    var SCALAR = Symbol.for("yaml.scalar");
    var SEQ = Symbol.for("yaml.seq");
    var NODE_TYPE = Symbol.for("yaml.node.type");
    var isAlias = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === ALIAS;
    var isDocument = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === DOC;
    var isMap = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === MAP;
    var isPair = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === PAIR;
    var isScalar = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === SCALAR;
    var isSeq = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === SEQ;
    function isCollection(node) {
      if (node && typeof node === "object")
        switch (node[NODE_TYPE]) {
          case MAP:
          case SEQ:
            return true;
        }
      return false;
    }
    function isNode(node) {
      if (node && typeof node === "object")
        switch (node[NODE_TYPE]) {
          case ALIAS:
          case MAP:
          case SCALAR:
          case SEQ:
            return true;
        }
      return false;
    }
    var hasAnchor = (node) => (isScalar(node) || isCollection(node)) && !!node.anchor;
    exports.ALIAS = ALIAS;
    exports.DOC = DOC;
    exports.MAP = MAP;
    exports.NODE_TYPE = NODE_TYPE;
    exports.PAIR = PAIR;
    exports.SCALAR = SCALAR;
    exports.SEQ = SEQ;
    exports.hasAnchor = hasAnchor;
    exports.isAlias = isAlias;
    exports.isCollection = isCollection;
    exports.isDocument = isDocument;
    exports.isMap = isMap;
    exports.isNode = isNode;
    exports.isPair = isPair;
    exports.isScalar = isScalar;
    exports.isSeq = isSeq;
  }
});

// ../../node_modules/yaml/dist/visit.js
var require_visit = __commonJS({
  "../../node_modules/yaml/dist/visit.js"(exports) {
    "use strict";
    var identity = require_identity();
    var BREAK = Symbol("break visit");
    var SKIP = Symbol("skip children");
    var REMOVE = Symbol("remove node");
    function visit(node, visitor) {
      const visitor_ = initVisitor(visitor);
      if (identity.isDocument(node)) {
        const cd = visit_(null, node.contents, visitor_, Object.freeze([node]));
        if (cd === REMOVE)
          node.contents = null;
      } else
        visit_(null, node, visitor_, Object.freeze([]));
    }
    visit.BREAK = BREAK;
    visit.SKIP = SKIP;
    visit.REMOVE = REMOVE;
    function visit_(key, node, visitor, path9) {
      const ctrl = callVisitor(key, node, visitor, path9);
      if (identity.isNode(ctrl) || identity.isPair(ctrl)) {
        replaceNode(key, path9, ctrl);
        return visit_(key, ctrl, visitor, path9);
      }
      if (typeof ctrl !== "symbol") {
        if (identity.isCollection(node)) {
          path9 = Object.freeze(path9.concat(node));
          for (let i = 0; i < node.items.length; ++i) {
            const ci = visit_(i, node.items[i], visitor, path9);
            if (typeof ci === "number")
              i = ci - 1;
            else if (ci === BREAK)
              return BREAK;
            else if (ci === REMOVE) {
              node.items.splice(i, 1);
              i -= 1;
            }
          }
        } else if (identity.isPair(node)) {
          path9 = Object.freeze(path9.concat(node));
          const ck = visit_("key", node.key, visitor, path9);
          if (ck === BREAK)
            return BREAK;
          else if (ck === REMOVE)
            node.key = null;
          const cv = visit_("value", node.value, visitor, path9);
          if (cv === BREAK)
            return BREAK;
          else if (cv === REMOVE)
            node.value = null;
        }
      }
      return ctrl;
    }
    async function visitAsync(node, visitor) {
      const visitor_ = initVisitor(visitor);
      if (identity.isDocument(node)) {
        const cd = await visitAsync_(null, node.contents, visitor_, Object.freeze([node]));
        if (cd === REMOVE)
          node.contents = null;
      } else
        await visitAsync_(null, node, visitor_, Object.freeze([]));
    }
    visitAsync.BREAK = BREAK;
    visitAsync.SKIP = SKIP;
    visitAsync.REMOVE = REMOVE;
    async function visitAsync_(key, node, visitor, path9) {
      const ctrl = await callVisitor(key, node, visitor, path9);
      if (identity.isNode(ctrl) || identity.isPair(ctrl)) {
        replaceNode(key, path9, ctrl);
        return visitAsync_(key, ctrl, visitor, path9);
      }
      if (typeof ctrl !== "symbol") {
        if (identity.isCollection(node)) {
          path9 = Object.freeze(path9.concat(node));
          for (let i = 0; i < node.items.length; ++i) {
            const ci = await visitAsync_(i, node.items[i], visitor, path9);
            if (typeof ci === "number")
              i = ci - 1;
            else if (ci === BREAK)
              return BREAK;
            else if (ci === REMOVE) {
              node.items.splice(i, 1);
              i -= 1;
            }
          }
        } else if (identity.isPair(node)) {
          path9 = Object.freeze(path9.concat(node));
          const ck = await visitAsync_("key", node.key, visitor, path9);
          if (ck === BREAK)
            return BREAK;
          else if (ck === REMOVE)
            node.key = null;
          const cv = await visitAsync_("value", node.value, visitor, path9);
          if (cv === BREAK)
            return BREAK;
          else if (cv === REMOVE)
            node.value = null;
        }
      }
      return ctrl;
    }
    function initVisitor(visitor) {
      if (typeof visitor === "object" && (visitor.Collection || visitor.Node || visitor.Value)) {
        return Object.assign({
          Alias: visitor.Node,
          Map: visitor.Node,
          Scalar: visitor.Node,
          Seq: visitor.Node
        }, visitor.Value && {
          Map: visitor.Value,
          Scalar: visitor.Value,
          Seq: visitor.Value
        }, visitor.Collection && {
          Map: visitor.Collection,
          Seq: visitor.Collection
        }, visitor);
      }
      return visitor;
    }
    function callVisitor(key, node, visitor, path9) {
      if (typeof visitor === "function")
        return visitor(key, node, path9);
      if (identity.isMap(node))
        return visitor.Map?.(key, node, path9);
      if (identity.isSeq(node))
        return visitor.Seq?.(key, node, path9);
      if (identity.isPair(node))
        return visitor.Pair?.(key, node, path9);
      if (identity.isScalar(node))
        return visitor.Scalar?.(key, node, path9);
      if (identity.isAlias(node))
        return visitor.Alias?.(key, node, path9);
      return void 0;
    }
    function replaceNode(key, path9, node) {
      const parent = path9[path9.length - 1];
      if (identity.isCollection(parent)) {
        parent.items[key] = node;
      } else if (identity.isPair(parent)) {
        if (key === "key")
          parent.key = node;
        else
          parent.value = node;
      } else if (identity.isDocument(parent)) {
        parent.contents = node;
      } else {
        const pt = identity.isAlias(parent) ? "alias" : "scalar";
        throw new Error(`Cannot replace node with ${pt} parent`);
      }
    }
    exports.visit = visit;
    exports.visitAsync = visitAsync;
  }
});

// ../../node_modules/yaml/dist/doc/directives.js
var require_directives = __commonJS({
  "../../node_modules/yaml/dist/doc/directives.js"(exports) {
    "use strict";
    var identity = require_identity();
    var visit = require_visit();
    var escapeChars = {
      "!": "%21",
      ",": "%2C",
      "[": "%5B",
      "]": "%5D",
      "{": "%7B",
      "}": "%7D"
    };
    var escapeTagName = (tn) => tn.replace(/[!,[\]{}]/g, (ch) => escapeChars[ch]);
    var Directives = class _Directives {
      constructor(yaml, tags) {
        this.docStart = null;
        this.docEnd = false;
        this.yaml = Object.assign({}, _Directives.defaultYaml, yaml);
        this.tags = Object.assign({}, _Directives.defaultTags, tags);
      }
      clone() {
        const copy = new _Directives(this.yaml, this.tags);
        copy.docStart = this.docStart;
        return copy;
      }
      /**
       * During parsing, get a Directives instance for the current document and
       * update the stream state according to the current version's spec.
       */
      atDocument() {
        const res = new _Directives(this.yaml, this.tags);
        switch (this.yaml.version) {
          case "1.1":
            this.atNextDocument = true;
            break;
          case "1.2":
            this.atNextDocument = false;
            this.yaml = {
              explicit: _Directives.defaultYaml.explicit,
              version: "1.2"
            };
            this.tags = Object.assign({}, _Directives.defaultTags);
            break;
        }
        return res;
      }
      /**
       * @param onError - May be called even if the action was successful
       * @returns `true` on success
       */
      add(line, onError) {
        if (this.atNextDocument) {
          this.yaml = { explicit: _Directives.defaultYaml.explicit, version: "1.1" };
          this.tags = Object.assign({}, _Directives.defaultTags);
          this.atNextDocument = false;
        }
        const parts = line.trim().split(/[ \t]+/);
        const name = parts.shift();
        switch (name) {
          case "%TAG": {
            if (parts.length !== 2) {
              onError(0, "%TAG directive should contain exactly two parts");
              if (parts.length < 2)
                return false;
            }
            const [handle2, prefix] = parts;
            this.tags[handle2] = prefix;
            return true;
          }
          case "%YAML": {
            this.yaml.explicit = true;
            if (parts.length !== 1) {
              onError(0, "%YAML directive should contain exactly one part");
              return false;
            }
            const [version2] = parts;
            if (version2 === "1.1" || version2 === "1.2") {
              this.yaml.version = version2;
              return true;
            } else {
              const isValid = /^\d+\.\d+$/.test(version2);
              onError(6, `Unsupported YAML version ${version2}`, isValid);
              return false;
            }
          }
          default:
            onError(0, `Unknown directive ${name}`, true);
            return false;
        }
      }
      /**
       * Resolves a tag, matching handles to those defined in %TAG directives.
       *
       * @returns Resolved tag, which may also be the non-specific tag `'!'` or a
       *   `'!local'` tag, or `null` if unresolvable.
       */
      tagName(source, onError) {
        if (source === "!")
          return "!";
        if (source[0] !== "!") {
          onError(`Not a valid tag: ${source}`);
          return null;
        }
        if (source[1] === "<") {
          const verbatim = source.slice(2, -1);
          if (verbatim === "!" || verbatim === "!!") {
            onError(`Verbatim tags aren't resolved, so ${source} is invalid.`);
            return null;
          }
          if (source[source.length - 1] !== ">")
            onError("Verbatim tags must end with a >");
          return verbatim;
        }
        const [, handle2, suffix] = source.match(/^(.*!)([^!]*)$/s);
        if (!suffix)
          onError(`The ${source} tag has no suffix`);
        const prefix = this.tags[handle2];
        if (prefix) {
          try {
            return prefix + decodeURIComponent(suffix);
          } catch (error51) {
            onError(String(error51));
            return null;
          }
        }
        if (handle2 === "!")
          return source;
        onError(`Could not resolve tag: ${source}`);
        return null;
      }
      /**
       * Given a fully resolved tag, returns its printable string form,
       * taking into account current tag prefixes and defaults.
       */
      tagString(tag2) {
        for (const [handle2, prefix] of Object.entries(this.tags)) {
          if (tag2.startsWith(prefix))
            return handle2 + escapeTagName(tag2.substring(prefix.length));
        }
        return tag2[0] === "!" ? tag2 : `!<${tag2}>`;
      }
      toString(doc) {
        const lines = this.yaml.explicit ? [`%YAML ${this.yaml.version || "1.2"}`] : [];
        const tagEntries = Object.entries(this.tags);
        let tagNames;
        if (doc && tagEntries.length > 0 && identity.isNode(doc.contents)) {
          const tags = {};
          visit.visit(doc.contents, (_key, node) => {
            if (identity.isNode(node) && node.tag)
              tags[node.tag] = true;
          });
          tagNames = Object.keys(tags);
        } else
          tagNames = [];
        for (const [handle2, prefix] of tagEntries) {
          if (handle2 === "!!" && prefix === "tag:yaml.org,2002:")
            continue;
          if (!doc || tagNames.some((tn) => tn.startsWith(prefix)))
            lines.push(`%TAG ${handle2} ${prefix}`);
        }
        return lines.join("\n");
      }
    };
    Directives.defaultYaml = { explicit: false, version: "1.2" };
    Directives.defaultTags = { "!!": "tag:yaml.org,2002:" };
    exports.Directives = Directives;
  }
});

// ../../node_modules/yaml/dist/doc/anchors.js
var require_anchors = __commonJS({
  "../../node_modules/yaml/dist/doc/anchors.js"(exports) {
    "use strict";
    var identity = require_identity();
    var visit = require_visit();
    function anchorIsValid(anchor) {
      if (/[\x00-\x19\s,[\]{}]/.test(anchor)) {
        const sa = JSON.stringify(anchor);
        const msg = `Anchor must not contain whitespace or control characters: ${sa}`;
        throw new Error(msg);
      }
      return true;
    }
    function anchorNames(root) {
      const anchors = /* @__PURE__ */ new Set();
      visit.visit(root, {
        Value(_key, node) {
          if (node.anchor)
            anchors.add(node.anchor);
        }
      });
      return anchors;
    }
    function findNewAnchor(prefix, exclude) {
      for (let i = 1; true; ++i) {
        const name = `${prefix}${i}`;
        if (!exclude.has(name))
          return name;
      }
    }
    function createNodeAnchors(doc, prefix) {
      const aliasObjects = [];
      const sourceObjects = /* @__PURE__ */ new Map();
      let prevAnchors = null;
      return {
        onAnchor: (source) => {
          aliasObjects.push(source);
          prevAnchors ?? (prevAnchors = anchorNames(doc));
          const anchor = findNewAnchor(prefix, prevAnchors);
          prevAnchors.add(anchor);
          return anchor;
        },
        /**
         * With circular references, the source node is only resolved after all
         * of its child nodes are. This is why anchors are set only after all of
         * the nodes have been created.
         */
        setAnchors: () => {
          for (const source of aliasObjects) {
            const ref = sourceObjects.get(source);
            if (typeof ref === "object" && ref.anchor && (identity.isScalar(ref.node) || identity.isCollection(ref.node))) {
              ref.node.anchor = ref.anchor;
            } else {
              const error51 = new Error("Failed to resolve repeated object (this should not happen)");
              error51.source = source;
              throw error51;
            }
          }
        },
        sourceObjects
      };
    }
    exports.anchorIsValid = anchorIsValid;
    exports.anchorNames = anchorNames;
    exports.createNodeAnchors = createNodeAnchors;
    exports.findNewAnchor = findNewAnchor;
  }
});

// ../../node_modules/yaml/dist/doc/applyReviver.js
var require_applyReviver = __commonJS({
  "../../node_modules/yaml/dist/doc/applyReviver.js"(exports) {
    "use strict";
    function applyReviver(reviver, obj, key, val) {
      if (val && typeof val === "object") {
        if (Array.isArray(val)) {
          for (let i = 0, len = val.length; i < len; ++i) {
            const v0 = val[i];
            const v1 = applyReviver(reviver, val, String(i), v0);
            if (v1 === void 0)
              delete val[i];
            else if (v1 !== v0)
              val[i] = v1;
          }
        } else if (val instanceof Map) {
          for (const k of Array.from(val.keys())) {
            const v0 = val.get(k);
            const v1 = applyReviver(reviver, val, k, v0);
            if (v1 === void 0)
              val.delete(k);
            else if (v1 !== v0)
              val.set(k, v1);
          }
        } else if (val instanceof Set) {
          for (const v0 of Array.from(val)) {
            const v1 = applyReviver(reviver, val, v0, v0);
            if (v1 === void 0)
              val.delete(v0);
            else if (v1 !== v0) {
              val.delete(v0);
              val.add(v1);
            }
          }
        } else {
          for (const [k, v0] of Object.entries(val)) {
            const v1 = applyReviver(reviver, val, k, v0);
            if (v1 === void 0)
              delete val[k];
            else if (v1 !== v0)
              val[k] = v1;
          }
        }
      }
      return reviver.call(obj, key, val);
    }
    exports.applyReviver = applyReviver;
  }
});

// ../../node_modules/yaml/dist/nodes/toJS.js
var require_toJS = __commonJS({
  "../../node_modules/yaml/dist/nodes/toJS.js"(exports) {
    "use strict";
    var identity = require_identity();
    function toJS(value, arg, ctx) {
      if (Array.isArray(value))
        return value.map((v, i) => toJS(v, String(i), ctx));
      if (value && typeof value.toJSON === "function") {
        if (!ctx || !identity.hasAnchor(value))
          return value.toJSON(arg, ctx);
        const data = { aliasCount: 0, count: 1, res: void 0 };
        ctx.anchors.set(value, data);
        ctx.onCreate = (res2) => {
          data.res = res2;
          delete ctx.onCreate;
        };
        const res = value.toJSON(arg, ctx);
        if (ctx.onCreate)
          ctx.onCreate(res);
        return res;
      }
      if (typeof value === "bigint" && !ctx?.keep)
        return Number(value);
      return value;
    }
    exports.toJS = toJS;
  }
});

// ../../node_modules/yaml/dist/nodes/Node.js
var require_Node = __commonJS({
  "../../node_modules/yaml/dist/nodes/Node.js"(exports) {
    "use strict";
    var applyReviver = require_applyReviver();
    var identity = require_identity();
    var toJS = require_toJS();
    var NodeBase = class {
      constructor(type) {
        Object.defineProperty(this, identity.NODE_TYPE, { value: type });
      }
      /** Create a copy of this node.  */
      clone() {
        const copy = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
        if (this.range)
          copy.range = this.range.slice();
        return copy;
      }
      /** A plain JavaScript representation of this node. */
      toJS(doc, { mapAsMap, maxAliasCount, onAnchor, reviver } = {}) {
        if (!identity.isDocument(doc))
          throw new TypeError("A document argument is required");
        const ctx = {
          anchors: /* @__PURE__ */ new Map(),
          doc,
          keep: true,
          mapAsMap: mapAsMap === true,
          mapKeyWarned: false,
          maxAliasCount: typeof maxAliasCount === "number" ? maxAliasCount : 100
        };
        const res = toJS.toJS(this, "", ctx);
        if (typeof onAnchor === "function")
          for (const { count, res: res2 } of ctx.anchors.values())
            onAnchor(res2, count);
        return typeof reviver === "function" ? applyReviver.applyReviver(reviver, { "": res }, "", res) : res;
      }
    };
    exports.NodeBase = NodeBase;
  }
});

// ../../node_modules/yaml/dist/nodes/Alias.js
var require_Alias = __commonJS({
  "../../node_modules/yaml/dist/nodes/Alias.js"(exports) {
    "use strict";
    var anchors = require_anchors();
    var visit = require_visit();
    var identity = require_identity();
    var Node = require_Node();
    var toJS = require_toJS();
    var Alias = class extends Node.NodeBase {
      constructor(source) {
        super(identity.ALIAS);
        this.source = source;
        Object.defineProperty(this, "tag", {
          set() {
            throw new Error("Alias nodes cannot have tags");
          }
        });
      }
      /**
       * Resolve the value of this alias within `doc`, finding the last
       * instance of the `source` anchor before this node.
       */
      resolve(doc, ctx) {
        if (ctx?.maxAliasCount === 0)
          throw new ReferenceError("Alias resolution is disabled");
        let nodes;
        if (ctx?.aliasResolveCache) {
          nodes = ctx.aliasResolveCache;
        } else {
          nodes = [];
          visit.visit(doc, {
            Node: (_key, node) => {
              if (identity.isAlias(node) || identity.hasAnchor(node))
                nodes.push(node);
            }
          });
          if (ctx)
            ctx.aliasResolveCache = nodes;
        }
        let found = void 0;
        for (const node of nodes) {
          if (node === this)
            break;
          if (node.anchor === this.source)
            found = node;
        }
        return found;
      }
      toJSON(_arg, ctx) {
        if (!ctx)
          return { source: this.source };
        const { anchors: anchors2, doc, maxAliasCount } = ctx;
        const source = this.resolve(doc, ctx);
        if (!source) {
          const msg = `Unresolved alias (the anchor must be set before the alias): ${this.source}`;
          throw new ReferenceError(msg);
        }
        let data = anchors2.get(source);
        if (!data) {
          toJS.toJS(source, null, ctx);
          data = anchors2.get(source);
        }
        if (data?.res === void 0) {
          const msg = "This should not happen: Alias anchor was not resolved?";
          throw new ReferenceError(msg);
        }
        if (maxAliasCount >= 0) {
          data.count += 1;
          if (data.aliasCount === 0)
            data.aliasCount = getAliasCount(doc, source, anchors2);
          if (data.count * data.aliasCount > maxAliasCount) {
            const msg = "Excessive alias count indicates a resource exhaustion attack";
            throw new ReferenceError(msg);
          }
        }
        return data.res;
      }
      toString(ctx, _onComment, _onChompKeep) {
        const src = `*${this.source}`;
        if (ctx) {
          anchors.anchorIsValid(this.source);
          if (ctx.options.verifyAliasOrder && !ctx.anchors.has(this.source)) {
            const msg = `Unresolved alias (the anchor must be set before the alias): ${this.source}`;
            throw new Error(msg);
          }
          if (ctx.implicitKey)
            return `${src} `;
        }
        return src;
      }
    };
    function getAliasCount(doc, node, anchors2) {
      if (identity.isAlias(node)) {
        const source = node.resolve(doc);
        const anchor = anchors2 && source && anchors2.get(source);
        return anchor ? anchor.count * anchor.aliasCount : 0;
      } else if (identity.isCollection(node)) {
        let count = 0;
        for (const item of node.items) {
          const c = getAliasCount(doc, item, anchors2);
          if (c > count)
            count = c;
        }
        return count;
      } else if (identity.isPair(node)) {
        const kc = getAliasCount(doc, node.key, anchors2);
        const vc = getAliasCount(doc, node.value, anchors2);
        return Math.max(kc, vc);
      }
      return 1;
    }
    exports.Alias = Alias;
  }
});

// ../../node_modules/yaml/dist/nodes/Scalar.js
var require_Scalar = __commonJS({
  "../../node_modules/yaml/dist/nodes/Scalar.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Node = require_Node();
    var toJS = require_toJS();
    var isScalarValue = (value) => !value || typeof value !== "function" && typeof value !== "object";
    var Scalar = class extends Node.NodeBase {
      constructor(value) {
        super(identity.SCALAR);
        this.value = value;
      }
      toJSON(arg, ctx) {
        return ctx?.keep ? this.value : toJS.toJS(this.value, arg, ctx);
      }
      toString() {
        return String(this.value);
      }
    };
    Scalar.BLOCK_FOLDED = "BLOCK_FOLDED";
    Scalar.BLOCK_LITERAL = "BLOCK_LITERAL";
    Scalar.PLAIN = "PLAIN";
    Scalar.QUOTE_DOUBLE = "QUOTE_DOUBLE";
    Scalar.QUOTE_SINGLE = "QUOTE_SINGLE";
    exports.Scalar = Scalar;
    exports.isScalarValue = isScalarValue;
  }
});

// ../../node_modules/yaml/dist/doc/createNode.js
var require_createNode = __commonJS({
  "../../node_modules/yaml/dist/doc/createNode.js"(exports) {
    "use strict";
    var Alias = require_Alias();
    var identity = require_identity();
    var Scalar = require_Scalar();
    var defaultTagPrefix = "tag:yaml.org,2002:";
    function findTagObject(value, tagName, tags) {
      if (tagName) {
        const match = tags.filter((t) => t.tag === tagName);
        const tagObj = match.find((t) => !t.format) ?? match[0];
        if (!tagObj)
          throw new Error(`Tag ${tagName} not found`);
        return tagObj;
      }
      return tags.find((t) => t.identify?.(value) && !t.format);
    }
    function createNode(value, tagName, ctx) {
      if (identity.isDocument(value))
        value = value.contents;
      if (identity.isNode(value))
        return value;
      if (identity.isPair(value)) {
        const map2 = ctx.schema[identity.MAP].createNode?.(ctx.schema, null, ctx);
        map2.items.push(value);
        return map2;
      }
      if (value instanceof String || value instanceof Number || value instanceof Boolean || typeof BigInt !== "undefined" && value instanceof BigInt) {
        value = value.valueOf();
      }
      const { aliasDuplicateObjects, onAnchor, onTagObj, schema, sourceObjects } = ctx;
      let ref = void 0;
      if (aliasDuplicateObjects && value && typeof value === "object") {
        ref = sourceObjects.get(value);
        if (ref) {
          ref.anchor ?? (ref.anchor = onAnchor(value));
          return new Alias.Alias(ref.anchor);
        } else {
          ref = { anchor: null, node: null };
          sourceObjects.set(value, ref);
        }
      }
      if (tagName?.startsWith("!!"))
        tagName = defaultTagPrefix + tagName.slice(2);
      let tagObj = findTagObject(value, tagName, schema.tags);
      if (!tagObj) {
        if (value && typeof value.toJSON === "function") {
          value = value.toJSON();
        }
        if (!value || typeof value !== "object") {
          const node2 = new Scalar.Scalar(value);
          if (ref)
            ref.node = node2;
          return node2;
        }
        tagObj = value instanceof Map ? schema[identity.MAP] : Symbol.iterator in Object(value) ? schema[identity.SEQ] : schema[identity.MAP];
      }
      if (onTagObj) {
        onTagObj(tagObj);
        delete ctx.onTagObj;
      }
      const node = tagObj?.createNode ? tagObj.createNode(ctx.schema, value, ctx) : typeof tagObj?.nodeClass?.from === "function" ? tagObj.nodeClass.from(ctx.schema, value, ctx) : new Scalar.Scalar(value);
      if (tagName)
        node.tag = tagName;
      else if (!tagObj.default)
        node.tag = tagObj.tag;
      if (ref)
        ref.node = node;
      return node;
    }
    exports.createNode = createNode;
  }
});

// ../../node_modules/yaml/dist/nodes/Collection.js
var require_Collection = __commonJS({
  "../../node_modules/yaml/dist/nodes/Collection.js"(exports) {
    "use strict";
    var createNode = require_createNode();
    var identity = require_identity();
    var Node = require_Node();
    function collectionFromPath(schema, path9, value) {
      let v = value;
      for (let i = path9.length - 1; i >= 0; --i) {
        const k = path9[i];
        if (typeof k === "number" && Number.isInteger(k) && k >= 0) {
          const a = [];
          a[k] = v;
          v = a;
        } else {
          v = /* @__PURE__ */ new Map([[k, v]]);
        }
      }
      return createNode.createNode(v, void 0, {
        aliasDuplicateObjects: false,
        keepUndefined: false,
        onAnchor: () => {
          throw new Error("This should not happen, please report a bug.");
        },
        schema,
        sourceObjects: /* @__PURE__ */ new Map()
      });
    }
    var isEmptyPath = (path9) => path9 == null || typeof path9 === "object" && !!path9[Symbol.iterator]().next().done;
    var Collection = class extends Node.NodeBase {
      constructor(type, schema) {
        super(type);
        Object.defineProperty(this, "schema", {
          value: schema,
          configurable: true,
          enumerable: false,
          writable: true
        });
      }
      /**
       * Create a copy of this collection.
       *
       * @param schema - If defined, overwrites the original's schema
       */
      clone(schema) {
        const copy = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
        if (schema)
          copy.schema = schema;
        copy.items = copy.items.map((it) => identity.isNode(it) || identity.isPair(it) ? it.clone(schema) : it);
        if (this.range)
          copy.range = this.range.slice();
        return copy;
      }
      /**
       * Adds a value to the collection. For `!!map` and `!!omap` the value must
       * be a Pair instance or a `{ key, value }` object, which may not have a key
       * that already exists in the map.
       */
      addIn(path9, value) {
        if (isEmptyPath(path9))
          this.add(value);
        else {
          const [key, ...rest] = path9;
          const node = this.get(key, true);
          if (identity.isCollection(node))
            node.addIn(rest, value);
          else if (node === void 0 && this.schema)
            this.set(key, collectionFromPath(this.schema, rest, value));
          else
            throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
        }
      }
      /**
       * Removes a value from the collection.
       * @returns `true` if the item was found and removed.
       */
      deleteIn(path9) {
        const [key, ...rest] = path9;
        if (rest.length === 0)
          return this.delete(key);
        const node = this.get(key, true);
        if (identity.isCollection(node))
          return node.deleteIn(rest);
        else
          throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
      }
      /**
       * Returns item at `key`, or `undefined` if not found. By default unwraps
       * scalar values from their surrounding node; to disable set `keepScalar` to
       * `true` (collections are always returned intact).
       */
      getIn(path9, keepScalar) {
        const [key, ...rest] = path9;
        const node = this.get(key, true);
        if (rest.length === 0)
          return !keepScalar && identity.isScalar(node) ? node.value : node;
        else
          return identity.isCollection(node) ? node.getIn(rest, keepScalar) : void 0;
      }
      hasAllNullValues(allowScalar) {
        return this.items.every((node) => {
          if (!identity.isPair(node))
            return false;
          const n = node.value;
          return n == null || allowScalar && identity.isScalar(n) && n.value == null && !n.commentBefore && !n.comment && !n.tag;
        });
      }
      /**
       * Checks if the collection includes a value with the key `key`.
       */
      hasIn(path9) {
        const [key, ...rest] = path9;
        if (rest.length === 0)
          return this.has(key);
        const node = this.get(key, true);
        return identity.isCollection(node) ? node.hasIn(rest) : false;
      }
      /**
       * Sets a value in this collection. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       */
      setIn(path9, value) {
        const [key, ...rest] = path9;
        if (rest.length === 0) {
          this.set(key, value);
        } else {
          const node = this.get(key, true);
          if (identity.isCollection(node))
            node.setIn(rest, value);
          else if (node === void 0 && this.schema)
            this.set(key, collectionFromPath(this.schema, rest, value));
          else
            throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
        }
      }
    };
    exports.Collection = Collection;
    exports.collectionFromPath = collectionFromPath;
    exports.isEmptyPath = isEmptyPath;
  }
});

// ../../node_modules/yaml/dist/stringify/stringifyComment.js
var require_stringifyComment = __commonJS({
  "../../node_modules/yaml/dist/stringify/stringifyComment.js"(exports) {
    "use strict";
    var stringifyComment = (str) => str.replace(/^(?!$)(?: $)?/gm, "#");
    function indentComment(comment, indent) {
      if (/^\n+$/.test(comment))
        return comment.substring(1);
      return indent ? comment.replace(/^(?! *$)/gm, indent) : comment;
    }
    var lineComment = (str, indent, comment) => str.endsWith("\n") ? indentComment(comment, indent) : comment.includes("\n") ? "\n" + indentComment(comment, indent) : (str.endsWith(" ") ? "" : " ") + comment;
    exports.indentComment = indentComment;
    exports.lineComment = lineComment;
    exports.stringifyComment = stringifyComment;
  }
});

// ../../node_modules/yaml/dist/stringify/foldFlowLines.js
var require_foldFlowLines = __commonJS({
  "../../node_modules/yaml/dist/stringify/foldFlowLines.js"(exports) {
    "use strict";
    var FOLD_FLOW = "flow";
    var FOLD_BLOCK = "block";
    var FOLD_QUOTED = "quoted";
    function foldFlowLines(text, indent, mode = "flow", { indentAtStart, lineWidth = 80, minContentWidth = 20, onFold, onOverflow } = {}) {
      if (!lineWidth || lineWidth < 0)
        return text;
      if (lineWidth < minContentWidth)
        minContentWidth = 0;
      const endStep = Math.max(1 + minContentWidth, 1 + lineWidth - indent.length);
      if (text.length <= endStep)
        return text;
      const folds = [];
      const escapedFolds = {};
      let end = lineWidth - indent.length;
      if (typeof indentAtStart === "number") {
        if (indentAtStart > lineWidth - Math.max(2, minContentWidth))
          folds.push(0);
        else
          end = lineWidth - indentAtStart;
      }
      let split = void 0;
      let prev = void 0;
      let overflow = false;
      let i = -1;
      let escStart = -1;
      let escEnd = -1;
      if (mode === FOLD_BLOCK) {
        i = consumeMoreIndentedLines(text, i, indent.length);
        if (i !== -1)
          end = i + endStep;
      }
      for (let ch; ch = text[i += 1]; ) {
        if (mode === FOLD_QUOTED && ch === "\\") {
          escStart = i;
          switch (text[i + 1]) {
            case "x":
              i += 3;
              break;
            case "u":
              i += 5;
              break;
            case "U":
              i += 9;
              break;
            default:
              i += 1;
          }
          escEnd = i;
        }
        if (ch === "\n") {
          if (mode === FOLD_BLOCK)
            i = consumeMoreIndentedLines(text, i, indent.length);
          end = i + indent.length + endStep;
          split = void 0;
        } else {
          if (ch === " " && prev && prev !== " " && prev !== "\n" && prev !== "	") {
            const next = text[i + 1];
            if (next && next !== " " && next !== "\n" && next !== "	")
              split = i;
          }
          if (i >= end) {
            if (split) {
              folds.push(split);
              end = split + endStep;
              split = void 0;
            } else if (mode === FOLD_QUOTED) {
              while (prev === " " || prev === "	") {
                prev = ch;
                ch = text[i += 1];
                overflow = true;
              }
              const j = i > escEnd + 1 ? i - 2 : escStart - 1;
              if (escapedFolds[j])
                return text;
              folds.push(j);
              escapedFolds[j] = true;
              end = j + endStep;
              split = void 0;
            } else {
              overflow = true;
            }
          }
        }
        prev = ch;
      }
      if (overflow && onOverflow)
        onOverflow();
      if (folds.length === 0)
        return text;
      if (onFold)
        onFold();
      let res = text.slice(0, folds[0]);
      for (let i2 = 0; i2 < folds.length; ++i2) {
        const fold = folds[i2];
        const end2 = folds[i2 + 1] || text.length;
        if (fold === 0)
          res = `
${indent}${text.slice(0, end2)}`;
        else {
          if (mode === FOLD_QUOTED && escapedFolds[fold])
            res += `${text[fold]}\\`;
          res += `
${indent}${text.slice(fold + 1, end2)}`;
        }
      }
      return res;
    }
    function consumeMoreIndentedLines(text, i, indent) {
      let end = i;
      let start = i + 1;
      let ch = text[start];
      while (ch === " " || ch === "	") {
        if (i < start + indent) {
          ch = text[++i];
        } else {
          do {
            ch = text[++i];
          } while (ch && ch !== "\n");
          end = i;
          start = i + 1;
          ch = text[start];
        }
      }
      return end;
    }
    exports.FOLD_BLOCK = FOLD_BLOCK;
    exports.FOLD_FLOW = FOLD_FLOW;
    exports.FOLD_QUOTED = FOLD_QUOTED;
    exports.foldFlowLines = foldFlowLines;
  }
});

// ../../node_modules/yaml/dist/stringify/stringifyString.js
var require_stringifyString = __commonJS({
  "../../node_modules/yaml/dist/stringify/stringifyString.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var foldFlowLines = require_foldFlowLines();
    var getFoldOptions = (ctx, isBlock) => ({
      indentAtStart: isBlock ? ctx.indent.length : ctx.indentAtStart,
      lineWidth: ctx.options.lineWidth,
      minContentWidth: ctx.options.minContentWidth
    });
    var containsDocumentMarker = (str) => /^(%|---|\.\.\.)/m.test(str);
    function lineLengthOverLimit(str, lineWidth, indentLength) {
      if (!lineWidth || lineWidth < 0)
        return false;
      const limit = lineWidth - indentLength;
      const strLen = str.length;
      if (strLen <= limit)
        return false;
      for (let i = 0, start = 0; i < strLen; ++i) {
        if (str[i] === "\n") {
          if (i - start > limit)
            return true;
          start = i + 1;
          if (strLen - start <= limit)
            return false;
        }
      }
      return true;
    }
    function doubleQuotedString(value, ctx) {
      const json2 = JSON.stringify(value);
      if (ctx.options.doubleQuotedAsJSON)
        return json2;
      const { implicitKey } = ctx;
      const minMultiLineLength = ctx.options.doubleQuotedMinMultiLineLength;
      const indent = ctx.indent || (containsDocumentMarker(value) ? "  " : "");
      let str = "";
      let start = 0;
      for (let i = 0, ch = json2[i]; ch; ch = json2[++i]) {
        if (ch === " " && json2[i + 1] === "\\" && json2[i + 2] === "n") {
          str += json2.slice(start, i) + "\\ ";
          i += 1;
          start = i;
          ch = "\\";
        }
        if (ch === "\\")
          switch (json2[i + 1]) {
            case "u":
              {
                str += json2.slice(start, i);
                const code = json2.substr(i + 2, 4);
                switch (code) {
                  case "0000":
                    str += "\\0";
                    break;
                  case "0007":
                    str += "\\a";
                    break;
                  case "000b":
                    str += "\\v";
                    break;
                  case "001b":
                    str += "\\e";
                    break;
                  case "0085":
                    str += "\\N";
                    break;
                  case "00a0":
                    str += "\\_";
                    break;
                  case "2028":
                    str += "\\L";
                    break;
                  case "2029":
                    str += "\\P";
                    break;
                  default:
                    if (code.substr(0, 2) === "00")
                      str += "\\x" + code.substr(2);
                    else
                      str += json2.substr(i, 6);
                }
                i += 5;
                start = i + 1;
              }
              break;
            case "n":
              if (implicitKey || json2[i + 2] === '"' || json2.length < minMultiLineLength) {
                i += 1;
              } else {
                str += json2.slice(start, i) + "\n\n";
                while (json2[i + 2] === "\\" && json2[i + 3] === "n" && json2[i + 4] !== '"') {
                  str += "\n";
                  i += 2;
                }
                str += indent;
                if (json2[i + 2] === " ")
                  str += "\\";
                i += 1;
                start = i + 1;
              }
              break;
            default:
              i += 1;
          }
      }
      str = start ? str + json2.slice(start) : json2;
      return implicitKey ? str : foldFlowLines.foldFlowLines(str, indent, foldFlowLines.FOLD_QUOTED, getFoldOptions(ctx, false));
    }
    function singleQuotedString(value, ctx) {
      if (ctx.options.singleQuote === false || ctx.implicitKey && value.includes("\n") || /[ \t]\n|\n[ \t]/.test(value))
        return doubleQuotedString(value, ctx);
      const indent = ctx.indent || (containsDocumentMarker(value) ? "  " : "");
      const res = "'" + value.replace(/'/g, "''").replace(/\n+/g, `$&
${indent}`) + "'";
      return ctx.implicitKey ? res : foldFlowLines.foldFlowLines(res, indent, foldFlowLines.FOLD_FLOW, getFoldOptions(ctx, false));
    }
    function quotedString(value, ctx) {
      const { singleQuote } = ctx.options;
      let qs;
      if (singleQuote === false)
        qs = doubleQuotedString;
      else {
        const hasDouble = value.includes('"');
        const hasSingle = value.includes("'");
        if (hasDouble && !hasSingle)
          qs = singleQuotedString;
        else if (hasSingle && !hasDouble)
          qs = doubleQuotedString;
        else
          qs = singleQuote ? singleQuotedString : doubleQuotedString;
      }
      return qs(value, ctx);
    }
    var blockEndNewlines;
    try {
      blockEndNewlines = new RegExp("(^|(?<!\n))\n+(?!\n|$)", "g");
    } catch {
      blockEndNewlines = /\n+(?!\n|$)/g;
    }
    function blockString({ comment, type, value }, ctx, onComment, onChompKeep) {
      const { blockQuote, commentString, lineWidth } = ctx.options;
      if (!blockQuote || /\n[\t ]+$/.test(value)) {
        return quotedString(value, ctx);
      }
      const indent = ctx.indent || (ctx.forceBlockIndent || containsDocumentMarker(value) ? "  " : "");
      const literal2 = blockQuote === "literal" ? true : blockQuote === "folded" || type === Scalar.Scalar.BLOCK_FOLDED ? false : type === Scalar.Scalar.BLOCK_LITERAL ? true : !lineLengthOverLimit(value, lineWidth, indent.length);
      if (!value)
        return literal2 ? "|\n" : ">\n";
      let chomp;
      let endStart;
      for (endStart = value.length; endStart > 0; --endStart) {
        const ch = value[endStart - 1];
        if (ch !== "\n" && ch !== "	" && ch !== " ")
          break;
      }
      let end = value.substring(endStart);
      const endNlPos = end.indexOf("\n");
      if (endNlPos === -1) {
        chomp = "-";
      } else if (value === end || endNlPos !== end.length - 1) {
        chomp = "+";
        if (onChompKeep)
          onChompKeep();
      } else {
        chomp = "";
      }
      if (end) {
        value = value.slice(0, -end.length);
        if (end[end.length - 1] === "\n")
          end = end.slice(0, -1);
        end = end.replace(blockEndNewlines, `$&${indent}`);
      }
      let startWithSpace = false;
      let startEnd;
      let startNlPos = -1;
      for (startEnd = 0; startEnd < value.length; ++startEnd) {
        const ch = value[startEnd];
        if (ch === " ")
          startWithSpace = true;
        else if (ch === "\n")
          startNlPos = startEnd;
        else
          break;
      }
      let start = value.substring(0, startNlPos < startEnd ? startNlPos + 1 : startEnd);
      if (start) {
        value = value.substring(start.length);
        start = start.replace(/\n+/g, `$&${indent}`);
      }
      const indentSize = indent ? "2" : "1";
      let header = (startWithSpace ? indentSize : "") + chomp;
      if (comment) {
        header += " " + commentString(comment.replace(/ ?[\r\n]+/g, " "));
        if (onComment)
          onComment();
      }
      if (!literal2) {
        const foldedValue = value.replace(/\n+/g, "\n$&").replace(/(?:^|\n)([\t ].*)(?:([\n\t ]*)\n(?![\n\t ]))?/g, "$1$2").replace(/\n+/g, `$&${indent}`);
        let literalFallback = false;
        const foldOptions = getFoldOptions(ctx, true);
        if (blockQuote !== "folded" && type !== Scalar.Scalar.BLOCK_FOLDED) {
          foldOptions.onOverflow = () => {
            literalFallback = true;
          };
        }
        const body = foldFlowLines.foldFlowLines(`${start}${foldedValue}${end}`, indent, foldFlowLines.FOLD_BLOCK, foldOptions);
        if (!literalFallback)
          return `>${header}
${indent}${body}`;
      }
      value = value.replace(/\n+/g, `$&${indent}`);
      return `|${header}
${indent}${start}${value}${end}`;
    }
    function plainString(item, ctx, onComment, onChompKeep) {
      const { type, value } = item;
      const { actualString, implicitKey, indent, indentStep, inFlow } = ctx;
      if (implicitKey && value.includes("\n") || inFlow && /[[\]{},]/.test(value)) {
        return quotedString(value, ctx);
      }
      if (/^[\n\t ,[\]{}#&*!|>'"%@`]|^[?-]$|^[?-][ \t]|[\n:][ \t]|[ \t]\n|[\n\t ]#|[\n\t :]$/.test(value)) {
        return implicitKey || inFlow || !value.includes("\n") ? quotedString(value, ctx) : blockString(item, ctx, onComment, onChompKeep);
      }
      if (!implicitKey && !inFlow && type !== Scalar.Scalar.PLAIN && value.includes("\n")) {
        return blockString(item, ctx, onComment, onChompKeep);
      }
      if (containsDocumentMarker(value)) {
        if (indent === "") {
          ctx.forceBlockIndent = true;
          return blockString(item, ctx, onComment, onChompKeep);
        } else if (implicitKey && indent === indentStep) {
          return quotedString(value, ctx);
        }
      }
      const str = value.replace(/\n+/g, `$&
${indent}`);
      if (actualString) {
        const test = (tag2) => tag2.default && tag2.tag !== "tag:yaml.org,2002:str" && tag2.test?.test(str);
        const { compat, tags } = ctx.doc.schema;
        if (tags.some(test) || compat?.some(test))
          return quotedString(value, ctx);
      }
      return implicitKey ? str : foldFlowLines.foldFlowLines(str, indent, foldFlowLines.FOLD_FLOW, getFoldOptions(ctx, false));
    }
    function stringifyString(item, ctx, onComment, onChompKeep) {
      const { implicitKey, inFlow } = ctx;
      const ss = typeof item.value === "string" ? item : Object.assign({}, item, { value: String(item.value) });
      let { type } = item;
      if (type !== Scalar.Scalar.QUOTE_DOUBLE) {
        if (/[\x00-\x08\x0b-\x1f\x7f-\x9f\u{D800}-\u{DFFF}]/u.test(ss.value))
          type = Scalar.Scalar.QUOTE_DOUBLE;
      }
      const _stringify = (_type) => {
        switch (_type) {
          case Scalar.Scalar.BLOCK_FOLDED:
          case Scalar.Scalar.BLOCK_LITERAL:
            return implicitKey || inFlow ? quotedString(ss.value, ctx) : blockString(ss, ctx, onComment, onChompKeep);
          case Scalar.Scalar.QUOTE_DOUBLE:
            return doubleQuotedString(ss.value, ctx);
          case Scalar.Scalar.QUOTE_SINGLE:
            return singleQuotedString(ss.value, ctx);
          case Scalar.Scalar.PLAIN:
            return plainString(ss, ctx, onComment, onChompKeep);
          default:
            return null;
        }
      };
      let res = _stringify(type);
      if (res === null) {
        const { defaultKeyType, defaultStringType } = ctx.options;
        const t = implicitKey && defaultKeyType || defaultStringType;
        res = _stringify(t);
        if (res === null)
          throw new Error(`Unsupported default string type ${t}`);
      }
      return res;
    }
    exports.stringifyString = stringifyString;
  }
});

// ../../node_modules/yaml/dist/stringify/stringify.js
var require_stringify = __commonJS({
  "../../node_modules/yaml/dist/stringify/stringify.js"(exports) {
    "use strict";
    var anchors = require_anchors();
    var identity = require_identity();
    var stringifyComment = require_stringifyComment();
    var stringifyString = require_stringifyString();
    function createStringifyContext(doc, options) {
      const opt = Object.assign({
        blockQuote: true,
        commentString: stringifyComment.stringifyComment,
        defaultKeyType: null,
        defaultStringType: "PLAIN",
        directives: null,
        doubleQuotedAsJSON: false,
        doubleQuotedMinMultiLineLength: 40,
        falseStr: "false",
        flowCollectionPadding: true,
        indentSeq: true,
        lineWidth: 80,
        minContentWidth: 20,
        nullStr: "null",
        simpleKeys: false,
        singleQuote: null,
        trailingComma: false,
        trueStr: "true",
        verifyAliasOrder: true
      }, doc.schema.toStringOptions, options);
      let inFlow;
      switch (opt.collectionStyle) {
        case "block":
          inFlow = false;
          break;
        case "flow":
          inFlow = true;
          break;
        default:
          inFlow = null;
      }
      return {
        anchors: /* @__PURE__ */ new Set(),
        doc,
        flowCollectionPadding: opt.flowCollectionPadding ? " " : "",
        indent: "",
        indentStep: typeof opt.indent === "number" ? " ".repeat(opt.indent) : "  ",
        inFlow,
        options: opt
      };
    }
    function getTagObject(tags, item) {
      if (item.tag) {
        const match = tags.filter((t) => t.tag === item.tag);
        if (match.length > 0)
          return match.find((t) => t.format === item.format) ?? match[0];
      }
      let tagObj = void 0;
      let obj;
      if (identity.isScalar(item)) {
        obj = item.value;
        let match = tags.filter((t) => t.identify?.(obj));
        if (match.length > 1) {
          const testMatch = match.filter((t) => t.test);
          if (testMatch.length > 0)
            match = testMatch;
        }
        tagObj = match.find((t) => t.format === item.format) ?? match.find((t) => !t.format);
      } else {
        obj = item;
        tagObj = tags.find((t) => t.nodeClass && obj instanceof t.nodeClass);
      }
      if (!tagObj) {
        const name = obj?.constructor?.name ?? (obj === null ? "null" : typeof obj);
        throw new Error(`Tag not resolved for ${name} value`);
      }
      return tagObj;
    }
    function stringifyProps(node, tagObj, { anchors: anchors$1, doc }) {
      if (!doc.directives)
        return "";
      const props = [];
      const anchor = (identity.isScalar(node) || identity.isCollection(node)) && node.anchor;
      if (anchor && anchors.anchorIsValid(anchor)) {
        anchors$1.add(anchor);
        props.push(`&${anchor}`);
      }
      const tag2 = node.tag ?? (tagObj.default ? null : tagObj.tag);
      if (tag2)
        props.push(doc.directives.tagString(tag2));
      return props.join(" ");
    }
    function stringify(item, ctx, onComment, onChompKeep) {
      if (identity.isPair(item))
        return item.toString(ctx, onComment, onChompKeep);
      if (identity.isAlias(item)) {
        if (ctx.doc.directives)
          return item.toString(ctx);
        if (ctx.resolvedAliases?.has(item)) {
          throw new TypeError(`Cannot stringify circular structure without alias nodes`);
        } else {
          if (ctx.resolvedAliases)
            ctx.resolvedAliases.add(item);
          else
            ctx.resolvedAliases = /* @__PURE__ */ new Set([item]);
          item = item.resolve(ctx.doc);
        }
      }
      let tagObj = void 0;
      const node = identity.isNode(item) ? item : ctx.doc.createNode(item, { onTagObj: (o) => tagObj = o });
      tagObj ?? (tagObj = getTagObject(ctx.doc.schema.tags, node));
      const props = stringifyProps(node, tagObj, ctx);
      if (props.length > 0)
        ctx.indentAtStart = (ctx.indentAtStart ?? 0) + props.length + 1;
      const str = typeof tagObj.stringify === "function" ? tagObj.stringify(node, ctx, onComment, onChompKeep) : identity.isScalar(node) ? stringifyString.stringifyString(node, ctx, onComment, onChompKeep) : node.toString(ctx, onComment, onChompKeep);
      if (!props)
        return str;
      return identity.isScalar(node) || str[0] === "{" || str[0] === "[" ? `${props} ${str}` : `${props}
${ctx.indent}${str}`;
    }
    exports.createStringifyContext = createStringifyContext;
    exports.stringify = stringify;
  }
});

// ../../node_modules/yaml/dist/stringify/stringifyPair.js
var require_stringifyPair = __commonJS({
  "../../node_modules/yaml/dist/stringify/stringifyPair.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Scalar = require_Scalar();
    var stringify = require_stringify();
    var stringifyComment = require_stringifyComment();
    function stringifyPair({ key, value }, ctx, onComment, onChompKeep) {
      const { allNullValues, doc, indent, indentStep, options: { commentString, indentSeq, simpleKeys } } = ctx;
      let keyComment = identity.isNode(key) && key.comment || null;
      if (simpleKeys) {
        if (keyComment) {
          throw new Error("With simple keys, key nodes cannot have comments");
        }
        if (identity.isCollection(key) || !identity.isNode(key) && typeof key === "object") {
          const msg = "With simple keys, collection cannot be used as a key value";
          throw new Error(msg);
        }
      }
      let explicitKey = !simpleKeys && (!key || keyComment && value == null && !ctx.inFlow || identity.isCollection(key) || (identity.isScalar(key) ? key.type === Scalar.Scalar.BLOCK_FOLDED || key.type === Scalar.Scalar.BLOCK_LITERAL : typeof key === "object"));
      ctx = Object.assign({}, ctx, {
        allNullValues: false,
        implicitKey: !explicitKey && (simpleKeys || !allNullValues),
        indent: indent + indentStep
      });
      let keyCommentDone = false;
      let chompKeep = false;
      let str = stringify.stringify(key, ctx, () => keyCommentDone = true, () => chompKeep = true);
      if (!explicitKey && !ctx.inFlow && str.length > 1024) {
        if (simpleKeys)
          throw new Error("With simple keys, single line scalar must not span more than 1024 characters");
        explicitKey = true;
      }
      if (ctx.inFlow) {
        if (allNullValues || value == null) {
          if (keyCommentDone && onComment)
            onComment();
          return str === "" ? "?" : explicitKey ? `? ${str}` : str;
        }
      } else if (allNullValues && !simpleKeys || value == null && explicitKey) {
        str = `? ${str}`;
        if (keyComment && !keyCommentDone) {
          str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment));
        } else if (chompKeep && onChompKeep)
          onChompKeep();
        return str;
      }
      if (keyCommentDone)
        keyComment = null;
      if (explicitKey) {
        if (keyComment)
          str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment));
        str = `? ${str}
${indent}:`;
      } else {
        str = `${str}:`;
        if (keyComment)
          str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment));
      }
      let vsb, vcb, valueComment;
      if (identity.isNode(value)) {
        vsb = !!value.spaceBefore;
        vcb = value.commentBefore;
        valueComment = value.comment;
      } else {
        vsb = false;
        vcb = null;
        valueComment = null;
        if (value && typeof value === "object")
          value = doc.createNode(value);
      }
      ctx.implicitKey = false;
      if (!explicitKey && !keyComment && identity.isScalar(value))
        ctx.indentAtStart = str.length + 1;
      chompKeep = false;
      if (!indentSeq && indentStep.length >= 2 && !ctx.inFlow && !explicitKey && identity.isSeq(value) && !value.flow && !value.tag && !value.anchor) {
        ctx.indent = ctx.indent.substring(2);
      }
      let valueCommentDone = false;
      const valueStr = stringify.stringify(value, ctx, () => valueCommentDone = true, () => chompKeep = true);
      let ws = " ";
      if (keyComment || vsb || vcb) {
        ws = vsb ? "\n" : "";
        if (vcb) {
          const cs = commentString(vcb);
          ws += `
${stringifyComment.indentComment(cs, ctx.indent)}`;
        }
        if (valueStr === "" && !ctx.inFlow) {
          if (ws === "\n" && valueComment)
            ws = "\n\n";
        } else {
          ws += `
${ctx.indent}`;
        }
      } else if (!explicitKey && identity.isCollection(value)) {
        const vs0 = valueStr[0];
        const nl0 = valueStr.indexOf("\n");
        const hasNewline = nl0 !== -1;
        const flow = ctx.inFlow ?? value.flow ?? value.items.length === 0;
        if (hasNewline || !flow) {
          let hasPropsLine = false;
          if (hasNewline && (vs0 === "&" || vs0 === "!")) {
            let sp0 = valueStr.indexOf(" ");
            if (vs0 === "&" && sp0 !== -1 && sp0 < nl0 && valueStr[sp0 + 1] === "!") {
              sp0 = valueStr.indexO…232152 tokens truncated…ssCurrentV2 = priorClaimlessCurrentV2Fingerprint();
    const priorOwnerfulV2 = priorOwnerfulV2Fingerprint();
    const historicalV2 = historicalV2Fingerprint();
    const emptyV2 = emptyV2Fingerprint();
    const currentQuarantine = currentQuarantineFingerprint();
    const oldQuarantine = legacyQuarantineFingerprint();
    const noQuarantine = emptyQuarantineFingerprint();
    const recognizedClaimlessMigration = (actualV2 === priorClaimlessCurrentV2 || actualV2 === priorOwnerfulV2) && actualDecisionClaims === noDecisionClaims && actualLegacyPreclaimProvenance === noLegacyPreclaimProvenance && actualQuarantine !== oldQuarantine;
    if (actualLegacyPreclaimProvenance !== noLegacyPreclaimProvenance && actualLegacyPreclaimProvenance !== currentLegacyPreclaimProvenance) {
      throw new DomainError(
        "INTERNAL",
        "Durable review legacy preclaim provenance schema fingerprint is unknown or weakened."
      );
    }
    if ((actualV2 === priorClaimlessCurrentV2 || actualV2 === priorOwnerfulV2) && !recognizedClaimlessMigration && actualQuarantine !== oldQuarantine) {
      throw new DomainError(
        "INTERNAL",
        "Durable review claimless schema is not an exact recognized historical upgrade."
      );
    }
    if (actualV2 === currentV2 && actualDecisionClaims !== currentDecisionClaims) {
      throw new DomainError(
        "INTERNAL",
        "Durable review current schema is missing its exact decision-claim surface."
      );
    }
    if (actualV2 === emptyV2) {
      if (actualQuarantine !== noQuarantine) {
        throw new DomainError("INTERNAL", "Durable review quarantine exists without its exact owning schema.");
      }
      db.exec(V2_SCHEMA);
      installCurrentV2Triggers(db, false);
    } else if (actualV2 === historicalV2) {
      if (actualQuarantine !== noQuarantine) {
        throw new DomainError("INTERNAL", "Historical durable review schema has an unexpected quarantine surface.");
      }
      rebuildAsQuarantine(db, historicalV2, false);
    } else if (actualV2 === currentV2 || actualV2 === priorClaimlessCurrentV2 || actualV2 === priorOwnerfulV2) {
      if (actualQuarantine === oldQuarantine) {
        rebuildAsQuarantine(db, actualV2, true);
      } else if (actualQuarantine !== noQuarantine && actualQuarantine !== currentQuarantine) {
        throw new DomainError("INTERNAL", "Durable review quarantine schema fingerprint is unknown or weakened.");
      } else if (actualV2 === priorClaimlessCurrentV2 || actualV2 === priorOwnerfulV2) {
        dropKnownV2Triggers(db);
        installCurrentV2Triggers(db, actualQuarantine === currentQuarantine);
      }
    } else {
      throw new DomainError("INTERNAL", "Durable review schema fingerprint is unknown or weakened.");
    }
    const migratedLegacyPreclaimProvenance = schemaFingerprint(
      db,
      [LEGACY_PRECLAIM_PROVENANCE_TABLE_NAME]
    );
    if (migratedLegacyPreclaimProvenance === noLegacyPreclaimProvenance) {
      if (recognizedClaimlessMigration) {
        installLegacyPreclaimProvenance(db, actualV2);
      } else {
        db.exec(LEGACY_PRECLAIM_PROVENANCE_SCHEMA);
        db.exec(legacyPreclaimProvenanceTriggerSql());
      }
    } else if (migratedLegacyPreclaimProvenance !== currentLegacyPreclaimProvenance) {
      throw new DomainError(
        "INTERNAL",
        "Durable review legacy preclaim provenance changed during migration."
      );
    }
    const migratedDecisionClaims = schemaFingerprint(
      db,
      [DECISION_CLAIM_TABLE_NAME]
    );
    if (migratedDecisionClaims === noDecisionClaims) {
      db.exec(DECISION_CLAIM_SCHEMA);
      db.exec(decisionClaimTriggerSql());
    } else if (migratedDecisionClaims !== currentDecisionClaims) {
      throw new DomainError(
        "INTERNAL",
        "Durable review decision-claim schema fingerprint is unknown or weakened."
      );
    }
    if (options.migrationFaultInjection === "after-trigger-installation") {
      throw new DomainError("INTERNAL", "Injected durable review migration failure.");
    }
    if (schemaFingerprint(db, V2_TABLE_NAMES) !== currentV2) {
      throw new DomainError("INTERNAL", "Durable review migration did not install the exact current schema.");
    }
    if (schemaFingerprint(db, [LEGACY_TABLE_NAME]) !== normalizedLegacy) {
      throw new DomainError("INTERNAL", "Durable review migration did not install the exact normalized legacy schema.");
    }
    if (schemaFingerprint(db, [DECISION_CLAIM_TABLE_NAME]) !== currentDecisionClaims) {
      throw new DomainError(
        "INTERNAL",
        "Durable review migration did not install the exact decision-claim schema."
      );
    }
    if (schemaFingerprint(db, [LEGACY_PRECLAIM_PROVENANCE_TABLE_NAME]) !== currentLegacyPreclaimProvenance) {
      throw new DomainError(
        "INTERNAL",
        "Durable review migration did not install exact legacy preclaim provenance."
      );
    }
    const finalQuarantine = schemaFingerprint(db, [QUARANTINE_TABLE_NAME]);
    if (finalQuarantine !== noQuarantine && finalQuarantine !== currentQuarantine) {
      throw new DomainError("INTERNAL", "Durable review migration did not install the exact quarantine schema.");
    }
    if (db.prepare("PRAGMA foreign_key_check").all().length > 0) {
      throw new DomainError("INTERNAL", "Durable review migration failed foreign-key validation.");
    }
    db.exec("COMMIT");
  } catch (error51) {
    db.exec("ROLLBACK");
    throw error51;
  }
}
function ownerValues(owner) {
  const valid = DurableReviewOwnerSchema.parse(owner);
  return [valid.tenantId, valid.issuer, valid.subject, valid.scope];
}
function pendingEntry(row) {
  const record2 = PendingDurableReviewRecordSchema.parse(JSON.parse(row.record_json));
  const rowOwner = DurableReviewOwnerSchema.parse({
    tenantId: row.owner_tenant_id,
    issuer: row.owner_issuer,
    subject: row.owner_subject,
    scope: row.owner_scope
  });
  if (row.review_id !== record2.reviewId || row.created_at_utc !== record2.createdAtUtc || row.domain_id !== record2.intake.domainId || row.source_id !== record2.intake.source.sourceId || row.input_id !== record2.intake.input.inputId || canonicalize(rowOwner) !== canonicalize(record2.owner)) {
    throw new DomainError("REQUEST_INVALID", "Stored durable review columns do not bind to its immutable record.");
  }
  return { seq: row.seq, reviewId: row.review_id, createdAtUtc: row.created_at_utc, domainId: row.domain_id, sourceId: row.source_id, inputId: row.input_id, record: record2 };
}
function resolutionEntry(row, pending, claim, legacyProvenance) {
  const resolution = DurableReviewResolutionSchema.parse(JSON.parse(row.resolution_json));
  if (resolution.reviewId !== row.review_id || resolution.resolvedAtUtc !== row.resolved_at_utc || resolution.receipt.receiptId !== row.receipt_id || resolution.receipt.receiptSha256 !== row.receipt_sha256 || canonicalize(pending.owner) !== canonicalize(DurableReviewOwnerSchema.parse({
    tenantId: row.owner_tenant_id,
    issuer: row.owner_issuer,
    subject: row.owner_subject,
    scope: row.owner_scope
  }))) throw new DomainError("REQUEST_INVALID", "Stored durable resolution columns do not bind to its immutable resolution.");
  try {
    if (claim) bindServerResolutionToPendingReview(pending, claim, resolution);
    else {
      if (!legacyProvenance) {
        throw new DomainError(
          "REQUEST_INVALID",
          "The resolution has neither an immutable decision claim nor verified historical migration provenance."
        );
      }
      const allowedSourceFingerprints = /* @__PURE__ */ new Set([
        priorClaimlessCurrentV2Fingerprint(),
        priorOwnerfulV2Fingerprint()
      ]);
      if (legacyProvenance.review_id !== row.review_id || legacyProvenance.owner_tenant_id !== row.owner_tenant_id || legacyProvenance.owner_issuer !== row.owner_issuer || legacyProvenance.owner_subject !== row.owner_subject || legacyProvenance.owner_scope !== row.owner_scope || legacyProvenance.receipt_id !== row.receipt_id || legacyProvenance.receipt_sha256 !== row.receipt_sha256 || legacyProvenance.resolution_row_sha256 !== resolutionRowSha256(row) || !allowedSourceFingerprints.has(
        legacyProvenance.source_schema_fingerprint
      )) {
        throw new DomainError(
          "REQUEST_INVALID",
          "The resolution does not match its verified historical migration provenance."
        );
      }
      readLegacyPreclaimResolution(pending, resolution);
    }
  } catch (error51) {
    throw new DomainError("REQUEST_INVALID", `Stored durable resolution does not bind to its immutable parent: ${error51 instanceof Error ? error51.message : "invalid binding"}`);
  }
  return {
    seq: row.seq,
    reviewId: row.review_id,
    resolvedAtUtc: row.resolved_at_utc,
    receiptId: row.receipt_id,
    receiptSha256: row.receipt_sha256,
    claimBinding: claim ? "verified-claim" : "verified-legacy-migration",
    resolution
  };
}
function decisionClaimEntry(row, pending) {
  const claim = DurableReviewDecisionClaimSchema.parse(JSON.parse(row.claim_json));
  const rowOwner = DurableReviewOwnerSchema.parse({
    tenantId: row.owner_tenant_id,
    issuer: row.owner_issuer,
    subject: row.owner_subject,
    scope: row.owner_scope
  });
  if (claim.reviewId !== row.review_id || canonicalize(claim.owner) !== canonicalize(rowOwner) || canonicalize(claim.owner) !== canonicalize(pending.owner) || claim.decision !== row.decision || claim.claimedAtUtc !== row.claimed_at_utc || claim.receiptId !== row.receipt_id) {
    throw new DomainError(
      "REQUEST_INVALID",
      "Stored durable decision claim columns do not bind to its immutable claim."
    );
  }
  return {
    seq: row.seq,
    reviewId: row.review_id,
    decision: row.decision,
    claimedAtUtc: row.claimed_at_utc,
    receiptId: row.receipt_id,
    claim
  };
}
function legacyEntry(row) {
  return { seq: row.seq, reviewId: row.review_id, createdAtUtc: row.created_at_utc, domainId: row.domain_id, sourceId: row.source_id, inputId: row.input_id, receiptId: row.receipt_id, receiptSha256: row.receipt_sha256, record: DurableReviewRecordSchema.parse(JSON.parse(row.record_json)) };
}
function limitOf(raw) {
  return Math.min(Math.max(Math.trunc(raw ?? DEFAULT_LIST_LIMIT2), 1), MAX_LIST_LIMIT2);
}
function samePendingRequest(left, right) {
  const requestFields = (record2) => ({
    recordVersion: record2.recordVersion,
    reviewId: record2.reviewId,
    owner: record2.owner,
    session: record2.session,
    intake: record2.intake,
    storage: record2.storage
  });
  return canonicalize(requestFields(left)) === canonicalize(requestFields(right));
}
var DurableReviewStore = class _DurableReviewStore {
  #db;
  #writes = Promise.resolve();
  constructor(db) {
    this.#db = db;
  }
  static open(path9, options = {}) {
    const db = openDatabase2(path9);
    try {
      db.exec("PRAGMA journal_mode = WAL");
      db.exec("PRAGMA synchronous = FULL");
      db.exec("PRAGMA foreign_keys = ON");
      db.exec("PRAGMA recursive_triggers = ON");
      db.exec("PRAGMA busy_timeout = 5000");
      initializeSchema(db, options);
      return new _DurableReviewStore(db);
    } catch (error51) {
      db.close();
      throw error51;
    }
  }
  close() {
    this.#db.close();
  }
  /** Number of v2 pending intake records, never historical v1 resolved rows. */
  count() {
    return external_exports.strictObject({ count: external_exports.number().int().nonnegative() }).parse(this.#db.prepare("SELECT count(*) AS count FROM durable_review_pending_records").get()).count;
  }
  legacyCount() {
    return external_exports.strictObject({ count: external_exports.number().int().nonnegative() }).parse(this.#db.prepare("SELECT count(*) AS count FROM durable_review_records").get()).count;
  }
  async appendPending(raw) {
    const accepted = await acceptPendingDurableReviewRecordForPersistence(raw);
    return this.#queue(() => this.#appendPending(accepted));
  }
  #appendPending(record2) {
    const existing = this.get(record2.reviewId, record2.owner);
    if (existing) {
      if (samePendingRequest(existing.record, record2)) return existing;
      throw new DomainError("REQUEST_INVALID", `Review ${record2.reviewId} already records different immutable metadata.`);
    }
    try {
      this.#db.prepare("INSERT INTO durable_review_pending_records (review_id, created_at_utc, domain_id, source_id, input_id, owner_tenant_id, owner_issuer, owner_subject, owner_scope, record_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
        record2.reviewId,
        record2.createdAtUtc,
        record2.intake.domainId,
        record2.intake.source.sourceId,
        record2.intake.input.inputId,
        ...ownerValues(record2.owner),
        canonicalize(record2)
      );
    } catch (error51) {
      const raced = this.get(record2.reviewId, record2.owner);
      if (raced) {
        if (samePendingRequest(raced.record, record2)) return raced;
        throw new DomainError("REQUEST_INVALID", `Review ${record2.reviewId} already records different immutable metadata.`);
      }
      throw error51;
    }
    const inserted = this.get(record2.reviewId, record2.owner);
    if (!inserted) throw new DomainError("INTERNAL", "The review store accepted a pending record but could not read it back.");
    return inserted;
  }
  /** Append a receipt binding only after the server has recomputed its verdict. */
  async bindServerResolution(reviewId, owner, raw) {
    const pending = this.get(reviewId, owner);
    if (!pending) throw new DomainError("REQUEST_INVALID", `No pending durable review exists for ${reviewId}.`);
    const claim = this.getDecisionClaim(reviewId, owner);
    if (!claim) {
      throw new DomainError(
        "ILLEGAL_TRANSITION",
        `Review ${reviewId} has no immutable decision claim.`
      );
    }
    const accepted = bindServerResolutionToPendingReview(pending.record, claim.claim, raw);
    return this.#queue(() => this.#appendResolution(pending.record, accepted));
  }
  /**
   * Claim and complete the audit-first decision sequence across every process
   * sharing this review database.
   *
   * The immutable claim is appended before receipt issuance. Its stable
   * receipt identity makes retries idempotent at the ledger boundary: a crash
   * before ledger append can retry the same record, while a crash after ledger
   * append can reconcile that exact record and append only the missing review
   * resolution. Conflicting human intent can never replace the first claim.
   */
  async resolvePending(reviewId, owner, request, preflight, issue2) {
    const id = IdSchema.parse(reviewId);
    const validOwner = DurableReviewOwnerSchema.parse(owner);
    const pending = this.get(id, validOwner);
    if (!pending) {
      throw new DomainError("REQUEST_INVALID", `No pending durable review exists for ${id}.`);
    }
    await preflight(pending.record);
    const claim = this.#claimDecision(
      pending.record,
      request.decision,
      request.claimedAtUtc,
      request.approverEmail
    );
    const issued = await issue2(pending.record, claim.claim);
    const accepted = bindServerResolutionToPendingReview(
      pending.record,
      claim.claim,
      issued.resolution
    );
    return {
      outcome: issued.outcome,
      resolution: await this.#queue(() => this.#appendResolution(pending.record, accepted))
    };
  }
  #claimDecision(pending, decision, claimedAtUtc, approverEmail) {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      if (!this.get(pending.reviewId, pending.owner)) {
        throw new DomainError(
          "REQUEST_INVALID",
          `No pending durable review exists for ${pending.reviewId}.`
        );
      }
      if (this.getResolution(pending.reviewId, pending.owner)) {
        throw new DomainError(
          "ILLEGAL_TRANSITION",
          `Review ${pending.reviewId} already has an immutable resolution.`
        );
      }
      const existing = this.getDecisionClaim(pending.reviewId, pending.owner);
      if (existing) {
        if (existing.decision !== decision) {
          throw new DomainError(
            "ILLEGAL_TRANSITION",
            `Review ${pending.reviewId} already has a conflicting immutable decision claim.`
          );
        }
        this.#db.exec("COMMIT");
        return existing;
      }
      const claim = DurableReviewDecisionClaimSchema.parse({
        claimVersion: "1",
        reviewId: pending.reviewId,
        owner: pending.owner,
        approverEmail,
        decision,
        claimedAtUtc,
        receiptId: `rcpt-${randomUUID()}`,
        receiptCreatedAtUtc: claimedAtUtc,
        receiptSignedAtUtc: claimedAtUtc
      });
      this.#db.prepare(
        `INSERT INTO durable_review_decision_claims
          (review_id, owner_tenant_id, owner_issuer, owner_subject, owner_scope,
           decision, claimed_at_utc, receipt_id, claim_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        claim.reviewId,
        ...ownerValues(claim.owner),
        claim.decision,
        claim.claimedAtUtc,
        claim.receiptId,
        canonicalize(claim)
      );
      const inserted = this.getDecisionClaim(pending.reviewId, pending.owner);
      if (!inserted) {
        throw new DomainError(
          "INTERNAL",
          "The review store accepted a decision claim but could not read it back."
        );
      }
      this.#db.exec("COMMIT");
      return inserted;
    } catch (error51) {
      this.#db.exec("ROLLBACK");
      throw error51;
    }
  }
  #appendResolution(pending, resolution) {
    const existing = this.getResolution(pending.reviewId, pending.owner);
    if (existing) {
      if (canonicalize(existing.resolution) === canonicalize(resolution)) return existing;
      throw new DomainError("ILLEGAL_TRANSITION", `Review ${pending.reviewId} already records a different immutable resolution.`);
    }
    try {
      this.#db.prepare("INSERT INTO durable_review_resolutions (review_id, resolved_at_utc, owner_tenant_id, owner_issuer, owner_subject, owner_scope, receipt_id, receipt_sha256, resolution_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(resolution.reviewId, resolution.resolvedAtUtc, ...ownerValues(pending.owner), resolution.receipt.receiptId, resolution.receipt.receiptSha256, canonicalize(resolution));
    } catch (error51) {
      const raced = this.getResolution(pending.reviewId, pending.owner);
      if (raced) {
        if (canonicalize(raced.resolution) === canonicalize(resolution)) return raced;
        throw new DomainError("ILLEGAL_TRANSITION", `Review ${pending.reviewId} already records a different immutable resolution.`);
      }
      const collision = this.#db.prepare("SELECT review_id FROM durable_review_resolutions WHERE receipt_id = ? OR receipt_sha256 = ? LIMIT 1").get(resolution.receipt.receiptId, resolution.receipt.receiptSha256);
      if (collision) throw new DomainError("REQUEST_INVALID", `Receipt ${resolution.receipt.receiptId} or its content hash is already bound to review ${external_exports.strictObject({ review_id: IdSchema }).parse(collision).review_id}.`);
      throw error51;
    }
    const inserted = this.getResolution(pending.reviewId, pending.owner);
    if (!inserted) throw new DomainError("INTERNAL", "The review store accepted a resolution but could not read it back.");
    return inserted;
  }
  // Compatibility-only v1 append. New endpoints must call appendPending; v1
  // rows stay readable but never appear in the pending queue.
  async append(raw) {
    const accepted = await acceptDurableReviewRecordForPersistence(raw);
    return this.#queue(() => this.#appendLegacy(accepted));
  }
  #appendLegacy(record2) {
    const old = this.getLegacy(record2.reviewId);
    if (old) {
      if (canonicalize(old.record) === canonicalize(record2)) return old;
      throw new DomainError("REQUEST_INVALID", `Review ${record2.reviewId} already records different immutable metadata.`);
    }
    try {
      this.#db.prepare("INSERT INTO durable_review_records (review_id, created_at_utc, domain_id, source_id, input_id, receipt_id, receipt_sha256, record_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(record2.reviewId, record2.createdAtUtc, record2.intake.domainId, record2.intake.source.sourceId, record2.intake.input.inputId, record2.receipt.receiptId, record2.receipt.receiptSha256, canonicalize(record2));
    } catch (error51) {
      const raced = this.getLegacy(record2.reviewId);
      if (raced) {
        if (canonicalize(raced.record) === canonicalize(record2)) return raced;
        throw new DomainError("REQUEST_INVALID", `Review ${record2.reviewId} already records different immutable metadata.`);
      }
      throw error51;
    }
    const inserted = this.getLegacy(record2.reviewId);
    if (!inserted) throw new DomainError("INTERNAL", "The legacy review store accepted a record but could not read it back.");
    return inserted;
  }
  #queue(task) {
    const result = this.#writes.then(task, task);
    this.#writes = result.then(() => void 0, () => void 0);
    return result;
  }
  /**
   * An owner-scoped read deliberately returns null for another principal's
   * review.  HTTP maps that to the same 404 as a missing id, so review ids do
   * not become an enumeration oracle.
   */
  get(reviewId, owner) {
    const row = this.#db.prepare("SELECT * FROM durable_review_pending_records WHERE review_id = ? AND owner_tenant_id = ? AND owner_issuer = ? AND owner_subject = ? AND owner_scope = ?").get(IdSchema.parse(reviewId), ...ownerValues(owner));
    return row ? pendingEntry(PendingRowSchema.parse(row)) : null;
  }
  getDecisionClaim(reviewId, owner) {
    const id = IdSchema.parse(reviewId);
    const validOwner = DurableReviewOwnerSchema.parse(owner);
    const row = this.#db.prepare(
      `SELECT * FROM durable_review_decision_claims
       WHERE review_id = ?
         AND owner_tenant_id = ?
         AND owner_issuer = ?
         AND owner_subject = ?
         AND owner_scope = ?`
    ).get(id, ...ownerValues(validOwner));
    if (!row) return null;
    const pending = this.get(id, validOwner);
    if (!pending) {
      throw new DomainError(
        "REQUEST_INVALID",
        `Stored durable decision claim ${id} has no immutable pending parent.`
      );
    }
    return decisionClaimEntry(DecisionClaimRowSchema.parse(row), pending.record);
  }
  getResolution(reviewId, owner) {
    const id = IdSchema.parse(reviewId);
    const validOwner = DurableReviewOwnerSchema.parse(owner);
    const row = this.#db.prepare("SELECT * FROM durable_review_resolutions WHERE review_id = ? AND owner_tenant_id = ? AND owner_issuer = ? AND owner_subject = ? AND owner_scope = ?").get(id, ...ownerValues(validOwner));
    if (!row) return null;
    const pending = this.get(id, validOwner);
    if (!pending) throw new DomainError("REQUEST_INVALID", `Stored durable resolution ${id} has no immutable pending parent.`);
    const claim = this.getDecisionClaim(id, validOwner);
    const legacyProvenance = claim ? null : this.#db.prepare(
      `SELECT * FROM durable_review_legacy_preclaim_provenance
         WHERE review_id = ?
           AND owner_tenant_id = ?
           AND owner_issuer = ?
           AND owner_subject = ?
           AND owner_scope = ?`
    ).get(id, ...ownerValues(validOwner));
    return resolutionEntry(
      ResolutionRowSchema.parse(row),
      pending.record,
      claim?.claim ?? null,
      legacyProvenance ? LegacyPreclaimProvenanceRowSchema.parse(legacyProvenance) : null
    );
  }
  getLegacy(reviewId) {
    const row = this.#db.prepare("SELECT * FROM durable_review_records WHERE review_id = ?").get(IdSchema.parse(reviewId));
    return row ? legacyEntry(LegacyRowSchema.parse(row)) : null;
  }
  list(options = {}, owner) {
    const valid = ListOptionsSchema.parse(options);
    const clauses = ["owner_tenant_id = ?", "owner_issuer = ?", "owner_subject = ?", "owner_scope = ?"];
    const params = [...ownerValues(owner)];
    if (valid.domainId) {
      clauses.push("domain_id = ?");
      params.push(valid.domainId);
    }
    if (valid.sourceId) {
      clauses.push("source_id = ?");
      params.push(valid.sourceId);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return this.#db.prepare(`SELECT * FROM durable_review_pending_records ${where} ORDER BY seq DESC LIMIT ${limitOf(valid.limit)}`).all(...params).map((row) => pendingEntry(PendingRowSchema.parse(row)));
  }
  listLegacy(options = {}) {
    const valid = ListOptionsSchema.parse(options);
    const clauses = [];
    const params = [];
    if (valid.domainId) {
      clauses.push("domain_id = ?");
      params.push(valid.domainId);
    }
    if (valid.sourceId) {
      clauses.push("source_id = ?");
      params.push(valid.sourceId);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return this.#db.prepare(`SELECT * FROM durable_review_records ${where} ORDER BY seq DESC LIMIT ${limitOf(valid.limit)}`).all(...params).map((row) => legacyEntry(LegacyRowSchema.parse(row)));
  }
  /**
   * Quarantine hashes bind the complete retained evidence envelope. They
   * provide an internal consistency check only: because this SQLite database
   * has no signed external migration anchor, they do not prove pre-migration
   * origin, authorship, or an authenticated owner.
   */
  listMigrationQuarantine() {
    const table = this.#db.prepare(
      "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?"
    ).get(QUARANTINE_TABLE_NAME);
    if (!table) return [];
    return this.#db.prepare(
      "SELECT * FROM durable_review_v2_migration_quarantine ORDER BY quarantine_id"
    ).all().map((raw) => {
      const row = QuarantineRowSchema.parse(raw);
      return {
        quarantineId: row.quarantine_id,
        rowKind: row.row_kind,
        oldSeq: row.old_seq,
        reviewId: row.review_id,
        rowJson: row.row_json,
        reason: row.reason,
        migrationVersion: row.migration_version,
        sourceSchemaFingerprint: row.source_schema_fingerprint,
        rowSha256: row.row_sha256
      };
    });
  }
  verifyMigrationQuarantine() {
    const errors = [];
    let entries = [];
    try {
      entries = this.listMigrationQuarantine();
    } catch (error51) {
      return {
        valid: false,
        entryCount: 0,
        errors: [`Quarantine rows do not match the exact evidence schema: ${error51 instanceof Error ? error51.message : "invalid row"}`]
      };
    }
    const quarantineExists = this.#db.prepare(
      "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?"
    ).get(QUARANTINE_TABLE_NAME);
    if (quarantineExists && schemaFingerprint(this.#db, [QUARANTINE_TABLE_NAME]) !== currentQuarantineFingerprint()) {
      errors.push("Quarantine schema or append-only guards do not match the exact integrity-evidence fingerprint.");
    }
    const allowedFingerprints = /* @__PURE__ */ new Set([
      historicalV2Fingerprint(),
      priorOwnerfulV2Fingerprint(),
      priorClaimlessCurrentV2Fingerprint(),
      currentV2Fingerprint()
    ]);
    for (const entry of entries) {
      try {
        if (canonicalize(JSON.parse(entry.rowJson)) !== entry.rowJson) {
          errors.push(`Quarantine entry ${entry.quarantineId} row_json is not canonical.`);
        }
      } catch {
        errors.push(`Quarantine entry ${entry.quarantineId} row_json is not valid JSON.`);
      }
      const actual = quarantineEnvelopeSha256({
        rowKind: entry.rowKind,
        oldSeq: entry.oldSeq,
        reviewId: entry.reviewId,
        rowJson: entry.rowJson,
        reason: entry.reason,
        migrationVersion: entry.migrationVersion,
        sourceSchemaFingerprint: entry.sourceSchemaFingerprint
      });
      if (actual !== entry.rowSha256) {
        errors.push(`Quarantine entry ${entry.quarantineId} digest does not match retained row values.`);
      }
      if (entry.migrationVersion !== MIGRATION_VERSION) {
        errors.push(`Quarantine entry ${entry.quarantineId} has an unsupported migration version.`);
      }
      if (!allowedFingerprints.has(entry.sourceSchemaFingerprint)) {
        errors.push(`Quarantine entry ${entry.quarantineId} has an unknown source schema fingerprint.`);
      }
    }
    return { valid: errors.length === 0, entryCount: entries.length, errors };
  }
};

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
async function runServe(options, console2) {
  if (!options.oidcIssuer || !options.oidcAudience) {
    throw new UsageError(
      "serve needs --oidc-issuer and --oidc-audience. Every decision this API issues names\n  an approver, so it will not start without a way to establish who that is."
    );
  }
  if (options.reviewsDb && !options.signKey) {
    throw new UsageError(
      "serve --reviews-db requires --sign-key because durable review decisions must be signed."
    );
  }
  const approverPolicy = buildApproverPolicy(options);
  const ledger = Ledger.open(options.db);
  const reviews = options.reviewsDb ? DurableReviewStore.open(options.reviewsDb) : void 0;
  const signingKeyPair = options.signKey ? await importSigningKeyPair(readTextFile(options.signKey, "signing key")) : void 0;
  const server = createDecisionServer({
    ledger,
    reviews,
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
  console2.out("");
  console2.out(`  ${paint(console2.color, "bold", "ChangeSafe decision API")}`);
  console2.out(`  ${paint(console2.color, "dim", `listening on http://${options.host}:${options.port}`)}`);
  console2.out(`  ${paint(console2.color, "dim", `ledger ${options.db} \xB7 ${ledger.count()} entries`)}`);
  console2.out(`  ${paint(console2.color, "dim", `approvers verified against ${options.oidcIssuer}`)}`);
  console2.out(
    approverPolicy ? `  ${paint(console2.color, "dim", `approving restricted to ${describePolicy(approverPolicy)}`)}` : `  ${paint(console2.color, "yellow", "every identity this issuer vouches for may approve")} ${paint(console2.color, "dim", "\u2014 pass --approver or --approver-claim to narrow it")}`
  );
  console2.out(
    signingKeyPair ? `  ${paint(console2.color, "dim", "receipts are signed")}` : `  ${paint(console2.color, "yellow", "receipts are unsigned")} ${paint(console2.color, "dim", "\u2014 pass --sign-key to prove authorship")}`
  );
  console2.out(
    reviews ? `  ${paint(console2.color, "dim", `durable review queue ${options.reviewsDb} \xB7 ${reviews.count()} pending`)}` : `  ${paint(console2.color, "dim", "durable review queue disabled")} ${paint(console2.color, "dim", "\u2014 pass --reviews-db to accept POST /reviews")}`
  );
  console2.out("");
  console2.out(`  ${paint(console2.color, "dim", "This API decides and records. It cannot execute a change.")}`);
  console2.out("");
  const close = async () => {
    await new Promise((resolve) => server.close(() => resolve()));
    ledger.close();
    reviews?.close();
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
    const signed = parseOrThrow2(SignedReceiptSchema, raw, "signed receipt");
    return { receipt: signed.receipt, signature: signed.signature };
  }
  return { receipt: parseOrThrow2(ChangeReceiptSchema, raw, "receipt"), signature: null };
}
async function runVerify(options, console2) {
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
  let parsedInput;
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
    parsedInput = input;
    const actual = await hashCanonical(input);
    checks.push({
      name: "input hash",
      ok: actual === receipt.inputSha256,
      detail: actual === receipt.inputSha256 ? `matches inputSha256 (${inputId})` : "the supplied input is not what this receipt describes"
    });
  }
  if (options.proposal) {
    const domain2 = resolveDomain(options.domain);
    const proposalRaw = domain2.readProposalFile?.(options.proposal) ?? readJsonFile(options.proposal, "proposal");
    const { proposal } = domain2.parseProposal(proposalRaw, parsedInput);
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
    console2.out(
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
  console2.out("");
  console2.out(
    `  ${paint(console2.color, "bold", "ChangeSafe receipt")} ${paint(
      console2.color,
      "dim",
      `\xB7 ${receipt.receiptId}`
    )}`
  );
  console2.out(
    `  ${paint(console2.color, "dim", `decision ${receipt.decision} \xB7 risk ${receipt.riskLevel} \xB7 mode ${receipt.mode} \xB7 policies ${receipt.policyVersion}`)}`
  );
  console2.out("");
  for (const check2 of checks) {
    const unknown2 = check2.name === "signature" && signatureVerdict === "unverified";
    const mark = unknown2 ? paint(console2.color, "yellow", "?   ") : check2.ok ? paint(console2.color, "green", "ok  ") : paint(console2.color, "red", "FAIL");
    console2.out(`  ${mark}  ${check2.name.padEnd(14)} ${paint(console2.color, "dim", check2.detail)}`);
  }
  console2.out("");
  console2.out(summary(console2, ok, signatureVerdict));
  console2.out("");
  return ok ? EXIT_OK : EXIT_BLOCKED;
}
function summary(console2, ok, verdict) {
  if (!ok) return `  ${paint(console2.color, "red", "receipt failed verification")}`;
  if (verdict === "valid") {
    return `  ${paint(console2.color, "green", "receipt is intact and authentic")} \u2014 content matches and the signature is from the supplied key.`;
  }
  if (verdict === "unverified") {
    return `  ${paint(console2.color, "yellow", "receipt is internally consistent, authorship unchecked")} \u2014 the signature was not verified.`;
  }
  return `  ${paint(console2.color, "green", "receipt is internally consistent")} \u2014 integrity only; this receipt is unsigned.`;
}

// src/kubernetes-collect.ts
import { open, rename, rm } from "node:fs/promises";
import path8 from "node:path";

// ../kubernetes-collector/src/collect.ts
import { createHash as createHash2 } from "node:crypto";
var LISTERS = [
  "listDeployments",
  "listStatefulSets",
  "listDaemonSets",
  "listServices"
];
function digest(value) {
  return createHash2("sha256").update(value).digest("hex").slice(0, 32);
}
async function collectKubernetesSnapshot(options, client) {
  const namespaces = [...new Set(options.namespaces)].sort();
  if (namespaces.length === 0) throw new Error("at least one namespace is required");
  if (!Number.isInteger(options.maxResources) || options.maxResources < 1) {
    throw new Error("maxResources must be a positive integer");
  }
  const collected = [];
  const limit = () => {
    if (collected.length > options.maxResources) throw new Error("Kubernetes snapshot exceeds the resource limit");
  };
  for (const namespace of namespaces) {
    for (const method of LISTERS) {
      const resources = await client[method](namespace);
      if (!Array.isArray(resources)) throw new Error(`Kubernetes ${method} returned an invalid response`);
      collected.push(...resources);
      limit();
    }
  }
  const now = options.now();
  const seed = `${options.contextFingerprint}\0${namespaces.join("\0")}\0${now}`;
  return normalizeSnapshot({
    snapshotVersion: "changesafe-kubernetes-snapshot/v1",
    snapshotId: `snapshot-kubernetes-${digest(seed)}`,
    evidenceId: "ev-kubernetes-snapshot",
    provenance: {
      source: "cluster-api",
      collectedAtUtc: now,
      contextFingerprint: options.contextFingerprint,
      namespaces,
      serverVersion: await client.serverVersion()
    },
    resources: collected
  });
}

// ../kubernetes-collector/src/client.ts
import { createHash as createHash3 } from "node:crypto";
import { createRequire as createRequire3 } from "node:module";
var runtimeRequire = createRequire3(import.meta.url);
function loadKubernetesClient() {
  return runtimeRequire("@kubernetes/client-node");
}
function rejectCredentialPlugins(config2) {
  for (const entry of config2.users ?? []) {
    if (entry.exec !== void 0 || entry.authProvider !== void 0 || entry["auth-provider"] !== void 0) {
      throw new Error("kubeconfig exec and auth-provider credentials are not supported");
    }
  }
}
function clientFromConfiguration(k8s, config2) {
  const apps = config2.makeApiClient(k8s.AppsV1Api);
  const core = config2.makeApiClient(k8s.CoreV1Api);
  return {
    async serverVersion() {
      const version2 = await config2.makeApiClient(k8s.VersionApi).getCode();
      return version2.gitVersion ?? "unknown";
    },
    async listDeployments(namespace) {
      return (await apps.listNamespacedDeployment({ namespace })).items;
    },
    async listStatefulSets(namespace) {
      return (await apps.listNamespacedStatefulSet({ namespace })).items;
    },
    async listDaemonSets(namespace) {
      return (await apps.listNamespacedDaemonSet({ namespace })).items;
    },
    async listServices(namespace) {
      return (await core.listNamespacedService({ namespace })).items;
    }
  };
}
function createReadOnlyClientWithFingerprint(kubeconfigPath, context) {
  const loaded = loadConfiguration(kubeconfigPath, context);
  return {
    client: clientFromConfiguration(loaded.k8s, loaded.config),
    fingerprint: loaded.fingerprint
  };
}
function loadConfiguration(kubeconfigPath, context) {
  const k8s = loadKubernetesClient();
  const config2 = new k8s.KubeConfig();
  if (kubeconfigPath) config2.loadFromFile(kubeconfigPath);
  else config2.loadFromDefault();
  const selected = context ?? config2.getCurrentContext();
  if (context) config2.setCurrentContext(context);
  const entry = config2.getContexts().find((candidate) => candidate.name === selected);
  const user = config2.getUsers().find((candidate) => candidate.name === entry?.user);
  rejectCredentialPlugins({ users: user ? [user] : [] });
  const cluster = config2.getClusters().find((candidate) => candidate.name === entry?.cluster);
  if (!cluster?.server) throw new Error("kubeconfig context has no API server");
  return {
    k8s,
    config: config2,
    fingerprint: createHash3("sha256").update(`${new URL(cluster.server).origin}\0${selected}`).digest("hex")
  };
}

// src/kubernetes-collect.ts
async function runKubernetesCollect(options, console2) {
  const namespaces = [...new Set(options.namespaces ?? [])].filter(Boolean).sort();
  if (namespaces.length === 0) throw new UsageError("kubernetes collect requires at least one --namespace");
  if (!options.out) throw new UsageError("kubernetes collect requires --out <snapshot.json>");
  try {
    const loaded = options.client ? { client: options.client, fingerprint: "injected-client" } : createReadOnlyClientWithFingerprint(options.kubeconfig, options.context);
    const snapshot = await collectKubernetesSnapshot(
      {
        namespaces,
        contextFingerprint: loaded.fingerprint,
        now: options.now ?? (() => (/* @__PURE__ */ new Date()).toISOString()),
        maxResources: 2e3
      },
      loaded.client
    );
    await writeSnapshotAtomically(options.out, snapshot);
    console2.out(JSON.stringify({ snapshotId: snapshot.snapshotId, namespaces, resources: snapshot.resources.length, out: path8.resolve(options.out) }, null, 2));
    return EXIT_OK;
  } catch (error51) {
    if (error51 instanceof UsageError) throw error51;
    throw new UsageError(`Kubernetes collection failed (${classifyCollectionFailure(error51)}).`);
  }
}
function classifyCollectionFailure(error51) {
  const message = error51 instanceof Error ? error51.message.toLowerCase() : "";
  if (/403|forbidden|authorization|permission/.test(message)) return "authorization";
  if (/401|unauthori|authentication|token/.test(message)) return "authentication";
  if (/timeout|timed out|deadline|econnreset/.test(message)) return "timeout";
  return "request";
}
async function writeSnapshotAtomically(filePath, value) {
  const absolute = path8.resolve(filePath);
  const temporary = `${absolute}.${process.pid}.tmp`;
  try {
    const handle2 = await open(temporary, "wx", 384);
    try {
      await handle2.writeFile(`${JSON.stringify(value, null, 2)}
`, "utf8");
      await handle2.sync();
    } finally {
      await handle2.close();
    }
    await rename(temporary, absolute);
  } catch (error51) {
    await rm(temporary, { force: true });
    throw new UsageError(error51 instanceof Error ? `Kubernetes collection failed: ${error51.message}` : "Kubernetes collection failed");
  }
}

// src/main.ts
var HELP = `changesafe \u2014 a deterministic airlock for AI-proposed infrastructure changes

USAGE
  changesafe gate      [options]        evaluate a proposal against the safety gate
  changesafe kubernetes collect [options] acquire a namespace-scoped read-only snapshot
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
                        a Kubernetes snapshot for --domain kubernetes, or
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

KUBERNETES COLLECT OPTIONS
  --namespace <name>    namespace to read (required, repeatable)
  --kubeconfig <file>   optional kubeconfig path (default: standard lookup)
  --context <name>      optional kubeconfig context
  --out <file>          atomically write the validated snapshot (required)

Collection performs only namespace-scoped get/list reads for Deployments,
StatefulSets, DaemonSets, and Services. It rejects credential plugins and has
no apply, patch, delete, watch, exec, or cluster-wide mode.

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
  --reviews-db <file>   durable review queue; enables POST /reviews and
                        POST /reviews/:id/decisions (disabled by default)

The API recomputes findings itself rather than trusting the caller, records an
authenticated approver on every decision, and appends to the ledger before
answering. It has no execution endpoint and no anonymous mode.

Without --reviews-db, the durable review queue is disabled: /reviews and
/reviews/:id/decisions do not exist, and /decisions is the only way to
record a decision. This matches every self-hosted deployment before this
flag existed \u2014 the queue is additive, never a required upgrade.

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
  "reviews-db": { type: "string" },
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
  namespace: { type: "string", multiple: true },
  kubeconfig: { type: "string" },
  context: { type: "string" },
  help: { type: "boolean", short: "h", default: false },
  version: { type: "boolean", default: false }
};
function parseFormat(value) {
  if (value !== "pretty" && value !== "json") {
    throw new UsageError(`--format must be "pretty" or "json", got "${value}"`);
  }
  return value;
}
async function main(argv, console2) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTION_SPEC, allowPositionals: true });
  } catch (error51) {
    throw new UsageError(error51 instanceof Error ? error51.message : "invalid arguments");
  }
  const { values, positionals } = parsed;
  if (values.version) {
    console2.out(`changesafe ${CLI_PACKAGE_VERSION}`);
    return 0;
  }
  if (values.help || positionals.length === 0) {
    console2.out(HELP);
    return positionals.length === 0 && !values.help ? EXIT_USAGE : 0;
  }
  const format = parseFormat(values.format);
  const command = positionals[0];
  switch (command) {
    case "kubernetes": {
      if (positionals[1] !== "collect") throw new UsageError("use changesafe kubernetes collect");
      return runKubernetesCollect({
        namespaces: values.namespace,
        kubeconfig: values.kubeconfig,
        context: values.context,
        out: values.out
      }, console2);
    }
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
        console2
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
        console2
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
          // eval measures a model, and only the network domain has model
          // analysis (see packages/ai/src/domains.ts) — terraform and
          // kubernetes proposals are derived mechanically, not proposed.
          dir: values.dir ?? "scenarios/network",
          runs,
          report: values.report,
          format
        },
        console2
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
        console2
      );
    }
    case "keygen":
      return runKeygen(
        { out: values.out ?? "changesafe-signing-key", force: values.force, format },
        console2
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
          signKey: values["sign-key"],
          reviewsDb: values["reviews-db"]
        },
        console2
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
      if (sub === "append") return runLedgerAppend(ledgerOptions, console2);
      if (sub === "list") return runLedgerList(ledgerOptions, console2);
      if (sub === "verify") return runLedgerVerify(ledgerOptions, console2);
      throw new UsageError(`unknown ledger subcommand "${sub ?? ""}". Use append, list, or verify.`);
    }
    case "scenario": {
      const sub = positionals[1];
      if (sub === "check") {
        return runScenarioCheck(
          {
            dir: positionals[2] ?? values.dir ?? `scenarios/${values.domain}`,
            domain: values.domain,
            format
          },
          console2
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
          console2
        );
      }
      if (sub === "init") {
        const name = positionals[2];
        if (!name) throw new UsageError("scenario init needs a name: changesafe scenario init <name>");
        return runScenarioInit(
          { name, dir: values.dir ?? `scenarios/${values.domain}` },
          console2
        );
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
  const console2 = createConsole();
  try {
    return await main(argv, console2);
  } catch (error51) {
    const message = isDomainError(error51) ? error51.userMessage : error51 instanceof Error ? error51.message : "the gate failed for an unknown reason";
    console2.err("");
    console2.err(`  ${paint(console2.color, "red", "error")} ${message}`);
    console2.err("");
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
