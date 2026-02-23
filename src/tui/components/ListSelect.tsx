/**
 * Generic scrollable list with keyboard navigation.
 */

import React, { useState } from 'react';
import { Box, useInput } from 'ink';

export interface ListSelectProps<T> {
  items: T[];
  renderItem: (item: T, index: number, isSelected: boolean) => React.ReactNode;
  onSelect?: (item: T, index: number) => void;
  onChange?: (index: number) => void;
  isActive?: boolean;
}

export function ListSelect<T>({
  items,
  renderItem,
  onSelect,
  onChange,
  isActive = true,
}: ListSelectProps<T>) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput(
    (input, key) => {
      if (items.length === 0) return;
      if (key.downArrow) {
        const next = Math.min(selectedIndex + 1, items.length - 1);
        setSelectedIndex(next);
        onChange?.(next);
      }
      if (key.upArrow) {
        const prev = Math.max(selectedIndex - 1, 0);
        setSelectedIndex(prev);
        onChange?.(prev);
      }
      if (key.return) {
        const item = items[selectedIndex];
        if (item !== undefined) onSelect?.(item, selectedIndex);
      }
    },
    { isActive },
  );

  return (
    <Box flexDirection="column">
      {items.map((item, i) => (
        <Box key={i}>{renderItem(item, i, i === selectedIndex)}</Box>
      ))}
    </Box>
  );
}
