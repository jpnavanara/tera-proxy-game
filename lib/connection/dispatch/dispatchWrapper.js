class DispatchWrapper {
  constructor(base, moduleName) {
    this.base = base;
    this.moduleName = moduleName;
  }

  load(name, from, required = true, ...args) {
    const mod = this.base.load(name, from, ...args);
    if (required && !mod) {
      throw new Error(`Cannot find module '${name}'`);
    }
    return mod;
  }

  unload(...args) {
    return this.base.unload(...args);
  }

  hook(...args) {
    const hook = this.base.hook(...args);
    hook.moduleName = this.moduleName;
    return hook;
  }

  unhook(...args) {
    return this.base.unhook(...args);
  }

  toClient(...args) {
    return this.base.write(false, ...args);
  }

  toServer(...args) {
    return this.base.write(true, ...args);
  }
}

module.exports = DispatchWrapper;
