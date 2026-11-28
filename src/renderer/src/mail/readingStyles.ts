import { makeStyles, tokens } from '@fluentui/react-components';

// The frame of the reading pane, for one message and for a conversation.
export const useReadingStyles = makeStyles({
  root: { height: '100%', display: 'flex', flexDirection: 'column', minWidth: 0 },
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
});
