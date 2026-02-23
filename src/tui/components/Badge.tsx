/**
 * Status badge component: ✓ ✗ ! · for backend availability states.
 */

import React from 'react';
import { Text } from 'ink';

export type BadgeStatus = 'available' | 'unavailable' | 'partial' | 'planned';

export interface BadgeProps {
  status: BadgeStatus;
}

const BADGE_MAP: Record<BadgeStatus, { symbol: string; color: string }> = {
  available: { symbol: '\u2713', color: 'green' },
  unavailable: { symbol: '\u2717', color: 'red' },
  partial: { symbol: '!', color: 'yellow' },
  planned: { symbol: '\u00b7', color: 'gray' },
};

export function Badge({ status }: BadgeProps) {
  const { symbol, color } = BADGE_MAP[status];
  return <Text color={color}>{symbol}</Text>;
}
