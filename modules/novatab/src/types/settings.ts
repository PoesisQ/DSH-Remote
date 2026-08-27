export type FeatureId =
  | 'wallpaper'
  | 'clock'
  | 'search'
  | 'bookmarks'
  | 'quicklinks'
  | 'todos'
  | 'history'
  | 'downloads'
  | 'browserlinks';

export type SearchEngineId = 'google' | 'bing' | 'baidu' | 'duckduckgo' | 'custom';

export type WallpaperFit = 'cover' | 'contain' | 'fill' | 'tile';
export type SearchOpenMode = 'current' | 'newtab' | 'background';
export type TodoPosition = 'center' | 'left' | 'right';
export type TodoTheme = 'dark' | 'light';

export interface WallpaperSettings {
  mode: 'image' | 'gradient';
  imageId: string | null;
  gradientFrom: string;
  gradientTo: string;
  fit: WallpaperFit;
  zoom: number; // 1 - 3
  posX: number; // 0 - 100（50 为居中）
  posY: number; // 0 - 100
  blur: number; // 0 - 40 px
  brightness: number; // 0.4 - 1.6
  contrast: number; // 0.4 - 1.6
  saturation: number; // 0 - 2
  vignette: number; // 0 - 1
  grain: number; // 0 - 1
  dim: number; // 0 - 0.8
}

export interface SearchSettings {
  engine: SearchEngineId;
  customTemplate: string;
  showSuggestions: boolean;
  showHistory: boolean;
  showMostSearched: boolean;
  openIn: SearchOpenMode;
}

export interface BookmarksSettings {
  showContents: boolean;
  maxItems: number;
  rootId: string; // 起始展示的根文件夹 id，空 = 全部
}

export interface QuickLink {
  id: string;
  title: string;
  url: string;
}

export interface QuickLinksSettings {
  maxItems: number;
  pins: QuickLink[];
}

export interface TodoSettings {
  sync: boolean;
  showDone: boolean;
  position: TodoPosition;
  theme: TodoTheme;
}

export interface GreetingSettings {
  text: string;
}

export interface HistorySettings {
  maxItems: number;
}

export interface DownloadsSettings {
  maxItems: number;
}

export interface LayoutSettings {
  columns: number;
  gap: number;
  cardOpacity: number; // 0.15 - 0.9
  cardBlur: number; // 0 - 40
  order: FeatureId[];
}

export interface Settings {
  version: 1;
  features: Record<FeatureId, boolean>;
  greeting: GreetingSettings;
  wallpaper: WallpaperSettings;
  search: SearchSettings;
  bookmarks: BookmarksSettings;
  quickLinks: QuickLinksSettings;
  todos: TodoSettings;
  history: HistorySettings;
  downloads: DownloadsSettings;
  layout: LayoutSettings;
}

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  features: {
    wallpaper: true,
    clock: true,
    search: true,
    bookmarks: true,
    quicklinks: true,
    todos: true,
    history: false,
    downloads: false,
    browserlinks: true
  },
  greeting: {
    text: '你好，欢迎回来'
  },
  wallpaper: {
    mode: 'gradient',
    imageId: null,
    gradientFrom: '#1b2a4a',
    gradientTo: '#0f172a',
    fit: 'cover',
    zoom: 1,
    posX: 50,
    posY: 50,
    blur: 0,
    brightness: 1,
    contrast: 1,
    saturation: 1,
    vignette: 0.35,
    grain: 0,
    dim: 0.15
  },
  search: {
    engine: 'bing',
    customTemplate: 'https://www.google.com/search?q=%s',
    showSuggestions: true,
    showHistory: true,
    showMostSearched: true,
    openIn: 'newtab'
  },
  bookmarks: { showContents: false, maxItems: 30, rootId: '' },
  quickLinks: { maxItems: 12, pins: [] },
  todos: { sync: false, showDone: false, position: 'center', theme: 'dark' },
  history: { maxItems: 10 },
  downloads: { maxItems: 8 },
  layout: {
    columns: 4,
    gap: 16,
    cardOpacity: 0.55,
    cardBlur: 20,
    order: ['bookmarks', 'quicklinks', 'todos', 'browserlinks', 'history', 'downloads']
  }
};

export function normalizeSettings(raw: unknown): Settings {
  const base = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as Settings;
  if (raw && typeof raw === 'object') {
    const r = raw as Partial<Settings>;
    if (r.features) Object.assign(base.features, r.features);
    if (r.greeting) Object.assign(base.greeting, r.greeting);
    if (r.wallpaper) Object.assign(base.wallpaper, r.wallpaper);
    if (r.search) Object.assign(base.search, r.search);
    if (r.bookmarks) Object.assign(base.bookmarks, r.bookmarks);
    if (r.quickLinks) Object.assign(base.quickLinks, r.quickLinks);
    if (r.todos) Object.assign(base.todos, r.todos);
    if (r.history) Object.assign(base.history, r.history);
    if (r.downloads) Object.assign(base.downloads, r.downloads);
    if (r.layout) Object.assign(base.layout, r.layout);
  }
  return base;
}
