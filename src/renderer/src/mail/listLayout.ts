export interface ListGroup {
  key: string;
  label: string;
  count: number;
  // Position of the first message of the group in the whole list.
  offset: number;
}

export type ListRow =
  { kind: 'header'; group: ListGroup } | { kind: 'message'; group: ListGroup; offset: number };

export interface ListLayout {
  rowCount: number;
  rowAt(index: number): ListRow;
  // The row that shows the message at this position, or null while its group is collapsed.
  rowOfOffset(offset: number): number | null;
}

// Maps the rows of the visible list (group headers and messages) to positions in the message
// list. Nothing is stored per message, so 100,000 messages cost the same as ten.
export function createListLayout(groups: ListGroup[], collapsed: ReadonlySet<string>): ListLayout {
  const visible = groups.filter((group) => group.count > 0);
  const firstRows: number[] = [];
  let rowCount = 0;
  for (const group of visible) {
    firstRows.push(rowCount);
    rowCount += 1 + (collapsed.has(group.key) ? 0 : group.count);
  }

  function groupIndexOfRow(index: number): number {
    let low = 0;
    let high = firstRows.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (firstRows[middle]! <= index) low = middle;
      else high = middle - 1;
    }
    return low;
  }

  return {
    rowCount,
    rowAt(index) {
      const groupIndex = groupIndexOfRow(index);
      const group = visible[groupIndex]!;
      const position = index - firstRows[groupIndex]!;
      if (position === 0) return { kind: 'header', group };
      return { kind: 'message', group, offset: group.offset + position - 1 };
    },
    rowOfOffset(offset) {
      const groupIndex = visible.findIndex(
        (group) => offset >= group.offset && offset < group.offset + group.count,
      );
      if (groupIndex < 0 || collapsed.has(visible[groupIndex]!.key)) return null;
      return firstRows[groupIndex]! + 1 + offset - visible[groupIndex]!.offset;
    },
  };
}
