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
  mergeClasses,
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
} from '@fluentui/react-icons';
import { useMemo, useState } from 'react';
import { MAX_IMAGE_URLS, type Attachment, type Message, type ResponseKind } from '@shared/api';
import type { OpenMessage } from '../core/useMessage';
import { t } from '../i18n';
import { darkTheme, lightTheme } from '../theme';
import { formatAddresses, formatFullDate, formatSize } from './format';
import { MessageBody } from './MessageBody';
import { prepareMail } from './sanitize';

const useStyles = makeStyles({
  card: {
    display: 'flex',
    flexDirection: 'column',
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow2,
    overflow: 'hidden',
  },
  // The only card of the pane fills it, and its text scrolls inside.
  fill: { flexGrow: 1, minHeight: 0 },
  // Cards of a conversation keep their height, and the pane scrolls.
  fit: { flexShrink: 0 },
  header: {
    flexShrink: 0,
    display: 'flex',
    gap: '12px',
    padding: '16px 24px 12px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  clickable: { cursor: 'pointer' },
  people: { flexGrow: 1, minWidth: 0, lineHeight: '20px' },
  sender: { fontWeight: tokens.fontWeightSemibold },
  line: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  muted: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  folder: { color: tokens.colorBrandForeground1, fontSize: tokens.fontSizeBase200 },
  side: { flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end' },
  preview: { padding: '12px 24px', overflowWrap: 'anywhere' },
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

export interface MessageCardProps {
  open: OpenMessage;
  message: Message;
  dark: boolean;
  // Fill: the card takes the whole pane. Fit: the card is as tall as the message, for a
  // conversation where several cards follow each other.
  size: 'fill' | 'fit';
  // Set when the message lies in another folder than the list, like an answer in Sent Items.
  folderName?: string;
  // Clicking the header folds the message, in a conversation.
  onHeaderClick?(): void;
  onRespond?(kind: ResponseKind): void;
}

type Notice = { kind: 'blocked' } | { kind: 'failed'; text: string };

// One message with its header, its attachments and its text.
export function MessageCard({
  open,
  message,
  dark,
  size,
  folderName,
  onHeaderClick,
  onRespond,
}: MessageCardProps) {
  const styles = useStyles();
  // Pictures from the internet that the user asked for. They belong to this message only: the
  // card is made again for another message.
  const [remoteImages, setRemoteImages] = useState<Record<string, string> | null>(null);
  const [fetching, setFetching] = useState(false);
  const [notice, setNotice] = useState<Notice>();

  const theme = dark ? darkTheme : lightTheme;
  const { body, inlineImages } = message;
  const inlineKey = inlineImages.map((image) => image.contentId).join('\n');
  // The same text gives the same page, so the frame is not rebuilt when the message is only
  // fetched again after a sync.
  const prepared = useMemo(
    () =>
      body
        ? prepareMail(body, {
            inlineImages,
            remoteImages,
            textColor: theme.colorNeutralForeground1,
            linkColor: theme.colorBrandForegroundLink,
            dark,
          })
        : undefined,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [body?.contentType, body?.content, inlineKey, remoteImages, theme, dark],
  );

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
    setRemoteImages(images);
    setFetching(false);
  };

  const act = async (attachment: Attachment, action: 'open' | 'save') => {
    setNotice(undefined);
    const result = await window.outlo.attachments[action](attachment.id);
    if (result.status === 'blocked') setNotice({ kind: 'blocked' });
    if (result.status === 'failed') setNotice({ kind: 'failed', text: result.message });
  };
  const hasExtras =
    attachments.length > 0 ||
    notice !== undefined ||
    blockedPictures.length > 0 ||
    open.textState === 'failed';

  return (
    <div className={mergeClasses(styles.card, size === 'fill' ? styles.fill : styles.fit)}>
      <div
        className={mergeClasses(styles.header, onHeaderClick && styles.clickable)}
        onClick={onHeaderClick}
      >
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
          {folderName && <div className={styles.folder}>{folderName}</div>}
        </div>
        {/* The buttons answer this message, not the conversation, so a click on them does not
            fold it. */}
        <div className={styles.side} onClick={(event) => event.stopPropagation()}>
          <div>
            <Button
              appearance="subtle"
              icon={<ArrowReplyRegular />}
              aria-label={t('ribbon.reply')}
              disabled={!onRespond}
              onClick={() => onRespond?.('reply')}
            />
            <Button
              appearance="subtle"
              icon={<ArrowReplyAllRegular />}
              aria-label={t('ribbon.replyAll')}
              disabled={!onRespond}
              onClick={() => onRespond?.('replyAll')}
            />
            <Button
              appearance="subtle"
              icon={<ArrowForwardRegular />}
              aria-label={t('ribbon.forward')}
              disabled={!onRespond}
              onClick={() => onRespond?.('forward')}
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
                      <MenuItem icon={<OpenRegular />} onClick={() => void act(attachment, 'open')}>
                        {t('attachment.open')}
                      </MenuItem>
                      <MenuItem icon={<SaveRegular />} onClick={() => void act(attachment, 'save')}>
                        {t('attachment.save')}
                      </MenuItem>
                    </MenuList>
                  </MenuPopover>
                </Menu>
              ))}
            </div>
          )}
          {notice && (
            <MessageBar
              className={styles.bar}
              intent={notice.kind === 'blocked' ? 'warning' : 'error'}
            >
              <MessageBarBody>
                {notice.kind === 'blocked'
                  ? t('attachment.blocked')
                  : `${t('attachment.failed')} ${notice.text}`}
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
        <MessageBody page={prepared.page} fit={size === 'fit'} />
      ) : open.textState === 'loading' ? (
        <Spinner className={styles.loading} size="tiny" label={t('reading.loadingText')} />
      ) : (
        <div className={styles.preview}>
          <p>{message.preview}</p>
          <p className={styles.muted}>{t('reading.previewOnly')}</p>
        </div>
      )}
    </div>
  );
}
