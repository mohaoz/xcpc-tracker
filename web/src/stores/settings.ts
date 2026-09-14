import { defineStore } from 'pinia';
import { ref } from 'vue';
import { liveQuery } from 'dexie';
import { localDb } from '../lib/local-db';
export const useSettingsStore = defineStore('settings', () => {
  const allowMedalEstimates = ref(true);
  const loaded = ref(false), saving = ref(false), error = ref('');
  liveQuery(() => localDb.appSettings.get('allow_medal_estimates')).subscribe({
    next(row) { allowMedalEstimates.value = row?.value ?? true; loaded.value = true; error.value = ''; },
    error() { allowMedalEstimates.value = false; loaded.value = false; error.value = '无法读取估算设置'; },
  });
  async function toggleEstimates() {
    if (!loaded.value || saving.value) return;
    saving.value = true;
    try {
      const next = !allowMedalEstimates.value;
      await localDb.appSettings.put({key:'allow_medal_estimates', value:next});
      allowMedalEstimates.value = next;
    } catch { error.value = '估算设置保存失败'; }
    finally { saving.value = false; }
  }
  return {allowMedalEstimates, loaded, saving, error, toggleEstimates};
});
