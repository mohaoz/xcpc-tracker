import { defineStore } from 'pinia';
import { ref, shallowRef } from 'vue';
import { liveQuery } from 'dexie';
import { localDb } from '../lib/local-db';
import { shouldShowSpoilers } from '../lib/spoiler-policy';
import type { ContestPreference } from '../lib/local-model';

export const useSpoilerStore = defineStore('spoilers', () => {
  const preferences = shallowRef(new Map<string, ContestPreference['spoiler_mode']>());
  const loaded = ref(false);
  const error = ref('');
  const saving = ref<string[]>([]);
  const bulkSaving = ref(false);
  let started = false;
  function initialize() {
    if (started) return;
    started = true;
    liveQuery(() => localDb.contestPreferences.toArray()).subscribe({
      next(rows) {
        preferences.value = new Map(rows.map(p => [p.contest_id, p.spoiler_mode]));
        loaded.value = true;
        error.value = '';
      },
      error() { loaded.value = false; started = false; error.value = '无法读取剧透设置，暂时隐藏剧透信息。'; },
    });
  }
  function visible(id: string, touched: boolean) {
    return shouldShowSpoilers(preferences.value.get(id), touched, loaded.value);
  }
  async function toggle(id: string, touched: boolean) {
    if (!loaded.value || saving.value.includes(id)) return;
    saving.value.push(id);
    const mode = visible(id, touched) ? 'non_spoiler' : 'spoiler';
    try {
      await localDb.contestPreferences.put({contest_id: id, spoiler_mode: mode});
      preferences.value = new Map(preferences.value).set(id, mode);
      error.value = '';
    } catch { error.value = '剧透设置保存失败，请重试。'; }
    finally { saving.value = saving.value.filter(value => value !== id); }
  }
  initialize();
  function allEnabled(ids: string[]) {
    return ids.length > 0 && ids.every(id => preferences.value.get(id) === 'spoiler');
  }
  async function setAll(ids: string[], enabled: boolean) {
    if (!loaded.value || bulkSaving.value) return;
    bulkSaving.value = true;
    const mode = enabled ? 'spoiler' : 'non_spoiler';
    try {
      await localDb.contestPreferences.bulkPut(ids.map(id => ({contest_id: id, spoiler_mode: mode})));
      const next = new Map(preferences.value);
      ids.forEach(id => next.set(id, mode));
      preferences.value = next;
      error.value = '';
    } catch { error.value = '批量剧透设置保存失败，请重试。'; }
    finally { bulkSaving.value = false; }
  }
  return { loaded, error, saving, bulkSaving, visible, toggle, initialize, allEnabled, setAll };
});
