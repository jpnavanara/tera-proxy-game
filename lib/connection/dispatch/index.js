const path = require('path');
const util = require('util');
const binarySearch = require('binary-search');
const { protocol } = require('tera-data-parser');
const log = require('../../logger');
const Wrapper = require('./dispatchWrapper');

protocol.load(require.resolve('tera-data'));

function* iterateHooks(globalHooks = [], codeHooks = []) {
  const globalHooksIterator = globalHooks[Symbol.iterator](); // .values()
  const codeHooksIterator = codeHooks[Symbol.iterator](); // .values()

  let nextGlobalHook = globalHooksIterator.next();
  let nextCodeHook = codeHooksIterator.next();

  while (!nextGlobalHook.done || !nextCodeHook.done) {
    const globalHookGroup = nextGlobalHook.value;
    const codeHookGroup = nextCodeHook.value;

    if (globalHookGroup && (!codeHookGroup || globalHookGroup.order <= codeHookGroup.order)) {
      yield* globalHookGroup.hooks;
      nextGlobalHook = globalHooksIterator.next();
    } else {
      yield* codeHookGroup.hooks;
      nextCodeHook = codeHooksIterator.next();
    }
  }
}

function tryIt(func) {
  try {
    return func();
  } catch (e) {
    return e;
  }
}

function normalizeName(name) {
  if (name === 'sF2pPremiumUserPermission') {
    return 'S_F2P_PremiumUser_Permission';
  } else if (name.indexOf('_') === -1) {
    return name.replace(/[A-Z]/g, '_$&').toUpperCase();
  } else {
    return name;
  }
}

function getHookName(hook) {
  const callbackName = hook.callback ? (hook.callback.name || '(anonymous)') : '<unknown>';
  const moduleName = hook.moduleName || '<unknown>';
  return `${callbackName} in ${moduleName}`;
}

function getMessageName(identifier, version, originalName) {
  if (typeof identifier === 'string') {
    const append = (identifier !== originalName) ? ` (original: "${originalName}")` : '';
    return `${identifier}<${version}>${append}`;
  } else if (typeof identifier === 'number') {
    const name = protocol.map.code.get(identifier) || `(opcode ${identifier})`;
    return `${name}<${version}>`;
  } else {
    return '(?)';
  }
}

function parseStack(err) {
  const stack = (err && err.stack) || '';
  return stack.split('\n').slice(1).map((line) => {
    if (line.indexOf('(eval ') !== -1) {
      // throw away eval info
      // see <https://github.com/stacktracejs/error-stack-parser/blob/d9eb56a/error-stack-parser.js#L59>
      line = line.replace(/(\(eval at [^\()]*)|(\)\,.*$)/g, '');
    }

    const match = line.match(/^\s*at (?:.+\s+\()?(?:(.+):\d+:\d+|([^)]+))\)?/);
    if (match) {
      return {
        filename: match[2] || match[1],
        source: line,
      };
    }
  }).filter(Boolean);
}

function errStack(err = new Error(), removeFront = true) {
  const stack = parseStack(err);
  const libPath = /tera-proxy-game[\\/]lib/;

  // remove node internals from end
  while (stack.length > 0 && !path.isAbsolute(stack[stack.length - 1].filename)) {
    stack.pop();
  }

  // remove tera-proxy-game internals from end
  while (stack.length > 0 && libPath.test(stack[stack.length - 1].filename)) {
    stack.pop();
  }

  if (removeFront) {
    // remove tera-proxy-game internals from front
    while (stack.length > 0 && libPath.test(stack[0].filename)) {
      stack.shift();
    }
  }

  return stack.map(frame => frame.source).join('\n');
}

class Dispatch {
  constructor(connection) {
    this.connection = connection;
    this.modules = new Map();

    // hooks:
    // { <code>:
    //   [ { <order>
    //     , hooks:
    //       [ { <code>, <filter>, <order>, <definitionVersion>, <moduleName>, <callback> }
    //       ]
    //     }
    //   ]
    // }
    this.hooks = new Map();
  }

  reset() {
    for (const name of this.modules.keys()) {
      this.unload(name);
    }

    this.modules.clear();
    this.hooks.clear();
  }

  load(name, from = module, ...args) {
    const mod = this.modules.get(name);
    if (mod) return mod;

    if (typeof from.require !== 'function' && typeof from === 'function') {
      // `from` is a function, so use itself the module constructor
      from = { require: (ModuleConstructor => () => ModuleConstructor)(from) };
    }

    try {
      const ModuleConstructor = from.require(name);
      const wrapper = new Wrapper(this, name);
      const mod = new ModuleConstructor(wrapper, ...args);
      this.modules.set(name, mod);

      log.info(`[dispatch] loaded "${name}"`);

      return mod;
    } catch (e) {
      log.error([
        `[dispatch] load: error initializing module "${name}"`,
        `error: ${e.message}`,
        errStack(e),
      ].join('\n'));
    }
  }

  unload(name) {
    const mod = this.modules.get(name);

    if (!mod) {
      log.error([
        `[dispatch] unload: cannot unload non-loaded module "${name}"`,
        errStack(),
      ].join('\n'));
      return false;
    }

    for (const orderings of this.hooks.values()) {
      for (const ordering of orderings) {
        ordering.hooks = ordering.hooks.filter(hook => hook.moduleName !== name);
      }
    }

    if (typeof mod.destructor === 'function') {
      try {
        mod.destructor();
      } catch (e) {
        log.error([
          `[dispatch] unload: error running destructor for module "${name}"`,
          `error: ${e.message}`,
          errStack(e),
        ].join('\n'));
      }
    }

    this.modules.delete(name);
    return true;
  }

  createHook(name, version, opts, cb) {
    // parse args
    if (version) {
      if (typeof version !== 'number' && typeof version !== 'string') {
        cb = opts;
        opts = version;
        version = '*';

        if (!process.env.NO_WARN_IMPLIED_VERSION) {
          log.warn([
            `[dispatch] hook: using implied latest version for "${name}"`,
            errStack(),
          ].join('\n'));
        }
      }
    }

    if (opts && typeof opts !== 'object') {
      cb = opts;
      opts = {};
    }

    if (typeof cb !== 'function') {
      cb = () => {};

      log.error([
        `[dispatch] hook: last argument not a function (given: ${typeof cb})`,
        errStack(),
      ].join('\n'));
    }

    // retrieve opcode
    let code;
    if (name === '*') {
      code = name;
      if (typeof version === 'number') {
        log.error([
          `[dispatch] hook: * hook must request version '*' or 'raw' (given: ${version})`,
          errStack(),
        ]).join('\n');

        version = '*';
      }
    } else {
      const normalizedName = normalizeName(name);
      code = protocol.map.name.get(normalizedName);
      if (code == null) {
        log.error([
          `[dispatch] hook: unrecognized hook target ${getMessageName(normalizedName, version, name)}`,
          errStack(),
        ].join('\n'));

        code = '_UNKNOWN';
      }
    }

    // check version
    if (typeof version !== 'number') {
      if (version === 'latest') version = '*';
      if (version !== '*' && version !== 'raw') {
        // TODO warning
        version = '*';
      }
    }

    // check filters
    const filter = Object.assign({
      fake: false,
      incoming: null,
      modified: null,
      silenced: false,
    }, opts.filter);

    if (opts.type) {
      log.warn([
        '[dispatch] hook: "type" is deprecated; use "filter"',
        errStack(),
      ].join('\n'));

      if (opts.type === 'all') filter.fake = null;
      if (opts.type === 'fake') filter.fake = true;
      if (opts.type === 'real') filter.fake = false;
    }

    return {
      code,
      filter,
      order: opts.order || 0,
      definitionVersion: version,
      callback: cb,
    };
  }

  hook(...args) {
    const hook = this.createHook(...args);
    const { code, order } = hook;

    if (!this.hooks.has(code)) {
      this.hooks.set(code, []);
    }

    const ordering = this.hooks.get(code);
    const index = binarySearch(ordering, { order }, (a, b) => a.order - b.order);
    if (index < 0) {
      ordering.splice(~index, 0, { order, hooks: [hook] });
    } else {
      ordering[index].hooks.push(hook);
    }

    return hook;
  }

  unhook(hook) {
    if (!this.hooks.has(hook.code)) return;

    const ordering = this.hooks.get(hook.code);
    const group = ordering.find(o => o.order === hook.order);
    if (group) group.hooks = group.hooks.filter(h => h !== hook);
  }

  write(outgoing, name, version, data) {
    if (!this.connection) return false;

    if (Buffer.isBuffer(name)) {
      data = name;
    } else {
      const normalizedName = normalizeName(name);

      if (!data && typeof version === 'object') {
        data = version;
        version = '*';

        if (!process.env.NO_WARN_IMPLIED_VERSION) {
          log.warn([
            `[dispatch] write: using implied latest version for "${normalizedName}"`,
            'WARNING: This behavior is deprecated. Please add an explicit version number or contact the module author to do so.',
            errStack(),
          ].join('\n'));
        }
      }

      try {
        data = protocol.write(normalizedName, version, data);
      } catch (e) {
        log.error([
          `[dispatch] write: failed to generate ${getMessageName(normalizedName, version, name)}`,
          `error: ${e.message}`,
          errStack(e, false),
        ].join('\n'));
        return false;
      }

      data = this.handle(data, !outgoing, true);
      if (data === false) return false;
    }
    this.connection[outgoing ? 'sendServer' : 'sendClient'](data);
    return true;
  }

  handle(data, incoming, fake = false) {
    const code = data.readUInt16LE(2);
    const copy = Buffer.from(data);

    const globalHooks = this.hooks.get('*');
    const codeHooks = this.hooks.get(code);
    if (!globalHooks && !codeHooks) return data;

    let modified = false;
    let silenced = false;

    function bufferAttachFlags(buf) {
      Object.defineProperties(buf, {
        $fake: { get: () => fake },
        $incoming: { get: () => incoming },
        $modified: { get: () => modified },
        $silenced: { get: () => silenced },
      });
    }

    function objectAttachFlags(obj) {
      Object.defineProperties(obj, {
        $fake: { value: fake },
        $incoming: { value: incoming },
        $modified: { value: modified },
        $silenced: { value: silenced },
      });
    }

    bufferAttachFlags(data);

    for (const hook of iterateHooks(globalHooks, codeHooks)) {
      // check flags
      const { filter } = hook;
      if (filter.fake != null && filter.fake !== fake) continue;
      if (filter.incoming != null && filter.incoming !== incoming) continue;
      if (filter.modified != null && filter.modified !== modified) continue;
      if (filter.silenced != null && filter.silenced !== silenced) continue;

      if (hook.definitionVersion === 'raw') {
        const result = tryIt(() => hook.callback(code, data, incoming, fake));

        if (result instanceof Error) {
          log.error([
            `[dispatch] handle: error running raw hook for ${getMessageName(code, hook.definitionVersion)}`,
            `hook: ${getHookName(hook)}`,
            `data: ${data.toString('hex')}`,
            `error: ${result.message}`,
            errStack(result),
          ].join('\n'));
          continue;
        }

        if (Buffer.isBuffer(result) && result !== data) {
          modified = modified || (result.length !== data.length) || !result.equals(data);
          bufferAttachFlags(result);
          data = result;
        } else {
          modified = modified || !data.equals(copy);
          if (typeof result === 'boolean') silenced = !result;
        }
      } else { // normal hook
        const event = tryIt(() => protocol.parse(code, hook.definitionVersion, data));

        if (event instanceof Error) {
          log.error([
            `[dispatch] handle: failed to parse ${getMessageName(code, hook.definitionVersion)}`,
            `hook: ${getHookName(hook)}`,
            `data: ${data.toString('hex')}`,
            `error: ${event.message}`,
            errStack(event, false),
          ].join('\n'));
          return data;
        }

        objectAttachFlags(event);

        const result = tryIt(() => hook.callback(event, fake));
        if (result instanceof Error) {
          log.error([
            `[dispatch] handle: error running hook for ${getMessageName(code, hook.definitionVersion)}`,
            `hook: ${getHookName(hook)}`,
            `data: ${util.inspect(event)}`,
            `error: ${result.message}`,
            errStack(result),
          ].join('\n'));
        } else if (result === true) {
          silenced = false;

          try {
            data = protocol.write(code, hook.definitionVersion, event);
          } catch (e) {
            log.error([
              `[dispatch] handle: failed to generate ${getMessageName(code, hook.definitionVersion)}`,
              `hook: ${getHookName(hook)}`,
              `error: ${e.message}`,
              errStack(e, false),
            ].join('\n'));
          }
          bufferAttachFlags(data);
        } else if (result === false) {
          silenced = true;
        }
      }
    }

    // return value
    return (!silenced ? data : false);
  }
}

module.exports = Dispatch;
