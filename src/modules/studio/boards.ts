import type { StudioBoard, StudioMode } from './types';

const BOARDS_KEY = 'xos-studio-boards-v1';

let idc = 100;
const nid = () => `board-${Date.now().toString(36)}-${++idc}`;

export function loadBoards(): StudioBoard[] {
  try {
    const raw = localStorage.getItem(BOARDS_KEY);
    if (raw) return JSON.parse(raw) as StudioBoard[];
  } catch {
    /* ignore corrupt storage */
  }
  return [];
}

function saveBoards(boards: StudioBoard[]) {
  localStorage.setItem(BOARDS_KEY, JSON.stringify(boards));
}

export function createBoard(name: string, mode: StudioMode): StudioBoard {
  const now = new Date().toISOString();
  const board: StudioBoard = { id: nid(), name: name.trim() || 'Untitled', mode, createdAt: now, updatedAt: now };
  const boards = loadBoards();
  boards.unshift(board);
  saveBoards(boards);
  return board;
}

export function touchBoard(id: string) {
  const boards = loadBoards();
  const b = boards.find((x) => x.id === id);
  if (b) {
    b.updatedAt = new Date().toISOString();
    saveBoards(boards);
  }
}

export function renameBoard(id: string, name: string) {
  const boards = loadBoards();
  const b = boards.find((x) => x.id === id);
  if (b) {
    b.name = name.trim() || b.name;
    b.updatedAt = new Date().toISOString();
    saveBoards(boards);
  }
}

export function deleteBoard(id: string) {
  saveBoards(loadBoards().filter((b) => b.id !== id));
  try {
    localStorage.removeItem(`xos-studio-draw-${id}`);
    localStorage.removeItem(`xos-studio-wf-${id}`);
  } catch {
    /* ignore */
  }
}
