import { defineStore } from 'pinia';
import { ref } from 'vue';
import { buildQojBatchBrowserScript } from '../lib/qoj-member-script';
import { listMemberPeopleFromDb } from '../lib/local-db';
import { importQojUserscriptMembers, type QojUserscriptImport } from '../lib/qoj';
import { emitMemberMutated } from '../lib/member-events';

type Target = {memberId:string;handle:string;displayName?:string};
export const useQojManualStore = defineStore('qoj-manual', () => {
  const open=ref(false), busy=ref(false), script=ref(''), input=ref(''), error=ref(''), message=ref('');
  const targets=ref<Target[]>([]);
  async function show(selected?: Target[]) {
    if(busy.value) return;
    error.value=''; message.value=''; input.value=''; script.value=''; open.value=true;
    try {
      targets.value=selected ?? (await listMemberPeopleFromDb()).flatMap(p=>p.handles.filter(h=>h.provider==='qoj').map(h=>({memberId:p.memberId,displayName:p.displayName,handle:h.handle})));
      if(!targets.value.length) { error.value='请先添加 QOJ 账号。'; return; }
      script.value=buildQojBatchBrowserScript({members:targets.value});
    } catch(e) { error.value=e instanceof Error ? e.message : '生成脚本失败'; }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(script.value); message.value='脚本已复制。'; error.value=''; }
    catch { error.value='浏览器未允许复制，请展开脚本手动复制。'; }
  }
  async function importJson() {
    if(busy.value) return;
    busy.value=true; error.value='';message.value='';
    try {
      const data=JSON.parse(input.value) as QojUserscriptImport;
      if(data?.provider!=='qoj' || !Array.isArray(data.members)) throw new Error('请粘贴 QOJ 脚本导出的 JSON。');
      const byHandle=new Map(targets.value.map(t=>[t.handle,t]));
      const active=new Map((await listMemberPeopleFromDb()).flatMap(p=>p.handles.filter(h=>h.provider==='qoj').map(h=>[h.handle,p.memberId] as const)));
      if(targets.value.some(t=>active.get(t.handle)!==t.memberId)) throw new Error('账号已变更，请关闭弹窗后重新导出。');
      const mapped=data.members.map(m=>{
        if(!m || typeof m.handle!=='string') throw new Error('账号格式不正确。');
        const target=byHandle.get(m.handle);
        if(!target || !Array.isArray(m.solved) || !Array.isArray(m.attempted) || ![...m.solved,...m.attempted].every(id=>typeof id==='string' && /^\d+$/.test(id))) throw new Error('JSON 中账号或做题记录不符合本次导出，请重新导出。');
        return {...m,member_id:target.memberId,display_name:target.displayName || target.memberId};
      });
      if(data.fetch_failures!==undefined && !Array.isArray(data.fetch_failures)) throw new Error('抓取失败记录格式不正确。');
      const failures=(data.fetch_failures ?? []).map(f=>{
        if(!f || typeof f.handle!=='string') throw new Error('失败记录格式不正确。');
        const target=byHandle.get(f.handle);if(!target) throw new Error('失败记录包含本次导出之外的账号。');
        return {...f,member_id:target.memberId};
      });
      const handles=[...mapped.map(m=>m.handle),...failures.map(f=>f.handle)];
      if(!handles.length) throw new Error('JSON 中没有账号记录。');
      if(new Set(handles).size!==handles.length) throw new Error('JSON 中账号重复。');
      const performImport=()=>importQojUserscriptMembers({...data,members:mapped,fetch_failures:failures});
      const result=navigator.locks ? await navigator.locks.request('xcpc-qoj-sync',{ifAvailable:true},lock=>{
        if(!lock)throw new Error('QOJ 正在同步，请稍后导入。');
        return performImport();
      }) : await performImport();
      emitMemberMutated();
      message.value=`已导入 ${result.memberCount} 个账号${result.fetchFailureCount ? `，${result.fetchFailureCount} 个读取失败，原记录保留` : ''}。`;
      input.value='';
    } catch(e) {error.value=e instanceof Error ? e.message : '导入失败';}
    finally {busy.value=false;}
  }
  return {open,busy,script,input,error,message,targets,show,copy,importJson};
});
