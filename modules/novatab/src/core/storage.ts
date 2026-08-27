import { reactive, watch } from 'vue';
import { DEFAULT_SETTINGS, normalizeSettings, type Settings } from '../types/settings';
import { toast } from './toast';

export const settings = reactive<Settings>(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as Settings);

let loaded = false;
let applying = false;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

export async function loadSettings(): Promise<void> {
  const data = await chrome.storage.local.get('settings');
  applying = true;
  Object.assign(settings, normalizeSettings(data.settings));
  applying = false;
  loaded = true;
}

export async function saveSettings(): Promise<void> {
  if (!loaded) return;
  await chrome.storage.local.set({ settings: JSON.parse(JSON.stringify(settings)) as Settings });
}

watch(
  settings,
  () => {
    if (applying || !loaded) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void saveSettings().catch(() => toast('设置未保存，请检查浏览器存储空间'));
    }, 200);
  },
  { deep: true, flush: 'sync' }
);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.settings || !loaded || applying) return;
  applying = true;
  Object.assign(settings, normalizeSettings(changes.settings.newValue));
  applying = false;
});

export interface Store<T extends object> {
  state: T;
  load: () => Promise<void>;
  save: () => Promise<void>;
}

/** 通用响应式持久化存储：state 变化自动（防抖）写入 chrome.storage.local */
export function createStore<T extends object>(key: string, defaults: T): Store<T> {
  const state = reactive<T>(JSON.parse(JSON.stringify(defaults)) as T);
  let storeLoaded = false;
  let storeApplying = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function load(): Promise<void> {
    const data = await chrome.storage.local.get(key);
    storeApplying = true;
    Object.assign(state, JSON.parse(JSON.stringify(defaults)) as T, data[key] ?? {});
    storeApplying = false;
    storeLoaded = true;
  }

  async function save(): Promise<void> {
    if (!storeLoaded) return;
    await chrome.storage.local.set({ [key]: JSON.parse(JSON.stringify(state)) });
  }

  watch(
    state,
    () => {
      if (storeApplying || !storeLoaded) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        void save().catch(() => toast('本地数据未保存，请检查存储空间'));
      }, 200);
    },
    { deep: true, flush: 'sync' }
  );

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[key] || !storeLoaded || storeApplying) return;
    storeApplying = true;
    Object.assign(state, JSON.parse(JSON.stringify(defaults)) as T, changes[key].newValue ?? {});
    storeApplying = false;
  });

  return { state: state as T, load, save };
}
