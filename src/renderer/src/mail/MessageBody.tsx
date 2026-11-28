import { makeStyles } from '@fluentui/react-components';
import { useEffect, useRef, useState } from 'react';

const MIN_HEIGHT = 48;
// Room for a scroll bar when a mail is wider than the pane.
const SCROLL_BAR = 12;

const useStyles = makeStyles({
  frame: { flexGrow: 1, width: '100%', border: 'none', backgroundColor: 'transparent' },
  fitted: { position: 'relative', flexShrink: 0 },
  fittedFrame: { display: 'block', width: '100%', border: 'none', backgroundColor: 'transparent' },
  measure: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '1px',
    border: 'none',
    visibility: 'hidden',
    pointerEvents: 'none',
  },
});

// Mail content never becomes part of the app's own page. It is shown in a frame that may not
// run scripts, load anything from the network or reach the page around it. The one thing it may
// do is ask for a new window when a link is clicked: the app answers that by handing the address
// to the system browser, and never opens a window.
//
// fit: the frame is as tall as the mail, for messages that follow each other in a conversation.
export function MessageBody({ page, fit = false }: { page: string; fit?: boolean }) {
  const styles = useStyles();
  if (fit) return <FittedBody page={page} />;
  return <iframe className={styles.frame} sandbox="allow-popups" srcDoc={page} title="Message" />;
}

// The frame that shows the mail cannot be looked into, so it cannot tell how tall the mail is.
// A second copy of the page, which nobody sees, tells. That copy may not run scripts, load
// anything or open anything, cannot be reached by mouse, keyboard or screen reader, and the app
// only reads its height. Being of the same origin is what lets the app read the height, and
// without scripts it gives the mail nothing it could use.
function FittedBody({ page }: { page: string }) {
  const styles = useStyles();
  const measure = useRef<HTMLIFrameElement>(null);
  const observer = useRef<ResizeObserver>(undefined);
  const [height, setHeight] = useState(MIN_HEIGHT);

  // Measures once the copy is loaded, and again when its content changes size: when pictures
  // arrive or the pane gets narrower.
  const watch = () => {
    observer.current?.disconnect();
    const document = measure.current?.contentDocument;
    const root = document?.documentElement;
    if (!document || !root) return;
    const update = () => {
      const wide = root.scrollWidth > root.clientWidth;
      setHeight(Math.max(MIN_HEIGHT, Math.ceil(root.scrollHeight) + (wide ? SCROLL_BAR : 0)));
    };
    update();
    observer.current = new ResizeObserver(update);
    observer.current.observe(root);
    if (document.body) observer.current.observe(document.body);
  };
  useEffect(() => () => observer.current?.disconnect(), []);

  return (
    <div className={styles.fitted}>
      <iframe
        className={styles.fittedFrame}
        style={{ height }}
        sandbox="allow-popups"
        srcDoc={page}
        title="Message"
      />
      <iframe
        ref={measure}
        className={styles.measure}
        sandbox="allow-same-origin"
        srcDoc={page}
        onLoad={watch}
        title=""
        aria-hidden
        tabIndex={-1}
        inert
      />
    </div>
  );
}
