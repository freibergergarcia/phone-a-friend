/**
 * Tests for ListSelect — generic scrollable list with keyboard navigation.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { ListSelect } from '../../../src/tui/components/ListSelect.js';
import { Text } from 'ink';

const tick = () => new Promise((r) => setTimeout(r, 50));

const SimpleItem = ({ item, isSelected }: { item: string; isSelected: boolean }) => (
  <Text>{isSelected ? '>' : ' '} {item}</Text>
);

describe('ListSelect', () => {
  it('renders items', () => {
    const { lastFrame } = render(
      <ListSelect
        items={['a', 'b', 'c']}
        renderItem={(item, _i, isSelected) => <SimpleItem item={item} isSelected={isSelected} />}
      />,
    );
    expect(lastFrame()).toContain('a');
    expect(lastFrame()).toContain('b');
    expect(lastFrame()).toContain('c');
  });

  it('controlled selectedIndex prop drives selection', async () => {
    const onChange = vi.fn();
    const { lastFrame, rerender } = render(
      <ListSelect
        items={['a', 'b', 'c']}
        selectedIndex={1}
        onChange={onChange}
        renderItem={(item, _i, isSelected) => <SimpleItem item={item} isSelected={isSelected} />}
      />,
    );
    // 'b' should be selected (index 1)
    const frame = lastFrame()!;
    expect(frame).toContain('> b');
    expect(frame).not.toContain('> a');
  });

  it('onCancel fires on Escape', async () => {
    const onCancel = vi.fn();
    const { stdin } = render(
      <ListSelect
        items={['a', 'b']}
        onCancel={onCancel}
        renderItem={(item, _i, isSelected) => <SimpleItem item={item} isSelected={isSelected} />}
      />,
    );
    stdin.write('\u001B'); // Escape
    await tick();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('getKey is used for React keys when provided', () => {
    const getKey = vi.fn((item: string) => `key-${item}`);
    render(
      <ListSelect
        items={['x', 'y']}
        getKey={getKey}
        renderItem={(item, _i, isSelected) => <SimpleItem item={item} isSelected={isSelected} />}
      />,
    );
    expect(getKey).toHaveBeenCalledWith('x', 0);
    expect(getKey).toHaveBeenCalledWith('y', 1);
  });

  it('onSelect fires on Enter', async () => {
    const onSelect = vi.fn();
    const { stdin } = render(
      <ListSelect
        items={['a', 'b']}
        onSelect={onSelect}
        renderItem={(item, _i, isSelected) => <SimpleItem item={item} isSelected={isSelected} />}
      />,
    );
    stdin.write('\r'); // Enter
    await tick();
    expect(onSelect).toHaveBeenCalledWith('a', 0);
  });

  it('arrow keys navigate in uncontrolled mode', async () => {
    const onChange = vi.fn();
    const { stdin } = render(
      <ListSelect
        items={['a', 'b', 'c']}
        onChange={onChange}
        renderItem={(item, _i, isSelected) => <SimpleItem item={item} isSelected={isSelected} />}
      />,
    );
    stdin.write('\u001B[B'); // down
    await tick();
    expect(onChange).toHaveBeenCalledWith(1);
  });

  it('does not update internal index in controlled mode', async () => {
    const onChange = vi.fn();
    const { lastFrame, stdin } = render(
      <ListSelect
        items={['a', 'b', 'c']}
        selectedIndex={0}
        onChange={onChange}
        renderItem={(item, _i, isSelected) => <SimpleItem item={item} isSelected={isSelected} />}
      />,
    );
    stdin.write('\u001B[B'); // down
    await tick();
    // onChange should be called but rendering should still show index 0
    // (since parent hasn't updated selectedIndex)
    expect(onChange).toHaveBeenCalledWith(1);
    expect(lastFrame()).toContain('> a');
  });

  it('isActive=false suppresses input', async () => {
    const onSelect = vi.fn();
    const { stdin } = render(
      <ListSelect
        items={['a', 'b']}
        isActive={false}
        onSelect={onSelect}
        renderItem={(item, _i, isSelected) => <SimpleItem item={item} isSelected={isSelected} />}
      />,
    );
    stdin.write('\r');
    await tick();
    expect(onSelect).not.toHaveBeenCalled();
  });
});
