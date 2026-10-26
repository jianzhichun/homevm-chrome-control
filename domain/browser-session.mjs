import { createHash } from 'node:crypto';

export const scopeKey = scope => createHash('sha256').update(scope).digest('hex').slice(0, 24);
export const sessionName = scope => 'cc-' + scopeKey(scope);
export const BROWSER_TOOLS = new Set([
  'list_pages', 'new_page', 'close_page', 'select_page', 'navigate_page',
  'take_snapshot', 'evaluate_script', 'click', 'click_at', 'hover', 'fill',
  'fill_form', 'press_key', 'type_text', 'upload_file', 'take_screenshot',
  'wait_for', 'resize_page',
]);
