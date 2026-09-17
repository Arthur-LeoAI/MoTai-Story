const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs/promises'), os=require('node:os'), path=require('node:path');
const {createJsonStore}=require('../src/storage'); const {createTaskService}=require('../src/tasks');
test('single queue, idempotence, cancellation and restart recovery',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'motai-task-')); t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const store=createJsonStore(path.join(dir,'db.json')); await store.write({schemaVersion:5,works:[],tasks:[],usage:[]});
 let release, started; const running=new Promise(r=>started=r); const gate=new Promise(r=>release=r);
 const service=createTaskService(store,async()=>{started();await gate;return {text:'late'};});
 const a=await service.create({requestId:'one',workId:'w'}); await running;
 assert.equal((await service.create({requestId:'one',workId:'w'})).id,a.id);
 await assert.rejects(service.create({requestId:'one',workId:'other'}),{status:409});
 const b=await service.create({requestId:'two',workId:'w'}); assert.equal((await service.get(b.id)).status,'queued');
 await service.cancel(a.id); await service.cancel(b.id); release(); await new Promise(r=>setTimeout(r,30));
 assert.equal((await service.get(a.id)).status,'cancelled'); assert.equal((await service.get(a.id)).result,undefined);
 await store.transact(db=>db.tasks.push({id:'old',status:'generating'})); const restarted=createTaskService(store,async()=>{}); await restarted.init(); assert.equal((await restarted.get('old')).status,'interrupted');
});
