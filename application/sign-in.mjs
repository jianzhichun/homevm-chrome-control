import { ENTRA, JS, isMethodList, secondsLeft, signedIn, totpCode } from '../domain/entra.mjs';

// The Cambridge sign-in walk on one leased page: entry URL on the library
// proxy -> Entra username -> password -> (push switched to code) -> TOTP ->
// stay signed in -> back on the proxy.
//
// Safety: every credential is submitted AT MOST ONCE; the same field offered
// again means it was rejected, and the walk stops rather than risk locking
// the account. A passkey (bridge/fido) detour is backed out of once via the
// page's own Back button; if that does not take, the walk stops and says so.
export class CambridgeSignIn {
  constructor(page, creds, { entry, sleep = ms => new Promise(r => setTimeout(r, ms)), log = () => {} } = {}) {
    this.page = page;
    this.creds = creds;
    this.entry = entry;
    this.sleep = sleep;
    this.log = log;
    this.once = {};
  }

  async run(maxRounds = 14) {
    await this.page.navigate(this.entry);
    for (let round = 0; round < maxRounds; round++) {
      const p = await this.settle();
      this.log('round', { round, url: String(p.url).slice(0, 100), title: String(p.title).slice(0, 60) });
      if (signedIn(p.url, this.entry)) return { ok: true, url: p.url, title: p.title, rounds: round };
      const stop = await this.step(p);
      if (stop) return { ok: false, url: p.url, title: p.title, rounds: round, stopped: stop };
    }
    const p = await this.page.eval(JS.probe);
    return { ok: signedIn(p.url, this.entry), url: p.url, title: p.title, rounds: maxRounds, stopped: 'rounds' };
  }

  // One page state -> one action. Returns a reason to stop, or nothing.
  async step(p) {
    const page = this.page;
    const visible = sel => page.eval(JS.visible(sel)).then(v => v === true);
    const seen = sel => page.eval(JS.seen(sel)).then(v => v === true);
    const submit = async () => { await page.eval(JS.click(ENTRA.submit)); await this.sleep(6000); };

    if (await visible(ENTRA.code)) {
      if (!this.first('code')) return 'code rejected';
      if (secondsLeft() < 5) await this.sleep(5500);
      this.log('fill code', await page.eval(JS.fill(ENTRA.code, totpCode(this.creds.totpSecret))));
      return submit();
    }
    if (String(p.url).includes('/bridge/fido')) {
      if (!this.first('fido')) return 'passkey prompt (bridge/fido) did not back out - needs a person to dismiss it';
      const snap = await page.snapshot().catch(() => '');
      const uid = (String(typeof snap === 'string' ? snap : JSON.stringify(snap)).match(/uid=(\S+)\s+button\s+"(?:上一步|Back)"/) || [])[1];
      this.log('fido back', uid ? await page.click(uid) : 'absent');
      return this.sleep(6000);
    }
    if (isMethodList(await page.eval(JS.text))) {
      if (!this.first('method')) return 'method list repeated';
      this.log('method list', await page.eval(JS.clickText('使用我的密码')));
      return this.sleep(4000);
    }
    if (await visible(ENTRA.push) || await seen(ENTRA.otpMethod)) {
      if (!this.first('switch')) return 'push prompt repeated';
      if (!(await seen(ENTRA.otpMethod))) {
        this.log('another way', await page.eval(JS.click(ENTRA.anotherWay)));
        let ok = false;
        for (let t = 0; t < 15 && !ok; t++) { await this.sleep(2000); ok = await seen(ENTRA.otpMethod); }
        if (!ok) return 'code method never offered';
      }
      this.log('code method', await page.eval(JS.click(ENTRA.otpMethod)));
      return this.sleep(5000);
    }
    if (await visible(ENTRA.user) && !(await page.eval(JS.value(ENTRA.user)))) {
      if (!this.first('user')) return 'username rejected';
      this.log('fill username', await page.eval(JS.fill(ENTRA.user, this.creds.user)));
      this.log('noFido', await page.eval(JS.noFido));
      return submit();
    }
    if (await visible(ENTRA.password)) {
      if (!this.first('password')) return 'password rejected';
      this.log('fill password', await page.eval(JS.fill(ENTRA.password, this.creds.password)));
      return submit();
    }
    if (await page.eval(JS.pickAccount(this.creds.user)) === 'picked') {
      if (!this.first('account')) return 'account picker repeated';
      return this.sleep(6000);
    }
    if (await seen(ENTRA.kmsi)) {
      this.log('stay signed in', await page.eval(JS.click(ENTRA.kmsi)));
      return submit();
    }
    return `stuck on ${String(p.url).slice(0, 90)}`;
  }

  first(field) {
    if (this.once[field]) return false;
    this.once[field] = true;
    return true;
  }

  async settle(budgetMs = 60_000) {
    const end = Date.now() + budgetMs;
    for (;;) {
      const p = await this.page.eval(JS.probe).catch(() => undefined);
      if (p && p.ready === 'complete' && p.title) return p;
      if (Date.now() > end) return p || { url: '?', title: '?' };
      await this.sleep(1500);
    }
  }
}
