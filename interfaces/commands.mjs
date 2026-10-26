import { downloadArtifact } from '../application/download.mjs';
import { capabilities } from '../application/version.mjs';
import { root } from '../adapters/host.mjs';
import { signInCommand } from './login.mjs';
import { pairExtension } from './pair-extension.mjs';

export async function commandResult(control, command, tool, args, selector) {
  switch (command) {
    case 'start': return control.start(selector);
    case 'boot': return control.boot(selector);
    case 'stop': return control.stop(selector);
    case 'status': {
      const version = await capabilities(root);
      return { ...await control.status(selector), control: { protocolVersion: version.protocolVersion, sourceDigest: version.sourceDigest, capabilities: version.capabilities } };
    }
    case 'capabilities': return capabilities(root);
    case 'tools': {
      const tools = await control.tools();
      if (!tool) return tools;
      const selected = tools.find(item => item.name === tool);
      if (!selected) throw new Error(`Unknown tool ${tool}`);
      return selected;
    }
    case 'profiles': return control.profiles();
    case 'pages': return control.pages(selector);
    case 'open': return control.open(tool, selector);
    case 'identity': return control.call('browser_identity', { pageId: Number(tool) }, selector);
    case 'call':
      if (!tool) throw new Error('call requires TOOL and optional JSON arguments');
      return control.call(tool, args, selector);
    case 'download':
      if (!tool) throw new Error('download requires URL and filename');
      return downloadArtifact(control, { ...args, ...selector, url: tool });
    case 'login':
      if (selector?.account) throw new Error('Automated login is limited to the dedicated instance');
      return signInCommand(control, { entry: tool, profile: selector?.profile });
    case 'pair': return pairExtension(control, selector);
    default: throw new Error(`Unknown command ${command}`);
  }
}
