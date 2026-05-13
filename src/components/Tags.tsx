import { useEffect, useId, useState } from 'react';
import type { FocusEventHandler, KeyboardEventHandler, ReactNode } from 'react';
import './tags.css';

type TagChipVariant = 'current' | 'suggestion' | 'add';

export function TagList({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`archivebox-tags${className ? ` ${className}` : ''}`}>{children}</div>;
}

export function TagChip({
  label,
  suffix,
  title,
  variant = 'current',
  onClick,
  onRemove,
  removeTitle,
}: {
  label: string;
  suffix?: string;
  title?: string;
  variant?: TagChipVariant;
  onClick?: () => void;
  onRemove?: () => void;
  removeTitle?: string;
}) {
  const className = `archivebox-tag-chip archivebox-tag-chip--${variant}`;
  const content = (
    <>
      <span>{label}</span>
      {suffix && <span>{suffix}</span>}
    </>
  );

  if (onClick) {
    return (
      <button className={className} onClick={onClick} title={title} type="button">
        {content}
      </button>
    );
  }

  return (
    <span className={className} title={title}>
      {content}
      {onRemove && (
        <button className="archivebox-tag-chip__remove" onClick={onRemove} title={removeTitle} type="button">
          ×
        </button>
      )}
    </span>
  );
}

export function TagInputChip({
  value,
  placeholder,
  autoFocus,
  onBlur,
  onChange,
  onKeyDown,
  suggestions = [],
  onCommit,
  onCancel,
  commitOnSpace = true,
}: {
  value: string;
  placeholder?: string;
  autoFocus?: boolean;
  onBlur?: FocusEventHandler<HTMLInputElement>;
  onChange: (value: string) => void;
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
  suggestions?: string[];
  onCommit?: (tag: string) => void;
  onCancel?: () => void;
  commitOnSpace?: boolean;
}) {
  const listboxId = useId();
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1);
  const showSuggestions = suggestions.length > 0 && Boolean(onCommit);

  useEffect(() => {
    setSelectedSuggestionIndex(-1);
  }, [suggestions.length, value]);

  function commitTag(tag?: string) {
    const nextTag = (tag ?? (selectedSuggestionIndex >= 0 ? suggestions[selectedSuggestionIndex] : value) ?? '').trim();
    if (nextTag) onCommit?.(nextTag);
  }

  return (
    <span className="archivebox-tag-chip archivebox-tag-chip--editing">
      <input
        className="archivebox-tag-chip__input"
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        aria-autocomplete={showSuggestions ? 'list' : undefined}
        aria-controls={showSuggestions ? listboxId : undefined}
        aria-expanded={showSuggestions ? true : undefined}
        onBlur={onBlur}
        onChange={(event) => onChange(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && suggestions.length > 0) {
            event.preventDefault();
            setSelectedSuggestionIndex((index) => Math.min(index + 1, suggestions.length - 1));
          } else if (event.key === 'ArrowUp' && suggestions.length > 0) {
            event.preventDefault();
            setSelectedSuggestionIndex((index) => index <= 0 ? -1 : index - 1);
          } else if (event.key === 'Tab' && selectedSuggestionIndex >= 0 && suggestions[selectedSuggestionIndex]) {
            event.preventDefault();
            onChange(suggestions[selectedSuggestionIndex]);
          } else if ((event.key === 'Enter' || (commitOnSpace && event.key === ' ')) && value.trim()) {
            event.preventDefault();
            commitTag();
          } else if (event.key === 'Escape' && onCancel) {
            event.preventDefault();
            onCancel();
          } else {
            onKeyDown?.(event);
          }
        }}
      />
      {showSuggestions && (
        <span className="archivebox-tag-autocomplete" id={listboxId} role="listbox">
          {suggestions.map((tag, index) => (
            <button
              key={tag}
              className={index === selectedSuggestionIndex ? 'selected' : ''}
              role="option"
              aria-selected={index === selectedSuggestionIndex}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setSelectedSuggestionIndex(index)}
              onClick={() => commitTag(tag)}
              type="button"
            >
              <span>{tag}</span>
            </button>
          ))}
        </span>
      )}
    </span>
  );
}
