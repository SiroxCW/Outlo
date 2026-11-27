import { makeStyles } from '@fluentui/react-components';
import type { MessageBody as Body } from '@shared/api';
import { darkTheme, lightTheme } from '../theme';

const useStyles = makeStyles({
  frame: { flexGrow: 1, width: '100%', border: 'none', backgroundColor: 'transparent' },
});

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Mail content never becomes part of the app's own page. It is shown in a frame that may not
// run scripts, load anything from the network or reach the page around it.
export function MessageBody({ body, dark }: { body: Body; dark: boolean }) {
  const styles = useStyles();
  const theme = dark ? darkTheme : lightTheme;
  const content =
    body.contentType === 'html'
      ? body.content
      : `<pre style="white-space: pre-wrap; font: inherit">${escapeHtml(body.content)}</pre>`;

  const page = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<meta name="color-scheme" content="${dark ? 'dark' : 'light'}">
<style>
  html { scrollbar-width: thin; }
  body { margin: 0; padding: 12px 24px 24px; font: 14px/1.5 'Segoe UI', system-ui, sans-serif; overflow-wrap: anywhere;
    color: ${theme.colorNeutralForeground1}; background: transparent; }
  a { color: ${theme.colorBrandForegroundLink}; }
</style>
</head>
<body>${content}</body>
</html>`;

  return <iframe className={styles.frame} sandbox="" srcDoc={page} title="Message" />;
}
