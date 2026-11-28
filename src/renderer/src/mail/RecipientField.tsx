import { makeStyles, Tag, TagGroup, tokens } from '@fluentui/react-components';
import { useId, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from 'react';
import type { Address } from '@shared/api';
import { endsAddress, isValidAddress, parseAddresses } from './addresses';

const useStyles = makeStyles({
  root: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    minHeight: '36px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  label: { flexShrink: 0, width: '32px', color: tokens.colorNeutralForeground2 },
  field: {
    flexGrow: 1,
    minWidth: 0,
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '4px',
    padding: '4px 0',
  },
  tags: { display: 'flex', flexWrap: 'wrap', gap: '4px' },
  invalid: { color: tokens.colorPaletteRedForeground1 },
  input: {
    flexGrow: 1,
    minWidth: '120px',
    border: 'none',
    outline: 'none',
    padding: '4px 0',
    backgroundColor: 'transparent',
    color: 'inherit',
    fontFamily: 'inherit',
    fontSize: tokens.fontSizeBase300,
  },
});

interface RecipientFieldProps {
  label: string;
  value: Address[];
  onChange(value: Address[]): void;
  autoFocus?: boolean;
  // Buttons at the end of the line, like Cc and Bcc.
  children?: ReactNode;
}

// A line of recipients. Each finished address becomes a tag, one that is not an address is
// shown in red.
export function RecipientField({
  label,
  value,
  onChange,
  autoFocus,
  children,
}: RecipientFieldProps) {
  const styles = useStyles();
  const id = useId();
  const [text, setText] = useState('');

  const commit = (input: string) => {
    const found = parseAddresses(input);
    if (found.length > 0) onChange([...value, ...found]);
    setText('');
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const separator = event.key === ';' || event.key === ',';
    if ((event.key === 'Enter' || (separator && endsAddress(text))) && text.trim() !== '') {
      event.preventDefault();
      commit(text);
    } else if (event.key === 'Backspace' && text === '' && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };
  // A pasted list becomes tags at once.
  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData('text');
    if (!/[;,\n]/.test(pasted)) return;
    event.preventDefault();
    commit(text + pasted);
  };

  return (
    <div className={styles.root}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <div className={styles.field}>
        {value.length > 0 && (
          <TagGroup
            className={styles.tags}
            size="small"
            onDismiss={(_event, data) =>
              onChange(value.filter((_entry, index) => String(index) !== data.value))
            }
          >
            {value.map((entry, index) => (
              <Tag
                key={`${index}:${entry.address}`}
                value={String(index)}
                dismissible
                shape="circular"
                title={entry.address}
                className={isValidAddress(entry.address) ? undefined : styles.invalid}
              >
                {entry.name || entry.address}
              </Tag>
            ))}
          </TagGroup>
        )}
        <input
          id={id}
          className={styles.input}
          value={text}
          autoFocus={autoFocus}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onBlur={() => text.trim() !== '' && commit(text)}
        />
      </div>
      {children}
    </div>
  );
}
