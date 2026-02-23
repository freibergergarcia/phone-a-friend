/**
 * Generic scrollable list with keyboard navigation.
 */

import React, { useState, useEffect } from 'react';
import { Box, useInput } from 'ink';

export interface ListSelectProps<T> {
  items: T[];
  renderItem: (item: T, index: number, isSelected: boolean) => React.ReactNode;
  onSelect?: (item: T, index: number) => void;
  onChange?: (index: number) => void;
  onCancel?: () => void;
  isActive?: boolean;
  /** When provided, parent controls the selected index (controlled mode). */
  selectedIndex?: number;
  /** Stable React key for each item. Falls back to array index. */
  getKey?: (item: T, index: number) => string;
}

export function ListSelect<T>({
  items,
  renderItem,
  onSelect,
  onChange,
  onCancel,
  isActive = true,
  selectedIndex: controlledIndex,
  getKey,
}: ListSelectProps<T>) {
  const [internalIndex, setInternalIndex] = useState(0);
  const isControlled = controlledIndex !== undefined;
  const selectedIndex = isControlled ? controlledIndex : internalIndex;

  // Clamp internal index when items array shrinks
  useEffect(() => {
    if (!isControlled && items.length > 0 && internalIndex >= items.length) {
      const clamped = items.length - 1;
      setInternalIndex(clamped);
      onChange?.(clamped);
    }
  }, [items.length, internalIndex, isControlled, onChange]);

  useInput(
    (input, key) => {
      if (items.length === 0) return;
      if (key.downArrow) {
        const next = Math.min(selectedIndex + 1, items.length - 1);
        if (!isControlled) setInternalIndex(next);
        onChange?.(next);
      }
      if (key.upArrow) {
        const prev = Math.max(selectedIndex - 1, 0);
        if (!isControlled) setInternalIndex(prev);
        onChange?.(prev);
      }
      if (key.return) {
        const item = items[selectedIndex];
        if (item !== undefined) onSelect?.(item, selectedIndex);
      }
      if (key.escape) {
        onCancel?.();
      }
    },
    { isActive },
  );

  return (
    <Box flexDirection="column">
      {items.map((item, i) => (
        <Box key={getKey ? getKey(item, i) : i}>{renderItem(item, i, i === selectedIndex)}</Box>
      ))}
    </Box>
  );
}
