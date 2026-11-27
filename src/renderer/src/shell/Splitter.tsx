import { makeStyles, tokens } from '@fluentui/react-components';
import { useRef, type PointerEvent } from 'react';

const useStyles = makeStyles({
  root: {
    flexShrink: 0,
    width: '8px',
    cursor: 'col-resize',
    position: 'relative',
    '::after': {
      content: '""',
      position: 'absolute',
      top: '8px',
      bottom: '8px',
      left: '3px',
      width: '2px',
      borderRadius: '1px',
      backgroundColor: 'transparent',
      transitionProperty: 'background-color',
      transitionDuration: tokens.durationFast,
    },
    ':hover::after': { backgroundColor: tokens.colorNeutralStroke1Hover },
    ':active::after': { backgroundColor: tokens.colorBrandStroke1 },
  },
});

interface SplitterProps {
  width: number;
  min: number;
  max: number;
  onResize(width: number): void;
  // Called once when the user lets go, with the final width.
  onCommit(width: number): void;
}

// A vertical handle between two panes. Dragging it changes the width of the pane on its left.
export function Splitter({ width, min, max, onResize, onCommit }: SplitterProps) {
  const styles = useStyles();
  const drag = useRef<{ startX: number; startWidth: number; current: number }>(undefined);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startX: event.clientX, startWidth: width, current: width };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const next = drag.current.startWidth + event.clientX - drag.current.startX;
    drag.current.current = Math.round(Math.min(max, Math.max(min, next)));
    onResize(drag.current.current);
  };
  const onPointerUp = () => {
    if (drag.current) onCommit(drag.current.current);
    drag.current = undefined;
  };

  return (
    <div
      className={styles.root}
      role="separator"
      aria-orientation="vertical"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    />
  );
}
