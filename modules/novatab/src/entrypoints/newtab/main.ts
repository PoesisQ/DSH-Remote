import { createApp } from 'vue';
import App from './App.vue';
import './style.css';
import { loadSettings } from '../../core/storage';
import { loadSearchHistory } from '../../core/searchHistory';

async function bootstrap() {
  await Promise.all([loadSettings(), loadSearchHistory()]);
  createApp(App).mount('#app');
}

void bootstrap();
