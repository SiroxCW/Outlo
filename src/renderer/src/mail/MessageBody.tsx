import { makeStyles } from '@fluentui/react-components';

const useStyles = makeStyles({
  frame: { flexGrow: 1, width: '100%', border: 'none', backgroundColor: 'transparent' },
});

// Mail content never becomes part of the app's own page. It is shown in a frame that may not
// run scripts, load anything from the network or reach the page around it. The one thing it may
// do is ask for a new window when a link is clicked: the app answers that by handing the address
// to the system browser, and never opens a window.
export function MessageBody({ page }: { page: string }) {
  const styles = useStyles();
  return <iframe className={styles.frame} sandbox="allow-popups" srcDoc={page} title="Message" />;
}
