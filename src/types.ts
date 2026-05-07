export interface Task {
  id: string;
  name: string;
  plannedTime: number; // seconds
  completedAt: number | null; // session elapsed seconds when completed, null = not done
  order: number;
  emoji: string; // single emoji icon
  color: string; // hex color
}

export interface Template {
  id: string;
  name: string;
  tasks: { name: string; plannedTime: number; emoji: string; color: string }[];
}

export type SessionState = 'idle' | 'running' | 'paused' | 'finished';

export const DEFAULT_EMOJI = '⬜';
export const DEFAULT_COLOR = '#3498db';
export const TASK_COLORS = ['#3498db', '#2ecc71', '#e74c3c', '#f1c40f', '#9b59b6', '#e67e22', '#1abc9c', '#00d4ff'];
export const TASK_EMOJIS = ['📋', '🛠️', '🧪', '👀', '🚀', '📦', '🐛', '💡', '🎯', '⚡'];
