<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { settings } from '../core/storage';
import { ENGINES, currentEngine, fetchSuggestions, openSearch } from '../core/search';
import { clearSearchHistory, loadSearchHistory, mostSearched, recentSearches, searchHistory } from '../core/searchHistory';
import { ensureSuggestPermissions } from '../core/permissions';
import Icon from './Icon.vue';
import { toast } from '../core/toast';
import type { SearchEngineId } from '../types/settings';

const q = ref('');
const focus = ref(false);
const engineMenu = ref(false);
const suggestions = ref<string[]>([]);
const activeIndex = ref(-1);
const panelOpen = ref(false);
let abort: AbortController | null = null;
let debounce: ReturnType<typeof setTimeout> | undefined;
let hideTimer: ReturnType<typeof setTimeout> | undefined;

onMounted(() => {
  void loadSearchHistory();
});

const engine = computed(() => currentEngine());
const historyItems = computed(() => (settings.search.showHistory ? recentSearches(8) : []));
const mostItems = computed(() => (settings.search.showMostSearched ? mostSearched(6) : []));

const showPanel = computed(
  () =>
    panelOpen.value &&
    ((q.value.trim() !== '' && (settings.search.showSuggestions || settings.search.showHistory)) ||
      (q.value.trim() === '' && settings.search.showHistory))
);

watch(q, (v) => {
  activeIndex.value = -1;
  if (abort) abort.abort();
  suggestions.value = [];
  clearTimeout(debounce);
  if (!v.trim() || !settings.search.showSuggestions) return;
  debounce = setTimeout(async () => {
    abort = new AbortController();
    suggestions.value = await fetchSuggestions(v.trim(), abort.signal);
  }, 160);
});

function submit(term?: string) {
  const t = (term ?? q.value).trim();
  if (!t) return;
  q.value = '';
  panelOpen.value = false;
  void openSearch(t);
}

function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const list = [...suggestions.value, ...historyItems.value.map((h) => h.q)];
  if (!list.length) return;
  e.preventDefault();
  const delta = e.key === 'ArrowDown' ? 1 : -1;
  activeIndex.value = (activeIndex.value + delta + list.length) % list.length;
  q.value = list[activeIndex.value] ?? q.value;
}

function pickEngine(id: SearchEngineId) {
  settings.search.engine = id;
  engineMenu.value = false;
}

function removeHistory(qq: string) {
  const i = searchHistory.state.entries.findIndex((e) => e.q === qq);
  if (i >= 0) searchHistory.state.entries.splice(i, 1);
}

function clearHistory() {
  clearSearchHistory();
  toast('已清空搜索历史');
}

function onFocus() {
  focus.value = true;
  clearTimeout(hideTimer);
  panelOpen.value = true;
  if (settings.search.showSuggestions) void ensureSuggestPermissions();
}

function onBlur() {
  focus.value = false;
  hideTimer = setTimeout(() => {
    panelOpen.value = false;
  }, 160);
}
</script>

<template>
  <div class="search">
    <form @submit.prevent="submit()">
      <div class="search-box" :class="{ focus }">
        <button type="button" class="engine-btn" title="切换搜索引擎" @mousedown.prevent @click="engineMenu = !engineMenu">
          {{ engine.label }} ▾
        </button>
        <div v-if="engineMenu" class="engine-menu" @mousedown.prevent>
          <button
            v-for="e in ENGINES"
            :key="e.id"
            type="button"
            :class="{ active: e.id === settings.search.engine }"
            @click="pickEngine(e.id)"
          >
            {{ e.label }}
          </button>
        </div>
        <input
          v-model="q"
          class="search-input"
          type="text"
          autocomplete="off"
          spellcheck="false"
          @focus="onFocus"
          @blur="onBlur"
          @keydown="onKeydown"
        />
        <button type="submit" class="search-go" title="搜索" aria-label="搜索">
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.2" y2="16.2" />
          </svg>
        </button>
      </div>
    </form>

    <div v-if="engineMenu" class="engine-backdrop" @click="engineMenu = false" />

    <div v-if="showPanel" class="search-panel" @mousedown.prevent>
      <div v-if="q.trim() && suggestions.length" class="group">
        <div class="group-label">搜索建议</div>
        <button
          v-for="(s, i) in suggestions"
          :key="s"
          type="button"
          class="item"
          :class="{ active: i === activeIndex }"
          @click="submit(s)"
        >
          <span class="i"><Icon name="search" :size="13" /></span><span class="t">{{ s }}</span>
        </button>
      </div>
      <div v-if="historyItems.length" class="group">
        <div class="group-label">
          最近搜索
          <button type="button" class="mini" @click="clearHistory">清空</button>
        </div>
        <button
          v-for="(h, i) in historyItems"
          :key="h.q"
          type="button"
          class="item"
          :class="{ active: suggestions.length + i === activeIndex }"
          @click="submit(h.q)"
        >
          <span class="i"><Icon name="clock" :size="13" /></span><span class="t">{{ h.q }}</span>
          <span class="del" @click.stop="removeHistory(h.q)">✕</span>
        </button>
      </div>
    </div>

    <div v-if="!q && mostItems.length" class="most-searched">
      <span class="label">最常搜索</span>
      <button v-for="m in mostItems" :key="m.q" type="button" @click="submit(m.q)">{{ m.q }}</button>
    </div>
  </div>
</template>
