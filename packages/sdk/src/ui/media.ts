export type IssueCardImage = {
  src: string;
  alt: string;
};

type IssueCardLink = {
  href: string;
  label: string;
};

type IssueCardRichPart =
  | { kind: 'text'; text: string }
  | { kind: 'image'; src: string; alt: string }
  | { kind: 'link'; href: string; label: string };

export type IssueCardMedia = {
  body: string;
  images: IssueCardImage[];
  links: IssueCardLink[];
};

const MARKDOWN_TOKEN = /(!?)\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g;

export const isIssueCardHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

export const splitIssueCardRich = (text: string): IssueCardRichPart[] => {
  const parts: IssueCardRichPart[] = [];
  let last = 0;
  for (const match of text.matchAll(MARKDOWN_TOKEN)) {
    const index = match.index ?? 0;
    if (index > last) {
      parts.push({ kind: 'text', text: text.slice(last, index) });
    }
    const marker = match[1] ?? '';
    const label = (match[2] ?? '').trim();
    const href = match[3] ?? '';
    if (!isIssueCardHttpUrl(href)) {
      parts.push({ kind: 'text', text: match[0] });
    } else if (marker === '!') {
      parts.push({ kind: 'image', src: href, alt: label });
    } else {
      parts.push({ kind: 'link', href, label: label || href });
    }
    last = index + match[0].length;
  }
  if (last < text.length) {
    parts.push({ kind: 'text', text: text.slice(last) });
  }
  return parts;
};

export const splitIssueCardMedia = (text: string): IssueCardMedia => {
  const images: IssueCardImage[] = [];
  const links: IssueCardLink[] = [];
  const body = splitIssueCardRich(text).map((part) => {
    if (part.kind === 'image') {
      images.push({ src: part.src, alt: part.alt });
      return '';
    }
    if (part.kind === 'link') {
      links.push({ href: part.href, label: part.label });
      return '';
    }
    return part.text;
  }).join('').replace(/\n{3,}/g, '\n\n').trim();
  return { body, images, links };
};

const appendLink = (
  root: HTMLElement,
  href: string,
  label: string,
  onOpenUrl: ((url: string) => void) | undefined,
): void => {
  const node = document.createElement('a');
  node.className = 'oc-sdk-card-link';
  node.href = href;
  node.rel = 'noopener noreferrer';
  node.target = '_blank';
  node.textContent = label;
  node.addEventListener('click', (event) => {
    if (!onOpenUrl) {
      return;
    }
    event.preventDefault();
    onOpenUrl(href);
  });
  root.append(node);
};

export const appendIssueCardRichText = (
  root: HTMLElement,
  text: string,
  className: string,
  onOpenUrl?: (url: string) => void,
): boolean => {
  const parts = splitIssueCardRich(text);
  const meaningful = parts.some((part) => (
    part.kind !== 'text' || part.text.trim() !== ''
  ));
  if (!meaningful) {
    return false;
  }
  const wrap = document.createElement('div');
  wrap.className = className;
  for (const part of parts) {
    if (part.kind === 'text') {
      if (part.text) {
        wrap.append(document.createTextNode(part.text));
      }
      continue;
    }
    if (part.kind === 'link') {
      appendLink(wrap, part.href, part.label, onOpenUrl);
      continue;
    }
    const img = document.createElement('img');
    img.className = 'oc-sdk-card-image';
    img.src = part.src;
    img.alt = part.alt;
    img.referrerPolicy = 'no-referrer';
    wrap.append(img);
  }
  root.append(wrap);
  return true;
};
