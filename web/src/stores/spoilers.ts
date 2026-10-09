import { defineStore } from 'pinia';
import { computed, ref, shallowRef } from 'vue';
import { liveQuery } from 'dexie';
import { localDb, migrateSpoilerPreferencesOnce } from '../lib/local-db';
import { isSpoilerDefault, shouldShowSpoilers, type SpoilerDefault } from '../lib/spoiler-policy';
import type { ContestPreference } from '../lib/local-model';

/**
 * Spoiler state has two layers:
 * - `spoilerDefault` (appSettings `spoiler_default`: all / touched / none,
 *   default touched) is the global default chosen on the management page;
 * - `contestPreferences` hold only manual per-contest choices (every flip on a
 *   detail page) until reset. Changing the global default never rewrites them.
 */
export const useSpoilerStore = defineStore('spoilers', () => {
  const preferences = shallowRef(new Map<string, ContestPreference['spoiler_mode']>());
  const spoilerDefault = ref<SpoilerDefault>('touched');
  const preferencesLoaded = ref(false);
  const settingLoaded = ref(false);
  const loaded = computed(() => preferencesLoaded.value && settingLoaded.value);
  const error = ref('');
  const saving = ref<string[]>([]);
  const bulkSaving = ref(false);
  const overrideCount = computed(() => preferences.value.size);
  let started = false;

  function initialize() {
    if (started) return;
    started = true;
    // Run the one-time cleanup first so old bulk-written rows never show.
    // Spoilers stay hidden until both subscriptions have reported.
    void migrateSpoilerPreferencesOnce()
      .catch(() => { error.value = '无法读取剧透设置，暂时隐藏剧透信息。'; })
      .finally(() => {
        liveQuery(() => localDb.contestPreferences.toArray()).subscribe({
          next(rows) {
            preferences.value = new Map(rows.map(p => [p.contest_id, p.spoiler_mode]));
            preferencesLoaded.value = true;
            error.value = '';
          },
          error() { preferencesLoaded.value = false; started = false; error.value = '无法读取剧透设置，暂时隐藏剧透信息。'; },
        });
      });
    liveQuery(() => localDb.appSettings.get('spoiler_default')).subscribe({
      next(row) { spoilerDefault.value = isSpoilerDefault(row?.value) ? row.value : 'touched'; settingLoaded.value = true; },
      error() { settingLoaded.value = false; error.value = '无法读取剧透设置，暂时隐藏剧透信息。'; },
    });
  }

  function visible(id: string, touched: boolean) {
    return shouldShowSpoilers(preferences.value.get(id), touched, loaded.value, spoilerDefault.value);
  }

  function hasOverride(id: string) {
    return preferences.value.has(id);
  }

  /**
   * Flip one contest. Every manual flip is recorded, even when it matches the
   * current default, so it keeps winning if the default later changes (e.g.
   * the contest becomes touched). Only "恢复默认" removes it.
   */
  async function toggle(id: string, touched: boolean) {
    if (!loaded.value || saving.value.includes(id)) return;
    saving.value.push(id);
    const mode = visible(id, touched) ? 'non_spoiler' : 'spoiler';
    try {
      await localDb.contestPreferences.put({ contest_id: id, spoiler_mode: mode });
      preferences.value = new Map(preferences.value).set(id, mode);
      error.value = '';
    } catch { error.value = '剧透设置保存失败，请重试。'; }
    finally { saving.value = saving.value.filter(value => value !== id); }
  }

  /** Drop one contest's manual choice so it follows the default again. */
  async function resetContest(id: string) {
    if (!loaded.value || saving.value.includes(id)) return;
    saving.value.push(id);
    try {
      await localDb.contestPreferences.delete(id);
      const next = new Map(preferences.value);
      next.delete(id);
      preferences.value = next;
      error.value = '';
    } catch { error.value = '剧透设置保存失败，请重试。'; }
    finally { saving.value = saving.value.filter(value => value !== id); }
  }

  /** Global default; manual per-contest choices are left untouched. */
  async function setSpoilerDefault(value: SpoilerDefault) {
    if (!loaded.value || bulkSaving.value) return;
    bulkSaving.value = true;
    try {
      await localDb.appSettings.put({ key: 'spoiler_default', value });
      spoilerDefault.value = value;
      error.value = '';
    } catch { error.value = '剧透设置保存失败，请重试。'; }
    finally { bulkSaving.value = false; }
  }

  /** Remove every manual per-contest choice. */
  async function resetAll() {
    if (!loaded.value || bulkSaving.value) return;
    bulkSaving.value = true;
    try {
      await localDb.contestPreferences.clear();
      preferences.value = new Map();
      error.value = '';
    } catch { error.value = '剧透设置保存失败，请重试。'; }
    finally { bulkSaving.value = false; }
  }

  initialize();
  return { loaded, error, saving, bulkSaving, spoilerDefault, overrideCount, visible, hasOverride, toggle, resetContest, setSpoilerDefault, resetAll, initialize };
});
