import { createStore, settings } from './storage';
import { toast } from './toast';

export interface TodoItem {
  id: string;
  text: string;
  done: boolean;
  ts: number;
  due?: number; // 可选提醒时间戳
}

export const todos = createStore<{ items: TodoItem[]; notes: string }>('todos', { items: [], notes: '' });

export async function loadTodos() {
  await todos.load();
  // 本地为空且开启同步时，尝试从浏览器账号同步区拉取
  if (settings.todos.sync && todos.state.items.length === 0) {
    try {
      const data = await chrome.storage.sync.get('todosSync');
      const remote = data.todosSync as { items?: TodoItem[]; notes?: string } | undefined;
      if (remote && Array.isArray(remote.items)) {
        todos.state.items = remote.items;
        todos.state.notes = remote.notes ?? '';
      }
    } catch {
      /* ignore */
    }
  }
}

let syncTimer: ReturnType<typeof setTimeout> | undefined;
export function pushSync() {
  clearTimeout(syncTimer);
  if (!settings.todos.sync) return;
  syncTimer = setTimeout(() => {
    if (!settings.todos.sync) return;
    const data = JSON.parse(JSON.stringify({ items: todos.state.items, notes: todos.state.notes }));
    if (new TextEncoder().encode(JSON.stringify(data)).length + 'todosSync'.length > chrome.storage.sync.QUOTA_BYTES_PER_ITEM) { toast('待办超出浏览器同步容量；本地数据仍保留'); return; }
    void chrome.storage.sync.set({ todosSync: data }).catch(() => toast('浏览器同步暂不可用；本地待办仍保留'));
  }, 700);
}
