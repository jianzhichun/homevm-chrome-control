// Generated snippets use public Playwright APIs inside the official CLI session.
// Page IDs are persistent for a session generation, not context.pages() indexes.
export function compatibleSnapshot(snapshot) {
  return snapshot.split('\n').map(line => {
    const match = line.match(/^(\s*)- (.*?)\s*\[ref=(?:f(\d+))?e(\d+)\](.*)$/);
    if (!match) return line;
    const frame = match[3] === undefined ? 0 : Number(match[3]) + 1;
    return `${match[1]}uid=${frame}_${match[4]} ${match[2]}${match[5]}`;
  }).join('\n');
}

export function pageRegistry() {
  return `const c=page.context(); const key=Symbol.for('chrome-control.pages.v1');
  const r=c[key]||(c[key]={next:1,pages:new Map()});
  for(const p of c.pages()) if(![...r.pages.values()].includes(p))r.pages.set(r.next++,p);
  for(const [id,p] of r.pages)if(p.isClosed())r.pages.delete(id);`;
}

export function listPagesScript() {
  return `async page=>{${pageRegistry()}return Promise.all([...r.pages].map(async([pageId,p])=>({pageId,url:p.url(),title:await p.title()})));}`;
}

const renderActions = new Set(['click', 'click_at', 'hover', 'fill', 'fill_form', 'press_key', 'type_text', 'upload_file', 'take_screenshot']);

export function pageActionScript(name, args) {
  const json = JSON.stringify;
  // Activate inside the input invocation, not in a separate call another tab can supersede.
  const focus = renderActions.has(name) ? 'await p.bringToFront();' : '';
  const prefix = `async page=>{${pageRegistry()}const p=r.pages.get(${json(args.pageId)});if(!p)throw Error('Unknown or closed pageId');${focus}`;
  const options = json({ timeout: args.timeout || 25_000 });
  const locator = uid => {
    const old = typeof uid === 'string' && uid.match(/^(\d+)_(\d+)$/);
    const ref = old ? `${Number(old[1]) ? 'f' + (Number(old[1]) - 1) : ''}e${old[2]}` : uid;
    if (typeof ref !== 'string' || !/^(f\d+)?e\d+$/.test(ref)) throw new Error('Use an element UID from a fresh take_snapshot');
    return `p.locator(${json('aria-ref=' + ref)})`;
  };
  let action;
  switch (name) {
    case 'evaluate_script':
      if (args.args?.length) throw new Error('Element arguments are not supported by this backend');
      action = `return p.evaluate(${json('(' + args.function + ')()')});`; break;
    case 'navigate_page':
      if (!args.type || args.type === 'url') action = `await p.goto(${json(args.url)},${options});`;
      else if (args.type === 'back') action = `await p.goBack(${options});`;
      else if (args.type === 'forward') action = `await p.goForward(${options});`;
      else if (args.type === 'reload') action = `await p.reload(${options});`;
      else throw new Error('Unsupported navigation type');
      action += 'return {url:p.url()};'; break;
    case 'take_snapshot': action = `return p.ariaSnapshot({mode:'ai',timeout:25000});`; break;
    case 'select_page': action = 'await p.bringToFront();return {selected:true};'; break;
    case 'click': action = `await ${locator(args.uid)}.${args.dblClick ? 'dblclick' : 'click'}(${options});return true;`; break;
    case 'click_at': action = `await p.mouse.${args.dblClick ? 'dblclick' : 'click'}(${json(args.x)},${json(args.y)});return true;`; break;
    case 'hover': action = `await ${locator(args.uid)}.hover(${options});return true;`; break;
    case 'fill':
    case 'fill_form': {
      const fill = `async function fill(l,v){const kind=await l.evaluate(e=>({tag:e.tagName,type:e.type}));
        if(kind.type==='checkbox'||kind.type==='radio')await l.setChecked(v==='true',${options});
        else if(kind.tag==='SELECT')await l.selectOption({label:v},${options}).catch(()=>l.selectOption(v,${options}));
        else await l.fill(v,${options});}`;
      const fields = name === 'fill' ? [{ uid: args.uid, value: args.value }] : args.elements;
      action = fill + fields.map(e => `await fill(${locator(e.uid)},${json(e.value)});`).join('') + 'return true;';
      break;
    }
    case 'press_key': action = `await p.keyboard.press(${json(args.key)});return true;`; break;
    case 'type_text': action = `await p.keyboard.insertText(${json(args.text)});${args.submitKey ? `await p.keyboard.press(${json(args.submitKey)});` : ''}return true;`; break;
    case 'upload_file': action = `await ${locator(args.uid)}.setInputFiles(${json(args.filePaths)},${options});return true;`; break;
    case 'take_screenshot':
      action = `return (await ${args.uid ? locator(args.uid) : 'p'}.screenshot(${json({ ...(args.uid ? {} : { fullPage: args.fullPage || false }), type: args.format === 'jpeg' ? 'jpeg' : 'png', ...(args.format === 'jpeg' && args.quality !== undefined ? { quality: args.quality } : {}) })})).toString('base64');`; break;
    case 'wait_for':
      action = `await Promise.any(${json(args.text)}.map(t=>p.getByText(t,{exact:false}).first().waitFor({state:'visible',timeout:${args.timeout || 25000}})));return true;`; break;
    case 'handle_dialog': throw new Error('Use the official dialog-accept/dialog-dismiss command through the adapter');
    case 'resize_page': action = `await p.setViewportSize(${json({ width: args.width, height: args.height })});return true;`; break;
    case 'close_page': action = `await p.close();r.pages.delete(${json(args.pageId)});return {closed:true};`; break;
    default: throw new Error(`Unsupported Playwright tool: ${name}`);
  }
  return prefix + action + '}';
}
