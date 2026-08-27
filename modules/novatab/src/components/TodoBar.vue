<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { settings } from '../core/storage';
import { loadTodos, pushSync, todos } from '../core/todos';
import Icon from './Icon.vue';
import { formatDue } from '../core/utils';

const managerOpen = ref(false);
const newText = ref('');
const withDue = ref(false);
const newDue = ref('');

onMounted(() => {
  void loadTodos();
});

const items = computed(() => {
  const list = [...todos.state.items];
  return settings.todos.showDone ? list : list.filter((i) => !i.done);
});

const notesModel = computed({
  get: () => todos.state.notes,
  set: (v: string) => {
    todos.state.notes = v;
  }
});

function add() {
  const t = newText.value.trim();
  if (!t) return;
  const due = withDue.value && newDue.value ? new Date(newDue.value).getTime() : undefined;
  todos.state.items.push({ id: crypto.randomUUID(), text: t, done: false, ts: Date.now(), due });
  newText.value = '';
  newDue.value = '';
  withDue.value = false;
}

function toggle(id: string) {
  const it = todos.state.items.find((i) => i.id === id);
  if (it) it.done = !it.done;
}

function remove(id: string) {
  const i = todos.state.items.findIndex((x) => x.id === id);
  if (i >= 0) todos.state.items.splice(i, 1);
}

function move(id: string, dir: -1 | 1) {
  const arr = todos.state.items;
  const i = arr.findIndex((x) => x.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= arr.length) return;
  const tmp = arr[i];
  const target = arr[j];
  if (!tmp || !target) return;
  arr[i] = target;
  arr[j] = tmp;
}

watch(
  () => [settings.todos.sync, todos.state.items, todos.state.notes],
  () => {
    if (settings.todos.sync) pushSync();
  },
  { deep: true }
);
</script>

<template>
  <div class="todo-bar" :class="[`pos-${settings.todos.position}`, settings.todos.theme === 'light' ? 'todo-light' : '']">
    <div class="todo-side">
      <button class="todo-manager-btn" title="管理待办（添加 / 删除 / 排序）" @click="managerOpen = !managerOpen">
        <Icon name="list" :size="22" />
      </button>
    </div>

    <TransitionGroup name="todo" tag="div" class="todo-strips">
      <div v-for="it in items" :key="it.id" class="todo-strip" :class="{ done: it.done }">
        <input class="todo-check" type="checkbox" :checked="it.done" @change="toggle(it.id)" />
        <span class="todo-strip-text" :title="it.text">{{ it.text }}</span>
        <span
          v-if="it.due"
          class="todo-due"
          :class="{ overdue: it.due < Date.now() && !it.done }"
        >
          {{ formatDue(it.due) }}
        </span>
        <button class="mini" title="删除" @click="remove(it.id)">✕</button>
      </div>
    </TransitionGroup>

    <div v-if="managerOpen" class="todo-manager-backdrop" @click="managerOpen = false" />
    <div v-if="managerOpen" class="todo-manager">
      <div class="tm-head">
        <span>待办管理</span>
        <button class="mini" @click="managerOpen = false">✕</button>
      </div>
      <form class="tm-add" @submit.prevent="add">
        <input v-model="newText" class="mini-input" placeholder="添加待办…" />
        <label class="tm-due-toggle" title="设置提醒日期和时间">
          <input type="checkbox" v-model="withDue" /> <Icon name="clock" :size="14" />
        </label>
        <button type="submit" class="chip">添加</button>
      </form>
      <input v-if="withDue" v-model="newDue" type="datetime-local" class="text-input" />
      <div class="tm-list">
        <div v-for="it in todos.state.items" :key="it.id" class="tm-item" :class="{ done: it.done }">
          <input class="todo-check" type="checkbox" :checked="it.done" @change="toggle(it.id)" />
          <span class="tm-text" :title="it.text">{{ it.text }}</span>
          <span v-if="it.due" class="todo-due">{{ formatDue(it.due) }}</span>
          <button class="mini" title="上移" @click="move(it.id, -1)">↑</button>
          <button class="mini" title="下移" @click="move(it.id, 1)">↓</button>
          <button class="mini" title="删除" @click="remove(it.id)">✕</button>
        </div>
        <div v-if="!todos.state.items.length" class="hint">暂无待办</div>
      </div>
      <textarea v-model="notesModel" class="notes" rows="2" placeholder="注意事项 / 备注…"></textarea>
    </div>
  </div>
</template>
