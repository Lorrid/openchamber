import { clearNode, ensureStyle } from './dom.ts';
import { icon } from './icons.ts';
import { appendIssueCardRichText } from './media.ts';
import { createChoiceMenu, placeFixedMenu } from './menu.ts';
import { UI_CSS } from './style.ts';
import type { IssueCardHandle, IssueCardLabels, IssueCardProps } from './types.ts';

const DEFAULT_LABELS: IssueCardLabels = {
  back: 'Back',
  open: 'Open',
  status: 'Status',
  comments: 'Comments',
  emptyDescription: 'No description',
  emptyComments: 'No comments',
  tags: 'Labels',
  action: 'Start session',
  busy: 'Loading…',
};

export const resolveIssueCardLabels = (labels: Partial<IssueCardLabels> | undefined): IssueCardLabels => ({
  back: labels?.back ?? DEFAULT_LABELS.back,
  open: labels?.open ?? DEFAULT_LABELS.open,
  status: labels?.status ?? DEFAULT_LABELS.status,
  comments: labels?.comments ?? DEFAULT_LABELS.comments,
  emptyDescription: labels?.emptyDescription ?? DEFAULT_LABELS.emptyDescription,
  emptyComments: labels?.emptyComments ?? DEFAULT_LABELS.emptyComments,
  tags: labels?.tags ?? DEFAULT_LABELS.tags,
  action: labels?.action ?? DEFAULT_LABELS.action,
  busy: labels?.busy ?? DEFAULT_LABELS.busy,
});

const selectedStatusLabel = (props: IssueCardProps, value: string): string => {
  const selected = props.status?.options.find((option) => option.id === value);
  return selected?.label ?? value;
};

export const mountIssueCard = (root: Element, initial: IssueCardProps): IssueCardHandle => {
  ensureStyle(UI_CSS);
  let props = initial;
  let statusValue = initial.status?.value ?? '';
  let menu: HTMLDivElement | null = null;
  let openTrigger: HTMLButtonElement | null = null;

  const shell = document.createElement('div');
  shell.className = 'oc-sdk-card';
  root.append(shell);

  const removeMenu = (): void => {
    menu?.remove();
    menu = null;
    openTrigger = null;
  };

  const placeMenu = (): void => {
    if (!menu || !openTrigger) {
      return;
    }
    placeFixedMenu(menu, openTrigger);
  };

  const paint = (): void => {
    removeMenu();
    clearNode(shell);
    const copy = resolveIssueCardLabels(props.labels);
    const bar = document.createElement('div');
    bar.className = 'oc-sdk-card-bar';
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'oc-sdk-card-back';
    back.setAttribute('aria-label', copy.back);
    back.append(icon('back', 16), document.createTextNode(copy.back));
    back.addEventListener('click', () => {
      props.onBack();
    });
    bar.append(back);
    if (props.onOpen) {
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'oc-sdk-card-open';
      open.setAttribute('aria-label', copy.open);
      open.append(icon('open', 16));
      open.addEventListener('click', () => {
        props.onOpen?.(props.item);
      });
      bar.append(open);
    }
    const body = document.createElement('div');
    body.className = 'oc-sdk-card-body';
    if (props.busy && !props.item.title) {
      const empty = document.createElement('div');
      empty.className = 'oc-sdk-empty';
      empty.textContent = copy.busy;
      body.append(empty);
    } else {
      const stack = document.createElement('div');
      stack.className = 'oc-sdk-card-stack';
      const heading = document.createElement('div');
      const id = document.createElement('div');
      id.className = 'oc-sdk-card-id';
      id.textContent = props.item.identifier ?? props.item.id;
      const title = document.createElement('h2');
      title.className = 'oc-sdk-card-title';
      title.textContent = props.item.title;
      heading.append(id, title);
      stack.append(heading);

      if (props.status || props.secondaryAction) {
        const row = document.createElement('div');
        row.className = 'oc-sdk-card-actions';
        if (props.status) {
          const select = document.createElement('button');
          select.type = 'button';
          select.className = 'oc-sdk-card-select';
          select.setAttribute('aria-label', copy.status);
          select.setAttribute('aria-haspopup', 'listbox');
          select.setAttribute('aria-expanded', 'false');
          if (props.busy) {
            select.disabled = true;
          }
          const caption = document.createElement('span');
          caption.textContent = selectedStatusLabel(props, statusValue);
          select.append(caption, icon('chevron', 14, 'oc-sdk-filter-chevron'));
          select.addEventListener('click', () => {
            if (menu) {
              removeMenu();
              select.setAttribute('aria-expanded', 'false');
              return;
            }
            openTrigger = select;
            menu = createChoiceMenu(copy.status, statusValue, props.status?.options ?? [], (next) => {
              statusValue = next;
              props.onStatusChange?.(next);
              paint();
            });
            document.body.append(menu);
            select.setAttribute('aria-expanded', 'true');
            placeMenu();
          });
          row.append(select);
        }
        if (props.secondaryAction) {
          const secondary = document.createElement('button');
          secondary.type = 'button';
          secondary.className = 'oc-sdk-card-secondary';
          secondary.textContent = props.secondaryAction.label;
          if (props.busy) {
            secondary.disabled = true;
          }
          secondary.addEventListener('click', () => {
            props.secondaryAction?.onClick();
          });
          row.append(secondary);
        }
        stack.append(row);
      }

      const fields = (props.fields ?? []).filter((field) => field.value.trim() !== '');
      const tags = props.tags ?? [];
      if (fields.length > 0 || tags.length > 0) {
        const list = document.createElement('dl');
        list.className = 'oc-sdk-card-meta';
        for (const field of fields) {
          const dt = document.createElement('dt');
          dt.className = 'oc-sdk-card-dt';
          dt.textContent = field.label;
          const dd = document.createElement('dd');
          dd.className = 'oc-sdk-card-dd';
          dd.textContent = field.value;
          list.append(dt, dd);
        }
        if (tags.length > 0) {
          const dt = document.createElement('dt');
          dt.className = 'oc-sdk-card-dt';
          dt.textContent = copy.tags;
          const dd = document.createElement('dd');
          dd.className = 'oc-sdk-card-dd';
          const chips = document.createElement('div');
          chips.className = 'oc-sdk-card-chips';
          for (const tag of tags) {
            const chip = document.createElement('span');
            chip.className = 'oc-sdk-card-chip';
            chip.textContent = tag.name;
            chips.append(chip);
          }
          dd.append(chips);
          list.append(dt, dd);
        }
        stack.append(list);
      }

      const description = document.createElement('div');
      const descriptionText = props.description?.trim() ?? '';
      if (appendIssueCardRichText(description, descriptionText, 'oc-sdk-card-description', props.onOpenUrl)) {
        description.className = 'oc-sdk-card-rich';
      } else {
        description.className = 'oc-sdk-card-muted';
        description.textContent = copy.emptyDescription;
      }
      stack.append(description);

      const commentsWrap = document.createElement('div');
      const commentsTitle = document.createElement('h3');
      commentsTitle.className = 'oc-sdk-card-comments-title';
      commentsTitle.textContent = copy.comments;
      commentsWrap.append(commentsTitle);
      const comments = props.comments ?? [];
      if (comments.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'oc-sdk-card-muted';
        empty.textContent = copy.emptyComments;
        commentsWrap.append(empty);
      } else {
        const thread = document.createElement('div');
        thread.className = 'oc-sdk-card-thread';
        comments.forEach((comment, index) => {
          const row = document.createElement('div');
          row.className = 'oc-sdk-card-comment';
          if (index < comments.length - 1) {
            const line = document.createElement('div');
            line.className = 'oc-sdk-card-comment-line';
            row.append(line);
          }
          const avatar = document.createElement('div');
          avatar.className = 'oc-sdk-card-avatar';
          avatar.textContent = comment.author.trim().charAt(0).toUpperCase() || '?';
          const bubble = document.createElement('div');
          bubble.className = 'oc-sdk-card-bubble';
          const meta = document.createElement('div');
          meta.className = 'oc-sdk-card-comment-meta';
          const author = document.createElement('span');
          author.className = 'oc-sdk-card-comment-author';
          author.textContent = comment.author;
          meta.append(author);
          if (comment.createdAt) {
            const when = document.createElement('span');
            when.textContent = comment.createdAt;
            meta.append(when);
          }
          bubble.append(meta);
          if (comment.body.trim()) {
            appendIssueCardRichText(bubble, comment.body, 'oc-sdk-card-description', props.onOpenUrl);
          }
          row.append(avatar, bubble);
          thread.append(row);
        });
        commentsWrap.append(thread);
      }
      stack.append(commentsWrap);
      body.append(stack);
    }

    shell.append(bar, body);
    if (props.onAction) {
      const foot = document.createElement('div');
      foot.className = 'oc-sdk-card-foot';
      const action = document.createElement('button');
      action.type = 'button';
      action.className = 'oc-sdk-card-action';
      action.textContent = copy.action;
      if (props.busy) {
        action.disabled = true;
      }
      action.addEventListener('click', () => {
        props.onAction?.(props.item);
      });
      foot.append(action);
      shell.append(foot);
    }
  };

  const onDocumentPointerDown = (event: PointerEvent): void => {
    if (!(event.target instanceof Element)) {
      return;
    }
    if (event.target.closest('.oc-sdk-card-select') || event.target.closest('.oc-sdk-menu')) {
      return;
    }
    if (!menu) {
      return;
    }
    removeMenu();
  };

  const onDocumentKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !menu) {
      return;
    }
    removeMenu();
  };

  document.addEventListener('pointerdown', onDocumentPointerDown);
  document.addEventListener('keydown', onDocumentKeyDown);
  window.addEventListener('resize', placeMenu);
  window.addEventListener('scroll', placeMenu, true);
  paint();

  return {
    update: (next) => {
      const itemChanged = next.item.id !== props.item.id;
      props = next;
      if (itemChanged) {
        statusValue = next.status?.value ?? '';
      } else if (next.status) {
        statusValue = next.status.value;
      }
      paint();
    },
    dispose: () => {
      document.removeEventListener('pointerdown', onDocumentPointerDown);
      document.removeEventListener('keydown', onDocumentKeyDown);
      window.removeEventListener('resize', placeMenu);
      window.removeEventListener('scroll', placeMenu, true);
      removeMenu();
      shell.remove();
    },
  };
};
