/**
 * Scripts the agent's browser actions run inside the page.
 *
 * Each builder returns a self-contained expression evaluated in the page's own
 * context, so none of them may reference anything from this module at runtime.
 * Inputs are embedded with `JSON.stringify`, which is what keeps a selector or
 * a typed value from terminating the expression and becoming code.
 *
 * Every script resolves to `{ ok, ... }` instead of throwing, so a failed match
 * comes back as an explainable result rather than an opaque evaluation error.
 */

/** Visible text is capped so a long page cannot flood the agent's context. */
const MAX_TEXT_CHARS = 6_000;
const MAX_ELEMENTS = 120;

/**
 * Shared helpers, injected into each script. `describe` builds the same kind of
 * selector the other actions accept, so a snapshot result is directly usable as
 * input to click or type.
 */
const HELPERS = `
  var MAX_ELEMENTS = ${MAX_ELEMENTS};
  var visible = function (element) {
    var rect = element.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return false;
    var style = window.getComputedStyle(element);
    return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) !== 0;
  };
  var label = function (element) {
    var aria = element.getAttribute('aria-label');
    if (aria) return aria.trim();
    var value = element.getAttribute('value');
    var text = (element.innerText || element.textContent || '').replace(/\\s+/g, ' ').trim();
    if (text) return text.slice(0, 120);
    if (value) return String(value).slice(0, 120);
    var placeholder = element.getAttribute('placeholder');
    return placeholder ? placeholder.trim().slice(0, 120) : '';
  };
  var cssPath = function (element) {
    if (element.id) return '#' + CSS.escape(element.id);
    var parts = [];
    var node = element;
    var depth = 0;
    while (node && node.nodeType === 1 && depth < 6) {
      var part = node.tagName.toLowerCase();
      var parent = node.parentElement;
      if (!parent) { parts.unshift(part); break; }
      var siblings = Array.prototype.filter.call(parent.children, function (child) {
        return child.tagName === node.tagName;
      });
      if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
      parts.unshift(part);
      if (node.id) { parts[0] = '#' + CSS.escape(node.id); break; }
      node = parent;
      depth += 1;
    }
    return parts.join(' > ');
  };
  var findByText = function (needle) {
    var wanted = String(needle).replace(/\\s+/g, ' ').trim().toLowerCase();
    var candidates = document.querySelectorAll('a, button, [role="button"], [role="link"], input[type="submit"], input[type="button"], summary, label');
    var exact = null;
    var partial = null;
    for (var i = 0; i < candidates.length; i += 1) {
      var element = candidates[i];
      if (!visible(element)) continue;
      var text = label(element).toLowerCase();
      if (!text) continue;
      if (text === wanted) { exact = element; break; }
      if (!partial && text.indexOf(wanted) !== -1) partial = element;
    }
    return exact || partial;
  };
`;

const wrap = (body: string): string => `(() => {\n${HELPERS}\n${body}\n})()`;

export const buildSnapshotScript = (): string => wrap(`
  var interactive = document.querySelectorAll('a[href], button, input, select, textarea, [role="button"], [role="link"], [role="tab"], [contenteditable="true"]');
  var elements = [];
  for (var i = 0; i < interactive.length && elements.length < MAX_ELEMENTS; i += 1) {
    var element = interactive[i];
    if (!visible(element)) continue;
    var rect = element.getBoundingClientRect();
    elements.push({
      selector: cssPath(element),
      tag: element.tagName.toLowerCase(),
      type: element.getAttribute('type') || '',
      role: element.getAttribute('role') || '',
      label: label(element),
      disabled: element.disabled === true,
      bounds: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
    });
  }
  var body = document.body ? (document.body.innerText || '') : '';
  var text = body.replace(/\\n{3,}/g, '\\n\\n').trim();
  return {
    ok: true,
    url: String(location.href),
    title: String(document.title || ''),
    truncated: text.length > ${MAX_TEXT_CHARS},
    text: text.slice(0, ${MAX_TEXT_CHARS}),
    elementCount: elements.length,
    elements: elements
  };
`);

export const buildClickScript = ({ selector, text }: { selector?: string; text?: string }): string => wrap(`
  var selector = ${JSON.stringify(selector ?? '')};
  var text = ${JSON.stringify(text ?? '')};
  var target = null;
  if (selector) {
    try { target = document.querySelector(selector); }
    catch (error) { return { ok: false, error: 'Invalid selector: ' + selector }; }
    if (!target) return { ok: false, error: 'No element matches ' + selector };
  } else {
    target = findByText(text);
    if (!target) return { ok: false, error: 'No clickable element has the label ' + text };
  }
  if (target.disabled === true) return { ok: false, error: 'Element is disabled' };
  target.scrollIntoView({ block: 'center', inline: 'center' });
  target.click();
  return { ok: true, clicked: cssPath(target), label: label(target), url: String(location.href) };
`);

export const buildTypeScript = ({ selector, value, submit }: { selector: string; value: string; submit: boolean }): string => wrap(`
  var selector = ${JSON.stringify(selector)};
  var value = ${JSON.stringify(value)};
  var target = null;
  try { target = document.querySelector(selector); }
  catch (error) { return { ok: false, error: 'Invalid selector: ' + selector }; }
  if (!target) return { ok: false, error: 'No element matches ' + selector };

  var editable = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
  if (!editable) return { ok: false, error: selector + ' is not a text field' };
  if (target.disabled === true || target.readOnly === true) return { ok: false, error: 'Field is not editable' };

  target.scrollIntoView({ block: 'center' });
  target.focus();
  if (target.isContentEditable) {
    target.textContent = value;
  } else {
    // Frameworks track the value through the native setter; assigning the
    // property directly leaves React and friends unaware of the change.
    var prototype = target.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    var setter = Object.getOwnPropertyDescriptor(prototype, 'value');
    if (setter && setter.set) setter.set.call(target, value);
    else target.value = value;
  }
  target.dispatchEvent(new Event('input', { bubbles: true }));
  target.dispatchEvent(new Event('change', { bubbles: true }));

  if (${submit ? 'true' : 'false'}) {
    var enter = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true };
    target.dispatchEvent(new KeyboardEvent('keydown', enter));
    target.dispatchEvent(new KeyboardEvent('keyup', enter));
    var form = target.form;
    if (form && typeof form.requestSubmit === 'function') form.requestSubmit();
  }
  return { ok: true, selector: cssPath(target), url: String(location.href) };
`);

export const buildScrollScript = ({ selector, direction }: { selector?: string; direction?: string }): string => wrap(`
  var selector = ${JSON.stringify(selector ?? '')};
  var direction = ${JSON.stringify(direction ?? '')};
  if (selector) {
    var target = null;
    try { target = document.querySelector(selector); }
    catch (error) { return { ok: false, error: 'Invalid selector: ' + selector }; }
    if (!target) return { ok: false, error: 'No element matches ' + selector };
    target.scrollIntoView({ block: 'center' });
    return { ok: true, scrolledTo: cssPath(target), scrollY: Math.round(window.scrollY) };
  }
  var page = Math.round(window.innerHeight * 0.85);
  if (direction === 'down') window.scrollBy(0, page);
  else if (direction === 'up') window.scrollBy(0, -page);
  else if (direction === 'top') window.scrollTo(0, 0);
  else if (direction === 'bottom') window.scrollTo(0, document.body ? document.body.scrollHeight : 0);
  else return { ok: false, error: 'Unknown scroll direction: ' + direction };
  return { ok: true, direction: direction, scrollY: Math.round(window.scrollY) };
`);
