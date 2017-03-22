const path = require('path');
const binarySearch = require('binary-search');
const errorStackParser = require('error-stack-parser');
const { protocol } = require('tera-data-parser');
const Wrapper = require('./dispatchWrapper');

protocol.load(require.resolve('tera-data'));

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

function nameFromCode(code) {
  return protocol.map.code.get(code) || `opcode ${code}`;
}

function errStack(err) {
  const stack = errorStackParser.parse(err);

  // remove node internals from end
  while (!path.isAbsolute(stack[stack.length - 1].fileName)) {
    stack.pop();
  }

  // remove tera-proxy-game internals from end
  while (stack[stack.length - 1].fileName.match(/tera-proxy-game[\\/]lib/)) {
    stack.pop();
  }

  // remove tera-proxy-game internals from front
  while (stack[0].fileName.match(/tera-proxy-game[\\/]lib/)) {
    stack.shift();
  }

  return ['Error: ' + err.message, ...stack.map(frame => frame.source)].join('\n');
}

function errMsg(msg, err, data) {
  if (Array.isArray(msg)) msg = msg.join('\n');
  console.error(msg);

  if (!err) err = new Error();
  console.error(errStack(err));

  if (data) {
    console.error('data:');
    console.error(data);
  }
}

class Dispatch {
  constructor(connection) {
    this.connection = connection;
    this.modules = new Map();

    // hooks:
    //   { <code>:
    //     [ { <order>
    //       , hooks:
    //         [ { <definitionVersion>, <type>, <moduleName>, <callback> }
    //         ]
    //       }
    //     ]
    //   }
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

      console.log('[dispatch] loaded "%s"', name);
      return mod;
    } catch (e) {
      errMsg(`[dispatch] load: error initializing module "${name}"`, e);
    }
  }

  unload(name) {
    const mod = this.modules.get(name);

    if (!mod) {
      console.warn(errStack(new Error(
        `[dispatch] unload: cannot unload non-loaded module "${name}"`
      )));
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
        errMsg(`[dispatch] unload: error running destructor for module "${name}"`, e);
      }
    }

    this.modules.delete(name);
    return true;
  }

  _resolveHook(name, version, opts, cb) {
    // parse args
    if (version) {
      if (typeof version !== 'number' && typeof version !== 'string') {
        cb = opts;
        opts = version;
        version = '*';
        console.warn(errStack(new Error(
          `[dispatch] hook: using implied latest version for "${name}"`
        )));
      }
    }

    if (opts && typeof opts !== 'object') {
      cb = opts;
      opts = {};
    }

    if (typeof cb !== 'function') {
      console.warn(errStack(new Error(
        `last argument not a function (given ${typeof cb})`
      )));
      cb = () => {};
    }

    // retrieve opcode
    let code;
    if (name === '*') {
      code = name;
      if (typeof version === 'number') {
        // TODO warning
        version = '*';
      }
    } else {
      const normalizedName = normalizeName(name);
      code = protocol.map.name.get(normalizedName);
      if (code == null) {
        const origText = (normalizedName !== name) ? ` (original: "${name}")` : '';
        console.warn(errStack(new Error(
          `unrecognized hook target "${normalizedName}"${origText}`
        )));
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

    return {
      code,
      order: opts.order || 0,
      hook: {
        definitionVersion: version,
        type: opts.type || 'real',
        callback: cb,
      },
    };
  }

  hook(...args) {
    const { code, order, hook } = this._resolveHook(...args);

    if (!this.hooks.has(code)) {
      this.hooks.set(code, []);
    }

    const ordering = this.hooks.get(code);
    const index = binarySearch(ordering, order, (a, b) => a.order - b.order);
    if (index < 0) {
      ordering.splice(~index, 0, { order, hooks: [hook] });
    } else {
      ordering[index].hooks.push(hook);
    }

    return hook;
  }

  unhook() {
    // TODO
    console.error(errStack(new Error(
      'Dispatch#unhook() is not implemented yet'
    )));
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
        console.warn(errStack(new Error(
          `[dispatch] write: using implied latest version for "${normalizedName}"`
        )));
      }

      try {
        data = protocol.write(normalizedName, version, data);
      } catch (e) {
        const origText = (normalizedName !== name) ? ` (original: "${name}")` : '';
        errMsg(`[dispatch] write: failed to generate ${normalizedName}<${version}>${origText}`, e, data);
        return false;
      }

      data = this.handle(data, !outgoing, true);
      if (data === false) return false;
    }
    this.connection[outgoing ? 'sendServer' : 'sendClient'](data);
    return true;
  }

  handle(data, fromServer, fake = false) {
    const code = data.readUInt16LE(2);
    for (const target of ['*', code]) {
      if (!this.hooks.has(target)) continue;

      for (const order of this.hooks.get(target)) {
        for (const hook of order.hooks) {
          if (hook.type !== 'all') {
            if (!fake && hook.type === 'fake') continue;
            if (fake && hook.type === 'real') continue;
          }

          if (hook.definitionVersion === 'raw') {
            const result = tryIt(() => hook.callback(code, data, fromServer, fake));

            if (result instanceof Error) {
              errMsg(
                [
                  `[dispatch] handle: error running raw hook for ${nameFromCode(code)}`,
                  `module: ${hook.moduleName || '<unknown>'}`,
                ],
                result,
                data.toString('hex')
              );
              continue;
            } else if (Buffer.isBuffer(result)) {
              data = result;
            } else if (result === false) {
              return false;
            }
          } else { // normal hook
            const event = tryIt(() => protocol.parse(code, hook.definitionVersion, data));

            if (event instanceof Error) {
              errMsg(`[dispatch] handle: failed to parse ${nameFromCode(code)}`, event, data.toString('hex'));
              return data;
            }

            const result = tryIt(() => hook.callback(event, fake));
            if (result instanceof Error) {
              errMsg(
                [
                  `[dispatch] handle: error running hook for ${nameFromCode(code)}`,
                  `module: ${hook.moduleName || '<unknown>'}`,
                ],
                result,
                event
              );
            } else if (result === true) {
              try {
                data = protocol.write(code, hook.definitionVersion, event);
              } catch (e) {
                errMsg(`[dispatch] handle: failed to generate "${nameFromCode(code)}"`, e, event);
              }
            } else if (result === false) {
              return false;
            }
          }
        }
      }
    }

    // return value
    return data;
  }
}

module.exports = Dispatch;
