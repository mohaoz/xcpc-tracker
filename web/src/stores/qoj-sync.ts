import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import { liveQuery } from 'dexie';
import { localDb, listMemberPeopleFromDb, recordImportSyncAttempt } from '../lib/local-db';
import { importQojUserscriptMembers } from '../lib/qoj';
import { emitMemberMutated } from '../lib/member-events';
import { useFeedbackStore, type FeedbackAction } from './feedback';
import { compareScriptVersions } from '../lib/qoj-script-version';
import { useQojManualStore } from './qoj-manual';
import { importCodeforcesMember } from '../lib/codeforces';

class SyncError extends Error {
  constructor(public code: string, public retryAfterMs = 0) { super(code); }
}
const labels: Record<string, string> = {
  BRIDGE_MISSING: '未连接脚本，请安装或启用脚本、允许用户脚本运行，然后重新检测。',
  AUTH_REQUIRED: '请先在 QOJ 登录，然后回到这里点击“重试”。已有做题记录不会被清空。',
  CHALLENGE_REQUIRED: 'QOJ 要求验证或拒绝访问，请前往 QOJ 完成验证后点击“重试”。已有做题记录不会被清空。',
  PERMISSION_REQUIRED: '请更新 QOJ 同步脚本至最新版，刷新本站后重试。',
  RATE_LIMITED: 'QOJ 请求过于频繁，暂时无法同步。请在限流结束后重试。',
  PARSE_ERROR: 'QOJ 主页数据不完整或结构变化，已停止自动重试，旧数据已保留。',
  USER_NOT_FOUND: 'QOJ 用户不存在，请检查账号。',
  TIMEOUT: 'QOJ 请求超时，旧数据已保留。', NETWORK_ERROR: 'QOJ 网络请求失败，旧数据已保留。',
  CANCELLED: '已停止同步。', BUSY: '另一项 QOJ 同步正在运行。',
  STORAGE_ERROR: '本地保存失败，请检查浏览器存储权限或可用空间后重试。',
  LOCK_UNAVAILABLE: '此浏览器不支持安全的跨标签页协调，请使用新版 Chrome。',
};
function rpc(method: string, params: object = {}, signal?: AbortSignal): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const message = (requestId: string, method: string, params: object) => window.postMessage({
      protocol:'xcpc-sync', version:1, direction:'request', request_id:requestId, method, params,
    }, location.origin);
    const finish = (error: unknown, result?: unknown) => {
      clearTimeout(timer); window.removeEventListener('message', receive); signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(result);
    };
    const cancel = () => message(crypto.randomUUID(), 'cancel', {request_id:id});
    const abort = () => { cancel(); finish(new SyncError('CANCELLED')); };
    const receive = (event: MessageEvent) => {
      const m = event.data;
      if (event.source !== window || event.origin !== location.origin || m?.protocol !== 'xcpc-sync' || m.version !== 1 || m.direction !== 'response' || m.request_id !== id) return;
      finish(m.error ? new SyncError(String(m.error.code), Number(m.error.retry_after_ms) || 0) : null, m.result);
    };
    const timer = setTimeout(() => { cancel(); finish(new SyncError(method === 'hello' ? 'BRIDGE_MISSING' : 'TIMEOUT')); }, method === 'hello' ? 1800 : 28000);
    window.addEventListener('message', receive);
    signal?.addEventListener('abort', abort, {once:true});
    if (signal?.aborted) abort(); else message(id, method, params);
  });
}
export function validateQojSnapshot(value: any, handle: string) {
  if (value?.provider !== 'qoj' || value.handle !== handle || value.snapshot?.scope !== 'profile_visible' ||
      typeof value.fetched_at !== 'string' || !Number.isFinite(Date.parse(value.fetched_at)) ||
      !['solved','attempted'].every(key => Array.isArray(value.snapshot[key]) && value.snapshot[key].every((id: unknown) => typeof id === 'string' && /^\d+$/.test(id)))) {
    throw new SyncError('PARSE_ERROR');
  }
  return value as { fetched_at: string; snapshot: { solved: string[]; attempted: string[] } };
}
export const useQojSyncStore = defineStore('qoj-sync', () => {
  const feedback = useFeedbackStore();
  let manualRun = false;
  const announced = new Set<string>();
  const enabled = ref(false), connected = ref(false), busy = ref(false), checking = ref(false);
  const useUserscript=ref(false), modeLoaded=ref(false);
  const introPending=ref(false);
  let introClaiming=false;
  watch([introPending,()=>feedback.current,()=>useQojManualStore().open,busy],async()=>{
    if(!introPending.value || introClaiming || feedback.current || useQojManualStore().open || busy.value)return;
    introClaiming=true;
    try {
      const claimed=await localDb.transaction('rw',localDb.appSettings,async()=>{
        if((await localDb.appSettings.get('qoj_script_intro_seen'))?.value)return false;
        await localDb.appSettings.put({key:'qoj_script_intro_seen',value:true});
        return true;
      });
      introPending.value=false;
      if(claimed && !feedback.current && !useQojManualStore().open)feedback.show({
        tone:'info',title:'QOJ 支持油猴同步了',
        message:'现在可以用油猴脚本同步 QOJ 做题记录。默认仍为手动导入，可在管理页启用。',
        actions:[{label:'使用帮助',run:showSetup}],
      });
    } catch {introPending.value=false;}
    finally {introClaiming=false;}
  },{flush:'post'});
  async function setUseUserscript(value:boolean) {
    try {await localDb.appSettings.put({key:'qoj_use_userscript',value});useUserscript.value=value;if(!value)controller?.abort();return true;}
    catch {report('STORAGE_ERROR');return false;}
  }
  const message = ref(''), currentHandle = ref('');
  const connectionMessage = ref('');
  const installedVersion = ref(''), latestVersion = ref(''), minimumVersion = ref('');
  const updateAvailable = computed(() => connected.value && !!latestVersion.value && (!installedVersion.value || compareScriptVersions(installedVersion.value,latestVersion.value)<0));
  const updateRequired = computed(() => !!installedVersion.value && !!minimumVersion.value && compareScriptVersions(installedVersion.value,minimumVersion.value)<0);
  const promptedUpdates = new Set<string>();
  function showUpdate() {
    promptedUpdates.add(`${installedVersion.value}:${latestVersion.value}`);
    feedback.show({tone:'info',title:'QOJ 脚本有更新',
      message:`${installedVersion.value || '旧版'} → ${latestVersion.value}，请更新脚本后刷新页面。`,
      actions:[{label:'更新脚本',href:`${import.meta.env.BASE_URL}userscripts/qoj-sync.user.js`}]});
  }
  watch([updateAvailable,latestVersion,installedVersion,()=>feedback.current,busy,checking,useUserscript,modeLoaded],() => {
    if (modeLoaded.value && useUserscript.value && updateAvailable.value && !busy.value && !checking.value && !feedback.current && !promptedUpdates.has(`${installedVersion.value}:${latestVersion.value}`)) showUpdate();
  },{flush:'post'});
  let nextUpdateCheck = 0;
  let updateCheck: Promise<void> | null = null;
  function checkUpdates() {
    if (updateCheck) return updateCheck;
    if (Date.now()<nextUpdateCheck) return Promise.resolve();
    updateCheck = (async () => {
      nextUpdateCheck = Date.now()+5*60000;
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}userscripts/qoj-sync.version.json`,{cache:'no-cache',signal:AbortSignal.timeout(5000)});
        if (!response.ok) return;
        const data = await response.json();
        if (data.protocol_version!==1 || typeof data.version!=='string' || typeof data.minimum_version!=='string') return;
        if (compareScriptVersions(data.minimum_version,data.version)>0) return;
        latestVersion.value=data.version; minimumVersion.value=data.minimum_version;
        nextUpdateCheck=Date.now()+6*3600000;
      } catch { /* Update outages must not prevent status synchronization. */ }
    })().finally(()=>{updateCheck=null;});
    return updateCheck;
  }
  const issues = ref<Array<{code:string; handle:string; detail:string; retryAt:number; at:string}>>([]);
  const progress = ref({total:0,completed:0,succeeded:0,failed:0});
  function showSetup() {
    feedback.show({tone:'info',title:'QOJ 自动同步帮助',
      message:`${updateAvailable.value ? `脚本有更新：${installedVersion.value || '旧版'} → ${latestVersion.value}，更新后请刷新页面。\n\n` : ''}1. 安装 Tampermonkey，允许用户脚本运行。\n2. 安装 QOJ 同步脚本，刷新本站。\n3. 在管理页启用“使用 QOJ 油猴脚本”。\n4. 登录 QOJ，点击“同步 QOJ”。\n\n安装即授权本站读取 QOJ 做题记录。定时同步需在管理页开启，手动失败不会自动重试。`,
      detail:installedVersion.value ? `当前脚本：${installedVersion.value}\n可用版本：${latestVersion.value || '尚未检查'}\n本站检测新版并提示，由你点击更新。` : undefined,
      actions:[{label:'安装油猴',href:'https://www.tampermonkey.net/'},{label:updateAvailable.value ? '更新脚本':'安装同步脚本',href:`${import.meta.env.BASE_URL}userscripts/qoj-sync.user.js`}]});
  }
  function report(code: string, handle = '', retryAt = 0) {
    const issue = {code,handle,detail:labels[code] || '同步未完成，请重试或反馈下方错误代码。',retryAt,at:new Date().toISOString()};
    issues.value = [...issues.value.filter(i => i.handle !== handle), issue];
    message.value = `${handle ? handle + '：' : ''}${issue.detail}`;
    const key = `${handle}:${code}`;
    if (!manualRun && announced.has(key)) return;
    announced.add(key);
    if (code === 'BRIDGE_MISSING') { if (manualRun) showSetup(); return; }
    if (code === 'AUTH_REQUIRED') {
      feedback.show({tone:'warning',title:'请先登录 QOJ',message:'请前往 QOJ 登录账号后重试。',actions:[{label:'前往 QOJ',href:'https://qoj.ac/'}]});
      return;
    }
    const titles: Record<string,string> = {AUTH_REQUIRED:'请先登录 QOJ',CHALLENGE_REQUIRED:'需要完成 QOJ 验证',BRIDGE_MISSING:'未连接 QOJ 同步脚本',PERMISSION_REQUIRED:'需要授权连接',RATE_LIMITED:'QOJ 暂时限制请求',CANCELLED:'同步已停止',BUSY:'另一标签页正在同步',STORAGE_ERROR:'本地保存失败'};
    const actions: FeedbackAction[] = [];
    if (['AUTH_REQUIRED','CHALLENGE_REQUIRED'].includes(code)) actions.push({label:'前往 QOJ',href:'https://qoj.ac/'});
    if (!['RATE_LIMITED','CANCELLED','BUSY','LOCK_UNAVAILABLE'].includes(code)) actions.push({label:'重试',run:() => { void sync(true,handle || undefined); }});
    feedback.show({tone:code === 'CANCELLED' || code === 'BUSY' ? 'info' : 'warning',title:titles[code] || 'QOJ 同步未完成',
      message:`${handle ? `账号：${handle}\n` : ''}${issue.detail}${code === 'RATE_LIMITED' && retryAt ? `\n最早可重试时间：${new Date(retryAt).toLocaleTimeString()}` : ''}${manualRun ? '\n本次为手动操作，不会自动重试。' : ''}`,
      detail:`错误代码：${code}\n时间：${issue.at}`,actions});
  }
  let started = false, controller: AbortController | null = null;
  async function check(interactive = false) {
    checking.value = true;
    try {
      const hello = await rpc('hello'); connected.value = hello?.version === 1;
      installedVersion.value = /^\d+\.\d+\.\d+$/.test(hello?.script_version || '') ? hello.script_version : '';
      if (connected.value) await checkUpdates();
      connectionMessage.value = connected.value ? (hello.connected ? '脚本已连接' : '请更新 QOJ 同步脚本') : labels.BRIDGE_MISSING;
      if (connected.value) issues.value = issues.value.filter(i => i.code !== 'BRIDGE_MISSING');
    }
    catch { connected.value = false; connectionMessage.value = labels.BRIDGE_MISSING; }
    finally { checking.value = false; }
    if (interactive) {
      if (connected.value) feedback.show({tone:'success',title:'脚本连接正常',message:connectionMessage.value});
      else { const previous = manualRun; manualRun = true; report('BRIDGE_MISSING'); manualRun = previous; }
    }
    return connected.value;
  }
  async function setEnabled(value: boolean) {
    try {
      await localDb.appSettings.put({key:'auto_sync',value}); enabled.value = value;
      if (!value) { controller?.abort(); cfController?.abort(); }
      else void runAutomatic();
    }
    catch { report('STORAGE_ERROR'); }
  }
  let cfController: AbortController | null = null;
  async function syncCodeforcesAutomatically() {
    if (!enabled.value || cfController || document.visibilityState !== 'visible' || !navigator.locks) return;
    const current = new AbortController(); cfController = current;
    try {
      const people = await listMemberPeopleFromDb();
      for (const person of people) for (const handle of person.handles.filter(h=>h.provider==='codeforces')) {
        if (!enabled.value || current.signal.aborted || document.visibilityState !== 'visible') return;
        try {
          await importCodeforcesMember({memberId:person.memberId,displayName:person.displayName,handle:handle.handle},{automatic:true,signal:current.signal});
          emitMemberMutated();
        } catch { /* Importer retains failure evidence and previous successful data. */ }
      }
    } finally { if(cfController===current)cfController=null; }
  }
  async function runAutomatic(returning=false) {
    await Promise.allSettled([sync(false,undefined,returning),syncCodeforcesAutomatically()]);
  }
  async function sync(manual = false, onlyHandle?: string, returning = false) {
    if (!useUserscript.value) {
      if(manual) {
        const targets=(await listMemberPeopleFromDb()).flatMap(p=>p.handles.filter(h=>h.provider==='qoj' && (!onlyHandle || h.handle===onlyHandle)).map(h=>({memberId:p.memberId,displayName:p.displayName,handle:h.handle})));
        await useQojManualStore().show(targets);
      }
      return;
    }
    if (busy.value || (!manual && (!enabled.value || useQojManualStore().open || document.visibilityState !== 'visible'))) return;
    manualRun = manual;
    if (!navigator.locks) { report('LOCK_UNAVAILABLE'); return; }
    busy.value = true;
    controller = new AbortController();
    const signal = controller.signal;
    try {
      await navigator.locks.request('xcpc-qoj-sync', {ifAvailable:true}, async lock => {
        if (!lock) { if (manual) report('BUSY'); return; }
        if (!await check()) { report('BRIDGE_MISSING'); return; }
        if (updateRequired.value) {
          message.value='请更新 QOJ 同步脚本后重试。';
          if (manual) showUpdate();
          return;
        }
        const history = await localDb.syncRecords.toArray();
        const globalLimit = history.find(r => r.summaryJson.bridge === true && r.summaryJson.error_code === 'RATE_LIMITED' && Number(r.summaryJson.retry_at) > Date.now());
        if (globalLimit) { report('RATE_LIMITED', String(globalLimit.summaryJson.handle || ''), Number(globalLimit.summaryJson.retry_at)); return; }
        const people = await listMemberPeopleFromDb();
        const targets = people.flatMap(person => person.handles.filter(h => h.provider === 'qoj' && (!onlyHandle || onlyHandle === h.handle)).map(h => ({memberId:person.memberId,displayName:person.displayName,handle:h.handle})));
        let count = 0, failed = 0;
        if (manual) { progress.value = {total:targets.length,completed:0,succeeded:0,failed:0}; message.value = ''; }
        for (const target of targets) {
          if (signal.aborted || (!manual && !enabled.value)) break;
          const records = history.filter(r => r.summaryJson.bridge === true && r.summaryJson.handle === target.handle && r.summaryJson.member_id === target.memberId).sort((a,b) => b.startedAt.localeCompare(a.startedAt));
          const last = records[0];
          const retryAt = Number(last?.summaryJson.retry_at || 0);
          const lastCode = String(last?.summaryJson.error_code || '');
          if (lastCode === 'RATE_LIMITED' && retryAt > Date.now()) { report('RATE_LIMITED',target.handle,retryAt); break; }
          if (!manual) {
            if (last?.status === 'failed' && last.summaryJson.manual === true) continue;
            if (last?.status === 'succeeded' && Date.now() - Date.parse(last.startedAt) < 30 * 60000) continue;
            if (['AUTH_REQUIRED','CHALLENGE_REQUIRED'].includes(lastCode)) { if (!returning) continue; }
            else if (['PERMISSION_REQUIRED','PARSE_ERROR','USER_NOT_FOUND','CANCELLED'].includes(lastCode)) continue;
            else if (retryAt > Date.now()) continue;
          }
          currentHandle.value = target.handle;
          const at = new Date().toISOString(), recordId = 'qoj-bridge:' + crypto.randomUUID();
          let error: SyncError | null = null;
          let phase: 'request' | 'save' = 'request';
          try {
            const data = validateQojSnapshot(await rpc('syncMember', {provider:'qoj',handle:target.handle,interactive:manual}, signal), target.handle);
            // Do not recreate a member/handle removed while a request was in flight.
            const stillActive = (await listMemberPeopleFromDb()).some(p => p.memberId === target.memberId && p.handles.some(h => h.provider === 'qoj' && h.handle === target.handle));
            if (!stillActive || signal.aborted) throw new SyncError('CANCELLED');
            phase = 'save';
            await importQojUserscriptMembers({provider:'qoj',script_version:3,exported_at:data.fetched_at,members:[{member_id:target.memberId,display_name:target.displayName,handle:target.handle,...data.snapshot}]});
            issues.value = issues.value.filter(i => i.handle !== target.handle && i.handle !== '');
            for (const key of announced) if (key.startsWith(`${target.handle}:`)) announced.delete(key);
            count++; emitMemberMutated();
          } catch (e) {
            error = e instanceof SyncError ? e : new SyncError(phase === 'save' ? 'STORAGE_ERROR' : 'NETWORK_ERROR'); failed++;
            message.value = `${target.handle}：${labels[error.code] || error.code}`;
          }
          const failures = error ? Number(last?.summaryJson.failures || 0) + 1 : 0;
          const retry = error ? Date.now() + Math.max(error.retryAfterMs, Math.min(30 * 60000, 60000 * 2 ** Math.min(failures - 1, 5))) : 0;
          if (error) report(error.code,target.handle,retry);
          progress.value = {total:targets.length,completed:count+failed,succeeded:count,failed};
          await recordImportSyncAttempt({
            importSource:{sourceRecordId:recordId,kind:'qoj_userscript_json',label:`QOJ bridge / ${target.handle}`,importedAt:at,rawMetaJson:{handle:target.handle}},
            syncRecord:{syncId:recordId,sourceRecordId:recordId,adapter:'qoj_userscript',startedAt:at,finishedAt:new Date().toISOString(),status:error ? 'failed':'succeeded',summaryJson:{bridge:true,manual,handle:target.handle,member_id:target.memberId,error_code:error?.code || null,retry_at:retry,failures}},
          });
          if (error && ['AUTH_REQUIRED','CHALLENGE_REQUIRED','RATE_LIMITED','PERMISSION_REQUIRED','CANCELLED'].includes(error.code)) break;
        }
        if (!failed && manual) message.value = targets.length ? `已同步 ${count} 个 QOJ 账号` : '请先添加带 QOJ 账号的成员';
        else if (failed && count) message.value = `部分完成：成功 ${count} 个，失败 ${failed} 个${targets.length-count-failed > 0 ? `，尚未处理 ${targets.length-count-failed} 个` : ''}`;
        if (manual && !failed) feedback.show({tone:count ? 'success':'info',title:count ? 'QOJ 同步完成':'没有可同步的账号',message:message.value});
      });
    } catch (e) { report(e instanceof SyncError ? e.code : 'STORAGE_ERROR', currentHandle.value); }
    finally { busy.value = false; currentHandle.value = ''; controller = null; }
  }
  function start() {
    if (started) return;
    started = true;
    void check();
    liveQuery(() => Promise.all([localDb.appSettings.get('auto_sync'),localDb.appSettings.get('qoj_auto_sync'),localDb.appSettings.get('qoj_use_userscript'),localDb.appSettings.get('qoj_script_intro_seen')])).subscribe({next([auto,legacy,mode,intro]) { enabled.value=(auto??legacy)?.value===true;useUserscript.value=mode?.value===true;modeLoaded.value=true;introPending.value=!intro?.value;if(!enabled.value){controller?.abort();cfController?.abort();}else if(!useUserscript.value)controller?.abort();void runAutomatic(); },error() {enabled.value=false;controller?.abort();cfController?.abort();}});
    setInterval(() => void runAutomatic(), 60000);
    setInterval(() => { if (document.visibilityState==='visible' && connected.value && Date.now()>=nextUpdateCheck) void check(); },60000);
    const returned = () => {
      if (document.visibilityState !== 'visible') return;
      if (connected.value && Date.now()>=nextUpdateCheck) void check();
      void runAutomatic(true);
    };
    window.addEventListener('focus', returned);
    document.addEventListener('visibilitychange', returned);
  }
  return {enabled,connected,busy,checking,message,connectionMessage,issues,progress,currentHandle,installedVersion,latestVersion,updateAvailable,updateRequired,useUserscript,modeLoaded,setUseUserscript,showSetup,check,setEnabled,sync,start,cancel:() => controller?.abort()};
});
