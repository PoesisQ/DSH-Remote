<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { featureMap } from '../core/featureRegistry';
import { onPermissionsAdded, requestPermissions } from '../core/permissions';
import { settings } from '../core/storage';
import { favicon } from '../core/utils';

interface Site {
  title: string;
  url: string;
}

const sites = ref<Site[]>([]);
const adding = ref(false);
const addTitle = ref('');
const addUrl = ref('');
const editingId = ref<string | null>(null);
const editingTitle = ref('');
let offPermissionAdded: (() => void) | undefined;

async function loadSites() {
  const ok = await requestPermissions(featureMap.quicklinks);
  if (!ok) return;
  try {
    sites.value = (await chrome.topSites.get()).map((s) => ({ title: s.title, url: s.url }));
  } catch {
    sites.value = [];
  }
}

function onPermissionAdded(perms: chrome.permissions.Permissions) {
  if (perms.permissions?.includes('topSites')) void loadSites();
}

onMounted(() => {
  void loadSites();
  offPermissionAdded = onPermissionsAdded(onPermissionAdded);
});

onUnmounted(() => {
  offPermissionAdded?.();
});

const pins = computed(() => settings.quickLinks.pins);

const visible = computed(() => {
  const urls = new Set(pins.value.map((p) => p.url));
  const merged = [...pins.value, ...sites.value.filter((s) => !urls.has(s.url))];
  return merged.slice(0, settings.quickLinks.maxItems);
});

function pinFor(url: string) {
  return pins.value.find((p) => p.url === url);
}

function addPin() {
  const title = addTitle.value.trim();
  let url = addUrl.value.trim();
  if (!title || !url) return;
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  settings.quickLinks.pins.push({ id: crypto.randomUUID(), title, url });
  addTitle.value = '';
  addUrl.value = '';
  adding.value = false;
}

function removePin(id: string) {
  const i = settings.quickLinks.pins.findIndex((p) => p.id === id);
  if (i >= 0) settings.quickLinks.pins.splice(i, 1);
}

function startEdit(url: string, current: string) {
  editingId.value = url;
  editingTitle.value = current;
}

function saveEdit(url: string) {
  const t = editingTitle.value.trim();
  editingId.value = null;
  if (!t) return;
  const pin = pins.value.find((p) => p.url === url);
  if (pin) {
    pin.title = t;
  } else {
    // 编辑常用网站的标题时，自动转为固定项
    settings.quickLinks.pins.push({ id: crypto.randomUUID(), title: t, url });
  }
}

function onFaviconError(e: Event) {
  const img = e.target as HTMLImageElement;
  img.style.display = 'none';
  const fallback = img.nextElementSibling as HTMLElement | null;
  if (fallback) fallback.style.display = 'inline-flex';
}
</script>

<template>
  <div class="ql-bar">
    <div class="ql-row">
      <TransitionGroup name="tile">
        <a
          v-for="s in visible"
          :key="s.url"
          class="ql-tile"
          :href="s.url"
          target="_blank"
          rel="noreferrer"
        >
          <span class="ql-tile-ico">
            <img class="favicon-big" :src="favicon(s.url, 32)" alt="" @error="onFaviconError" />
            <span class="letter" style="display: none">{{ (s.title || '?').charAt(0).toUpperCase() }}</span>
          </span>
          <input
            v-if="editingId === s.url"
            v-model="editingTitle"
            class="ql-edit-input"
            @click.prevent
            @keydown.enter.prevent="saveEdit(s.url)"
            @keydown.esc.prevent="editingId = null"
            @blur="saveEdit(s.url)"
          />
          <span v-else class="ql-name" :title="s.title" @click.prevent="startEdit(s.url, s.title)">{{ s.title }}</span>
          <span class="ql-tile-actions" @click.prevent>
            <button class="ql-tile-action" title="编辑名称" @click="startEdit(s.url, s.title)">✎</button>
            <button v-if="pinFor(s.url)" class="ql-tile-action" title="移除固定" @click="removePin(pinFor(s.url)?.id ?? '')">✕</button>
          </span>
        </a>
      </TransitionGroup>
      <button class="ql-tile ql-add-tile" @click="adding = !adding">
        <span class="ql-tile-ico">＋</span>
        <span class="ql-name">添加网址</span>
      </button>
    </div>
    <form v-if="adding" class="ql-add-form" @submit.prevent="addPin">
      <input v-model="addTitle" class="mini-input" placeholder="名称" />
      <input v-model="addUrl" class="mini-input" placeholder="https://…" />
      <button type="submit" class="chip">保存</button>
      <button type="button" class="chip" @click="adding = false">取消</button>
    </form>
  </div>
</template>
