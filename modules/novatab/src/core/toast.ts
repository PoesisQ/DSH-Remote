import { reactive } from 'vue';

export interface ToastItem {
  id: number;
  text: string;
}

export const toasts = reactive<ToastItem[]>([]);

export function toast(text: string) {
  const id = Date.now() + Math.random();
  toasts.push({ id, text });
  setTimeout(() => {
    const i = toasts.findIndex((t) => t.id === id);
    if (i >= 0) toasts.splice(i, 1);
  }, 2600);
}
