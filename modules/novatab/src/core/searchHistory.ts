import { createStore } from './storage';

export interface SearchEntry {
  q: string;
  n: number; // 搜索次数
  t: number; // 最近搜索时间
}

export const searchHistory = createStore<{ entries: SearchEntry[] }>('searchHistory', { entries: [] });

export async function loadSearchHistory() {
  await searchHistory.load();
}

export function recordSearch(q: string) {
  const query = q.trim();
  if (!query) return;
  const entry = searchHistory.state.entries.find((e) => e.q === query);
  if (entry) {
    entry.n += 1;
    entry.t = Date.now();
  } else {
    searchHistory.state.entries.push({ q: query, n: 1, t: Date.now() });
  }
  if (searchHistory.state.entries.length > 500) {
    searchHistory.state.entries.sort((a, b) => b.t - a.t);
    searchHistory.state.entries.splice(500);
  }
}

export function recentSearches(limit = 8): SearchEntry[] {
  return [...searchHistory.state.entries].sort((a, b) => b.t - a.t).slice(0, limit);
}

export function mostSearched(limit = 6): SearchEntry[] {
  return [...searchHistory.state.entries].sort((a, b) => b.n - a.n).slice(0, limit);
}

export function clearSearchHistory() {
  searchHistory.state.entries.splice(0);
}
