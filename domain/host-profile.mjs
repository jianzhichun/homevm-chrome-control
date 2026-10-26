import { posix, win32 } from 'node:path';

const MODES = new Set(['extension', 'dedicated', 'isolated']);

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
    if (!MODES.has(mode)) throw new Error(`Unknown browser mode: ${mode}`);
    if (env.CHROME_CONTROL_DRIVER && env.CHROME_CONTROL_DRIVER !== 'playwright-cli') throw new Error('Only the official Playwright CLI backend is supported');
    this.mode = mode;
  }

  // Named browser instances share discovery but have independent runtime and
  // startup policy. Connection/session identity is owned by PlaywrightSession.
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

  get browser() {
    const value = Object.fromEntries(Object.entries(this.spec.browser).map(([key, v]) =>
      [key, typeof v === 'string' && /Path|Dir$/.test(key) ? this.expand(v) : v]));
    if (this.env.CHROME_CONTROL_USER_DATA_DIR) value.userDataDir = this.path.resolve(this.env.CHROME_CONTROL_USER_DATA_DIR);
    return value;
  }

  playwrightConfig(facts = {}) {
    const browser = this.browser;
    const args = browser.userAgent ? [`--user-agent=${this.substitute(browser.userAgent, facts)}`] : [];
    return { browser: { browserName: 'chromium', isolated: this.mode === 'isolated',
      ...(browser.userDataDir ? { userDataDir: browser.userDataDir } : {}),
      launchOptions: { executablePath: browser.executablePath, headless: browser.headless ?? true, args,
        ignoreDefaultArgs: ['--password-store=basic', '--use-mock-keychain'] } },
      outputMode: 'stdout' };
  }

  get runtime() { return this.env.CHROME_CONTROL_RUNTIME || this.expand(this.spec.runtime); }
  get tmp() { return this.spec.tmp ? this.expand(this.spec.tmp) : undefined; }
  get starter() {
    return this.env.CHROME_CONTROL_START_TASK
      ? { ...this.spec.starter, name: this.env.CHROME_CONTROL_START_TASK }
      : this.spec.starter;
  }

  // Where finished downloads are collected and renamed. Lives inside a
  // configured file root so the file layer can verify it.
  get staging() { return this.expand(this.spec.staging); }

  // Profile discovery source: the user-facing Chrome's user data dir and the
  // instance that serves it (named instance, or the default browser itself).
  get profiles() {
    const p = this.spec.profiles;
    if (!p) return undefined;
    return { userDataDir: this.expand(p.userDataDir), browser: p.browser || 'default' };
  }

  roots(root) { return [root, ...this.spec.roots.map(r => this.expand(r))]; }
}
