export type StudioItemType = 'frame' | 'sticky' | 'stickyM' | 'rect' | 'circle' | 'mood' | 'image';

export interface StudioItem {
  id: string;
  type: StudioItemType;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
  src?: string;
  visible: boolean;
  variant?: 'splash' | 'onboarding' | 'blank';
  bg?: string;
  fg?: string;
}

export interface StudioArrow {
  id: string;
  name: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  visible: boolean;
}

export interface InkStroke {
  id: string;
  points: [number, number][];
}

export interface CommentPin {
  id: string;
  x: number;
  y: number;
  text: string;
}

export interface StudioSnapshot {
  items: StudioItem[];
  arrows: StudioArrow[];
  ink: InkStroke[];
  comments: CommentPin[];
}
