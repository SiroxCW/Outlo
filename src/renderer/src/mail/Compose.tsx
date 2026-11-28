import {
  Button,
  makeStyles,
  mergeClasses,
  Spinner,
  ToggleButton,
  tokens,
  Tooltip,
} from '@fluentui/react-components';
import {
  DeleteRegular,
  MoreHorizontalRegular,
  SendRegular,
  TextBoldRegular,
  TextBulletListLtrRegular,
  TextItalicRegular,
  TextNumberListLtrRegular,
  TextUnderlineRegular,
} from '@fluentui/react-icons';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { Draft, DraftContent, InlineImage } from '@shared/api';
import { t } from '../i18n';
import { darkTheme, lightTheme } from '../theme';
import { MessageBody } from './MessageBody';
import { RecipientField } from './RecipientField';
import { prepareMail } from './sanitize';

// A draft is saved this long after the user stopped typing, and at the latest this long after
// the first change that was not saved.
const SAVE_PAUSE = 1500;
const SAVE_LONGEST = 10_000;

const useStyles = makeStyles({
  card: {
    display: 'flex',
    flexDirection: 'column',
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow2,
    overflow: 'hidden',
  },
  fill: { flexGrow: 1, minHeight: 0 },
  fit: { flexShrink: 0 },
  loading: { padding: '24px', alignSelf: 'flex-start' },
  gone: { padding: '24px', color: tokens.colorNeutralForeground3 },
  actions: {
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '12px 24px 8px',
  },
  status: {
    marginLeft: 'auto',
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  error: { color: tokens.colorPaletteRedForeground1 },
  fields: { flexShrink: 0, padding: '0 24px' },
  from: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    minHeight: '36px',
    color: tokens.colorNeutralForeground2,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  fromLabel: { width: '32px' },
  lineButton: { minWidth: 'auto' },
  subject: {
    width: '100%',
    boxSizing: 'border-box',
    minHeight: '40px',
    border: 'none',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    outline: 'none',
    backgroundColor: 'transparent',
    color: 'inherit',
    fontFamily: 'inherit',
    fontSize: tokens.fontSizeBase400,
    ':focus': { borderBottomColor: tokens.colorBrandStroke1 },
  },
  toolbar: { flexShrink: 0, display: 'flex', gap: '2px', padding: '6px 20px 0' },
  // Alone in the pane, the text scrolls inside the card.
  body: { display: 'flex', flexDirection: 'column' },
  scroll: { flexGrow: 1, minHeight: 0, overflowY: 'auto' },
  editor: {
    '& .ProseMirror': {
      minHeight: '160px',
      padding: '12px 24px',
      outline: 'none',
      fontFamily: 'Aptos, Calibri, Helvetica, sans-serif',
      fontSize: '16px',
      lineHeight: '1.4',
      overflowWrap: 'anywhere',
    },
    '& .ProseMirror p': { margin: 0 },
    '& .ProseMirror ul, & .ProseMirror ol': { margin: 0, paddingLeft: '28px' },
    '& .ProseMirror blockquote': {
      margin: '0 0 0 4px',
      paddingLeft: '12px',
      borderLeft: `3px solid ${tokens.colorNeutralStroke1}`,
    },
    '& .ProseMirror a': { color: tokens.colorBrandForegroundLink },
  },
  history: { alignSelf: 'flex-start', margin: '0 20px 12px' },
  quote: { padding: '0 0 12px' },
});

// React may mount an editor again right after it unmounted it, as it does during development.
// Closing waits a moment, so a draft that is opened again at once is not closed.
const closing = new Map<number, number>();

function closeLater(id: number, content: DraftContent | undefined): void {
  closing.set(
    id,
    window.setTimeout(() => {
      closing.delete(id);
      void window.outlo.request('drafts.close', { id, content });
    }, 0),
  );
}

function keepOpen(id: number): void {
  window.clearTimeout(closing.get(id));
  closing.delete(id);
}

interface ComposeProps {
  // The ID of the draft's message.
  id: number;
  // Fill: alone in the pane. Fit: a card of a conversation.
  size: 'fill' | 'fit';
  dark: boolean;
  // Set when the user has more than one account, so it is clear which one writes.
  showFrom: boolean;
  // The draft was thrown away. Its source is the message it answered, if that is stored.
  onDiscarded(sourceId: number | null): void;
}

// A draft in the editor, as in the reading pane of Outlook.
export function Compose({ id, size, dark, showFrom, onDiscarded }: ComposeProps) {
  const styles = useStyles();
  const [loaded, setLoaded] = useState<{ id: number; draft: Draft | null }>();
  useEffect(() => {
    let current = true;
    void window.outlo.request('drafts.get', { id }).then((draft) => {
      if (current) setLoaded({ id, draft });
    });
    return () => {
      current = false;
    };
  }, [id]);

  const card = mergeClasses(styles.card, size === 'fill' ? styles.fill : styles.fit);
  if (loaded?.id !== id) {
    return (
      <div className={card}>
        <Spinner className={styles.loading} size="tiny" label={t('compose.loading')} />
      </div>
    );
  }
  if (!loaded.draft) {
    return <div className={mergeClasses(card, styles.gone)}>{t('compose.gone')}</div>;
  }
  return (
    <DraftEditor
      key={id}
      draft={loaded.draft}
      size={size}
      dark={dark}
      showFrom={showFrom}
      onDiscarded={onDiscarded}
    />
  );
}

type Fields = Omit<DraftContent, 'text'>;

interface DraftEditorProps extends Omit<ComposeProps, 'id'> {
  draft: Draft;
}

function DraftEditor({ draft, size, dark, showFrom, onDiscarded }: DraftEditorProps) {
  const styles = useStyles();
  const [values, setValues] = useState<Fields>(() => ({
    to: draft.to,
    cc: draft.cc,
    bcc: draft.bcc,
    subject: draft.subject,
  }));
  const [showCc, setShowCc] = useState(draft.cc.length > 0);
  const [showBcc, setShowBcc] = useState(draft.bcc.length > 0);
  // A forward shows the message it forwards. An answer hides the earlier messages, as Outlook.
  const [showQuote, setShowQuote] = useState(draft.kind === 'forward');
  const [saved, setSaved] = useState<{ at: number } | 'failed'>();

  // What the user wrote, also in refs, so the timers and the closing see the latest.
  const fields = useRef(values);
  const text = useRef(draft.text);
  const dirty = useRef(false);
  const discarded = useRef(false);
  const timer = useRef<number>(undefined);
  const firstChange = useRef<number>(undefined);
  const queue = useRef<Promise<void>>(Promise.resolve());

  const content = (): DraftContent => ({ ...fields.current, text: text.current });

  const save = () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    firstChange.current = undefined;
    if (!dirty.current || discarded.current) return;
    dirty.current = false;
    const next = content();
    // One save after the other, so an older one never arrives last.
    queue.current = queue.current.then(() =>
      window.outlo.request('drafts.save', { id: draft.id, content: next }).then(
        () => setSaved({ at: Date.now() }),
        () => {
          dirty.current = true;
          setSaved('failed');
        },
      ),
    );
  };

  const changed = () => {
    dirty.current = true;
    const now = Date.now();
    firstChange.current ??= now;
    window.clearTimeout(timer.current);
    const wait = Math.min(SAVE_PAUSE, Math.max(0, firstChange.current + SAVE_LONGEST - now));
    timer.current = window.setTimeout(save, wait);
  };

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        code: false,
        codeBlock: false,
        link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
      }),
    ],
    content: draft.text,
    // Answers start in the text, a new mail in the To line.
    autofocus: draft.kind === 'reply' || draft.kind === 'replyAll' ? 'start' : false,
    editorProps: { attributes: { 'aria-label': t('compose.text'), role: 'textbox' } },
    onUpdate: ({ editor: current }) => {
      text.current = current.getHTML();
      changed();
    },
  });

  // On closing, what was not saved yet goes along. A draft nobody wrote in is removed then.
  useEffect(() => {
    keepOpen(draft.id);
    if (dirty.current) changed();
    return () => {
      window.clearTimeout(timer.current);
      if (discarded.current) return;
      closeLater(draft.id, dirty.current ? content() : undefined);
    };
    // Runs once per draft. The refs hold what changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.id]);

  const setField = <Key extends keyof Fields>(key: Key, value: Fields[Key]) => {
    fields.current = { ...fields.current, [key]: value };
    setValues(fields.current);
    changed();
  };

  const discard = async () => {
    discarded.current = true;
    window.clearTimeout(timer.current);
    await queue.current;
    await window.outlo.request('drafts.discard', { id: draft.id });
    onDiscarded(draft.sourceId);
  };

  const time = (at: number) =>
    new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const body = (
    <>
      <EditorContent editor={editor} className={styles.editor} />
      {draft.quote &&
        (showQuote ? (
          <Quote html={draft.quote} sourceId={draft.sourceId} dark={dark} />
        ) : (
          <Tooltip content={t('compose.showHistory')} relationship="label">
            <Button
              className={styles.history}
              size="small"
              icon={<MoreHorizontalRegular />}
              onClick={() => setShowQuote(true)}
            />
          </Tooltip>
        ))}
    </>
  );

  return (
    <div className={mergeClasses(styles.card, size === 'fill' ? styles.fill : styles.fit)}>
      <div className={styles.actions}>
        <Tooltip content={t('compose.sendLater')} relationship="description">
          <Button appearance="primary" icon={<SendRegular />} disabledFocusable>
            {t('compose.send')}
          </Button>
        </Tooltip>
        <Button appearance="subtle" icon={<DeleteRegular />} onClick={() => void discard()}>
          {t('compose.discard')}
        </Button>
        <span className={mergeClasses(styles.status, saved === 'failed' && styles.error)}>
          {saved === 'failed'
            ? t('compose.saveFailed')
            : saved
              ? `${t('compose.savedAt')} ${time(saved.at)}`
              : ''}
        </span>
      </div>
      <div className={styles.fields}>
        {showFrom && (
          <div className={styles.from}>
            <span className={styles.fromLabel}>{t('compose.from')}</span>
            {draft.from.address}
          </div>
        )}
        <RecipientField
          label={t('compose.to')}
          value={values.to}
          onChange={(value) => setField('to', value)}
          autoFocus={draft.kind === 'new' || draft.kind === 'forward'}
        >
          {!showCc && (
            <Button
              className={styles.lineButton}
              size="small"
              appearance="transparent"
              onClick={() => setShowCc(true)}
            >
              {t('compose.cc')}
            </Button>
          )}
          {!showBcc && (
            <Button
              className={styles.lineButton}
              size="small"
              appearance="transparent"
              onClick={() => setShowBcc(true)}
            >
              {t('compose.bcc')}
            </Button>
          )}
        </RecipientField>
        {showCc && (
          <RecipientField
            label={t('compose.cc')}
            value={values.cc}
            onChange={(value) => setField('cc', value)}
          />
        )}
        {showBcc && (
          <RecipientField
            label={t('compose.bcc')}
            value={values.bcc}
            onChange={(value) => setField('bcc', value)}
          />
        )}
        <input
          className={styles.subject}
          placeholder={t('compose.subject')}
          aria-label={t('compose.subject')}
          value={values.subject}
          onChange={(event) => setField('subject', event.target.value)}
        />
      </div>
      {editor && <FormatBar editor={editor} />}
      {size === 'fill' ? (
        <div className={mergeClasses(styles.body, styles.scroll)}>{body}</div>
      ) : (
        <div className={styles.body}>{body}</div>
      )}
    </div>
  );
}

function FormatBar({ editor }: { editor: Editor }) {
  const styles = useStyles();
  const active = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current.isActive('bold'),
      italic: current.isActive('italic'),
      underline: current.isActive('underline'),
      bullets: current.isActive('bulletList'),
      numbers: current.isActive('orderedList'),
    }),
  });
  const button = (label: string, icon: ReactElement, checked: boolean, run: () => void) => (
    <Tooltip content={label} relationship="label">
      <ToggleButton
        size="small"
        appearance="subtle"
        icon={icon}
        checked={checked}
        // The text keeps its selection when the button is pressed.
        onMouseDown={(event) => event.preventDefault()}
        onClick={run}
      />
    </Tooltip>
  );
  const chain = () => editor.chain().focus();
  return (
    <div className={styles.toolbar} role="toolbar" aria-label={t('compose.format')}>
      {button(t('compose.bold'), <TextBoldRegular />, active.bold, () =>
        chain().toggleBold().run(),
      )}
      {button(t('compose.italic'), <TextItalicRegular />, active.italic, () =>
        chain().toggleItalic().run(),
      )}
      {button(t('compose.underline'), <TextUnderlineRegular />, active.underline, () =>
        chain().toggleUnderline().run(),
      )}
      {button(t('compose.bullets'), <TextBulletListLtrRegular />, active.bullets, () =>
        chain().toggleBulletList().run(),
      )}
      {button(t('compose.numbering'), <TextNumberListLtrRegular />, active.numbers, () =>
        chain().toggleOrderedList().run(),
      )}
    </div>
  );
}

// The earlier message below an answer or forward. It comes from mail, so it is shown like
// mail: cleaned, in a frame that can run nothing. Its pictures belong to the message it quotes.
function Quote({ html, sourceId, dark }: { html: string; sourceId: number | null; dark: boolean }) {
  const styles = useStyles();
  const [inlineImages, setInlineImages] = useState<InlineImage[]>([]);
  useEffect(() => {
    if (sourceId === null) return;
    void window.outlo
      .request('messages.get', { id: sourceId })
      .then((message) => message && setInlineImages(message.inlineImages));
  }, [sourceId]);
  const theme = dark ? darkTheme : lightTheme;
  const prepared = useMemo(
    () =>
      prepareMail(
        { contentType: 'html', content: html },
        {
          inlineImages,
          remoteImages: null,
          textColor: theme.colorNeutralForeground1,
          linkColor: theme.colorBrandForegroundLink,
          backgroundColor: theme.colorNeutralBackground1,
          dark,
        },
      ),
    [html, inlineImages, theme, dark],
  );
  return (
    <div className={styles.quote}>
      <MessageBody page={prepared.page} fit />
    </div>
  );
}
