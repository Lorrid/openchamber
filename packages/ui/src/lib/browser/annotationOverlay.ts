/**
 * The annotation overlay that runs *inside* the previewed page.
 *
 * This module produces a self-contained script string. It is injected through
 * `webview.executeJavaScript`, so it cannot import anything, cannot reference
 * our theme variables (the page has its own `:root`), and must not disturb the
 * document it lands in. Consequences that drive the implementation:
 *
 * - All chrome lives in a **closed** shadow root on a single host element, so
 *   page CSS cannot restyle it and page scripts cannot walk into it.
 * - Every color and every label is passed in from the host, already resolved
 *   and already translated. Nothing user-facing is hardcoded here.
 * - Style edits are applied to the live page with `!important` and recorded
 *   against a baseline, so `revert()` restores exactly what was there before —
 *   including properties that were previously unset.
 *
 * Lifecycle: the script resolves with a payload (or null when cancelled) and
 * tears down its own chrome *before* resolving, so a screenshot taken by the
 * host contains the page and the live style edits but none of our UI. The
 * style edits themselves survive until the host calls the revert hook exposed
 * on `window`, which it does once the capture is done.
 */

export type BrowserAnnotationOverlayTheme = {
  readonly colorScheme: 'light' | 'dark';
  readonly primary: string;
  /** Translucent primary, already resolved to a concrete color by the host. */
  readonly primarySoft: string;
  /** Faint primary used for hover backgrounds. */
  readonly primaryFaint: string;
  readonly primaryContrast: string;
  readonly surface: string;
  readonly surfaceElevated: string;
  readonly border: string;
  readonly text: string;
  readonly mutedText: string;
};

export type BrowserAnnotationOverlayLabels = {
  readonly select: string;
  readonly marquee: string;
  readonly draw: string;
  readonly styles: string;
  readonly commentPlaceholder: string;
  readonly submit: string;
  readonly cancel: string;
  readonly clear: string;
  readonly text: string;
  readonly colors: string;
  readonly borders: string;
  readonly sizing: string;
  readonly fontSize: string;
  readonly fontWeight: string;
  readonly textColor: string;
  readonly background: string;
  readonly borderColor: string;
  readonly borderWidth: string;
  readonly borderRadius: string;
  readonly width: string;
  readonly height: string;
  readonly opacity: string;
};

/** Global names the overlay defines on the page. Kept in one place so the host can clean up. */
export const ANNOTATION_REVERT_HOOK = '__openchamberBrowserAnnotationRevert';
const ANNOTATION_ACTIVE_FLAG = '__openchamberBrowserAnnotationActive';

/**
 * Cancels any overlay left behind by an earlier session and reverts its style
 * edits. Safe to run when nothing is active.
 */
export const ANNOTATION_TEARDOWN_SCRIPT = `(() => {
  try {
    var revert = window['${ANNOTATION_REVERT_HOOK}'];
    if (typeof revert === 'function') revert();
  } catch (error) { /* page navigated away */ }
  try {
    var host = document.querySelector('[data-openchamber-annotation]');
    if (host && host.parentNode) host.parentNode.removeChild(host);
  } catch (error) { /* page navigated away */ }
  try { delete window['${ANNOTATION_ACTIVE_FLAG}']; } catch (error) { /* non-configurable */ }
})();`;

export const buildAnnotationOverlayScript = (
  theme: BrowserAnnotationOverlayTheme,
  labels: BrowserAnnotationOverlayLabels,
): string => {
  const config = JSON.stringify({ theme, labels });
  return String.raw`new Promise((resolve) => {
  var CONFIG = ${config};
  var THEME = CONFIG.theme;
  var LABELS = CONFIG.labels;
  var OVERLAY_ATTR = 'data-openchamber-annotation';
  var Z_OVERLAY = 2147483646;
  var MAX_TEXT = 400;
  var MIN_RECT = 3;

  try {
    var stale = document.querySelector('[' + OVERLAY_ATTR + ']');
    if (stale && stale.parentNode) stale.parentNode.removeChild(stale);
    var staleRevert = window['${ANNOTATION_REVERT_HOOK}'];
    if (typeof staleRevert === 'function') staleRevert();
  } catch (error) { /* nothing to clean */ }

  window['${ANNOTATION_ACTIVE_FLAG}'] = true;

  var counter = 0;
  var nextId = function (prefix) { counter += 1; return prefix + '-' + counter; };

  // Exactly one element at a time. Clicking another replaces it, clicking the
  // same one clears it. Several things at once belong to the region tool, which
  // marks an area rather than a list of elements to restyle individually.
  var selected = null;
  var regions = [];
  var strokes = [];
  var styleChanges = new Map();
  var tool = 'select';
  var settled = false;

  // ---------------------------------------------------------------- geometry

  var rectFrom = function (domRect) {
    return { x: domRect.left, y: domRect.top, width: domRect.width, height: domRect.height };
  };
  var normalizeRect = function (ax, ay, bx, by) {
    return { x: Math.min(ax, bx), y: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay) };
  };
  var usableRect = function (rect) { return rect.width >= MIN_RECT && rect.height >= MIN_RECT; };

  // ------------------------------------------------------------- description

  var isOverlayNode = function (element) {
    var node = element;
    while (node) {
      if (node.nodeType === 1 && node.hasAttribute && node.hasAttribute(OVERLAY_ATTR)) return true;
      node = node.parentNode || (node.host || null);
    }
    return false;
  };

  var elementFromPoint = function (x, y) {
    var found = document.elementFromPoint(x, y);
    if (!found || isOverlayNode(found)) return null;
    return found;
  };

  var selectorPart = function (element) {
    var part = element.tagName.toLowerCase();
    if (element.id) return part + '#' + element.id;
    var className = typeof element.className === 'string' ? element.className.trim() : '';
    if (className) {
      var first = className.split(/\s+/).filter(Boolean).slice(0, 2).join('.');
      if (first) part += '.' + first;
    }
    return part;
  };

  var buildSelector = function (element) {
    if (element.id) return '#' + element.id;
    var parts = [];
    var node = element;
    var depth = 0;
    while (node && node.nodeType === 1 && depth < 5) {
      var part = selectorPart(node);
      var parent = node.parentElement;
      if (parent) {
        var siblings = Array.prototype.filter.call(parent.children, function (child) {
          return child.tagName === node.tagName;
        });
        if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
      }
      parts.unshift(part);
      if (node.id) break;
      node = parent;
      depth += 1;
    }
    return parts.join(' > ');
  };

  var INTERESTING_ATTRS = ['id', 'class', 'name', 'type', 'href', 'src', 'alt', 'title', 'role', 'placeholder', 'aria-label', 'data-testid'];
  var STYLE_PROPS = [
    'display', 'position', 'color', 'backgroundColor', 'fontSize', 'fontWeight', 'fontFamily',
    'lineHeight', 'padding', 'margin', 'border', 'borderRadius', 'width', 'height', 'opacity',
    'zIndex', 'flexDirection', 'justifyContent', 'alignItems', 'gap', 'textAlign'
  ];

  var describe = function (element) {
    var computed = window.getComputedStyle(element);
    var attributes = {};
    for (var i = 0; i < INTERESTING_ATTRS.length; i += 1) {
      var name = INTERESTING_ATTRS[i];
      var value = element.getAttribute(name);
      if (value) attributes[name] = String(value).slice(0, 200);
    }
    var computedStyle = {};
    for (var j = 0; j < STYLE_PROPS.length; j += 1) {
      var prop = STYLE_PROPS[j];
      computedStyle[prop] = String(computed[prop] == null ? '' : computed[prop]);
    }
    var ancestry = [];
    var node = element.parentElement;
    var depth = 0;
    while (node && node.nodeType === 1 && depth < 4) {
      var entry = { tag: node.tagName.toLowerCase(), selectorPart: selectorPart(node) };
      if (node.id) entry.id = node.id;
      var cls = typeof node.className === 'string' ? node.className.trim() : '';
      if (cls) entry.className = cls.slice(0, 200);
      ancestry.unshift(entry);
      node = node.parentElement;
      depth += 1;
    }
    var box = element.getBoundingClientRect();
    var text = (element.textContent == null ? '' : String(element.textContent)).replace(/\s+/g, ' ').trim();
    return {
      tag: element.tagName.toLowerCase(),
      text: text.slice(0, MAX_TEXT),
      selector: buildSelector(element),
      path: ancestry.map(function (entry) { return entry.selectorPart; }).concat([selectorPart(element)]).join(' > '),
      bounds: rectFrom(box),
      center: { x: box.left + box.width / 2, y: box.top + box.height / 2 },
      attributes: attributes,
      computedStyle: computedStyle,
      ancestry: ancestry
    };
  };

  // ------------------------------------------------------------------ chrome

  var host = document.createElement('div');
  host.setAttribute(OVERLAY_ATTR, '');
  host.style.cssText = 'position:fixed;inset:0;z-index:' + Z_OVERLAY + ';pointer-events:none';
  var shadow = host.attachShadow({ mode: 'closed' });

  var style = document.createElement('style');
  style.textContent = [
    ':host{all:initial}',
    '*{box-sizing:border-box;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}',
    '.layer{position:fixed;inset:0;pointer-events:none}',
    '.box{position:fixed;left:0;top:0;display:none;pointer-events:none;border:1.5px solid ' + THEME.primary + ';background:' + THEME.primarySoft + ';border-radius:2px}',
    '.label{position:fixed;left:0;top:0;display:none;pointer-events:none;padding:1px 5px;border-radius:3px;background:' + THEME.primary + ';color:' + THEME.primaryContrast + ';font-size:10px;line-height:15px;white-space:nowrap;font-weight:600}',
    '.bar{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);display:flex;flex-direction:column;gap:6px;width:min(440px,calc(100vw - 32px));padding:8px;border-radius:10px;border:1px solid ' + THEME.border + ';background:' + THEME.surfaceElevated + ';color:' + THEME.text + ';box-shadow:0 8px 28px rgba(0,0,0,.28);pointer-events:auto}',
    '.row{display:flex;align-items:center;gap:6px}',
    'button{appearance:none;border:1px solid transparent;background:transparent;color:' + THEME.text + ';border-radius:6px;padding:4px 8px;font-size:11px;line-height:16px;cursor:pointer;white-space:nowrap}',
    'button:hover{background:' + THEME.primaryFaint + '}',
    'button[aria-pressed="true"]{background:' + THEME.primary + ';color:' + THEME.primaryContrast + '}',
    'button.primary{background:' + THEME.primary + ';color:' + THEME.primaryContrast + ';font-weight:600}',
    'button.primary[disabled]{opacity:.45;cursor:default}',
    'textarea{flex:1;min-width:0;resize:none;border-radius:6px;border:1px solid ' + THEME.border + ';background:' + THEME.surface + ';color:' + THEME.text + ';padding:5px 7px;font-size:12px;line-height:17px;outline:none}',
    'textarea:focus{border-color:' + THEME.primary + '}',
    '.panel{display:none;grid-template-columns:repeat(auto-fit,minmax(128px,1fr));gap:8px;padding-top:2px;border-top:1px solid ' + THEME.border + '}',
    '.group{display:flex;flex-direction:column;gap:4px;min-width:0}',
    '.group > span{font-size:9px;text-transform:uppercase;letter-spacing:.05em;color:' + THEME.mutedText + '}',
    '.field{display:flex;align-items:center;gap:4px;min-width:0}',
    '.field > label{flex:0 0 46px;font-size:10px;color:' + THEME.mutedText + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    'input,select{flex:1;min-width:0;height:22px;border-radius:5px;border:1px solid ' + THEME.border + ';background:' + THEME.surface + ';color:' + THEME.text + ';font-size:11px;padding:0 5px;outline:none}',
    'input[type=color]{padding:1px;height:22px;cursor:pointer}',
    'input[type=range]{border:none;background:transparent;padding:0;accent-color:' + THEME.primary + '}',
    '.count{font-size:10px;color:' + THEME.mutedText + ';white-space:nowrap}'
  ].join('');
  shadow.appendChild(style);

  var cursorStyle = document.createElement('style');
  document.head.appendChild(cursorStyle);
  var setCursor = function (value) {
    cursorStyle.textContent = value ? '*{cursor:' + value + ' !important}' : '';
  };

  var svgNS = 'http://www.w3.org/2000/svg';
  var svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('class', 'layer');
  svg.style.overflow = 'visible';
  shadow.appendChild(svg);

  var hoverBox = document.createElement('div');
  hoverBox.className = 'box';
  var hoverLabel = document.createElement('div');
  hoverLabel.className = 'label';
  var marqueeBox = document.createElement('div');
  marqueeBox.className = 'box';
  shadow.appendChild(hoverBox);
  shadow.appendChild(hoverLabel);
  shadow.appendChild(marqueeBox);

  var positionBox = function (node, rect) {
    node.style.display = 'block';
    node.style.transform = 'translate(' + rect.x + 'px,' + rect.y + 'px)';
    node.style.width = rect.width + 'px';
    node.style.height = rect.height + 'px';
  };

  var bar = document.createElement('div');
  bar.className = 'bar';
  shadow.appendChild(bar);

  var toolRow = document.createElement('div');
  toolRow.className = 'row';
  bar.appendChild(toolRow);

  var makeButton = function (label, className) {
    var button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    if (className) button.className = className;
    return button;
  };

  var selectButton = makeButton(LABELS.select);
  var marqueeButton = makeButton(LABELS.marquee);
  var drawButton = makeButton(LABELS.draw);
  var stylesButton = makeButton(LABELS.styles);
  var countLabel = document.createElement('span');
  countLabel.className = 'count';
  var spacer = document.createElement('span');
  spacer.style.flex = '1';
  var clearButton = makeButton(LABELS.clear);
  var cancelButton = makeButton(LABELS.cancel);
  toolRow.append(selectButton, marqueeButton, drawButton, stylesButton, countLabel, spacer, clearButton, cancelButton);

  var commentRow = document.createElement('div');
  commentRow.className = 'row';
  bar.appendChild(commentRow);
  var comment = document.createElement('textarea');
  comment.rows = 1;
  comment.placeholder = LABELS.commentPlaceholder;
  var submitButton = makeButton(LABELS.submit, 'primary');
  commentRow.append(comment, submitButton);

  var panel = document.createElement('div');
  panel.className = 'panel';
  bar.appendChild(panel);

  var panelOpen = false;

  var resizeComment = function () {
    comment.style.height = 'auto';
    comment.style.height = Math.min(comment.scrollHeight, 96) + 'px';
  };
  comment.addEventListener('input', resizeComment);

  // ------------------------------------------------------------ style panel

  var makeGroup = function (title) {
    var group = document.createElement('div');
    group.className = 'group';
    var heading = document.createElement('span');
    heading.textContent = title;
    group.appendChild(heading);
    return group;
  };

  var makeField = function (group, labelText, input) {
    var field = document.createElement('div');
    field.className = 'field';
    var label = document.createElement('label');
    label.textContent = labelText;
    field.append(label, input);
    group.appendChild(field);
    return input;
  };

  var applyStyle = function (property, value) {
    var target = selected;
    if (!target) return;
    if (!target.baseline.has(property)) {
      target.baseline.set(property, target.element.style.getPropertyValue(property));
    }
    var key = target.id + '|' + property;
    var previous = styleChanges.has(key)
      ? styleChanges.get(key).previousValue
      : String(window.getComputedStyle(target.element).getPropertyValue(property) || '');
    target.element.style.setProperty(property, value, 'important');
    styleChanges.set(key, { targetId: target.id, property: property, previousValue: previous, value: value });
    syncSelectionVisuals();
  };

  var revertStyles = function () {
    if (selected) {
      selected.baseline.forEach(function (baselineValue, property) {
        if (baselineValue) selected.element.style.setProperty(property, baselineValue);
        else selected.element.style.removeProperty(property);
      });
      selected.baseline.clear();
    }
    styleChanges.clear();
  };

  var textGroup = makeGroup(LABELS.text);
  var fontSizeInput = makeField(textGroup, LABELS.fontSize, document.createElement('input'));
  fontSizeInput.type = 'text';
  fontSizeInput.placeholder = '16px';
  fontSizeInput.addEventListener('change', function () {
    if (fontSizeInput.value.trim()) applyStyle('font-size', fontSizeInput.value.trim());
  });
  var fontWeightSelect = makeField(textGroup, LABELS.fontWeight, document.createElement('select'));
  ['', '300', '400', '500', '600', '700', '800'].forEach(function (weight) {
    var option = document.createElement('option');
    option.value = weight;
    option.textContent = weight || '—';
    fontWeightSelect.appendChild(option);
  });
  fontWeightSelect.addEventListener('change', function () {
    if (fontWeightSelect.value) applyStyle('font-weight', fontWeightSelect.value);
  });

  var colorGroup = makeGroup(LABELS.colors);
  var textColorInput = makeField(colorGroup, LABELS.textColor, document.createElement('input'));
  textColorInput.type = 'color';
  textColorInput.addEventListener('input', function () { applyStyle('color', textColorInput.value); });
  var backgroundInput = makeField(colorGroup, LABELS.background, document.createElement('input'));
  backgroundInput.type = 'color';
  backgroundInput.addEventListener('input', function () { applyStyle('background-color', backgroundInput.value); });

  var borderGroup = makeGroup(LABELS.borders);
  var borderColorInput = makeField(borderGroup, LABELS.borderColor, document.createElement('input'));
  borderColorInput.type = 'color';
  borderColorInput.addEventListener('input', function () {
    applyStyle('border-color', borderColorInput.value);
    applyStyle('border-style', 'solid');
  });
  var borderWidthInput = makeField(borderGroup, LABELS.borderWidth, document.createElement('input'));
  borderWidthInput.type = 'text';
  borderWidthInput.placeholder = '1px';
  borderWidthInput.addEventListener('change', function () {
    if (!borderWidthInput.value.trim()) return;
    applyStyle('border-width', borderWidthInput.value.trim());
    applyStyle('border-style', 'solid');
  });
  var radiusInput = makeField(borderGroup, LABELS.borderRadius, document.createElement('input'));
  radiusInput.type = 'text';
  radiusInput.placeholder = '8px';
  radiusInput.addEventListener('change', function () {
    if (radiusInput.value.trim()) applyStyle('border-radius', radiusInput.value.trim());
  });

  var sizeGroup = makeGroup(LABELS.sizing);
  var widthInput = makeField(sizeGroup, LABELS.width, document.createElement('input'));
  widthInput.type = 'text';
  widthInput.placeholder = 'auto';
  widthInput.addEventListener('change', function () {
    if (widthInput.value.trim()) applyStyle('width', widthInput.value.trim());
  });
  var heightInput = makeField(sizeGroup, LABELS.height, document.createElement('input'));
  heightInput.type = 'text';
  heightInput.placeholder = 'auto';
  heightInput.addEventListener('change', function () {
    if (heightInput.value.trim()) applyStyle('height', heightInput.value.trim());
  });
  var opacityInput = makeField(sizeGroup, LABELS.opacity, document.createElement('input'));
  opacityInput.type = 'range';
  opacityInput.min = '0';
  opacityInput.max = '1';
  opacityInput.step = '0.05';
  opacityInput.value = '1';
  opacityInput.addEventListener('input', function () { applyStyle('opacity', opacityInput.value); });

  panel.append(textGroup, colorGroup, borderGroup, sizeGroup);

  // -------------------------------------------------------------- selection

  var syncSelectionVisuals = function () {
    var target = selected;
    if (!target) return;
    var rect = rectFrom(target.element.getBoundingClientRect());
    if (!usableRect(rect)) {
      target.outline.style.display = 'none';
      target.badge.style.display = 'none';
      return;
    }
    positionBox(target.outline, rect);
    target.badge.style.display = 'block';
    target.badge.style.transform = 'translate(' + Math.max(2, rect.x) + 'px,' + Math.max(2, rect.y - 17) + 'px)';
  };

  var syncChrome = function () {
    var total = (selected ? 1 : 0) + regions.length + strokes.length;
    countLabel.textContent = total > 0 ? String(total) : '';
    submitButton.disabled = total === 0;
    panel.style.display = panelOpen && selected ? 'grid' : 'none';
    stylesButton.setAttribute('aria-pressed', panelOpen && selected ? 'true' : 'false');
    selectButton.setAttribute('aria-pressed', tool === 'select' ? 'true' : 'false');
    marqueeButton.setAttribute('aria-pressed', tool === 'marquee' ? 'true' : 'false');
    drawButton.setAttribute('aria-pressed', tool === 'draw' ? 'true' : 'false');
  };

  var dropSelection = function () {
    if (!selected) return;
    // Reverting first: the element is about to stop being tracked, and a style
    // edit left on it could never be undone afterwards.
    revertStyles();
    selected.outline.remove();
    selected.badge.remove();
    selected = null;
  };

  var selectElement = function (element) {
    var wasSelected = selected && selected.element === element;
    dropSelection();
    if (wasSelected) {
      // Clicking the chosen element again clears it, so a misclick is one
      // click to undo rather than a trip through Clear.
      syncChrome();
      return;
    }
    var outline = document.createElement('div');
    outline.className = 'box';
    var badge = document.createElement('div');
    badge.className = 'label';
    badge.textContent = selectorPart(element);
    shadow.appendChild(outline);
    shadow.appendChild(badge);
    selected = { id: nextId('element'), element: element, outline: outline, badge: badge, baseline: new Map() };
    syncSelectionVisuals();
    syncChrome();
  };

  var clearAll = function () {
    dropSelection();
    regions.length = 0;
    strokes.length = 0;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    marqueeBox.style.display = 'none';
    syncChrome();
  };

  var setTool = function (next) {
    tool = next;
    hoverBox.style.display = 'none';
    hoverLabel.style.display = 'none';
    marqueeBox.style.display = 'none';
    setCursor(next === 'draw' ? 'crosshair' : next === 'marquee' ? 'crosshair' : '');
    syncChrome();
  };

  selectButton.addEventListener('click', function () { setTool('select'); });
  marqueeButton.addEventListener('click', function () { setTool('marquee'); });
  drawButton.addEventListener('click', function () { setTool('draw'); });
  stylesButton.addEventListener('click', function () { panelOpen = !panelOpen; syncChrome(); });
  clearButton.addEventListener('click', clearAll);

  // ------------------------------------------------------------- interaction

  var drag = null;

  var onPointerMove = function (event) {
    if (drag) {
      if (drag.kind === 'marquee') {
        drag.rect = normalizeRect(drag.startX, drag.startY, event.clientX, event.clientY);
        positionBox(marqueeBox, drag.rect);
      } else if (drag.kind === 'draw') {
        drag.points.push({ x: event.clientX, y: event.clientY });
        drag.path.setAttribute('d', drag.points.map(function (point, index) {
          return (index === 0 ? 'M' : 'L') + point.x + ' ' + point.y;
        }).join(' '));
      }
      return;
    }

    if (tool !== 'select') return;
    var element = elementFromPoint(event.clientX, event.clientY);
    if (!element) {
      hoverBox.style.display = 'none';
      hoverLabel.style.display = 'none';
      return;
    }
    var rect = rectFrom(element.getBoundingClientRect());
    positionBox(hoverBox, rect);
    hoverLabel.textContent = selectorPart(element);
    hoverLabel.style.display = 'block';
    hoverLabel.style.transform = 'translate(' + Math.max(2, rect.x) + 'px,' + Math.max(2, rect.y - 17) + 'px)';
  };

  var onPointerDown = function (event) {
    if (event.button !== 0) return;
    if (isOverlayNode(event.target)) return;
    event.preventDefault();
    event.stopPropagation();

    if (tool === 'select') {
      var element = elementFromPoint(event.clientX, event.clientY);
      if (element) selectElement(element);
      return;
    }

    if (tool === 'marquee') {
      drag = { kind: 'marquee', startX: event.clientX, startY: event.clientY, rect: null };
      return;
    }

    var path = document.createElementNS(svgNS, 'path');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', THEME.primary);
    path.setAttribute('stroke-width', '2.5');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);
    drag = { kind: 'draw', path: path, points: [{ x: event.clientX, y: event.clientY }] };
  };

  var onPointerUp = function () {
    if (!drag) return;
    var finished = drag;
    drag = null;

    if (finished.kind === 'marquee') {
      marqueeBox.style.display = 'none';
      var rect = finished.rect;
      if (!rect || !usableRect(rect)) return;
      // A region marks an area of the page, not the elements inside it. It used
      // to expand into a selection of every element it fully contained, which
      // silently turned one drag into twenty targets and made the tool
      // unpredictable: what you got depended on the page's markup, not on what
      // you drew.
      regions.push({ id: nextId('region'), rect: rect });
      var outline = document.createElementNS(svgNS, 'rect');
      outline.setAttribute('x', String(rect.x));
      outline.setAttribute('y', String(rect.y));
      outline.setAttribute('width', String(rect.width));
      outline.setAttribute('height', String(rect.height));
      outline.style.fill = THEME.primarySoft;
      outline.setAttribute('stroke', THEME.primary);
      outline.setAttribute('stroke-width', '1.5');
      outline.setAttribute('rx', '2');
      svg.appendChild(outline);
      syncChrome();
      return;
    }

    var points = finished.points;
    if (points.length < 2) {
      if (finished.path.parentNode) finished.path.parentNode.removeChild(finished.path);
      return;
    }
    var minX = points[0].x, minY = points[0].y, maxX = points[0].x, maxY = points[0].y;
    for (var p = 1; p < points.length; p += 1) {
      minX = Math.min(minX, points[p].x);
      minY = Math.min(minY, points[p].y);
      maxX = Math.max(maxX, points[p].x);
      maxY = Math.max(maxY, points[p].y);
    }
    strokes.push({
      id: nextId('stroke'),
      points: points,
      bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
    });
    syncChrome();
  };

  var onScrollOrResize = function () { syncSelectionVisuals(); };

  var onKeyDown = function (event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      finish(null);
    }
  };

  document.addEventListener('pointermove', onPointerMove, true);
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('pointerup', onPointerUp, true);
  window.addEventListener('scroll', onScrollOrResize, true);
  window.addEventListener('resize', onScrollOrResize, true);
  window.addEventListener('keydown', onKeyDown, true);

  // ------------------------------------------------------------------ finish

  // Style edits intentionally outlive the overlay: the host screenshots the
  // page after we resolve, and that capture must show the requested visual
  // state. The host calls this hook once the capture is done.
  window['${ANNOTATION_REVERT_HOOK}'] = function () {
    try { revertStyles(); } catch (error) { /* elements already gone */ }
    try { delete window['${ANNOTATION_REVERT_HOOK}']; } catch (error) { /* non-configurable */ }
    try { delete window['${ANNOTATION_ACTIVE_FLAG}']; } catch (error) { /* non-configurable */ }
  };

  var teardown = function () {
    document.removeEventListener('pointermove', onPointerMove, true);
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('pointerup', onPointerUp, true);
    window.removeEventListener('scroll', onScrollOrResize, true);
    window.removeEventListener('resize', onScrollOrResize, true);
    window.removeEventListener('keydown', onKeyDown, true);
    setCursor('');
    if (cursorStyle.parentNode) cursorStyle.parentNode.removeChild(cursorStyle);
    if (host.parentNode) host.parentNode.removeChild(host);
  };

  var finish = function (payload) {
    if (settled) return;
    settled = true;
    if (!payload) {
      var revert = window['${ANNOTATION_REVERT_HOOK}'];
      if (typeof revert === 'function') revert();
    }
    teardown();
    // Removing the chrome is not enough: the host screenshots this page right
    // after we resolve, and the compositor can still be holding a frame that
    // contains our outlines and labels. Yield two frames so the page has
    // actually repainted without them.
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { resolve(payload); });
    });
  };

  submitButton.addEventListener('click', function () {
    if (!selected && regions.length === 0 && strokes.length === 0) return;
    // Zero or one, never more. Kept as a list so regions, strokes and elements
    // stay one uniform shape for everything downstream.
    var elements = selected ? [{ id: selected.id, element: describe(selected.element) }] : [];
    var changes = [];
    styleChanges.forEach(function (change) { changes.push(change); });

    finish({
      id: 'annotation-' + Date.now(),
      pageUrl: String(location.href),
      pageTitle: String(document.title || ''),
      viewport: { width: window.innerWidth, height: window.innerHeight },
      devicePixelRatio: window.devicePixelRatio || 1,
      comment: comment.value,
      elements: elements,
      regions: regions.map(function (entry) { return { id: entry.id, rect: entry.rect }; }),
      strokes: strokes.map(function (entry) {
        return { id: entry.id, points: entry.points, bounds: entry.bounds };
      }),
      styleChanges: changes
    });
  });

  cancelButton.addEventListener('click', function () { finish(null); });

  (document.body || document.documentElement).appendChild(host);
  setTool('select');
  syncChrome();
  resizeComment();
});`;
};
