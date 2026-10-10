import { posix, win32 } from 'node:path';

const BASE_ARGS = ['--no-usage-statistics', '--no-performance-crux', '--redactNetworkHeaders', '--experimentalVision'];
const MODES = {
  autoConnect: () => ['--autoConnect'],
  dedicated: b => ['--userDataDir', b.userDataDir, ...(b.headless ? ['--headless'] : []), '--executablePath', b.executablePath],
  isolated: b => ['--headless', '--isolated', '--executablePath', b.executablePath],
};

// Pure description of one browser host: where runtime state lives, which
// directories the file tools may touch, and how the official daemon reaches
// Chrome. No I/O; adapters/host.mjs feeds it the live platform and env.
export class HostProfile {
  static select(specs, context) {
    const spec = specs[context.platform];
    if (!spec) throw new Error(`Unsupported browser host platform: ${context.platform}`);
    return new HostProfile(spec, context);
  }

  constructor(spec, { platform, home, env = {} }) {
    this.path = platform === 'win32' ? win32 : posix;
    this.vars = { ...env, home };
    this.spec = spec;
    this.env = env;
    const mode = env.CHROME_CONTROL_MODE || spec.browser.mode;
    if (!MODES[mode]) throw new Error(`Unknown browser mode: ${mode}`);
    this.mode = mode;
  }

  expand(template) {
    return this.path.resolve(template.replace(/\{(\w+)\}/g, (_, name) => {
      if (!this.vars[name]) throw new Error(`Host profile variable ${name} is not set`);
      return this.vars[name];
    }));
  }

  get runtime() { return this.env.CHROME_CONTROL_RUNTIME || this.expand(this.spec.runtime); }
  get tmp() { return this.spec.tmp ? this.expand(this.spec.tmp) : undefined; }
  get starter() { return this.spec.starter; }

  roots(root) { return [root, ...this.spec.roots.map(r => this.expand(r))]; }

  daemonArgs(root) {
    const browser = Object.fromEntries(Object.entries(this.spec.browser)
      .map(([key, value]) => [key, typeof value === 'string' && /Path|Dir$/.test(key) ? this.expand(value) : value]));
    return [...BASE_ARGS, ...this.roots(root).flatMap(w => ['--workspace', w]), ...MODES[this.mode](browser)];
  }
}
