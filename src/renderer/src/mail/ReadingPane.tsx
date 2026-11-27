import {
  Avatar,
  Button,
  makeStyles,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  MessageBar,
  MessageBarActions,
  MessageBarBody,
  Spinner,
  tokens,
} from '@fluentui/react-components';
import {
  ArrowForwardRegular,
  ArrowReplyAllRegular,
  ArrowReplyRegular,
  AttachRegular,
  OpenRegular,
  SaveRegular,
  MailRegular,
} from '@fluentui/react-icons';
import { useMemo, useState } from 'react';
import { MAX_IMAGE_URLS, type Attachment } from '@shared/api';
import type { OpenMessage } from '../core/useMessage';
import { t } from '../i18n';
import { formatAddresses, formatFullDate, formatSize } from './format';
import { MessageBody } from './MessageBody';
import { prepareMail } from './sanitize';
import { darkTheme, lightTheme } from '../theme';

const useStyles = makeStyles({
  root: { height: '100%', display: 'flex', flexDirection: 'column', minWidth: 0 },
  card: {
    flexGrow: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow2,
    overflow: 'hidden',
  },
  empty: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: tokens.spacingVerticalM,
    color: tokens.colorNeutralForeground3,
  },
  emptyIcon: { fontSize: '64px', color: tokens.colorNeutralForeground4 },
  subject: {
    flexShrink: 0,
    margin: 0,
    padding: '6px 16px 12px',
    fontSize: tokens.fontSizeBase500,
    lineHeight: tokens.lineHeightBase500,
    fontWeight: tokens.fontWeightSemibold,
  },
  header: {
    flexShrink: 0,
    display: 'flex',
    gap: '12px',
    padding: '16px 24px 12px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  people: { flexGrow: 1, minWidth: 0, lineHeight: '20px' },
  sender: { fontWeight: tokens.fontWeightSemibold },
  line: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  muted: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  side: { flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end' },
  preview: { padding: '12px 24px 0', overflowWrap: 'anywhere' },
  attachments: {
    flexShrink: 0,
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    padding: '12px 24px 0',
  },
  attachment: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 10px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    fontSize: tokens.fontSizeBase200,
    backgroundColor: 'transparent',
    color: 'inherit',
    fontFamily: 'inherit',
    cursor: 'pointer',
    ':hover': { backgroundColor: tokens.colorNeutralBackground1Hover },
  },
  bar: { flexShrink: 0, margin: '12px 24px 0' },
  extras: {
    flexShrink: 0,
    paddingBottom: '12px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  loading: { padding: '24px', alignSelf: 'flex-start' },
});

interface ReadingPaneProps {
  // The message is undefined while loading, null when nothing is selected or it is gone.
  open: OpenMessage;
  dark: boolean;
}

type Notice =
  { messageId: number; kind: 'blocked' } | { messageId: number; kind: 'failed'; text: string };

export function ReadingPane({ open, dark }: ReadingPaneProps) {
  const styles = useStyles();
  const { message } = open;
  // Pictures from the internet that the user asked for. They belong to one message.
  const [pictures, setPictures] = useState<{ messageId: number; images: Record<string, string> }>();
  const [fetching, setFetching] = useState(false);
  const [notice, setNotice] = useState<Notice>();

  const theme = dark ? darkTheme : lightTheme;
  const body = message?.body;
  const messageId = message?.id;
  const inlineImages = message?.inlineImages;
  const inlineKey = inlineImages?.map((image) => image.contentId).join('\n');
  const remoteImages = pictures && pictures.messageId === messageId ? pictures.images : null;
  // The same text gives the same page, so the frame is not rebuilt when the message is only
  // fetched again after a sync.
  const prepared = useMemo(
    () =>
      body
        ? prepareMail(body, {
            inlineImages: inlineImages ?? [],
            remoteImages,
            textColor: theme.colorNeutralForeground1,
            linkColor: theme.colorBrandForegroundLink,
            dark,
          })
        : undefined,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [body?.contentType, body?.content, inlineKey, remoteImages, theme, dark],
  );
  if (message === undefined) {
    return (
      <div className={styles.empty}>
        <Spinner label={t('reading.loading')} />
      </div>
    );
  }
  if (message === null) {
    return (
      <div className={styles.empty}>
        <MailRegular className={styles.emptyIcon} />
        {t('reading.empty')}
      </div>
    );
  }

  const senderName = message.from.name || message.from.address;
  // Pictures that are shown inside the text are not listed as attachments again.
  const attachments = message.attachments.filter(
    (attachment) =>
      !attachment.contentId || !prepared?.usedContentIds.includes(attachment.contentId),
  );
  const blockedPictures = prepared && !remoteImages ? prepared.remoteImages : [];

  const showPictures = async () => {
    setFetching(true);
    const urls = blockedPictures.slice(0, MAX_IMAGE_URLS);
    const images = await window.outlo
      .request('images.fetch', { messageId: message.id, urls })
      .catch(() => ({}));
    setPictures({ messageId: message.id, images });
    setFetching(false);
  };

  const act = async (attachment: Attachment, action: 'open' | 'save') => {
    setNotice(undefined);
    const result = await window.outlo.attachments[action](attachment.id);
    if (result.status === 'blocked') setNotice({ messageId: message.id, kind: 'blocked' });
    if (result.status === 'failed') {
      setNotice({ messageId: message.id, kind: 'failed', text: result.message });
    }
  };
  const shownNotice = notice?.messageId === message.id ? notice : undefined;
  const hasExtras =
    attachments.length > 0 ||
    shownNotice !== undefined ||
    blockedPictures.length > 0 ||
    open.textState === 'failed';
  return (
    <article className={styles.root}>
      <h1 className={styles.subject}>{message.subject || t('reading.noSubject')}</h1>
      <div className={styles.card}>
        <div className={styles.header}>
          <Avatar name={senderName} color="colorful" size={40} />
          <div className={styles.people}>
            <div className={styles.line}>
              <span className={styles.sender}>{senderName}</span> &lt;{message.from.address}&gt;
            </div>
            <div className={styles.line}>
              {t('reading.to')} {formatAddresses(message.to)}
            </div>
            {message.cc.length > 0 && (
              <div className={styles.line}>
                {t('reading.cc')} {formatAddresses(message.cc)}
              </div>
            )}
          </div>
          <div className={styles.side}>
            <div>
              <Button
                appearance="subtle"
                icon={<ArrowReplyRegular />}
                aria-label={t('ribbon.reply')}
                disabled
              />
              <Button
                appearance="subtle"
                icon={<ArrowReplyAllRegular />}
                aria-label={t('ribbon.replyAll')}
                disabled
              />
              <Button
                appearance="subtle"
                icon={<ArrowForwardRegular />}
                aria-label={t('ribbon.forward')}
                disabled
              />
            </div>
            <span className={styles.muted}>{formatFullDate(message.receivedAt)}</span>
          </div>
        </div>

        {/* Everything between the header and the text sits in one block, set apart from the text. */}
        {hasExtras && (
          <div className={styles.extras}>
            {attachments.length > 0 && (
              <div className={styles.attachments}>
                {attachments.map((attachment) => (
                  <Menu key={attachment.id}>
                    <MenuTrigger disableButtonEnhancement>
                      <button type="button" className={styles.attachment}>
                        <AttachRegular />
                        {attachment.name}
                        <span className={styles.muted}>{formatSize(attachment.size)}</span>
                      </button>
                    </MenuTrigger>
                    <MenuPopover>
                      <MenuList>
                        <MenuItem
                          icon={<OpenRegular />}
                          onClick={() => void act(attachment, 'open')}
                        >
                          {t('attachment.open')}
                        </MenuItem>
                        <MenuItem
                          icon={<SaveRegular />}
                          onClick={() => void act(attachment, 'save')}
                        >
                          {t('attachment.save')}
                        </MenuItem>
                      </MenuList>
                    </MenuPopover>
                  </Menu>
                ))}
              </div>
            )}
            {shownNotice && (
              <MessageBar
                className={styles.bar}
                intent={shownNotice.kind === 'blocked' ? 'warning' : 'error'}
              >
                <MessageBarBody>
                  {shownNotice.kind === 'blocked'
                    ? t('attachment.blocked')
                    : `${t('attachment.failed')} ${shownNotice.text}`}
                </MessageBarBody>
              </MessageBar>
            )}
            {blockedPictures.length > 0 && (
              <MessageBar className={styles.bar}>
                <MessageBarBody>{t('reading.picturesBlocked')}</MessageBarBody>
                <MessageBarActions>
                  <Button size="small" disabled={fetching} onClick={() => void showPictures()}>
                    {t('reading.showPictures')}
                  </Button>
                </MessageBarActions>
              </MessageBar>
            )}
            {open.textState === 'failed' && (
              <MessageBar className={styles.bar} intent="error">
                <MessageBarBody>{t('reading.textFailed')}</MessageBarBody>
                <MessageBarActions>
                  <Button size="small" onClick={open.retryText}>
                    {t('reading.retry')}
                  </Button>
                </MessageBarActions>
              </MessageBar>
            )}
          </div>
        )}

        {prepared ? (
          <MessageBody page={prepared.page} />
        ) : open.textState === 'loading' ? (
          <Spinner className={styles.loading} size="tiny" label={t('reading.loadingText')} />
        ) : (
          <div className={styles.preview}>
            <p>{message.preview}</p>
            <p className={styles.muted}>{t('reading.previewOnly')}</p>
          </div>
        )}
      </div>
    </article>
  );
}
