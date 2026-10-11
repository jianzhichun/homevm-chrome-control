import { createHash } from 'node:crypto';
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
//
// `spec.browser` is the DEFAULT instance the bare CLI drives. `spec.browsers`
// optionally names further instances (e.g. the owner's real Chrome next to a
// dedicated headless one); each is a browser spec plus its own runtime dir
// and starter, because the daemon sessions must not share pid files.
export class HostProfile {
  static select(specs, context) {
    const spec = specs[context.platform];
    if (!spec) throw new Error(`Unsupported browser host platform: ${context.platform}`);
    return new HostProfile(spec, context);
  }

  constructor(spec, { platform, home, env = {}, instance } = {}) {
    this.path = platform === 'win32' ? win32 : posix;
    this.vars = { ...env, home };
    this.spec = spec;
    this.env = env;
    this.platform = platform;
    this.home = home;
    this.instanceName = instance;
    const mode = env.CHROME_CONTROL_MODE || spec.browser.mode;
    if (!MODES[mode]) throw new Error(`Unknown browser mode: ${mode}`);
    this.mode = mode;
  }

  // A named instance view of this host: same host-level roots and discovery,
  // but its own browser spec, runtime dir and starter. The daemon session id
  // must stay hex (upstream requirement) and stable across restarts; the
  // default keeps its historical name so deployed tasks and sockets survive
  // the upgrade unchanged.
  instance(name) {
    if (!name || name === 'default') return this;
    const one = this.spec.browsers?.[name];
    if (!one) throw new Error(`Unknown browser instance: ${name}`);
    const spec = {
      ...this.spec, browser: one,
      runtime: one.runtime || this.spec.runtime,
      starter: one.starter || this.spec.starter,
    };
    return new HostProfile(spec, { platform: this.platform, home: this.home, env: this.env, instance: name });
  }

  get session() {
    if (!this.instanceName) return 'cc001';
    return 'cc' + createHash('sha256').update(this.instanceName).digest('hex').slice(0, 6);
  }

  substitute(template, facts = {}) {
    const vars = { ...this.vars, ...facts };
    return template.replace(/\{(\w+)\}/g, (_, name) => {
      if (!vars[name]) throw new Error(`Host profile variable ${name} is not set`);
      return String(vars[name]);
    });
  }

  expand(template) { return this.path.resolve(this.substitute(template)); }

  // Facts only the live machine knows (e.g. chromeMajor, read from chrome.exe).
  wants(fact) { return Object.values(this.spec.browser).some(v => typeof v === 'string' && v.includes(`{${fact}}`)); }
  get executablePath() { return this.spec.browser.executablePath && this.expand(this.spec.browser.executablePath); }

  get runtime() { return this.env.CHROME_CONTROL_RUNTIME || this.expand(this.spec.runtime); }
  get tmp() { return this.spec.tmp ? this.expand(this.spec.tmp) : undefined; }
  get starter() { return this.spec.starter; }

  // Where finished downloads are collected and renamed. Lives inside a
  // configured file root so the file layer can verify it.
  get staging() { return this.expand(this.spec.staging); }

  // Downloads land in the Chrome-configured directory; staging sits inside
  // it, so that directory is what the watch polls.
  get stagingWatch() {
    const parts = this.staging.split(/[\\/]/);
    const dir = parts.slice(0, -1).join(this.path.sep);
    return dir || this.path.sep;
  }

  // Profile discovery source: the user-facing Chrome's user data dir and the
  // instance that serves it (named instance, or the default browser itself).
  get profiles() {
    const p = this.spec.profiles;
    if (!p) return undefined;
    return { userDataDir: this.expand(p.userDataDir), browser: p.browser || 'default' };
  }

  roots(root) { return [root, ...this.spec.roots.map(r => this.expand(r))]; }

  daemonArgs(root, facts = {}) {
    const browser = Object.fromEntries(Object.entries(this.spec.browser)
      .map(([key, value]) => [key, typeof value === 'string' && /Path|Dir$/.test(key) ? this.expand(value) : value]));
    // A headed UA for the same Chrome version: headless otherwise announces
    // itself as "HeadlessChrome/<v>" and some publishers refuse it.
    const ua = browser.userAgent ? [`--chromeArg=--user-agent=${this.substitute(browser.userAgent, facts)}`] : [];
    return [...BASE_ARGS, ...this.roots(root).flatMap(w => ['--workspace', w]), ...MODES[this.mode](browser), ...ua];
  }
}
