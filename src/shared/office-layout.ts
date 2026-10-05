import type { WorkerId } from './contracts.js';

export type OfficePersonId = WorkerId | 'owner';
export interface Cell {
  x: number;
  y: number;
}
export const TILE = 32;
export const COLUMNS = 32;
export const ROWS = 24;
export const WORLD_WIDTH = COLUMNS * TILE;
export const WORLD_HEIGHT = ROWS * TILE;
export const HOMES: Record<OfficePersonId, Cell> = {
  owner: { x: 11, y: 6 },
  operator: { x: 6, y: 6 },
  treasury: { x: 24, y: 6 },
  researcher: { x: 6, y: 19 },
  creator: { x: 23, y: 19 },
  reviewer: { x: 27, y: 19 },
};
export const MEETING_SEATS: Cell[] = [
  { x: 14, y: 11 },
  { x: 17, y: 11 },
];
export const COFFEE_SPOT: Cell = { x: 15, y: 5 };
export const ROOMS = [
  {
    x: 2,
    y: 2,
    width: 12,
    height: 8,
    title: 'OPERATIONS',
    subtitle: 'Operator → team',
    color: '#dbe5c9',
    accent: '#678450',
    doorY: 9,
    doorX: 8,
  },
  {
    x: 19,
    y: 2,
    width: 12,
    height: 8,
    title: 'FINANCE',
    subtitle: 'Treasury → owner',
    color: '#ede2bf',
    accent: '#99804a',
    doorY: 9,
    doorX: 24,
  },
  {
    x: 2,
    y: 15,
    width: 12,
    height: 8,
    title: 'STRATEGY',
    subtitle: 'Scout → Operator',
    color: '#d0e1df',
    accent: '#548581',
    doorY: 15,
    doorX: 8,
  },
  {
    x: 19,
    y: 15,
    width: 12,
    height: 8,
    title: 'PRODUCT & QUALITY',
    subtitle: 'Studio + Review → Operator',
    color: '#ded6e9',
    accent: '#857298',
    doorY: 15,
    doorX: 24,
  },
] as const;
export const FURNITURE = [
  { kind: 'desk', x: 5, y: 4, width: 3, height: 2 },
  { kind: 'desk', x: 10, y: 4, width: 2, height: 2 },
  { kind: 'desk', x: 23, y: 4, width: 3, height: 2 },
  { kind: 'desk', x: 5, y: 17, width: 3, height: 2 },
  { kind: 'desk', x: 22, y: 17, width: 3, height: 2 },
  { kind: 'desk', x: 26, y: 17, width: 3, height: 2 },
  { kind: 'shelf', x: 3, y: 4, width: 1, height: 2 },
  { kind: 'shelf', x: 3, y: 17, width: 1, height: 2 },
  { kind: 'vault', x: 28, y: 4, width: 2, height: 2 },
  { kind: 'coffee', x: 14, y: 3, width: 4, height: 2 },
  { kind: 'table', x: 15, y: 11, width: 2, height: 2 },
  { kind: 'sofa', x: 4, y: 11, width: 3, height: 1 },
  { kind: 'sofa', x: 25, y: 11, width: 3, height: 1 },
  { kind: 'board', x: 14, y: 20, width: 4, height: 1 },
  ...[
    { x: 12, y: 8 },
    { x: 29, y: 8 },
    { x: 3, y: 21 },
    { x: 29, y: 21 },
    { x: 2, y: 12 },
    { x: 29, y: 12 },
  ].map((p) => ({ kind: 'plant', ...p, width: 1, height: 1 })),
] as const;

export function isWall(x: number, y: number): boolean {
  if (x === 0 || y === 0 || x === COLUMNS - 1 || y === ROWS - 1) return true;
  return ROOMS.some((room) => {
    if (y === room.doorY && (x === room.doorX || x === room.doorX + 1)) return false;
    return (
      x >= room.x &&
      x < room.x + room.width &&
      y >= room.y &&
      y < room.y + room.height &&
      (x === room.x ||
        x === room.x + room.width - 1 ||
        y === room.y ||
        y === room.y + room.height - 1)
    );
  });
}
export function walkable(cell: Cell): boolean {
  const { x, y } = cell;
  return (
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    x >= 0 &&
    y >= 0 &&
    x < COLUMNS &&
    y < ROWS &&
    !isWall(x, y) &&
    !FURNITURE.some(
      (item) => x >= item.x && x < item.x + item.width && y >= item.y && y < item.y + item.height,
    )
  );
}
/** Cardinal paths keep avatars out of walls and stop diagonal corner clipping. */
export function findPath(start: Cell, end: Cell): Cell[] {
  if (!walkable(start) || !walkable(end)) return [];
  const key = (p: Cell) => p.y * COLUMNS + p.x;
  const queue = [start],
    visited = new Map<number, Cell | null>([[key(start), null]]);
  for (let index = 0; index < queue.length; index++) {
    const point = queue[index];
    if (point.x === end.x && point.y === end.y) {
      const path: Cell[] = [];
      let cursor: Cell | null = point;
      while (cursor && key(cursor) !== key(start)) {
        path.unshift(cursor);
        cursor = visited.get(key(cursor)) ?? null;
      }
      return path;
    }
    for (const direction of [
      { x: 0, y: 1 },
      { x: 1, y: 0 },
      { x: 0, y: -1 },
      { x: -1, y: 0 },
    ]) {
      const next = { x: point.x + direction.x, y: point.y + direction.y };
      if (!walkable(next) || visited.has(key(next))) continue;
      visited.set(key(next), point);
      queue.push(next);
    }
  }
  return [];
}
