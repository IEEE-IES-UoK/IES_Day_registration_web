'use strict';
/* Server-side proxy: this secret is NEVER shipped to the browser. */
const json=(statusCode,body)=>({statusCode,headers:{
  'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'
},body:JSON.stringify(body)});
const fail=(code,error)=>json(code,{success:false,error});
const validPhone=x=>/^(?:07\d{8}|\+?947\d{8}|\+?\d{8,15})$/.test(x);
exports.handler=async event=>{
  if(event.httpMethod!=='POST')return fail(405,'Method not allowed.');
  if(!process.env.GOOGLE_APPS_SCRIPT_URL || !process.env.REGISTRATION_SECRET)
    return fail(503,'Registration is not configured yet. Please contact the organizers.');
  const url=process.env.GOOGLE_APPS_SCRIPT_URL;
  if(!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url))
    return fail(503,'Registration service is misconfigured.');
  if((event.body||'').length>8000)return fail(413,'Form data is too large.');
  let d;
  try{d=JSON.parse(event.body||'{}');}catch{return fail(400,'Invalid form data.');}
  if(!d || typeof d!=='object' || Array.isArray(d))return fail(400,'Invalid form data.');
  if(!['firstName','university','faculty','whatsapp','requestId'].every(key=>typeof d[key]==='string')||
      (d.website!==undefined&&typeof d.website!=='string'))
    return fail(400,'Please check your details and try again.');
  // Honeypot does not fabricate a success response, even for automated attempts.
  if(d.website)return fail(400,'Could not process the registration.');
  const firstName=d.firstName.trim();
  const university=d.university.trim();
  const faculty=d.faculty.trim();
  const whatsapp=d.whatsapp.replace(/[\s().-]+/g,'').trim();
  const requestId=d.requestId.trim();
  const validText=(value,max)=>value.length>=2&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
  if(!validText(firstName,80)||!validText(university,120)||!validText(faculty,120)||
      !validPhone(whatsapp)||!/^[a-zA-Z0-9-]{8,100}$/.test(requestId))
    return fail(400,'Please check your details and try again.');
  const aborter=new AbortController();
  const deadline=setTimeout(()=>aborter.abort(),16000);
  try{
    const upstream=await fetch(url,{
      method:'POST',redirect:'follow',
      headers:{'Content-Type':'text/plain;charset=utf-8'},
      body:JSON.stringify({secret:process.env.REGISTRATION_SECRET,requestId,firstName,university,faculty,whatsapp}),signal:aborter.signal
    });
    if(!upstream.ok)return fail(502,'We could not confirm the registration. Please try again.');
    let result;
    try{result=await upstream.json();}catch{return fail(502,'Unexpected response from registration storage. Please try again.');}
    if(result?.success===true)return json(200,{success:true});
    if(result?.code==='DUPLICATE')return fail(409,'This registration has already been submitted.');
    if(result?.code==='INVALID')return fail(400,'Please check your details and try again.');
    return fail(503,'Registration storage is temporarily unavailable. Please try again.');
  }catch(err){
    return fail(503,err?.name==='AbortError'?
      'The server took too long to respond. You can retry safely without creating a duplicate.':
      'Could not connect to registration storage. Please try again.');
  }finally{clearTimeout(deadline);}
};
