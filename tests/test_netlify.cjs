'use strict';
const assert=require('node:assert/strict');
const {handler}=require('../netlify/functions/register.js');
const originalFetch=global.fetch;
const standard={
  requestId:'f6b279d8-6226-49f4-8d60-d01f5d94a601',
  firstName:'Example',email:'example@example.com',university:'University of Kelaniya',faculty:'Faculty of Science',
  whatsapp:'0712345678'
};
const send=d=>handler({httpMethod:'POST',body:JSON.stringify(d)});
const read=r=>JSON.parse(r.body);
(async()=>{
  process.env.GOOGLE_APPS_SCRIPT_URL='https://script.google.com/macros/s/AKfycbx123456789/exec';
  process.env.REGISTRATION_SECRET='test-secret-only';
  let upstreamPayload;
  global.fetch=async(url,options)=>{
    assert.equal(url,process.env.GOOGLE_APPS_SCRIPT_URL);
    upstreamPayload=JSON.parse(options.body);
    assert.equal(options.headers['Content-Type'],'text/plain;charset=utf-8');
    return new Response(JSON.stringify({success:true}),{status:200});
  };
  let result=await send(standard);
  assert.equal(result.statusCode,200);
  assert.equal(read(result).success,true);
  assert.equal(upstreamPayload.requestId,standard.requestId);
  assert.equal(upstreamPayload.email,standard.email);
  assert.equal(upstreamPayload.secret,process.env.REGISTRATION_SECRET);
  assert.equal(upstreamPayload.university,standard.university);
  assert.equal(upstreamPayload.faculty,standard.faculty);
  assert.equal(upstreamPayload.singing,undefined);
  assert.equal(upstreamPayload.rehearsal,undefined);
  result=await send({...standard,university:'Example University',faculty:'Engineering'});
  assert.equal(result.statusCode,200);
  assert.equal(upstreamPayload.university,'Example University');
  assert.equal(upstreamPayload.faculty,'Engineering');
  global.fetch=()=>assert.fail('Ineligible registration must not reach storage');
  for(const change of [
    {email:undefined},{email:null},{email:'not-an-email'},
    {university:undefined},{university:null},{university:123},{university:[]},{university:''},{university:'U'.repeat(121)},
    {faculty:undefined},{faculty:null},{faculty:23},{faculty:''},{faculty:'F'.repeat(121)},
    {requestId:123},{firstName:{name:'Example'}},{email:'not-an-email'},{whatsapp:[]},
    {firstName:'Name\nInjected'},{whatsapp:'not-a-phone'}
  ]){
    result=await send({...standard,...change});
    assert.equal(result.statusCode,400,JSON.stringify(change));
    assert.equal(read(result).success,false);
  }
  result=await send({...standard,requestId:'invalid'});
  assert.equal(result.statusCode,400);
  result=await send({...standard,website:'bot.example'});
  assert.equal(result.statusCode,400);
  assert.equal(read(result).success,false);
  global.fetch=async()=>new Response(JSON.stringify({success:false,code:'DUPLICATE'}),{status:200});
  result=await send(standard);
  assert.equal(result.statusCode,409);
  global.fetch=async()=>new Response(JSON.stringify({success:false,code:'DUPLICATE_PHONE'}),{status:200});
  result=await send(standard);
  assert.equal(result.statusCode,409);
  assert.equal(read(result).error,'You have already registered to the event with this phone number.');
  global.fetch=async()=>new Response('not json',{status:200});
  result=await send(standard);
  assert.equal(result.statusCode,502);
  global.fetch=async()=>{throw Error('connection failed');};
  result=await send(standard);
  assert.equal(result.statusCode,503);
  result=await handler({httpMethod:'GET'});
  assert.equal(result.statusCode,405);
  global.fetch=originalFetch;
  console.log('Passed: required registration details including email, free-text university/faculty, removed carols fields, invalid data, honeypot, duplicate response, malformed upstream, network error, method guard.');
})().catch(err=>{global.fetch=originalFetch;console.error(err);process.exit(1)});
