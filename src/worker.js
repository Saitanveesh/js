import { decrementStoredBytes, quotaFor, uploadWithinQuota } from './storage.js';

const MAX_FILES = 5;
const MAX_SIZE = 5 * 1024 * 1024;
const TYPES = new Map([['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp']]);
const COOKIE = 'swapshelf_admin';
const enc = new TextEncoder();
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });
export const clean = (value, max = 500) => String(value ?? '').trim().slice(0, max);
export const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(value, 254));

function matches(bytes, signature, offset = 0) { return signature.every((value, index) => bytes[offset + index] === value); }
export async function validImage(file) {
  if (!TYPES.has(file.type) || !file.size || file.size > MAX_SIZE) return false;
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (file.type === 'image/jpeg') return matches(bytes, [0xff, 0xd8, 0xff]);
  if (file.type === 'image/png') return matches(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return matches(bytes, [0x52, 0x49, 0x46, 0x46]) && matches(bytes, [0x57, 0x45, 0x42, 0x50], 8);
}
function b64(buffer) { return btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
async function sign(secret, value) { const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); return b64(await crypto.subtle.sign('HMAC', key, enc.encode(value))); }
async function admin(request, env) {
  if (!env.SESSION_SECRET) return false;
  const token = (request.headers.get('cookie') || '').split(';').map(x => x.trim()).find(x => x.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!token) return false;
  const [expires, nonce, signature] = token.split('.');
  if (!signature || Number(expires) < Date.now()) return false;
  return signature === await sign(env.SESSION_SECRET, `${expires}.${nonce}`);
}
function safeListing(row) { return { ...row, tags: JSON.parse(row.tags || '[]'), images: JSON.parse(row.images || '[]'), featured: Boolean(row.featured) }; }

async function list(request, env) {
  const where = await admin(request, env) ? '' : " WHERE status = 'PUBLISHED'";
  const result = await env.DB.prepare(`SELECT id,type,title,author_subject,isbn,description,condition,location,tags,images,status,featured,created_at,updated_at FROM listings${where} ORDER BY created_at DESC`).all();
  return json({ success: true, resources: result.results.map(safeListing) });
}

async function create(request, env) {
  const form = await request.formData();
  const required = ['type','title','author_subject','description','condition','location','owner_email'];
  const missing = required.filter(name => !clean(form.get(name)));
  if (missing.length) return json({ success: false, message: `Missing: ${missing.join(', ')}` }, 400);
  const type = clean(form.get('type'), 20).toUpperCase(), condition = clean(form.get('condition'), 40), email = clean(form.get('owner_email'), 254);
  if (!['BOOK','NOTES'].includes(type) || !['Excellent','Good','Fair'].includes(condition) || !validEmail(email)) return json({ success: false, message: 'Invalid listing details.' }, 400);
  const files = form.getAll('images').filter(value => value instanceof File && value.size);
  if (files.length > MAX_FILES) return json({ success: false, message: 'Upload at most five images.' }, 400);
  for (const file of files) if (!(await validImage(file))) return json({ success: false, message: 'Images must be valid JPG, PNG, or WebP files no larger than 5 MiB.' }, 400);
  const id = crypto.randomUUID();
  const candidates = files.map(file => { const key=`listings/${id}/${crypto.randomUUID()}.${TYPES.get(file.type)}`; return {key,size:file.size,url:`/media/${encodeURIComponent(key)}`,body:file.stream(),options:{httpMetadata:{contentType:file.type},customMetadata:{listingId:id}}}; });
  let uploaded = [];
  try {
    uploaded = await uploadWithinQuota(env.DB, env.UPLOADS, candidates, quotaFor(env));
    const now = new Date().toISOString();
    const tags = clean(form.get('tags'), 500).split(',').map(x => x.trim()).filter(Boolean).slice(0, 12);
    await env.DB.batch([
      env.DB.prepare('INSERT INTO listings (id,type,title,author_subject,isbn,description,condition,location,owner_email,tags,images,status,featured,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,type,clean(form.get('title'),160),clean(form.get('author_subject'),160),clean(form.get('isbn'),20),clean(form.get('description'),2000),condition,clean(form.get('location'),160),email,JSON.stringify(tags),JSON.stringify(uploaded.map(x=>x.url)),'PENDING',0,now,now),
      ...uploaded.map(object => env.DB.prepare('INSERT INTO listing_objects (object_key,listing_id,size_bytes,created_at) VALUES (?,?,?,?)').bind(object.key,id,object.size,now))
    ]);
    return json({ success: true, resource: { id, type, title: clean(form.get('title'),160), author_subject: clean(form.get('author_subject'),160), description: clean(form.get('description'),2000), condition, location: clean(form.get('location'),160), tags, images: uploaded.map(x=>x.url), status:'PENDING', featured:false, created_at:now, updated_at:now } }, 201);
  } catch (error) {
    await Promise.all(uploaded.map(object => env.UPLOADS.delete(object.key).then(() => decrementStoredBytes(env.DB, object.size))));
    return error.status === 507
      ? json({ success: false, message: error.message }, 507)
      : json({ success: false, message: 'Could not save the listing; uploaded objects were rolled back.' }, 500);
  }
}

async function remove(request, env, id) {
  if (!(await admin(request, env))) return json({ success:false, message:'Admin authentication required.' }, 401);
  const found = await env.DB.prepare('SELECT id FROM listings WHERE id = ?').bind(id).first();
  if (!found) return json({ success:false, message:'Listing not found.' }, 404);
  const objects = (await env.DB.prepare('SELECT object_key,size_bytes FROM listing_objects WHERE listing_id = ?').bind(id).all()).results;
  for (const object of objects) {
    await env.UPLOADS.delete(object.object_key);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM listing_objects WHERE object_key = ?').bind(object.object_key),
      env.DB.prepare('UPDATE storage_usage SET stored_bytes = MAX(0, stored_bytes - ?), updated_at = ? WHERE id = 1').bind(object.size_bytes,new Date().toISOString())
    ]);
  }
  await env.DB.prepare('DELETE FROM listings WHERE id = ?').bind(id).run();
  return json({ success:true });
}
async function patch(request, env, id) { if (!(await admin(request,env))) return json({success:false,message:'Admin authentication required.'},401); const body=await request.json().catch(()=>({})); if(!['PENDING','PUBLISHED'].includes(body.status)) return json({success:false,message:'Invalid status.'},400); const result=await env.DB.prepare('UPDATE listings SET status=?,updated_at=? WHERE id=?').bind(body.status,new Date().toISOString(),id).run(); return result.meta.changes?json({success:true}):json({success:false,message:'Listing not found.'},404); }
async function login(request,env) { if(!env.ADMIN_USERNAME||!env.ADMIN_PASSWORD||!env.SESSION_SECRET)return json({success:false,message:'Admin login is not configured.'},503);const body=await request.json().catch(()=>({}));if(clean(body.username,100).toLowerCase()!==env.ADMIN_USERNAME.toLowerCase()||clean(body.password,200)!==env.ADMIN_PASSWORD)return json({success:false,message:'Invalid credentials.'},401);const value=`${Date.now()+86400000}.${crypto.randomUUID()}`;return json({success:true},200,{'set-cookie':`${COOKIE}=${value}.${await sign(env.SESSION_SECRET,value)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=86400`}); }
async function media(env,key){const object=await env.UPLOADS.get(key);if(!object)return new Response('Not found',{status:404});const headers=new Headers();object.writeHttpMetadata(headers);headers.set('etag',object.httpEtag);headers.set('x-content-type-options','nosniff');return new Response(object.body,{headers});}
async function isbn(value){const code=clean(value,20).replace(/[^0-9Xx]/g,'');if(!code)return json({success:false,message:'ISBN required.'},400);try{const response=await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(code)}`,{signal:AbortSignal.timeout(8000)});if(!response.ok)throw Error();const data=await response.json(),book=data.items?.[0]?.volumeInfo;if(!book)return json({success:false,message:'No book found.'});return json({success:true,book:{title:book.title||'',authors:book.authors||[],description:book.description||''}})}catch{return json({success:false,message:'ISBN lookup failed.'},502)}}
async function email(request,env){const body=await request.json().catch(()=>({}));if(!clean(body.listing_id)||!clean(body.requester_name)||!validEmail(body.requester_email)||!clean(body.message))return json({success:false,message:'Enter all fields and a valid email.'},400);if(!env.SENDGRID_API_KEY||!env.SENDGRID_FROM_EMAIL)return json({success:false,message:'Email delivery is not configured.'},503);const listing=await env.DB.prepare("SELECT title,owner_email FROM listings WHERE id=? AND status='PUBLISHED'").bind(clean(body.listing_id,64)).first();if(!listing)return json({success:false,message:'Listing not found.'},404);const response=await fetch('https://api.sendgrid.com/v3/mail/send',{method:'POST',headers:{authorization:`Bearer ${env.SENDGRID_API_KEY}`,'content-type':'application/json'},body:JSON.stringify({personalizations:[{to:[{email:listing.owner_email}]}],from:{email:env.SENDGRID_FROM_EMAIL},reply_to:{email:clean(body.requester_email,254)},subject:`SwapShelf request for ${clean(listing.title,120)}`,content:[{type:'text/plain',value:`${clean(body.requester_name,100)} is interested in your resource.\n\n${clean(body.message,2000)}`}]}),signal:AbortSignal.timeout(8000)});return response.ok?json({success:true}):json({success:false,message:'Email delivery failed.'},502)}

async function route(request,env){const url=new URL(request.url), method=request.method;if(!['GET','HEAD'].includes(method)){const origin=request.headers.get('origin');if(origin&&origin!==url.origin)return json({success:false,message:'Cross-origin request rejected.'},403);}if(url.pathname==='/health')return json({ok:true,service:'swapshelf'});if(url.pathname==='/api/resources'&&method==='GET')return list(request,env);if(url.pathname==='/api/resources'&&method==='POST')return create(request,env);const match=url.pathname.match(/^\/api\/resources\/([0-9a-f-]+)$/i);if(match&&method==='PATCH')return patch(request,env,match[1]);if(match&&method==='DELETE')return remove(request,env,match[1]);if(url.pathname==='/api/admin/status')return json({isAdmin:await admin(request,env)});if(url.pathname==='/admin/login'&&method==='POST')return login(request,env);if(url.pathname==='/admin/logout'&&method==='POST')return json({success:true},200,{'set-cookie':`${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`});if(url.pathname.startsWith('/api/isbn/')&&method==='GET')return isbn(url.pathname.slice(10));if(url.pathname==='/api/send-request-email'&&method==='POST')return email(request,env);if(url.pathname.startsWith('/media/'))return media(env,decodeURIComponent(url.pathname.slice(7)));return env.ASSETS.fetch(request);}
export default {async fetch(request,env){try{const response=await route(request,env);const copy=new Response(response.body,response);for(const [k,v] of Object.entries({'content-security-policy':"default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'",'x-content-type-options':'nosniff','x-frame-options':'DENY'}))copy.headers.set(k,v);return copy;}catch{ return json({success:false,message:'Server error.'},500);}}};
