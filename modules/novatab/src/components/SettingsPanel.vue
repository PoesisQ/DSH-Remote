<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { FEATURES, type FeatureDef } from '../core/featureRegistry';
import { requestPermissions } from '../core/permissions';
import { settings } from '../core/storage';
import { clearImages, saveImage } from '../core/images';
import { normalizeSettings } from '../types/settings';
import type { SearchEngineId, SearchOpenMode, WallpaperFit } from '../types/settings';
import { ENGINES } from '../core/search';
import { clearSearchHistory } from '../core/searchHistory';
import { getRootFolders, type BmRoot } from '../core/bookmarkRoots';
import { toast } from '../core/toast';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ 'update:open': [value: boolean] }>();

const version = chrome.runtime.getManifest().version;

const wpFile = ref<HTMLInputElement>();
const importFile = ref<HTMLInputElement>();
const roots = ref<BmRoot[]>([]);

function pickWallpaper() {
  const input = wpFile.value;
  if (!input) {
    toast('文件选择不可用，请重试');
    return;
  }
  input.click();
}

const DETAIL_IDS = ['wallpaper', 'clock', 'search', 'bookmarks', 'quicklinks', 'todos'];
const expanded = reactive<Record<string, boolean>>({});

function hasDetail(id: string) {
  return DETAIL_IDS.includes(id);
}

function toggleExpand(id: string) {
  if (!hasDetail(id)) return;
  expanded[id] = !expanded[id];
}

watch(
  () => props.open,
  async (open) => {
    if (open && settings.features.bookmarks) {
      roots.value = await getRootFolders();
    }
  }
);

const PRESETS = [
  { name: '深海', from: '#1b2a4a', to: '#0f172a' },
  { name: '暮色', from: '#2c1e4a', to: '#0d0a1f' },
  { name: '森林', from: '#1a3a2a', to: '#0c1a12' },
  { name: '日落', from: '#7a3b2e', to: '#2a1030' },
  { name: '极光', from: '#123a4a', to: '#0a1628' },
  { name: '石墨', from: '#2b2f36', to: '#14161a' }
];

const FIT_OPTIONS: Array<[WallpaperFit, string]> = [
  ['cover', '填充裁剪'],
  ['contain', '完整显示'],
  ['fill', '拉伸'],
  ['tile', '平铺']
];

function pct(get: () => number, set: (v: number) => void) {
  return computed({
    get: () => Math.round(get() * 100),
    set: (v: number) => set(v / 100)
  });
}

const brightnessPct = pct(() => settings.wallpaper.brightness, (v) => (settings.wallpaper.brightness = v));
const contrastPct = pct(() => settings.wallpaper.contrast, (v) => (settings.wallpaper.contrast = v));
const saturationPct = pct(() => settings.wallpaper.saturation, (v) => (settings.wallpaper.saturation = v));
const vignettePct = pct(() => settings.wallpaper.vignette, (v) => (settings.wallpaper.vignette = v));
const grainPct = pct(() => settings.wallpaper.grain, (v) => (settings.wallpaper.grain = v));
const dimPct = pct(() => settings.wallpaper.dim, (v) => (settings.wallpaper.dim = v));

async function toggleFeature(f: FeatureDef) {
  if (settings.features[f.id]) {
    const ok = await requestPermissions(f);
    if (!ok) {
      settings.features[f.id] = false;
      toast(`未获得权限，「${f.label}」保持关闭`);
    }
  }
}

function onFeatureChange(f: FeatureDef, e: Event) {
  settings.features[f.id] = (e.target as HTMLInputElement).checked;
  void toggleFeature(f);
}

async function onWpFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    toast('请选择图片文件');
    return;
  }
  try {
    let blob: Blob = file;
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, 3840 / Math.max(bmp.width, bmp.height));
      if (scale < 1) {
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(bmp.width * scale);
        canvas.height = Math.round(bmp.height * scale);
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
          blob = await new Promise<Blob>((resolve, reject) =>
            canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/jpeg', 0.92)
          );
        }
      }
      bmp.close();
    } catch {
      /* 处理失败则保留原图 */
    }
    const id = `wp-${Date.now()}`;
    await saveImage(id, blob);
    settings.wallpaper.imageId = id;
    settings.wallpaper.mode = 'image';
    toast('壁纸已更新');
  } catch {
    toast('壁纸处理失败');
  }
}

function removeImage() {
  settings.wallpaper.imageId = null;
  settings.wallpaper.mode = 'gradient';
  toast('已移除壁纸，回到渐变');
}

function exportConfig() {
  const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'novatab-config.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function onImportFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    Object.assign(settings, normalizeSettings(parsed));
    toast('配置已导入');
  } catch {
    toast('导入失败：文件格式不正确');
  }
}

function resetAll() {
  if (!confirm('确定恢复全部默认设置？')) return;
  Object.assign(settings, normalizeSettings(null));
  toast('已恢复默认设置');
}

async function clearAll() {
  if (!confirm('确定清空所有数据（含壁纸、待办、搜索历史）？此操作不可撤销。')) return;
  await clearImages();
  await chrome.storage.local.clear();
  location.reload();
}

function onEngineChange(e: Event) {
  settings.search.engine = (e.target as HTMLSelectElement).value as SearchEngineId;
}

function onOpenInChange(e: Event) {
  settings.search.openIn = (e.target as HTMLSelectElement).value as SearchOpenMode;
}

function onRootChange(e: Event) {
  settings.bookmarks.rootId = (e.target as HTMLSelectElement).value;
}

function clearHistory() {
  clearSearchHistory();
  toast('已清空搜索历史');
}
</script>

<template>
  <div v-if="open" class="settings-backdrop" @click="emit('update:open', false)" />
  <aside class="settings-panel" :class="{ open }">
    <input ref="wpFile" type="file" accept="image/*" hidden @change="onWpFile" />
    <header class="sp-head">
      <div class="sp-title"><span class="sp-title-icon"></span><span>设置</span></div>
      <button class="sp-close" title="关闭" @click="emit('update:open', false)">✕</button>
    </header>

    <details class="sp-section" open>
      <summary>功能 <span class="chev">▾</span></summary>
      <div class="sp-body sp-features">
        <div v-for="f in FEATURES" :key="f.id" class="feature">
          <div class="feature-head" :class="{ clickable: hasDetail(f.id) }" @click="toggleExpand(f.id)">
            <div class="cr-text">
              <div class="cr-title">
                {{ f.label }}
                <span v-if="f.permissions" class="badge">权限</span>
              </div>
              <div class="cr-desc">{{ f.description }}</div>
            </div>
            <span v-if="hasDetail(f.id)" class="feature-caret" :class="{ open: expanded[f.id] }">▾</span>
            <label class="switch" @click.stop>
              <input type="checkbox" :checked="settings.features[f.id]" @change="onFeatureChange(f, $event)" />
              <span class="track"></span>
            </label>
          </div>

          <Transition name="feat">
            <div v-if="expanded[f.id] && hasDetail(f.id)" class="feature-body">
              <!-- 壁纸与效果 -->
              <template v-if="f.id === 'wallpaper'">
                <div class="btn-row">
                  <button class="chip" @click="pickWallpaper">选择本地图片</button>
                  <button v-if="settings.wallpaper.imageId" class="chip" @click="removeImage">移除图片</button>
                </div>

                <label class="row">预设渐变</label>
                <div class="presets">
                  <button
                    v-for="p in PRESETS"
                    :key="p.name"
                    class="preset"
                    :class="{ active: settings.wallpaper.mode === 'gradient' && settings.wallpaper.gradientFrom === p.from }"
                    @click="settings.wallpaper.mode = 'gradient'; settings.wallpaper.gradientFrom = p.from; settings.wallpaper.gradientTo = p.to"
                  >
                    <span class="swatch" :style="{ background: `linear-gradient(135deg, ${p.from}, ${p.to})` }" />
                    {{ p.name }}
                  </button>
                </div>

                <label class="row">自定义渐变（改色即切换为渐变壁纸）</label>
                <div class="btn-row">
                  <input type="color" v-model="settings.wallpaper.gradientFrom" @input="settings.wallpaper.mode = 'gradient'" />
                  <input type="color" v-model="settings.wallpaper.gradientTo" @input="settings.wallpaper.mode = 'gradient'" />
                </div>

                <label class="row">适配方式</label>
                <div class="seg">
                  <button
                    v-for="m in FIT_OPTIONS"
                    :key="m[0]"
                    :class="{ active: settings.wallpaper.fit === m[0] }"
                    @click="settings.wallpaper.fit = m[0]"
                  >
                    {{ m[1] }}
                  </button>
                </div>

                <label class="row">缩放 <span class="val">{{ settings.wallpaper.zoom.toFixed(2) }}</span></label>
                <input type="range" min="1" max="3" step="0.01" v-model.number="settings.wallpaper.zoom" />
                <label class="row">水平位置 <span class="val">{{ settings.wallpaper.posX }}</span></label>
                <input type="range" min="0" max="100" step="1" v-model.number="settings.wallpaper.posX" />
                <label class="row">垂直位置 <span class="val">{{ settings.wallpaper.posY }}</span></label>
                <input type="range" min="0" max="100" step="1" v-model.number="settings.wallpaper.posY" />

                <label class="row">模糊 <span class="val">{{ settings.wallpaper.blur }}px</span></label>
                <input type="range" min="0" max="40" step="1" v-model.number="settings.wallpaper.blur" />
                <label class="row">亮度 <span class="val">{{ brightnessPct }}%</span></label>
                <input type="range" min="40" max="160" step="1" v-model.number="brightnessPct" />
                <label class="row">对比度 <span class="val">{{ contrastPct }}%</span></label>
                <input type="range" min="40" max="160" step="1" v-model.number="contrastPct" />
                <label class="row">饱和度 <span class="val">{{ saturationPct }}%</span></label>
                <input type="range" min="0" max="200" step="1" v-model.number="saturationPct" />
                <label class="row">暗角 <span class="val">{{ vignettePct }}%</span></label>
                <input type="range" min="0" max="100" step="1" v-model.number="vignettePct" />
                <label class="row">颗粒噪点 <span class="val">{{ grainPct }}%</span></label>
                <input type="range" min="0" max="100" step="1" v-model.number="grainPct" />
                <label class="row">变暗遮罩（提高可读性） <span class="val">{{ dimPct }}%</span></label>
                <input type="range" min="0" max="80" step="1" v-model.number="dimPct" />
              </template>

              <!-- 问候语 -->
              <template v-else-if="f.id === 'clock'">
                <input v-model="settings.greeting.text" class="text-input" placeholder="留空则不显示" />
                <div class="cr-desc">显示在页面左下角，可自由填写</div>
              </template>

              <!-- 搜索 -->
              <template v-else-if="f.id === 'search'">
                <label class="row">搜索引擎</label>
                <select class="select" :value="settings.search.engine" @change="onEngineChange">
                  <option v-for="e in ENGINES" :key="e.id" :value="e.id">{{ e.label }}</option>
                </select>
                <template v-if="settings.search.engine === 'custom'">
                  <label class="row">自定义搜索模板</label>
                  <input class="text-input" v-model="settings.search.customTemplate" placeholder="https://example.com/search?q=%s" />
                  <div class="cr-desc">%s 会被替换为搜索词</div>
                </template>
                <div class="switch-row">
                  <span>搜索建议（联网）</span>
                  <label class="switch"><input type="checkbox" v-model="settings.search.showSuggestions" /><span class="track"></span></label>
                </div>
                <div class="switch-row">
                  <span>搜索历史</span>
                  <label class="switch"><input type="checkbox" v-model="settings.search.showHistory" /><span class="track"></span></label>
                </div>
                <div class="switch-row">
                  <span>最常搜索</span>
                  <label class="switch"><input type="checkbox" v-model="settings.search.showMostSearched" /><span class="track"></span></label>
                </div>
                <label class="row">打开结果方式</label>
                <select class="select" :value="settings.search.openIn" @change="onOpenInChange">
                  <option value="current">当前标签页跳转</option>
                  <option value="newtab">新标签页打开</option>
                  <option value="background">后台新标签页</option>
                </select>
                <div class="btn-row" style="margin-top: 10px">
                  <button class="chip danger" @click="clearHistory">清空搜索历史</button>
                </div>
              </template>

              <!-- 收藏夹 -->
              <template v-else-if="f.id === 'bookmarks'">
                <label class="row">起始位置</label>
                <select class="select" :value="settings.bookmarks.rootId" @change="onRootChange">
                  <option value="">全部（书签栏 + 其他书签）</option>
                  <option v-for="r in roots" :key="r.id" :value="r.id">{{ r.title }}</option>
                </select>
                <div class="cr-desc">选择后，左上角收藏夹面板将直接展示该文件夹的内容</div>
                <div class="switch-row">
                  <span>直接展示收藏内容</span>
                  <label class="switch"><input type="checkbox" v-model="settings.bookmarks.showContents" /><span class="track"></span></label>
                </div>
                <label class="row">最大条数 <span class="val">{{ settings.bookmarks.maxItems }}</span></label>
                <input type="range" min="5" max="60" step="1" v-model.number="settings.bookmarks.maxItems" />
              </template>

              <!-- 常用网址 -->
              <template v-else-if="f.id === 'quicklinks'">
                <label class="row">最大条数 <span class="val">{{ settings.quickLinks.maxItems }}</span></label>
                <input type="range" min="4" max="24" step="1" v-model.number="settings.quickLinks.maxItems" />
              </template>

              <!-- 待办事项 -->
              <template v-else-if="f.id === 'todos'">
                <label class="row">位置</label>
                <div class="seg">
                  <button :class="{ active: settings.todos.position === 'center' }" @click="settings.todos.position = 'center'">居中</button>
                  <button :class="{ active: settings.todos.position === 'left' }" @click="settings.todos.position = 'left'">左侧 1/3</button>
                  <button :class="{ active: settings.todos.position === 'right' }" @click="settings.todos.position = 'right'">右侧 1/3</button>
                </div>
                <label class="row">背景颜色</label>
                <div class="seg">
                  <button :class="{ active: settings.todos.theme === 'dark' }" @click="settings.todos.theme = 'dark'">深色</button>
                  <button :class="{ active: settings.todos.theme === 'light' }" @click="settings.todos.theme = 'light'">亮色</button>
                </div>
                <div class="switch-row">
                  <span>显示已完成</span>
                  <label class="switch"><input type="checkbox" v-model="settings.todos.showDone" /><span class="track"></span></label>
                </div>
                <div class="switch-row">
                  <span>跨设备同步（浏览器账号）</span>
                  <label class="switch"><input type="checkbox" v-model="settings.todos.sync" /><span class="track"></span></label>
                </div>
                <div class="cr-desc">同步仅在当前浏览器账号内有效；Chrome 与 Edge 的同步云相互独立。</div>
              </template>
            </div>
          </Transition>
        </div>
      </div>
    </details>

    <details class="sp-section">
      <summary>历史与下载 <span class="chev">▾</span></summary>
      <div class="sp-body">
        <label class="row">历史最大条数 <span class="val">{{ settings.history.maxItems }}</span></label>
        <input type="range" min="3" max="30" step="1" v-model.number="settings.history.maxItems" />
        <label class="row">下载最大条数 <span class="val">{{ settings.downloads.maxItems }}</span></label>
        <input type="range" min="3" max="30" step="1" v-model.number="settings.downloads.maxItems" />
      </div>
    </details>

    <details class="sp-section">
      <summary>数据 <span class="chev">▾</span></summary>
      <div class="sp-body">
        <div class="btn-row">
          <button class="chip" @click="exportConfig">导出配置</button>
          <button class="chip" @click="importFile?.click()">导入配置</button>
          <input ref="importFile" type="file" accept="application/json,.json" hidden @change="onImportFile" />
        </div>
        <div class="btn-row" style="margin-top: 10px">
          <button class="chip danger" @click="resetAll">恢复默认设置</button>
          <button class="chip danger" @click="clearAll">清空全部数据</button>
        </div>
      </div>
    </details>

    <details class="sp-section">
      <summary>关于与隐私 <span class="chev">▾</span></summary>
      <div class="sp-body">
        <div class="cr-desc">当前版本：v{{ version }}</div>
        <div class="cr-desc">
          NovaTab · 纯本地运行：所有数据仅保存在本机浏览器内（chrome.storage + IndexedDB），无遥测、无广告、无账户。
          唯一的联网请求是搜索建议词（可在「搜索」中关闭）。壁纸同样保存在本地，不依赖任何在线服务。
        </div>
      </div>
    </details>
  </aside>
</template>
