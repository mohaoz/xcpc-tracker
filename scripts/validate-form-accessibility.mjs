// Offline component checks. These do not replace browser keyboard/screen-reader QA.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import vm from 'node:vm';

const requireWeb=createRequire(resolve('web/package.json'));
const {parse,compileScript}=requireWeb('@vue/compiler-sfc');
const {baseParse}=requireWeb('@vue/compiler-dom');
const ts=requireWeb('typescript');
const vue=requireWeb('vue');
const {renderToString}=requireWeb('@vue/server-renderer');

function compileComponent(filename,mocks={},inlineTemplate=true) {
  const source=readFileSync(filename,'utf8');
  const {descriptor}=parse(source,{filename});
  const compiled=compileScript(descriptor,{id:filename,inlineTemplate});
  const code=ts.transpileModule(compiled.content,{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  }).outputText;
  const module={exports:{}};
  vm.runInNewContext(code,{
    exports:module.exports,module,
    require(id) {
      if(id==='vue')return vue;
      if(Object.hasOwn(mocks,id))return mocks[id];
      throw new Error(`Unexpected component dependency: ${id}`);
    },
  },{filename});
  return {component:module.exports.default,descriptor};
}

function elements(node,result=[]) {
  if(node.type===1)result.push(node);
  for(const child of node.children ?? [])elements(child,result);
  return result;
}
function attribute(node,name) {
  return node.props.find(prop=>prop.type===6 && prop.name===name)?.value?.content;
}

const {component:Editor}=compileComponent('web/src/components/ContestCatalogEditor.vue',{
  '../lib/catalog-sources':{aggregateAliasesFromSources:(_title,aliases)=>aliases},
});
const initialValue={
  title:'Accessible fixture',aliases:[],tags:[],notes:null,
  sources:[
    {provider:'qoj',kind:'contest',url:'https://qoj.ac/contest/1'},
    {provider:'codeforces',kind:'contest',url:'https://codeforces.com/gym/100000'},
    {provider:'manual',kind:'contest'},
  ],
  problems:[{ordinal:'A',title:'Example',aliases:[],sources:[]}],
};
const html=await renderToString(vue.createSSRApp({
  render:()=>vue.h('main',[vue.h(Editor,{initialValue}),vue.h(Editor,{initialValue})]),
}));
const nodes=elements(baseParse(html,{isVoidTag:tag=>tag==='input'}));
const labels=nodes.filter(node=>node.tag==='label' && attribute(node,'for'));
const controls=nodes.filter(node=>['input','select','textarea'].includes(node.tag));
const ids=nodes.map(node=>attribute(node,'id')).filter(Boolean);
assert.equal(new Set(ids).size,ids.length,'editor instances and repeated sources need unique IDs');
assert.ok(controls.length>30,'fixture must exercise repeated source controls and two editors');
for(const control of controls) {
  const id=attribute(control,'id');
  assert.ok(id,`${control.tag} must have an ID`);
  assert.equal(labels.filter(label=>attribute(label,'for')===id).length,1,`${id} needs exactly one associated label`);
}
assert.equal(nodes.filter(node=>attribute(node,'role')==='group' && /^Contest source \d+$/.test(attribute(node,'aria-label') ?? '')).length,6);

const qojSync=vue.reactive({modeLoaded:true,busy:false,useUserscript:false,sync:async()=>{}});
let cfImports=0,qojLinks=0,releaseImport;
const {component:AddMember,descriptor}=compileComponent('web/src/views/AddMemberView.vue',{
  'vue-router':{useRouter:()=>({replace:async()=>{}}),useRoute:()=>({query:{}})},
  '../lib/codeforces':{importCodeforcesMember:async()=>{cfImports++;await new Promise(resolve=>{releaseImport=resolve;});}},
  '../lib/member-events':{emitMemberMutated:()=>{}},
  '../lib/qoj':{linkQojMember:async()=>{qojLinks++;}},
  '../stores/qoj-sync':{useQojSyncStore:()=>qojSync},
},false);
const templateNodes=elements(baseParse(descriptor.template.content));
const form=templateNodes.find(node=>node.tag==='form');
assert.ok(form,'Add Member must render a native form');
assert.ok(form.props.some(prop=>prop.type===7 && prop.name==='on' && prop.arg?.content==='submit' && prop.exp?.content==='handleSubmit' && prop.modifiers.some(modifier=>modifier.content==='prevent')),'form must route native submit through the existing handler without navigating');
const submitButton=elements(form).find(node=>node.tag==='button' && attribute(node,'type')==='submit');
assert.ok(submitButton,'the action must be a native submit button');
assert.ok(!submitButton.props.some(prop=>prop.type===7 && prop.name==='on' && prop.arg?.content==='click'),'click and native submit must not both call the handler');

const state=AddMember.setup({}, {expose:()=>{}});
await state.handleSubmit();
assert.equal(cfImports,0,'empty fields must not import');
state.memberForm.value={memberId:'Test member',platform:'codeforces',handle:'test'};
const first=state.handleSubmit();
assert.equal(cfImports,1);
await state.handleSubmit();
assert.equal(cfImports,1,'repeat submit during an in-flight import must be ignored');
releaseImport();
await first;
assert.equal(state.submitting.value,false);
state.memberForm.value.platform='qoj';
qojSync.modeLoaded=false;
await state.handleSubmit();
assert.equal(qojLinks,0,'keyboard submit must respect loading state');
qojSync.modeLoaded=true;
qojSync.busy=true;
await state.handleSubmit();
assert.equal(qojLinks,0,'keyboard submit must respect synchronization state');
qojSync.busy=false;
await state.handleSubmit();
assert.equal(qojLinks,1,'ready QOJ form must submit');
console.log('PASS offline form checks: all rendered editor controls labelled, unique IDs across instances/sources, native submit wiring, empty/loading/busy/repeated submit guards.');
