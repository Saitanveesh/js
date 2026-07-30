import test from 'node:test';
import assert from 'node:assert/strict';
import { decrementStoredBytes, PREVIEW_QUOTA, PRODUCTION_QUOTA, quotaFor, uploadWithinQuota } from '../src/storage.js';

class UsageDb {
  constructor(stored = 0) { this.stored = stored; this.reserved = 0; }
  prepare(sql) {
    return { bind: (...args) => ({ run: async () => {
      if (sql.includes('reserved_bytes = reserved_bytes +')) { const [bytes,,again,limit]=args; if(this.stored+this.reserved+again>limit)return {meta:{changes:0}};this.reserved+=bytes;return {meta:{changes:1}}; }
      if (sql.includes('stored_bytes = stored_bytes +')) { const [bytes,add]=args;this.reserved=Math.max(0,this.reserved-bytes);this.stored+=add; }
      else if (sql.includes('stored_bytes = MAX')) this.stored=Math.max(0,this.stored-args[0]);
      else if (sql.includes('reserved_bytes = MAX')) this.reserved=Math.max(0,this.reserved-args[0]);
      return {meta:{changes:1}};
    } }) };
  }
}
const object = (key,size) => ({ key,size,body:new Uint8Array(size),options:{} });

test('production and preview quotas are 7 GiB and 1 GiB',()=>{assert.equal(quotaFor({}),PRODUCTION_QUOTA);assert.equal(quotaFor({ENVIRONMENT:'preview'}),PREVIEW_QUOTA)});
test('quota accepts upload that fits and counts bytes after R2 success',async()=>{const db=new UsageDb(90),puts=[];await uploadWithinQuota(db,{put:async key=>puts.push(key),delete:async()=>{}},[object('a',10)],100);assert.deepEqual(puts,['a']);assert.equal(db.stored,100);assert.equal(db.reserved,0)});
test('quota rejects before R2 when upload would exceed limit',async()=>{const db=new UsageDb(91);let puts=0;await assert.rejects(uploadWithinQuota(db,{put:async()=>puts++,delete:async()=>{}},[object('a',10)],100),error=>error.status===507);assert.equal(puts,0);assert.equal(db.stored,91)});
test('successful deletion decrements without allowing a negative counter',async()=>{const db=new UsageDb(5);await decrementStoredBytes(db,8);assert.equal(db.stored,0)});
test('failed R2 upload rolls back prior objects and all counters',async()=>{const db=new UsageDb(20),deleted=[];let calls=0;await assert.rejects(uploadWithinQuota(db,{put:async()=>{if(++calls===2)throw Error('R2 failure')},delete:async key=>deleted.push(key)},[object('a',5),object('b',7)],100));assert.deepEqual(deleted,['a']);assert.equal(db.stored,20);assert.equal(db.reserved,0)});
