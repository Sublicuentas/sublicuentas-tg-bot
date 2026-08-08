(function controlMaestroSublicuentas(){
  'use strict';

  const API='/api/importar';
  const INVENTORY_API='/api/inventario';
  const RENEW_API='/api/renovar';
  const BUILD='CONTROL-MAESTRO-MENOS-TEXTO-20260808-25';
  let accountSearchTimer=null,clientSearchTimer=null;
  const state={
    booted:false,installed:false,loading:false,busy:false,status:'',statusType:'',meta:null,
    templateBase64:'',analysis:null,filter:'revision',query:'',visible:[],autoTried:false,
    accountAudit:null,accountPlatform:'all',accountStatus:'all',accountQuery:'',accountVisible:[],accountLimit:1500,revealedAccounts:new Set(),expandedAccountKey:'',
    reviewSavingKey:'',accountFeedback:null,uiSize:loadUiSize(),refreshing:false,lastRefreshAt:'',fullscreenReturnY:0
  };

  function loadUiSize(){
    try{
      const saved=localStorage.getItem('sublichat_control_text_size_v1');
      return ['normal','large','xlarge'].includes(saved)?saved:'large';
    }catch(_){return 'large';}
  }

  function setUiSize(size){
    if(!['normal','large','xlarge'].includes(size))return;
    state.uiSize=size;
    try{localStorage.setItem('sublichat_control_text_size_v1',size);}catch(_){}
    render();
  }

  const esc=(v)=>String(v??'').replace(/[&<>"']/g,(m)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const norm=(v)=>String(v??'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9@.+\s_-]/g,' ').replace(/\s+/g,' ').trim();
  const phone=(v)=>String(v??'').replace(/\D/g,'').replace(/^504(?=\d{8}$)/,'').slice(-8);
  const email=(v)=>String(v??'').trim().toLowerCase().replace(/\s+/g,'');
  const excelEmail=(v)=>{const x=email(v);return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)?x:'';};
  const fileDate=()=>{
    const d=new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}_${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}`;
  };
  const serverDateKey=()=>{
    try{
      const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Tegucigalpa',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
      const get=(type)=>parts.find(x=>x.type===type)?.value||'';
      return `${get('year')}-${get('month')}-${get('day')}`;
    }catch(_){return new Date().toISOString().slice(0,10);}
  };
  const root=()=>document.getElementById('rbac-control-cuentas');
  const screenActive=()=>!!document.getElementById('screen-control-cuentas')?.classList.contains('active');

  function refreshTimeLabel(){
    if(!state.lastRefreshAt)return 'Lee los cambios nuevos de Firebase y Telegram';
    const d=new Date(state.lastRefreshAt);if(isNaN(d))return 'Datos actualizados';
    try{return `Actualizado ${d.toLocaleTimeString('es-HN',{timeZone:'America/Tegucigalpa',hour:'2-digit',minute:'2-digit',second:'2-digit'})}`;}
    catch(_){return `Actualizado ${d.toLocaleTimeString('es-HN')}`;}
  }

  function captureControlView(){
    const screen=document.getElementById('screen-control-cuentas');
    const host=root();
    const fullscreen=!!screen&&(document.fullscreenElement===screen||screen.classList.contains('cm-control-expanded'));
    const active=document.activeElement;
    const roster=host?.querySelector('.cm-ledger-account.is-open .cm-roster');
    return {
      accountPlatform:state.accountPlatform,accountStatus:state.accountStatus,accountQuery:state.accountQuery,
      accountLimit:state.accountLimit,expandedAccountKey:state.expandedAccountKey,
      screenTop:screen?.scrollTop||0,windowX:window.scrollX||0,windowY:window.scrollY||0,
      ledgerLeft:host?.querySelector('.cm-ledger-scroll')?.scrollLeft||0,rosterTop:roster?.scrollTop||0,
      historicalOpen:!!host?.querySelector('.cm-details[open]'),fullscreen,
      focusId:active&&host?.contains(active)?active.id||'':'',selectionStart:active?.selectionStart,selectionEnd:active?.selectionEnd
    };
  }

  function restoreControlView(view){
    if(!view)return;
    state.accountPlatform=view.accountPlatform||'all';state.accountStatus=view.accountStatus||'all';
    state.accountQuery=String(view.accountQuery||'');state.accountLimit=Number(view.accountLimit)||1500;
    state.expandedAccountKey=String(view.expandedAccountKey||'');
    const apply=()=>{
      const screen=document.getElementById('screen-control-cuentas');const host=root();if(!host)return;
      const details=host.querySelector('.cm-details');if(details&&view.historicalOpen)details.open=true;
      const ledger=host.querySelector('.cm-ledger-scroll');if(ledger)ledger.scrollLeft=view.ledgerLeft||0;
      const roster=host.querySelector('.cm-ledger-account.is-open .cm-roster');if(roster)roster.scrollTop=view.rosterTop||0;
      if(view.fullscreen&&screen)screen.scrollTop=view.screenTop||0;else window.scrollTo(view.windowX||0,view.windowY||0);
      if(view.focusId){
        const field=document.getElementById(view.focusId);if(field){field.focus({preventScroll:true});
          if(typeof field.setSelectionRange==='function'&&Number.isInteger(view.selectionStart))field.setSelectionRange(view.selectionStart,Number.isInteger(view.selectionEnd)?view.selectionEnd:view.selectionStart);
        }
      }
    };
    requestAnimationFrame(()=>requestAnimationFrame(apply));
    setTimeout(apply,120);
  }
  const activeUser=()=>{
    for(const k of ['sublichat_user','subli_usuario','usuario','subli_user','active_user']){
      const v=localStorage.getItem(k);if(v&&String(v).trim())return norm(v);
    }
    return '';
  };
  const isAdmin=()=>['sublicuentas','naara'].includes(activeUser());

  function source(){
    try{
      const x=typeof window.sublichatControlData==='function'?window.sublichatControlData():{};
      return {servicios:Array.isArray(x.servicios)?x.servicios:[],cuentas:Array.isArray(x.cuentas)?x.cuentas:[]};
    }catch(_){return {servicios:[],cuentas:[]};}
  }

  async function api(payload,endpoint=API){
    const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload||{})});
    const j=await r.json().catch(()=>({ok:false,error:'Respuesta inválida del servidor.'}));
    if(!r.ok||!j.ok)throw new Error(j.error||`Error ${r.status}`);
    return j;
  }

  function setStatus(text,type){state.status=String(text||'');state.statusType=type||'';render();}

  function base64ToBuffer(raw){
    const binary=atob(String(raw||''));
    const bytes=new Uint8Array(binary.length);
    for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
    return bytes.buffer;
  }

  function bufferToBase64(buffer){
    const bytes=new Uint8Array(buffer);
    const step=0x8000;
    let out='';
    for(let i=0;i<bytes.length;i+=step)out+=String.fromCharCode.apply(null,bytes.subarray(i,i+step));
    return btoa(out);
  }

  function saveBuffer(buffer,filename){
    const blob=new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1500);
  }

  function valueText(v){
    if(v==null)return '';
    if(v instanceof Date)return v;
    if(typeof v==='object'){
      if(v.result!=null)return valueText(v.result);
      if(v.text!=null)return String(v.text);
      if(Array.isArray(v.richText))return v.richText.map(x=>x.text||'').join('');
      if(v.formula!=null&&v.result!=null)return valueText(v.result);
      return '';
    }
    return String(v).trim();
  }

  function fieldText(v){
    if(v==null)return '';
    if(Array.isArray(v))return v.map(fieldText).filter(Boolean).join(' · ');
    if(typeof v==='object'){
      for(const key of ['perfil','slot','nombre','name','label','value','numero','número','index','id']){
        if(v[key]!=null&&typeof v[key]!=='object'){const out=String(v[key]).trim();if(out)return out;}
      }
      const out=valueText(v);return out==='[object Object]'?'':out;
    }
    return String(v).trim();
  }

  function dateValue(v){
    if(v==null||v==='')return null;
    if(v instanceof Date&&!isNaN(v))return v;
    if(typeof v==='object'&&v.result!=null)return dateValue(v.result);
    if(typeof v==='number'&&v>20000&&v<90000){const d=new Date(Date.UTC(1899,11,30)+Math.round(v*86400000));return isNaN(d)?null:d;}
    const s=String(v).trim();
    let m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);if(m)return new Date(+m[1],+m[2]-1,+m[3]);
    m=s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);if(m)return new Date(+m[3],+m[2]-1,+m[1]);
    const d=new Date(s);return isNaN(d)?null:d;
  }

  function dateKey(v){
    const d=dateValue(v);if(!d)return '';
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  function dateLabel(v){
    const d=dateValue(v);if(!d)return '—';
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
  }

  function canonPlatform(v){
    const k=norm(v).replace(/[^a-z0-9]/g,'');
    const aliases={
      netflix:'netflix',netflixpremium:'netflix',netflixbelice:'netflix',extra:'netflix',extras:'netflix',
      vip:'vipnetflix',vipnetflix:'vipnetflix',netflixvip:'vipnetflix',
      disneyp:'disneyp',disneypremium:'disneyp',disneys:'disneys',disneystandard:'disneys',disney:'disney',
      hbomax:'hbomax',hbo:'hbomax',max:'hbomax',prime:'primevideo',primevideo:'primevideo',
      paramount:'paramount',paramountp:'paramount',crunchy:'crunchyroll',crunchyroll:'crunchyroll',
      vix:'vix',viki:'viki',vikirakuten:'viki',universal:'universal',universalp:'universal',
      spotify:'spotify',youtube:'youtube',youtubepremium:'youtube',canva:'canva',gemini:'gemini',
      duolingo:'duolingo',chatgpt:'chatgpt',chatgptplus:'chatgpt',
      magis:'magis',magistv:'magis',oleada:'oleada',oleadatv:'oleada',iptv:'iptv'
    };
    if(aliases[k])return aliases[k];
    if(k.startsWith('oleada'))return 'oleada';
    if(k.startsWith('iptv'))return 'iptv';
    return k;
  }

  function platformsForSheet(name){
    const n=norm(name);
    // ⚠️ FIX: antes solo reconocía "netflix vip" en ese orden exacto, así que
    // una hoja llamada "VIP Netflix" (VIP primero, como la tuya) no calzaba y
    // esas cuentas terminaban cayendo en la Netflix normal o sin plataforma.
    // Ahora detecta "vip" junto a "netflix" sin importar el orden, y las hojas
    // "Extras..." (confirmado con el usuario: Extras 2026 Perú, Extras 2026
    // Bolo y Trap, Netflix vip) son siempre VIP Netflix, no ambiguas.
    const esVip=/\bvip\b/.test(n);
    if(n.includes('netflix')&&esVip)return ['vipnetflix'];
    if(esVip)return ['vipnetflix'];
    if(n.includes('extra'))return ['vipnetflix'];
    if(n.includes('netflix'))return ['netflix'];
    if(n.includes('disney'))return ['disneyp','disneys','disney'];
    if(n.includes('hbo')||n==='max')return ['hbomax'];
    if(n.includes('prime'))return ['primevideo'];
    if(n.includes('paramount'))return ['paramount'];
    if(n.includes('crunch'))return ['crunchyroll'];
    if(n.includes('vix')||n.includes('viki')||n.includes('universal'))return ['vix','viki','universal'];
    if(n.includes('spotify'))return ['spotify'];
    if(n.includes('youtube'))return ['youtube'];
    if(n.includes('canva'))return ['canva'];
    if(n.includes('magis'))return ['magis','oleada','iptv'];
    return [];
  }

  function headerKey(v){return norm(valueText(v)).replace(/[^a-z0-9]/g,'').toUpperCase();}
  function firstCol(map,names){for(const n of names){const a=map[n];if(a&&a.length)return a[0];}return 0;}

  function findHeader(ws){
    let best=null;
    const max=Math.min(Math.max(ws.rowCount||20,20),30);
    for(let r=1;r<=max;r++){
      const map={};
      ws.getRow(r).eachCell({includeEmpty:false},(cell,col)=>{const k=headerKey(cell.value);if(k)(map[k]||(map[k]=[])).push(col);});
      const score=(map.NOMBRE?3:0)+(map.CELULAR||map.TELEFONO?3:0)+(map.CORREO?2:0)+(map.PERFIL||map.PERFILES?1:0)+(map.EXPIRACION||map.RENOVACION?1:0);
      if(!best||score>best.score)best={row:r,map,score};
    }
    if(!best||best.score<4)return null;
    const m=best.map;
    return {
      row:best.row,map:m,
      name:firstCol(m,['NOMBRE']),seller:firstCol(m,['VENDEDOR']),phone:firstCol(m,['CELULAR','TELEFONO']),
      profile:firstCol(m,['PERFIL','PERFILES']),pin:firstCol(m,['PIN']),email:firstCol(m,['CORREO']),password:firstCol(m,['CLAVE']),
      price:firstCol(m,['PRECIO']),expiry:firstCol(m,['RENOVACION','EXPIRACION']),
      alert:firstCol(m,['ALERTA']),days:firstCol(m,['DIAS'])
    };
  }

  function buildInventoryMap(src){
    const byKey=new Map();
    const duplicates=new Set();
    (src.cuentas||[]).forEach((account)=>{
      const plat=canonPlatform(account.plataforma),acc=email(account.correo);
      (account.clientes||[]).forEach((p)=>{
        const key=`${plat}|${norm(p.nombre)}`;
        const item={account:acc,slot:p.slot??'',pin:p.pin||'',accountId:account.id||''};
        if(byKey.has(key))duplicates.add(key);else byKey.set(key,item);
      });
    });
    return {byKey,duplicates};
  }

  const AUDIT_PLATFORM_LABELS={
    netflix:'Netflix',vipnetflix:'VIP Netflix',disney:'Disney+',hbomax:'HBO Max',primevideo:'Prime Video',
    paramount:'Paramount+',crunchyroll:'Crunchyroll',vix:'ViX',viki:'Viki Rakuten',universal:'Universal+',
    spotify:'Spotify',youtube:'YouTube',canva:'Canva',gemini:'Gemini',duolingo:'Duolingo',chatgpt:'ChatGPT',
    magis:'Magis TV',oleada:'Oleada TV',iptv:'IPTV',
    vixmix:'ViX / Viki / Universal+'
  };

  function auditFamily(v){
    const p=canonPlatform(v);
    if(['disneyp','disneys','disney'].includes(p))return 'disney';
    return p||'sin_plataforma';
  }

  function auditPlatformLabel(v){
    const p=auditFamily(v);
    return AUDIT_PLATFORM_LABELS[p]||String(v||p||'Sin plataforma').replace(/(^|\s)\S/g,x=>x.toUpperCase());
  }

  function daysSince(v){
    const d=new Date(v||'');if(isNaN(d))return 99999;
    const today=new Date();today.setHours(0,0,0,0);d.setHours(0,0,0,0);
    return Math.max(0,Math.floor((today-d)/86400000));
  }

  function isExpired(v){
    const d=dateValue(v);if(!d)return false;
    const today=new Date();today.setHours(0,0,0,0);d.setHours(0,0,0,0);
    return d<today;
  }

  function excelAuditFamily(sheet,row,item,src){
    if(item?.service)return auditFamily(item.service._plat||item.service.plataforma||item.service.plataformaLabel);
    const allowed=[...new Set((sheet.platforms||[]).map(auditFamily))];
    const mail=excelEmail(row.accountEmail);
    if(mail){
      const found=new Set();
      (src.servicios||[]).forEach((s)=>{if(email(s.correo)===mail&&allowed.includes(auditFamily(s.plataforma||s.plataformaLabel)))found.add(auditFamily(s.plataforma||s.plataformaLabel));});
      (src.cuentas||[]).forEach((a)=>{if(email(a.correo)===mail&&allowed.includes(auditFamily(a.plataforma)))found.add(auditFamily(a.plataforma));});
      if(found.size===1)return [...found][0];
    }
    const name=norm(sheet.ws?.name||row.sheet);
    // ⚠️ FIX: mismo problema de orden que en platformsForSheet — "vip" se
    // busca junto a "netflix" sin importar cuál va primero.
    if(name.includes('extra')||(name.includes('netflix')&&/\bvip\b/.test(name))||/\bvip\b/.test(name))return 'vipnetflix';
    if(name.includes('netflix belice'))return 'netflix';
    if(name.includes('netflix'))return 'netflix';
    if(name.includes('vix')&&name.includes('viki'))return 'vixmix';
    return allowed[0]||'sin_plataforma';
  }

  function buildAccountAudit(src,analysis){
    const groups=new Map();
    const hasExcelAudit=!!analysis?.sheets?.length;
    const allServices=(src.servicios||[]).map((s,i)=>({
      ...s,_auditIndex:i,_family:auditFamily(s.plataforma||s.plataformaLabel),_email:email(s.correo),
      _name:norm(s.nombre),_titular:String(s.titular||s.nombre||''),_phone:phone(s.telefono),_date:dateKey(s.fecha)
    }));
    const assignmentCounts=new Map();
    (src.cuentas||[]).forEach((account)=>{
      const family=auditFamily(account.plataforma);
      (account.clientes||[]).forEach((p)=>{
        const name=norm(p.nombre);if(!name)return;
        const key=`${family}|${name}`;assignmentCounts.set(key,(assignmentCounts.get(key)||0)+1);
      });
    });

    const ensureGroup=(family,mail,key)=>{
      if(!groups.has(key))groups.set(key,{
        key,family,email:mail,platform:auditPlatformLabel(family),rawPlatforms:new Set(),inventoryAccounts:[],accountIds:[],
        clave:'',capacidad:0,disponibles:0,estado:'',invClients:[],services:[],excelRows:[],excelSheets:new Set()
      });
      return groups.get(key);
    };

    (src.cuentas||[]).forEach((account,i)=>{
      const family=auditFamily(account.plataforma),mail=email(account.correo);
      const key=mail?`${family}|${mail}`:`${family}|__sin_correo_inventario_${account.id||i}`;
      const g=ensureGroup(family,mail,key);
      g.rawPlatforms.add(canonPlatform(account.plataforma));g.inventoryAccounts.push(account);g.accountIds.push(account.id||'');
      if(!g.clave&&account.clave!=null)g.clave=String(account.clave);
      g.capacidad+=Math.max(0,Number(account.capacidad)||0);g.disponibles+=Math.max(0,Number(account.disponibles)||0);
      if(!g.estado&&account.estado)g.estado=String(account.estado);
      (account.clientes||[]).forEach((p,clientIndex)=>g.invClients.push({...p,_accountId:account.id||'',_clientIndex:clientIndex,_family:family,_email:mail}));
    });

    allServices.forEach((s)=>{
      const key=s._email?`${s._family}|${s._email}`:`${s._family}|__sin_cuenta_clientes`;
      const g=ensureGroup(s._family,s._email,key);g.rawPlatforms.add(canonPlatform(s.plataforma||s.plataformaLabel));g.services.push(s);
      if(!g.clave&&s.clave!=null)g.clave=String(s.clave);
    });

    // ⚠️ FIX: hojas de Excel tipo "solo lista de nombres" (NETFLIX VIP,
    // EXTRAS...) no tienen columna de correo por fila, así que antes cada
    // nombre quedaba en su propio grupo aislado sin cuenta en vivo y se
    // descartaba entero (ver filtro más abajo). Ahora, si el nombre coincide
    // sin ambigüedad con un cliente ya asignado en Bodega/Clientes de la misma
    // plataforma, la fila del Excel se ata a esa cuenta real en vez de perderse.
    const nameToAccountKey=new Map();
    groups.forEach((g,key)=>{
      if(!g.inventoryAccounts.length&&!g.services.length)return;
      const names=new Set([...g.invClients.map((p)=>norm(p.nombre)),...g.services.map((s)=>s._name)]);
      names.forEach((name)=>{
        if(!name)return;
        const k=`${g.family}|${name}`;
        nameToAccountKey.set(k,nameToAccountKey.has(k)?null:key);
      });
    });

    const itemByRow=new Map((analysis?.items||[]).filter((x)=>x.row).map((x)=>[x.row,x]));
    const allExcelRows=[];
    (analysis?.sheets||[]).forEach((sheet)=>{
      (sheet.rows||[]).filter((r)=>r.name||r.tel).forEach((row)=>{
        const item=itemByRow.get(row)||null;
        const family=excelAuditFamily(sheet,row,item,src);
        const mail=excelEmail(row.accountEmail);
        const entry={
          key:`${row.sheet}|${row.row}`,sheet:row.sheet,row:row.row,family,email:mail,
          name:String(row.name||'').trim(),phone:phone(row.tel),profile:String(row.profile||'').trim(),pin:String(row.pin||'').trim(),
          date:dateKey(row.expiry),password:String(row.accountPassword||'').trim(),item
        };
        allExcelRows.push(entry);
        const orphanKey=`${family}|__excel_${norm(row.sheet)}_${row.row}`;
        const key=mail?`${family}|${mail}`:(nameToAccountKey.get(`${family}|${norm(entry.name)}`)||orphanKey);
        const g=ensureGroup(family,mail,key);g.rawPlatforms.add(family);g.excelRows.push(entry);g.excelSheets.add(row.sheet);
        if(key===orphanKey)g.orphanExcelOnly=true;
        if(!g.clave&&entry.password)g.clave=entry.password;
      });
    });

    const revisions=new Map((state.meta?.revisiones||[]).map((r)=>[String(r.accountKey||`${auditFamily(r.plataforma)}|${email(r.correo)}`),r]));
    const accounts=[];
    groups.forEach((g)=>{
      // ⚠️ FIX: antes esto ocultaba CUALQUIER cuenta que estuviera solo en el
      // Excel y no también en Clientes/Bodega — con o sin correo propio, daba
      // igual. Esa es justo la gente que hay que revisar para darla de alta,
      // así que ya no se descarta: toda fila del Excel sin coincidencia en
      // vivo se muestra como "Solo Excel" en vez de desaparecer sin rastro.
      if(!g.inventoryAccounts.length&&!g.services.length&&!g.excelRows.length)return;
      const used=new Set(),usedExcel=new Set(),roster=[];
      const takeExcel=(target)=>{
        const targetName=norm(target?.name),targetPhone=phone(target?.phone),targetProfile=norm(fieldText(target?.profile));
        let best=-1,bestScore=0;
        g.excelRows.forEach((x,i)=>{
          if(usedExcel.has(i))return;
          let score=0;
          if(targetName&&norm(x.name)===targetName)score+=120;
          if(targetPhone&&x.phone===targetPhone)score+=105;
          if(targetProfile&&norm(x.profile)===targetProfile)score+=32;
          if(score>bestScore){best=i;bestScore=score;}
        });
        if(best<0)return null;usedExcel.add(best);return g.excelRows[best];
      };
      g.invClients.forEach((p,invIndex)=>{
        const name=norm(p.nombre),duplicate=(assignmentCounts.get(`${g.family}|${name}`)||0)>1;
        const matchIndex=g.services.findIndex((s,i)=>!used.has(i)&&name&&s._name===name);
        let service=null,status='solo_bodega',level='bad',detail=hasExcelAudit?'Está asignado en Bodega, pero no tiene servicio activo en Clientes ni fila coincidente en Excel.':'Está asignado en Bodega, pero no tiene servicio activo en Clientes.';
        if(matchIndex>=0){
          used.add(matchIndex);service=g.services[matchIndex];status='ok';level='ok';detail='Coincide entre Clientes y Bodega.';
          if(duplicate){status='duplicado';level='bad';detail='El cliente aparece asignado en más de una cuenta de esta plataforma.';}
          else if(isExpired(service.fecha)){status='vencido';level='warn';detail='El cliente coincide, pero su fecha está vencida.';}
        }else{
          const other=allServices.find((s)=>s._family===g.family&&name&&s._name===name);
          if(duplicate){status='duplicado';detail='La asignación está repetida en Bodega.';}
          else if(other){status='otra_cuenta';detail=`El servicio activo está registrado en ${other._email||'otra cuenta'}.`;service=other;}
        }
        const excel=takeExcel({name:p.nombre||service?.nombre,phone:service?._phone,profile:service?.perfil||p.slot});
        if(status==='ok'&&excel)detail='Coincide entre Clientes, Bodega y el respaldo Excel.';
        else if(status==='ok'&&hasExcelAudit&&!excel)detail='Coincide entre Clientes y Bodega. El Excel es un respaldo histórico y no modifica ni duplica la base actual.';
        else if(!service&&excel){status='excel_bodega';level='warn';detail='Aparece en Excel y Bodega, pero no tiene servicio activo en Clientes.';}
        // ⚠️ FIX: si Bodega tenía guardado un teléfono en el propio registro del
        // cliente (p.telefono), antes se ignoraba por completo — el teléfono solo
        // se tomaba de Clientes o del Excel. Si no había servicio coincidente en
        // Clientes, el teléfono desaparecía aunque siguiera guardado en Bodega.
        roster.push({inv:p,service,excel,status,level,detail,name:p.nombre||service?.nombre||excel?.name||'Sin nombre',phone:service?._phone||excel?.phone||fieldText(p.telefono)||'',profile:fieldText(service?.perfil)||fieldText(p.slot)||fieldText(excel?.profile),pin:fieldText(service?.pinPerfil)||fieldText(p.pin)||fieldText(excel?.pin),date:service?._date||excel?.date||'',actualAccount:service?._email||'',invIndex:Number.isInteger(Number(p._clientIndex))?Number(p._clientIndex):invIndex});
      });
      g.services.forEach((service,i)=>{
        if(used.has(i))return;
        const excel=takeExcel({name:service.nombre,phone:service._phone,profile:service.perfil});
        const expired=isExpired(service.fecha);
        let status=expired?'vencido_sin_bodega':'falta_bodega';
        let detail=expired?'Servicio vencido y no asignado en Bodega.':(excel?'Coincide entre Clientes y Excel, pero falta en Bodega.':(hasExcelAudit?'Cliente activo, pero falta tanto en Bodega como en el Excel cargado.':'Cliente activo en esta cuenta, pero falta en Bodega.'));
        if(hasExcelAudit&&!excel&&!expired)status='falta_excel_bodega';
        roster.push({inv:null,service,excel,status,level:expired?'bad':'warn',detail,name:service.nombre||excel?.name||'Sin nombre',phone:service._phone||excel?.phone||'',profile:fieldText(service.perfil)||fieldText(excel?.profile),pin:fieldText(service.pinPerfil)||fieldText(excel?.pin),date:service._date||excel?.date||'',actualAccount:service._email||''});
      });
      g.excelRows.forEach((excel,i)=>{
        if(usedExcel.has(i))return;
        const expired=isExpired(excel.date);
        roster.push({inv:null,service:null,excel,status:expired?'solo_excel_vencido':'solo_excel',level:expired?'bad':'warn',detail:expired?'Permanece en el Excel con fecha vencida, pero ya no está en Clientes ni Bodega.':'Está en el Excel, pero no aparece en Clientes ni en Bodega.',name:excel.name||`Sin nombre · fila ${excel.row}`,phone:excel.phone||'',profile:excel.profile||'',pin:excel.pin||'',date:excel.date||'',actualAccount:''});
      });

      const missingInventory=!g.inventoryAccounts.length;
      const inventoryPlatformCounts={};
      g.inventoryAccounts.forEach((a)=>{const p=canonPlatform(a.plataforma);inventoryPlatformCounts[p]=(inventoryPlatformCounts[p]||0)+1;});
      const duplicateDocs=Object.values(inventoryPlatformCounts).some((n)=>n>1);
      const overCapacity=!!g.capacidad&&Math.max(g.invClients.length,g.services.length)>g.capacidad;
      const rosterIssues=roster.filter((r)=>r.status!=='ok').length;
      const revisionKey=g.email?`${g.family}|${g.email}`:'';
      const revision=revisionKey?revisions.get(revisionKey)||null:null;
      const missingPassword=!String(g.clave||'').trim();
      const recordedIncident=revision?.resultado==='incidencia';
      const internalIssueCount=rosterIssues+Number(missingInventory)+Number(duplicateDocs)+Number(overCapacity)+Number(!g.email)+Number(missingPassword);
      const issueCount=internalIssueCount+Number(recordedIncident);
      const reviewAge=revision?daysSince(revision.revisadoAt):99999;
      // Una diferencia administrativa corregida no invalida la revisión real del
      // proveedor. Sí se solicita otra revisión si cambian los clientes o aparecen
      // más diferencias que las guardadas anteriormente.
      const reviewDataChanged=!!revision&&(Number(revision.clientesEsperados)!==roster.length||internalIssueCount>Number(revision.diferencias||0));
      const reviewDue=!revision||reviewAge>=15||reviewDataChanged;
      const occupied=g.inventoryAccounts.length?g.invClients.length:(g.services.length||g.excelRows.length);
      const maxExcelProfile=Math.max(0,...g.excelRows.map((x)=>Number(x.profile)||0));
      const capacity=g.capacidad||Math.max(occupied,maxExcelProfile);
      accounts.push({
        ...g,rawPlatforms:[...g.rawPlatforms],excelSheets:[...g.excelSheets],roster,missingInventory,duplicateDocs,overCapacity,rosterIssues,issueCount,
        missingPassword,recordedIncident,internalIssueCount,revisionKey,revision,reviewAge,reviewDataChanged,reviewDue,occupied,capacity,free:Math.max(0,capacity-occupied),clean:issueCount===0
      });
    });

    accounts.sort((a,b)=>a.platform.localeCompare(b.platform)||Number(b.issueCount>0)-Number(a.issueCount>0)||String(a.email).localeCompare(String(b.email)));
    const clients=new Set(allServices.map(s=>s.clienteId||`${s._name}|${s._phone}`));
    const platforms={},platformRows={};accounts.forEach(a=>{platforms[a.family]=(platforms[a.family]||0)+1;platformRows[a.family]=(platformRows[a.family]||0)+a.roster.length;});
    return {
      accounts,platforms,platformRows,
      metrics:{clientes:clients.size,servicios:allServices.length,filasExcel:allExcelRows.length,registros:accounts.reduce((n,a)=>n+a.roster.length,0),cuentas:accounts.length,limpias:accounts.filter(a=>a.clean).length,conProblemas:accounts.filter(a=>a.issueCount>0).length,pendientes15:accounts.filter(a=>a.reviewDue).length}
    };
  }

  function parseWorkbook(workbook,src){
    const sheets=[];
    const excelRows=[];
    workbook.worksheets.forEach((ws)=>{
      if(['revision','__sublichat_ids'].includes(norm(ws.name).replace(/[^a-z0-9_]/g,'')))return;
      const platforms=platformsForSheet(ws.name);if(!platforms.length)return;
      const h=findHeader(ws);if(!h)return;
      const rows=[];
      let currentAccount='',currentPassword='';
      const end=Math.min(Math.max(ws.rowCount||h.row+1,h.row+1),2200);
      for(let r=h.row+1;r<=end;r++){
        const row=ws.getRow(r);
        const directEmail=h.email?excelEmail(valueText(row.getCell(h.email).value)):'';
        const directPassword=h.password?String(valueText(row.getCell(h.password).value)||'').trim():'';
        if(directEmail){currentAccount=directEmail;currentPassword=directPassword;}
        const name=h.name?String(valueText(row.getCell(h.name).value)||'').trim():'';
        const tel=h.phone?phone(valueText(row.getCell(h.phone).value)):'';
        const profile=h.profile?String(valueText(row.getCell(h.profile).value)||'').trim():'';
        const record={
          ws,sheet:ws.name,row:r,header:h,platforms,accountEmail:directEmail||currentAccount,directEmail,
          accountPassword:directPassword||currentPassword,
          name,tel,profile,pin:h.pin?String(valueText(row.getCell(h.pin).value)||'').trim():'',
          price:h.price?Number(valueText(row.getCell(h.price).value)||0)||0:0,
          expiry:h.expiry?dateKey(row.getCell(h.expiry).value):'',
          blank:!name&&!tel
        };
        rows.push(record);
        if(name||tel)excelRows.push(record);
      }
      sheets.push({ws,header:h,platforms,rows});
    });

    const inv=buildInventoryMap(src);
    const live=(src.servicios||[]).map((s,i)=>{
      const plat=canonPlatform(s.plataforma||s.plataformaLabel);
      const invKey=`${plat}|${norm(s.nombre)}`;
      const invItem=inv.byKey.get(invKey)||null;
      return {...s,_index:i,_used:false,_plat:plat,_name:norm(s.nombre),_phone:phone(s.telefono),_email:email(s.correo),_date:dateKey(s.fecha),_inv:invItem,_invDuplicate:inv.duplicates.has(invKey)};
    });
    const livePhoneCount=new Map();
    live.forEach(s=>{if(s._phone){const k=`${s._plat}|${s._phone}`;livePhoneCount.set(k,(livePhoneCount.get(k)||0)+1);}});

    const exactRows=new Set(excelRows.filter(row=>live.some(s=>row.platforms.includes(s._plat)&&row.accountEmail&&s._email===row.accountEmail&&((row.name&&norm(row.name)===s._name)||(row.tel&&row.tel===s._phone)))));
    const orderedExcelRows=[...excelRows].sort((a,b)=>Number(exactRows.has(b))-Number(exactRows.has(a)));
    const items=[];
    const matched=[];
    for(const row of orderedExcelRows){
      let best=null,bestScore=-1;
      for(const s of live){
        if(s._used||!row.platforms.includes(s._plat))continue;
        const nameMatch=!!row.name&&!!s._name&&norm(row.name)===s._name;
        const phoneMatch=!!row.tel&&!!s._phone&&row.tel===s._phone;
        if(!nameMatch&&!phoneMatch)continue;
        if(phoneMatch&&!nameMatch&&(livePhoneCount.get(`${s._plat}|${s._phone}`)||0)>1&&row.accountEmail!==s._email)continue;
        let score=100+(nameMatch?45:0)+(phoneMatch?38:0);
        if(row.accountEmail&&s._email&&row.accountEmail===s._email)score+=55;
        if(row.profile&&s.perfil&&norm(row.profile)===norm(s.perfil))score+=8;
        if(score>bestScore){best=s;bestScore=score;}
      }
      if(!best){
        items.push({kind:'solo_excel',level:'bad',status:'Solo en Excel',detail:'No aparece como servicio activo en la base actual.',name:row.name||'Sin nombre',phone:row.tel,platform:row.platforms[0]||'',excelAccount:row.accountEmail,liveAccount:'',inventoryAccount:'',excelDate:row.expiry,liveDate:'',row});
        continue;
      }
      best._used=true;
      const accountDiff=!!row.accountEmail&&!!best._email&&row.accountEmail!==best._email;
      const inventoryDiff=!!best._inv&&!!best._inv.account&&!!best._email&&best._inv.account!==best._email;
      const dateDiff=!!row.expiry&&!!best._date&&row.expiry!==best._date;
      const duplicate=best._invDuplicate;
      let kind='ok',level='ok',status='Correcto',detail='Cliente, cuenta y fecha coinciden.';
      if(duplicate){kind='duplicado';level='bad';status='Duplicado';detail='El cliente aparece asignado en más de una cuenta del inventario.';}
      else if(inventoryDiff||accountDiff){kind='cuenta';level='bad';status='Revisar cuenta';detail=inventoryDiff?'La cuenta del servicio no coincide con la asignación del inventario.':'La cuenta del Excel no coincide con Sublichat.';}
      else if(dateDiff){kind='fecha';level='warn';status='Actualizar fecha';detail='La fecha del Excel es diferente a la fecha vigente en Sublichat.';}
      const item={kind,level,status,detail,name:best.nombre||row.name,phone:best._phone||row.tel,platform:best.plataformaLabel||best.plataforma||best._plat,excelAccount:row.accountEmail,liveAccount:best._email,inventoryAccount:best._inv?.account||'',excelDate:row.expiry,liveDate:best._date,row,service:best};
      items.push(item);matched.push(item);
    }

    for(const s of live.filter(x=>!x._used)){
      const invDiff=!!s._inv&&!!s._inv.account&&!!s._email&&s._inv.account!==s._email;
      const currentOk=!!s._inv&&!!s._inv.account&&!!s._email&&s._inv.account===s._email&&!s._invDuplicate;
      items.push({kind:'solo_sublichat',level:invDiff?'bad':(currentOk?'ok':'warn'),status:invDiff?'Revisar cuenta':(currentOk?'Base actual coincide':'Falta en Bodega'),detail:invDiff?'La cuenta del servicio difiere de la asignación en Bodega.':(currentOk?'Existe una sola vez en Clientes y está asignado a la misma cuenta en Bodega. El Excel se conserva únicamente como respaldo histórico.':'El servicio está activo en Clientes, pero todavía no está asignado en Bodega.'),currentOk,name:s.nombre||'Sin nombre',phone:s._phone,platform:s.plataformaLabel||s.plataforma||s._plat,excelAccount:'',liveAccount:s._email,inventoryAccount:s._inv?.account||'',excelDate:'',liveDate:s._date,service:s});
    }

    const correct=items.filter(x=>x.kind==='ok'||x.currentOk).length;
    const metrics={
      clientes:new Set(live.map(x=>x.clienteId||`${x._name}|${x._phone}`)).size,
      servicios:live.length,cuentas:(src.cuentas||[]).length,filasExcel:excelRows.length,correctos:correct,
      revision:items.length-correct,soloExcel:items.filter(x=>x.kind==='solo_excel').length,
      soloSublichat:items.filter(x=>x.kind==='solo_sublichat').length,fechaDistinta:items.filter(x=>x.kind==='fecha').length,
      cuentaDistinta:items.filter(x=>['cuenta','duplicado'].includes(x.kind)).length
    };
    return {workbook,sheets,items,matched,metrics};
  }

  async function loadTemplateBase64(force){
    if(state.templateBase64&&!force)return state.templateBase64;
    const id=state.meta?.plantilla?.id;if(!id)throw new Error('Primero cargue su Excel actual como plantilla.');
    const j=await api({accion:'control_leer_archivo',id});
    state.templateBase64=j.base64||'';
    return state.templateBase64;
  }

  async function analyze(force){
    if(!window.ExcelJS)throw new Error('No cargó el lector de Excel. Revise la conexión e intente nuevamente.');
    const src=source();
    if(!src.servicios.length)throw new Error('La base actual de clientes todavía no terminó de cargar. Presione “Actualizar base”.');
    const raw=await loadTemplateBase64(force);
    const workbook=new ExcelJS.Workbook();
    await workbook.xlsx.load(base64ToBuffer(raw));
    state.analysis=parseWorkbook(workbook,src);state.accountAudit=null;
    return state.analysis;
  }

  function resultClass(item){return item.level==='ok'?'ok':(item.level==='warn'?'warn':'bad');}
  function resultFilter(item){
    if(state.filter==='all')return true;
    if(state.filter==='ok')return item.kind==='ok'||item.currentOk;
    if(state.filter==='revision')return item.kind!=='ok'&&!item.currentOk;
    if(state.filter==='solo_excel')return item.kind==='solo_excel';
    if(state.filter==='solo_sublichat')return item.kind==='solo_sublichat';
    if(state.filter==='cuenta')return ['cuenta','duplicado'].includes(item.kind);
    return true;
  }

  function maskAccount(v){return v||'—';}
  function filteredItems(){
    const q=norm(state.query);
    return (state.analysis?.items||[]).filter(resultFilter).filter(x=>!q||norm([x.name,x.phone,x.platform,x.excelAccount,x.liveAccount,x.inventoryAccount,x.status].join(' ')).includes(q));
  }

  const ROSTER_STATUS={
    ok:{label:'Coincide',icon:'✅',tone:'ok'},
    vencido:{label:'Vencido',icon:'⏰',tone:'warn'},
    duplicado:{label:'Duplicado',icon:'⛔',tone:'bad'},
    solo_bodega:{label:'Solo en Bodega',icon:'📦',tone:'bad'},
    otra_cuenta:{label:'Está en otra cuenta',icon:'↔️',tone:'bad'},
    falta_bodega:{label:'Falta en Bodega',icon:'⚠️',tone:'warn'},
    falta_excel:{label:'Falta en Excel',icon:'📘',tone:'warn'},
    excel_bodega:{label:'Excel + Bodega',icon:'🔄',tone:'warn'},
    falta_excel_bodega:{label:'Solo en Clientes',icon:'⚠️',tone:'warn'},
    solo_excel:{label:'Solo en Excel',icon:'📘',tone:'warn'},
    solo_excel_vencido:{label:'Excel vencido',icon:'🗑️',tone:'bad'},
    vencido_sin_bodega:{label:'Vencido y sin Bodega',icon:'🗑️',tone:'bad'}
  };

  function accountDateTime(v){
    const d=new Date(v||'');if(isNaN(d))return '—';
    try{return d.toLocaleString('es-HN',{timeZone:'America/Tegucigalpa',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});}
    catch(_){return d.toLocaleString('es-HN');}
  }

  function accountReviewDates(v){
    const d=new Date(v||'');
    if(isNaN(d))return {reviewed:'—',next:'—'};
    try{
      const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Tegucigalpa',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d);
      const get=(type)=>parts.find((x)=>x.type===type)?.value||'';
      const year=Number(get('year')),month=Number(get('month')),day=Number(get('day'));
      if(!year||!month||!day)throw new Error('Fecha inválida');
      const next=new Date(Date.UTC(year,month-1,day+15,12));
      const pad=(n)=>String(n).padStart(2,'0');
      return {
        reviewed:`${pad(day)}/${pad(month)}/${year}`,
        next:`${pad(next.getUTCDate())}/${pad(next.getUTCMonth()+1)}/${next.getUTCFullYear()}`
      };
    }catch(_){
      const next=new Date(d);next.setDate(next.getDate()+15);
      const format=(x)=>`${String(x.getDate()).padStart(2,'0')}/${String(x.getMonth()+1).padStart(2,'0')}/${x.getFullYear()}`;
      return {reviewed:format(d),next:format(next)};
    }
  }

  function accountReviewSchedule(a){
    const review=a?.revision;
    if(!review)return {tone:'due',label:'🕒 PENDIENTE',rowText:'Nunca revisada',detail:'Esta cuenta aún no se ha revisado.',reviewed:'—',next:'—',isReviewed:false};
    const dates=accountReviewDates(review.revisadoAt);
    if(review.resultado==='incidencia')return {tone:'bad',label:'⚠️ INCIDENCIA',rowText:`Revisada: ${dates.reviewed}`,detail:`Incidencia registrada el ${dates.reviewed}.`,reviewed:dates.reviewed,next:dates.next,isReviewed:false};
    if(a.reviewDataChanged)return {tone:'due',label:'🕒 TOCA REVISAR',rowText:'Cambió la asignación',detail:`La cuenta cambió después de revisarla el ${dates.reviewed}.`,reviewed:dates.reviewed,next:dates.next,isReviewed:false};
    if(a.reviewDue)return {tone:'due',label:'🕒 TOCA REVISAR',rowText:`Venció: ${dates.next}`,detail:`Revisada: ${dates.reviewed} · debía revisarse: ${dates.next}`,reviewed:dates.reviewed,next:dates.next,isReviewed:false};
    return {tone:'ok',label:'✅ REVISADA',rowText:`Próxima: ${dates.next}`,detail:`Revisada: ${dates.reviewed} · próxima revisión: ${dates.next}`,reviewed:dates.reviewed,next:dates.next,isReviewed:true};
  }

  function reviewProgress(accounts){
    const list=Array.isArray(accounts)?accounts:[];
    const total=list.length;
    const reviewed=list.filter((a)=>accountReviewSchedule(a).isReviewed).length;
    const pending=Math.max(0,total-reviewed);
    const percent=total?Math.round((reviewed/total)*100):0;
    const tone=percent===100?'complete':(percent===0?'empty':(percent<50?'urgent':'partial'));
    const label=percent===100?'✅ Completa':(percent===0?'🔴 Sin revisar':(percent<50?'🟠 Urge avanzar':'🟡 Parcial'));
    return {total,reviewed,pending,percent,tone,label};
  }

  function platformOverviewHtml(audit){
    const items=Object.keys(audit.platforms||{}).map((family)=>{
      const accounts=audit.accounts.filter((a)=>a.family===family);
      return {family,name:auditPlatformLabel(family),ctas:audit.platforms[family]||0,perfiles:audit.platformRows[family]||0,...reviewProgress(accounts)};
    }).sort((a,b)=>a.percent-b.percent||b.pending-a.pending||a.name.localeCompare(b.name));
    const overall=reviewProgress(audit.accounts);
    const chip=(item,key,color)=>`<button type="button" class="cm-platform-chip ${esc(item.tone)} ${state.accountPlatform===key?'on':''}" style="--platform-color:${color}" data-cm-audit-platform="${esc(key)}" title="${esc(`${item.label} · ${item.reviewed} de ${item.total} cuentas revisadas · ${item.pending} pendientes`)}">
      <div class="cm-platform-chip-top"><b>${esc(item.name)}</b><strong>${item.percent}%</strong></div>
      <span class="cm-platform-chip-meta">${item.ctas} cta${item.ctas===1?'':'s'} · ${item.perfiles} perfil${item.perfiles===1?'':'es'}</span>
      <span class="cm-progress-mini" aria-hidden="true"><i style="width:${item.percent}%"></i></span>
      <small>${item.reviewed}/${item.total} revisadas</small>
    </button>`;
    const totalChip=chip({...overall,name:'Todas',ctas:audit.accounts.length,perfiles:audit.metrics.registros},'all','#168fd3');
    return `<section class="cm-review-progress">
      <div class="cm-progress-head"><div><b>📊 Plataformas: cuentas y revisión</b><small>Toque una plataforma para filtrar la mesa de abajo · revisión vigente 15 días.</small></div></div>
      <div class="cm-platform-filters">${totalChip}${items.map((item)=>chip(item,item.family,platformColor(item.family))).join('')}</div>
      <div class="cm-progress-legend"><span>🔴 0% sin revisar</span><span>🟡 revisión parcial</span><span>🟢 100% revisada</span></div>
    </section>`;
  }

  const EXPIRY_SOON_DAYS=3;
  const AUDIT_PLATFORM_COLORS={
    netflix:'#e50914',vipnetflix:'#c9184a',disney:'#1769d2',hbomax:'#6f42c1',primevideo:'#00a8e1',
    paramount:'#1769d2',crunchyroll:'#f47521',vix:'#c000ff',viki:'#00a7c4',universal:'#078b80',
    spotify:'#1db954',youtube:'#ff0033',canva:'#7d2ae8',gemini:'#4285f4',duolingo:'#58cc02',chatgpt:'#10a37f',
    magis:'#16a085',oleada:'#1297a6',iptv:'#0f9f82',vixmix:'#9c27b0',sin_plataforma:'#78909c'
  };

  function platformColor(family){return AUDIT_PLATFORM_COLORS[auditFamily(family)]||'#168fd3';}

  function daysUntil(v){
    const d=dateValue(v);if(!d)return null;
    const today=new Date();today.setHours(0,0,0,0);d.setHours(0,0,0,0);
    return Math.round((d-today)/86400000);
  }

  function accountLifecycle(a){
    const dated=(a.roster||[]).map((r)=>({row:r,days:daysUntil(r.date),date:dateValue(r.date)})).filter((x)=>x.days!=null);
    const expired=dated.filter((x)=>x.days<0);
    const soon=dated.filter((x)=>x.days>=0&&x.days<=EXPIRY_SOON_DAYS);
    const active=dated.filter((x)=>x.days>EXPIRY_SOON_DAYS);
    const noDate=Math.max(0,(a.roster||[]).length-dated.length);
    const future=dated.filter((x)=>x.days>=0).sort((x,y)=>x.days-y.days);
    const past=[...expired].sort((x,y)=>y.days-x.days);
    const tone=expired.length?'expired':(soon.length?'soon':(active.length?'active':'nodate'));
    const label=expired.length?'Con vencidos':(soon.length?'Próxima a vencer':(active.length?'Vigente':'Sin fecha'));
    const icon=expired.length?'🔴':(soon.length?'🟡':(active.length?'🟢':'⚪'));
    let nextText='Sin fechas registradas';
    if(future[0])nextText=`Próximo: ${dateLabel(future[0].row.date)}`;
    else if(past[0])nextText=`Último: ${dateLabel(past[0].row.date)}`;
    return {expired:expired.length,soon:soon.length,active:active.length,noDate,tone,label,icon,nextText,nextDays:future[0]?.days??99999};
  }

  function filteredAccounts(){
    const q=norm(state.accountQuery);
    const rank={expired:0,soon:1,nodate:2,active:3};
    return (state.accountAudit?.accounts||[]).filter((a)=>{
      const life=accountLifecycle(a);
      if(state.accountPlatform!=='all'&&a.family!==state.accountPlatform)return false;
      if(state.accountStatus==='expired'&&life.tone!=='expired')return false;
      if(state.accountStatus==='soon'&&life.tone!=='soon')return false;
      if(state.accountStatus==='active'&&life.tone!=='active')return false;
      if(state.accountStatus==='problems'&&!a.issueCount)return false;
      if(state.accountStatus==='reviewed'&&!accountReviewSchedule(a).isReviewed)return false;
      if(state.accountStatus==='review_due'&&!a.reviewDue)return false;
      if(!q)return true;
      return norm([a.platform,a.email,a.clave,...a.roster.flatMap((r)=>[r.name,r.phone,r.profile,r.pin,r.actualAccount,dateLabel(r.date)])].join(' ')).includes(q);
    }).sort((a,b)=>{
      const la=accountLifecycle(a),lb=accountLifecycle(b);
      return (rank[la.tone]??9)-(rank[lb.tone]??9)||la.nextDays-lb.nextDays||a.platform.localeCompare(b.platform)||String(a.email).localeCompare(String(b.email));
    });
  }

  function accountIssuesHtml(a){
    const list=[];
    if(!a.email)list.push('⛔ Sin correo');
    if(a.missingPassword)list.push('🔑 Sin clave');
    if(a.missingInventory)list.push('📦 Falta en Bodega');
    if(a.duplicateDocs)list.push('📦 Cuenta repetida');
    if(a.overCapacity)list.push('🚨 Sobre capacidad');
    if(a.rosterIssues)list.push(`👥 ${a.rosterIssues} por revisar`);
    if(a.recordedIncident)list.push('⚠️ Incidencia manual abierta');
    if(a.reviewDataChanged)list.push('🔄 Cambió desde la última revisión');
    if(!list.length)list.push('✅ Base interna coincide');
    return list.map((x)=>`<span class="cm-account-issue ${a.issueCount?'bad':'ok'}">${esc(x)}</span>`).join('');
  }

  function rosterRowHtml(r,accountIndex,rowIndex){
    const s=ROSTER_STATUS[r.status]||{label:r.status||'Revisar',icon:'⚠️',tone:'bad'};
    const rawProfile=fieldText(r.profile);
    const profile=rawProfile?(/^perfil\b/i.test(rawProfile)?rawProfile:`Perfil ${rawProfile}`):'Perfil sin indicar';
    const sources=[r.excel?`📘 Excel · ${r.excel.sheet} fila ${r.excel.row}`:'',r.service?'👤 Clientes':'',r.inv?'📦 Bodega':''].filter(Boolean);
    const pointer=`${accountIndex}:${rowIndex}`;
    const actions=[
      r.service?`<button class="cm-row-action edit" data-cm-edit-service="${pointer}">✏️ Editar</button>`:'',
      (r.inv&&!r.service)?`<button class="cm-row-action edit" data-cm-edit-inventory-client="${pointer}">✏️ Editar en Bodega</button>`:'',
      r.inv?`<button class="cm-row-action move" data-cm-remove-assignment="${pointer}">📤 Sacar</button>`:'',
      r.service?`<button class="cm-row-action delete" data-cm-delete-service="${pointer}">🗑️ Eliminar</button>`:'',
      r.excel&&!r.service&&!r.inv?`<button class="cm-row-action delete" data-cm-delete-excel="${pointer}">🗑️ Borrar del Excel</button>`:''
    ].filter(Boolean).join('');
    return `<div class="cm-roster-row ${s.tone}" title="${esc(r.detail||'')}">
      <div class="cm-roster-slot"><b>${esc(profile)}</b><small>${r.pin?`PIN ${esc(r.pin)}`:'Sin PIN'}</small><div class="cm-roster-sources">${sources.map((x)=>`<i>${esc(x)}</i>`).join('')}</div></div>
      <button class="cm-roster-client" data-cm-audit-client="${accountIndex}:${rowIndex}" title="Abrir este cliente"><b>${esc(r.name||'Sin nombre')}</b><small>${esc(r.phone||'Sin teléfono')}</small></button>
      <div class="cm-roster-date"><b>${esc(dateLabel(r.date))}</b><small>Vencimiento</small></div>
      <span class="cm-roster-status ${s.tone}" title="${esc(r.detail||'')}">${s.icon} ${esc(s.label)}</span>
      <div class="cm-roster-actions">${actions||'<span>Solo respaldo Excel</span>'}</div>
    </div>`;
  }

  function accountCardHtml(a,i){
    const life=accountLifecycle(a);
    const expanded=state.expandedAccountKey===a.key;
    const revealed=state.revealedAccounts.has(a.key);
    const review=a.revision;
    const saving=state.reviewSavingKey===a.key;
    const savedCorrect=review?.resultado==='correcta'&&!a.reviewDue;
    const okLabel=saving?'⏳ Guardando…':(savedCorrect?'✅ Coincidencia guardada':'✅ Revisada: coincide');
    const feedback=state.accountFeedback?.key===a.key?state.accountFeedback:null;
    const reviewSchedule=accountReviewSchedule(a);
    const reviewTone=reviewSchedule.tone;
    const inventoryIds=a.accountIds.filter(Boolean);
    const editableAccount=inventoryIds.length===1;
    const password=a.clave?revealed?esc(a.clave):'••••••••':'Sin clave guardada';
    const roster=expanded?a.roster.map((r,j)=>rosterRowHtml(r,i,j)).join(''):'';
    return `<article class="cm-ledger-account ${life.tone} ${expanded?'is-open':''}" style="--platform-color:${platformColor(a.family)}">
      <div class="cm-ledger-row">
        <div class="cm-ledger-platform-cell"><span class="cm-ledger-platform">${esc(a.platform)}</span><span class="cm-life-state ${life.tone}">${life.icon} ${esc(life.label)}</span></div>
        <div class="cm-ledger-identity"><b title="${esc(a.email||'CUENTA SIN CORREO')}">${esc(a.email||'CUENTA SIN CORREO')}</b><small>🔑 ${password}</small></div>
        <div class="cm-ledger-clients"><b>${a.roster.length}</b><small>${a.occupied}/${a.capacity||'—'} cupos</small></div>
        <div class="cm-ledger-expiry"><div><span class="expired">${life.expired} vencido${life.expired===1?'':'s'}</span><span class="soon">${life.soon} próximo${life.soon===1?'':'s'}</span><span class="active">${life.active} vigente${life.active===1?'':'s'}</span>${life.noDate?`<span class="nodate">${life.noDate} sin fecha</span>`:''}</div><small>${esc(life.nextText)}</small></div>
        <div class="cm-ledger-control"><span class="cm-control-diff ${a.issueCount?'bad':'ok'}">${a.issueCount?`⚠️ ${a.issueCount} diferencia${a.issueCount===1?'':'s'}`:'✅ Sin diferencias'}</span><span class="cm-review-box ${reviewTone}"><b>${esc(reviewSchedule.label)}</b><small>${esc(reviewSchedule.rowText)}</small></span></div>
        <button class="cm-ledger-toggle" data-cm-toggle-account="${esc(a.key)}" aria-expanded="${expanded?'true':'false'}">${expanded?'Cerrar':'Ver clientes'} <i>${expanded?'▲':'▼'}</i></button>
      </div>
      ${expanded?`<div class="cm-ledger-detail">
        <div class="cm-ledger-detail-head"><div><small>${a.excelRows.length} fila${a.excelRows.length===1?'':'s'} Excel · ${a.inventoryAccounts.length} registro${a.inventoryAccounts.length===1?'':'s'} en Bodega · ${a.services.length} servicio${a.services.length===1?'':'s'} en Clientes</small></div><div class="cm-ledger-detail-side"><span class="cm-review-state ${reviewTone}"><b>${esc(reviewSchedule.label)}</b><small>${esc(reviewSchedule.detail)}</small></span>${editableAccount?`<div class="cm-account-tools"><button class="cm-row-action edit" data-cm-edit-account="${i}">✏️ Editar cuenta</button><button class="cm-row-action delete" data-cm-delete-account="${i}">🗑️ Eliminar cuenta</button></div>`:''}</div></div>
        <div class="cm-account-issues">${accountIssuesHtml(a)}</div>
        <div class="cm-credentials">
          <div class="cm-credential"><span>Correo de acceso</span><code>${esc(a.email||'—')}</code><button class="cm-copy" data-cm-copy-email="${i}" ${a.email?'':'disabled'}>📋 Copiar</button></div>
          <div class="cm-credential"><span>Clave de la cuenta</span><code class="cm-secret ${revealed?'shown':''}">${password}</code><div class="cm-secret-actions"><button class="cm-copy" data-cm-reveal-account="${i}" ${a.clave?'':'disabled'}>${revealed?'🙈 Ocultar':'👁️ Ver'}</button><button class="cm-copy" data-cm-copy-password="${i}" ${a.clave?'':'disabled'}>📋 Copiar</button></div></div>
        </div>
        <div class="cm-roster-head"><div><b>Clientes que deben estar aquí</b></div><button class="cm-btn" data-cm-open-audit="${i}">📦 Abrir en Bodega</button></div>
        <div class="cm-roster">${roster||'<div class="cm-empty cm-roster-empty">Esta cuenta no tiene clientes asignados.</div>'}</div>
        ${review?.nota?`<div class="cm-review-note"><b>Última nota:</b> ${esc(review.nota)}</div>`:''}
        ${feedback?`<div class="cm-review-note ${esc(feedback.type)}"><b>${esc(feedback.text)}</b></div>`:''}
        <div class="cm-account-review"><div><b>Revisión real del proveedor</b><small>Entre a la cuenta y compare. Se guarda en Firebase.</small></div><div class="cm-account-review-actions"><button class="cm-btn good" data-cm-review-ok="${esc(a.key)}" ${state.busy?'disabled':''}>${okLabel}</button><button class="cm-btn warn" data-cm-review-issue="${esc(a.key)}" ${state.busy?'disabled':''}>⚠️ Registrar incidencia</button></div></div>
      </div>`:''}
    </article>`;
  }

  function accountResultsHtml(){
    const all=filteredAccounts();state.accountVisible=all.slice(0,Math.max(1,state.accountLimit||1500));
    return `<div class="cm-account-count">Mostrando <b>${state.accountVisible.length}</b> de <b>${all.length}</b> cuentas. Las urgentes aparecen primero.</div>
      <div class="cm-ledger-scroll"><div class="cm-account-ledger"><div class="cm-ledger-header"><span>Plataforma / estado</span><span>Cuenta y clave</span><span>Clientes</span><span>Vencimientos</span><span>Control interno</span><span>Detalle</span></div>${state.accountVisible.map(accountCardHtml).join('')||'<div class="cm-empty cm-account-no-results">No hay cuentas con este filtro.</div>'}</div></div>
      ${all.length>state.accountVisible.length?`<div class="cm-load-more"><button class="cm-btn primary" data-cm-action="show-all-accounts">Mostrar las ${all.length} cuentas</button><small>El conteo ya incluye todas; se cargan por partes para no trabar la computadora.</small></div>`:''}`;
  }

  function accountAuditHtml(){
    const audit=state.accountAudit;
    if(!audit?.accounts?.length)return `<section class="cm-panel"><div class="cm-empty">Todavía no cargaron las cuentas de Firebase. Presione <b>Actualizar base</b>.</div></section>`;
    const reviewedCount=audit.accounts.filter((a)=>accountReviewSchedule(a).isReviewed).length;
    const reviewDueCount=audit.accounts.filter((a)=>a.reviewDue).length;
    const statuses=[['all','Todas'],['expired','🔴 Vencidos'],['soon',`🟡 Próximos ${EXPIRY_SOON_DAYS} días`],['active','🟢 Vigentes'],['problems','⚠️ Diferencias'],['reviewed',`✅ Revisadas (${reviewedCount})`],['review_due',`🕒 Toca revisar (${reviewDueCount})`]];
    return `<section class="cm-panel cm-accounts-panel">
      <div class="cm-panel-head"><div><h3>📋 Mesa compacta por cuenta</h3><p>Una línea por correo, como en su Excel. Abra solamente la cuenta que quiera comprobar.</p></div><span class="cm-template-state ${audit.metrics.conProblemas?'':'ok'}">${audit.metrics.conProblemas?audit.metrics.conProblemas+' cuentas con diferencias':'✅ Base interna correcta'}</span></div>
      <div class="cm-audit-callout"><b>Lectura rápida:</b> <span class="expired">🔴 vencido</span> · <span class="soon">🟡 vence hoy o en ${EXPIRY_SOON_DAYS} días</span> · <span class="active">🟢 vigente</span>. Presione <b>Ver clientes</b> para editar, sacar o eliminar. Firebase es la base viva; el Excel queda solamente como respaldo histórico.</div>
      ${platformOverviewHtml(audit)}
      <div class="cm-toolbar cm-account-toolbar"><label class="cm-search"><span>⌕</span><input id="cmAccountSearch" value="${esc(state.accountQuery)}" placeholder="Correo, clave, cliente, teléfono, perfil o PIN…"></label><div class="cm-filters">${statuses.map(([k,l])=>`<button class="cm-filter ${state.accountStatus===k?'on':''}" data-cm-audit-status="${k}">${l}</button>`).join('')}</div></div>
      <div id="cmAccountResults">${accountResultsHtml()}</div>
    </section>`;
  }

  function kpisHtml(){
    const m=state.accountAudit?.metrics||{};
    const accounts=state.accountAudit?.accounts||[];
    const life=accounts.map(accountLifecycle);
    const expired=life.filter((x)=>x.tone==='expired').length,soon=life.filter((x)=>x.tone==='soon').length,active=life.filter((x)=>x.tone==='active').length;
    return `<div class="cm-kpis">
      <div class="cm-kpi"><b>${m.cuentas??'—'}</b><span>Cuentas agrupadas</span></div>
      <div class="cm-kpi bad"><b>${expired}</b><span>🔴 Cuentas con vencidos</span></div>
      <div class="cm-kpi warn"><b>${soon}</b><span>🟡 Próximas a vencer</span></div>
      <div class="cm-kpi good"><b>${active}</b><span>🟢 Cuentas vigentes</span></div>
      <div class="cm-kpi ${m.conProblemas?'bad':'good'}"><b>${m.conProblemas??'—'}</b><span>Diferencias internas</span></div>
    </div>`;
  }

  function templateHtml(){
    const t=state.meta?.plantilla;
    return `<section class="cm-panel">
      <div class="cm-panel-head"><div><h3>📘 Formato descargable del respaldo</h3><p>El Excel anterior queda únicamente como formato de salida. Su trabajo diario se hace arriba con la información viva de Firebase.</p></div><span class="cm-template-state ${t?'ok':''}">${t?'✅ Formato activo':'⚠️ Falta formato'}</span></div>
      ${t?`<div class="cm-note"><b>${esc(t.filename)}</b> · ${Number(t.size||0).toLocaleString('es-HN')} bytes · cargado ${esc(String(t.createdAt||'').replace('T',' ').slice(0,16))}</div>`:'<div class="cm-note">Cargue una sola vez el Excel “Sublicuentas streaming”. No se publica dentro de la web; queda protegido para generar sus respaldos.</div>'}
      <div class="cm-actions" style="margin-top:11px">
        <label class="cm-file-btn ${state.busy?'off':''}">📤 ${t?'Reemplazar plantilla':'Cargar Excel actual'}<input id="cmTemplateFile" type="file" accept=".xlsx"></label>
        ${t?'<button class="cm-btn" data-cm-action="download-template">⬇️ Descargar plantilla</button>':''}
        <button class="cm-btn" data-cm-action="refresh-data" ${state.busy?'disabled':''}>${state.refreshing?'⏳ Actualizando…':'🔄 Actualizar datos'}</button>
        ${t?'<button class="cm-btn primary" data-cm-action="review">🔎 Revisar ahora</button>':''}
      </div>
      <div class="cm-hint">Para corregir algo, abra el cliente o la cuenta desde la revisión. Después presione “Revisar ahora”; no necesita escribirlo otra vez en Excel.</div>
      <div class="cm-status ${state.statusType==='error'?'err':(state.statusType==='good'?'good':'')}">${esc(state.status)}</div>
    </section>`;
  }

  function reviewHtml(){
    if(!state.analysis)return `<details class="cm-panel cm-details"><summary><span><b>📎 Cruce histórico con el Excel</b><small>Opcional: cargue el formato y presione “Revisar ahora” para comparar también las filas antiguas.</small></span><i>Ver</i></summary></details>`;
    const all=filteredItems();state.visible=all.slice(0,300);
    const filters=[['revision','Revisar'],['cuenta','Cuentas'],['solo_sublichat','Nuevos para respaldo'],['solo_excel','Solo Excel'],['ok','Correctos'],['all','Todos']];
    const rows=state.visible.map((x,i)=>`<tr>
      <td><div class="cm-client"><b>${esc(x.name||'Sin nombre')}</b><small>${esc(x.phone||'Sin teléfono')}</small></div></td>
      <td><span class="cm-platform">${esc(x.platform||'—')}</span></td>
      <td>${esc(maskAccount(x.excelAccount))}</td><td>${esc(maskAccount(x.liveAccount))}</td><td>${esc(maskAccount(x.inventoryAccount))}</td>
      <td>${esc(dateLabel(x.excelDate))}</td><td>${esc(dateLabel(x.liveDate))}</td>
      <td><span class="cm-result ${resultClass(x)}">${esc(x.status)}</span></td>
      <td><div class="cm-inline-actions"><button class="cm-mini" data-cm-client="${i}" title="Abrir cliente">👤</button><button class="cm-mini" data-cm-account="${i}" title="Abrir cuenta">📦</button>${x.kind==='solo_excel'?`<button class="cm-mini" data-cm-delete-historical-excel="${i}" title="Borrar únicamente del Excel">🗑️</button>`:''}</div></td>
    </tr>`).join('');
    return `<details class="cm-panel cm-details">
      <summary><span><b>📎 Cruce histórico con el Excel</b><small>Comparación opcional entre el formato antiguo, Clientes y Bodega.</small></span><i>${state.analysis.metrics.revision?state.analysis.metrics.revision+' diferencias':'Todo coincide'} · Ver</i></summary>
      <div class="cm-details-body">
      <div class="cm-toolbar"><label class="cm-search"><span>⌕</span><input id="cmSearch" value="${esc(state.query)}" placeholder="Cliente, teléfono, plataforma o cuenta…"></label><div class="cm-filters">${filters.map(([k,l])=>`<button class="cm-filter ${state.filter===k?'on':''}" data-cm-filter="${k}">${l}</button>`).join('')}</div></div>
      <div class="cm-table-wrap">${rows?`<table class="cm-table"><thead><tr><th>Cliente</th><th>Plataforma</th><th>Cuenta Excel</th><th>Cuenta Sublichat</th><th>Cuenta inventario</th><th>Fecha Excel</th><th>Fecha actual</th><th>Resultado</th><th>Acciones</th></tr></thead><tbody>${rows}</tbody></table>`:'<div class="cm-empty">No hay registros con este filtro.</div>'}</div>
      ${all.length>state.visible.length?`<div class="cm-hint">Mostrando 300 de ${all.length} resultados. Use la búsqueda para encontrar un cliente específico.</div>`:''}
      <div class="cm-actions" style="margin-top:12px"><button class="cm-btn good" data-cm-action="generate-download">📥 Generar y descargar Excel</button><button class="cm-btn" data-cm-action="save-backup">🛡️ Guardar respaldo sin descargar</button></div>
      </div>
    </details>`;
  }

  function backupsHtml(){
    const list=state.meta?.respaldos||[];
    return `<section class="cm-panel"><div class="cm-panel-head"><div><h3>🛡️ Respaldos privados</h3><p>Se guarda una copia al generar y una copia automática al abrir el módulo; máximo ${state.meta?.dailyLimit||2} por día.</p></div><span class="cm-template-state">${list.length} versiones</span></div>
      <div class="cm-backups">${list.length?list.slice(0,12).map((b)=>`<div class="cm-backup"><div><b>${esc(b.filename)}</b><small>${esc(String(b.createdAt||'').replace('T',' ').slice(0,16))} · ${b.metricas?.servicios??'—'} servicios · ${b.metricas?.revision??'—'} para revisar</small></div><div class="cm-backup-actions"><button class="cm-mini" data-cm-download="${esc(b.id)}" title="Descargar">⬇️</button><button class="cm-mini" data-cm-restore="${esc(b.id)}" title="Usar como plantilla">↩️</button></div></div>`).join(''):'<div class="cm-empty">Todavía no hay respaldos generados.</div>'}</div>
    </section>`;
  }

  function render(){
    const host=root();if(!host)return;
    if(!isAdmin()){host.innerHTML='<div class="cm-empty">Este módulo pertenece únicamente al usuario Sublicuentas.</div>';return;}
    if(state.loading&&!state.meta){host.innerHTML='<div class="cm-loading"><div><div class="cm-spinner"></div>Cargando Control Maestro…</div></div>';return;}
    if(!state.accountAudit)state.accountAudit=buildAccountAudit(source(),state.analysis);
    const controlScreen=document.getElementById('screen-control-cuentas');
    const expanded=document.fullscreenElement===controlScreen||controlScreen?.classList.contains('cm-control-expanded');
    host.innerHTML=`<div class="cm-shell cm-size-${esc(state.uiSize)}" data-build="${BUILD}">
      <header class="cm-hero"><div class="cm-title"><div class="cm-title-icon">📋</div><div><h2>Control Maestro</h2><p>Vista tipo Excel: una línea por cuenta, colores de vencimiento y clientes desplegables.</p></div></div><div class="cm-hero-actions"><div class="cm-refresh-top-wrap"><button class="cm-btn primary cm-refresh-top ${state.refreshing?'is-loading':''}" data-cm-action="refresh-data" ${state.busy?'disabled':''}>${state.refreshing?'⏳ Actualizando datos…':'🔄 Actualizar datos'}</button><small>${esc(refreshTimeLabel())}</small></div><button class="cm-btn cm-expand" data-cm-action="toggle-fullscreen">${expanded?'↙️ Salir de pantalla completa':'⛶ Pantalla completa'}</button><span class="cm-private">🔒 Solo Sublicuentas</span></div></header>
      <div class="cm-reading-bar"><div><b>👓 Tamaño de lectura</b><small>Puede aumentarlo sin cambiar el tamaño del resto de Sublichat.</small></div><div class="cm-size-options" role="group" aria-label="Tamaño del texto"><button data-cm-size="normal" class="${state.uiSize==='normal'?'on':''}" aria-pressed="${state.uiSize==='normal'}">Normal</button><button data-cm-size="large" class="${state.uiSize==='large'?'on':''}" aria-pressed="${state.uiSize==='large'}">Grande</button><button data-cm-size="xlarge" class="${state.uiSize==='xlarge'?'on':''}" aria-pressed="${state.uiSize==='xlarge'}">Muy grande</button></div></div>
      ${kpisHtml()}${accountAuditHtml()}${templateHtml()}${reviewHtml()}${backupsHtml()}
    </div>`;
    bind();
  }

  // Vuelve a atar únicamente los botones que viven dentro de la mesa de cuentas
  // (#cmAccountResults). Se llama tanto en el render completo como en la
  // actualización liviana que dispara la búsqueda, para no tener que reconstruir
  // toda la pantalla ni el campo de búsqueda cada vez que se filtra.
  function bindAccountResults(container){
    if(!container)return;
    container.querySelectorAll('[data-cm-action="show-all-accounts"]').forEach(b=>b.onclick=()=>handleAction(b.dataset.cmAction));
    container.querySelectorAll('[data-cm-toggle-account]').forEach(b=>b.onclick=()=>toggleAccountDetails(b.dataset.cmToggleAccount));
    container.querySelectorAll('[data-cm-reveal-account]').forEach(b=>b.onclick=()=>toggleAccountSecret(Number(b.dataset.cmRevealAccount)));
    container.querySelectorAll('[data-cm-copy-email]').forEach(b=>b.onclick=()=>copyAccountValue(Number(b.dataset.cmCopyEmail),'email'));
    container.querySelectorAll('[data-cm-copy-password]').forEach(b=>b.onclick=()=>copyAccountValue(Number(b.dataset.cmCopyPassword),'password'));
    container.querySelectorAll('[data-cm-open-audit]').forEach(b=>b.onclick=()=>openAuditAccount(Number(b.dataset.cmOpenAudit)));
    container.querySelectorAll('[data-cm-audit-client]').forEach(b=>b.onclick=()=>openAuditClient(b.dataset.cmAuditClient));
    container.querySelectorAll('[data-cm-edit-service]').forEach(b=>b.onclick=()=>editAuditService(b.dataset.cmEditService));
    container.querySelectorAll('[data-cm-delete-service]').forEach(b=>b.onclick=()=>deleteAuditService(b.dataset.cmDeleteService));
    container.querySelectorAll('[data-cm-delete-excel]').forEach(b=>b.onclick=()=>askDeleteExcelBackupRow(b,b.dataset.cmDeleteExcel));
    container.querySelectorAll('[data-cm-remove-assignment]').forEach(b=>b.onclick=()=>removeAuditAssignment(b.dataset.cmRemoveAssignment));
    container.querySelectorAll('[data-cm-edit-inventory-client]').forEach(b=>b.onclick=()=>editAuditInventoryClient(b.dataset.cmEditInventoryClient));
    container.querySelectorAll('[data-cm-edit-account]').forEach(b=>b.onclick=()=>editAuditAccount(Number(b.dataset.cmEditAccount)));
    container.querySelectorAll('[data-cm-delete-account]').forEach(b=>b.onclick=()=>deleteAuditAccount(Number(b.dataset.cmDeleteAccount)));
    container.querySelectorAll('[data-cm-review-ok]').forEach(b=>b.onclick=()=>saveAccountReview(b.dataset.cmReviewOk,'correcta'));
    container.querySelectorAll('[data-cm-review-issue]').forEach(b=>b.onclick=()=>saveAccountReview(b.dataset.cmReviewIssue,'incidencia'));
  }

  // Actualiza solamente la mesa de cuentas (conteo + tarjetas) sin tocar el
  // resto de la pantalla ni el campo de búsqueda. Así el input nunca se destruye
  // mientras la persona escribe y el teclado del celular no se cierra.
  function updateAccountResults(){
    const host=root();if(!host)return;
    const results=host.querySelector('#cmAccountResults');if(!results)return;
    results.innerHTML=accountResultsHtml();
    bindAccountResults(results);
  }

  function bind(){
    const host=root();if(!host)return;
    host.querySelectorAll('[data-cm-action]').forEach(b=>b.onclick=()=>handleAction(b.dataset.cmAction));
    host.querySelectorAll('[data-cm-size]').forEach(b=>b.onclick=()=>setUiSize(b.dataset.cmSize));
    const file=host.querySelector('#cmTemplateFile');if(file)file.onchange=()=>uploadTemplate(file.files?.[0]);
    host.querySelectorAll('[data-cm-audit-platform]').forEach(b=>b.onclick=()=>{state.accountPlatform=b.dataset.cmAuditPlatform;state.accountLimit=1500;state.expandedAccountKey='';render();});
    host.querySelectorAll('[data-cm-audit-status]').forEach(b=>b.onclick=()=>{state.accountStatus=b.dataset.cmAuditStatus;state.accountLimit=1500;state.expandedAccountKey='';render();});
    const aq=host.querySelector('#cmAccountSearch');
    if(aq)aq.oninput=()=>{
      state.accountQuery=aq.value;
      clearTimeout(accountSearchTimer);
      accountSearchTimer=setTimeout(()=>{state.accountLimit=5000;updateAccountResults();},180);
    };
    bindAccountResults(host);
    host.querySelectorAll('[data-cm-filter]').forEach(b=>b.onclick=()=>{state.filter=b.dataset.cmFilter;render();});
    const q=host.querySelector('#cmSearch');
    if(q)q.oninput=()=>{
      state.query=q.value;
      clearTimeout(clientSearchTimer);
      clientSearchTimer=setTimeout(()=>{render();setTimeout(()=>{const el=document.getElementById('cmSearch');if(el){el.focus();el.setSelectionRange(el.value.length,el.value.length);}},0);},180);
    };
    host.querySelectorAll('[data-cm-client]').forEach(b=>b.onclick=()=>openClient(state.visible[Number(b.dataset.cmClient)]));
    host.querySelectorAll('[data-cm-account]').forEach(b=>b.onclick=()=>openAccount(state.visible[Number(b.dataset.cmAccount)]));
    host.querySelectorAll('[data-cm-delete-historical-excel]').forEach(b=>b.onclick=()=>askDeleteExcelBackupRow(b,'',state.visible[Number(b.dataset.cmDeleteHistoricalExcel)]));
    host.querySelectorAll('[data-cm-download]').forEach(b=>b.onclick=()=>downloadStored(b.dataset.cmDownload));
    host.querySelectorAll('[data-cm-restore]').forEach(b=>b.onclick=()=>restoreStored(b.dataset.cmRestore));
  }

  function toggleAccountDetails(key){
    state.expandedAccountKey=state.expandedAccountKey===key?'':key;
    render();
    setTimeout(()=>{
      const button=[...document.querySelectorAll('[data-cm-toggle-account]')].find((x)=>x.dataset.cmToggleAccount===key);
      if(button&&state.expandedAccountKey===key)button.closest('.cm-ledger-account')?.scrollIntoView({block:'nearest',behavior:'smooth'});
    },0);
  }

  function toggleAccountSecret(index){
    const a=state.accountVisible[index];if(!a?.clave)return;
    if(state.revealedAccounts.has(a.key))state.revealedAccounts.delete(a.key);else state.revealedAccounts.add(a.key);
    render();
  }

  async function copyText(value,label){
    if(!value)return setStatus(`No hay ${label} para copiar.`,'error');
    try{
      if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(String(value));
      else{
        const area=document.createElement('textarea');area.value=String(value);area.style.position='fixed';area.style.opacity='0';document.body.appendChild(area);area.select();document.execCommand('copy');area.remove();
      }
      setStatus(`✅ ${label} copiado.`,'good');
    }catch(_){setStatus(`No se pudo copiar ${label}. Mantenga presionado sobre el dato para copiarlo.`,'error');}
  }

  function copyAccountValue(index,type){
    const a=state.accountVisible[index];if(!a)return;
    return copyText(type==='password'?a.clave:a.email,type==='password'?'Clave':'Correo');
  }

  function openAuditAccount(index){
    const a=state.accountVisible[index];if(!a)return;
    openAccount({inventoryAccount:a.email,liveAccount:a.email,platform:a.platform});
  }

  function openAuditClient(pointer){
    const [ai,ri]=String(pointer||'').split(':').map(Number);
    const r=state.accountVisible[ai]?.roster?.[ri];if(!r)return;
    openClient(r.service||{name:r.name,phone:r.phone});
  }

  function auditRoster(pointer){
    const [ai,ri]=String(pointer||'').split(':').map(Number);
    const account=state.accountVisible[ai]||null;
    return {account,row:account?.roster?.[ri]||null,accountIndex:ai,rowIndex:ri};
  }

  function mutationMessage(text,type='good'){
    state.status=text;state.statusType=type;
    try{if(typeof window.mostrarToast==='function')window.mostrarToast(text);}catch(_){}
  }

  function restoreExcelDeleteButton(holder){
    const original=holder?._cmOriginalButton;
    if(holder?.isConnected&&original)holder.replaceWith(original);
  }

  function setExcelDeleteInline(holder,text,tone='working'){
    if(!holder?.isConnected)return;
    holder.className=`cm-excel-delete-confirm ${tone}`;
    holder.innerHTML=`<b>${esc(text)}</b>`;
  }

  function askDeleteExcelBackupRow(button,pointer,historicalItem=null){
    if(!button?.isConnected||state.busy)return;
    const holder=document.createElement('span');
    holder.className='cm-excel-delete-confirm';
    holder._cmOriginalButton=button;
    holder._cmView=captureControlView();
    holder.innerHTML='<b>¿Borrar del Excel?</b><button type="button" class="cm-excel-delete-cancel">Cancelar</button><button type="button" class="cm-excel-delete-ok">Sí, borrar</button>';
    button.replaceWith(holder);
    holder.querySelector('.cm-excel-delete-cancel').onclick=(event)=>{event.stopPropagation();restoreExcelDeleteButton(holder);};
    holder.querySelector('.cm-excel-delete-ok').onclick=async(event)=>{
      event.stopPropagation();
      setExcelDeleteInline(holder,'⏳ Borrando del Excel…');
      const result=await deleteExcelBackupRow(pointer,historicalItem,holder);
      if(result.ok||!holder.isConnected)return;
      holder.className='cm-excel-delete-confirm error';
      holder.innerHTML=`<b>⚠️ ${esc(result.message||'No se pudo borrar.')}</b><button type="button" class="cm-excel-delete-back">Volver</button>`;
      holder.querySelector('.cm-excel-delete-back').onclick=(e)=>{e.stopPropagation();restoreExcelDeleteButton(holder);};
    };
  }

  async function reloadControlAfterMutation(message,preferredKey=''){
    let reloadWarning='';
    try{if(typeof window.sublichatControlReload==='function')await window.sublichatControlReload();}
    catch(_){reloadWarning=' La operación sí se guardó; presione “Actualizar base” para verla.';}
    state.accountAudit=null;
    state.expandedAccountKey=preferredKey;
    mutationMessage(message+reloadWarning,'good');
  }

  function editAuditService(pointer){
    const {account,row}=auditRoster(pointer);if(!account||!row?.service)return;
    const raw=row.service;
    const serviceIndex=Number.isInteger(Number(raw.servicioIndex))?Number(raw.servicioIndex):null;
    const service={...raw,srvIndex:serviceIndex,plataformaRaw:raw.plataforma||account.family,plataforma:raw.plataformaLabel||account.platform,fechaRaw:raw.fecha||'',fecha:dateValue(raw.fecha),pin:raw.clave||'',clave:raw.clave||'',pinPerfil:raw.pinPerfil||'',perfil:raw.perfil||row.profile||''};
    const titular=raw.titular||raw._titular||raw.nombre||row.name||'';
    const group={clienteId:raw.clienteId||'',nombre:titular,telefono:raw.telefono||row.phone||'',vendedor:raw.vendedor||'',nombreNorm:norm(titular),servicios:[service]};
    if(typeof window.abrirEntregaFicha==='function')window.abrirEntregaFicha(group,{servicioIndex:serviceIndex});
    else openAuditClient(pointer);
  }

  async function deleteAuditService(pointer){
    const {account,row}=auditRoster(pointer);if(!account||!row?.service||state.busy)return;
    const service=row.service;
    const platform=service.plataformaLabel||account.platform;
    const multiperfil=Number(service.cantidadPerfiles||0)>1;
    if(!confirm(multiperfil
      ?`¿Quitar solamente este perfil de la compra?\n\nPerfil: ${row.name||'Sin nombre'}\nServicio: ${platform}\nCuenta: ${account.email||'Sin correo'}\n\nLa compra, su precio y los demás perfiles se conservarán. También se liberará este cupo en Bodega.`
      :`¿Eliminar este servicio de Firebase?\n\nCliente: ${row.name||'Sin nombre'}\nServicio: ${platform}\nCuenta: ${account.email||'Sin correo'}\n\nSe eliminará solo este servicio y se liberará su cupo en Bodega. Los demás servicios del cliente se conservan.`))return;
    state.busy=true;mutationMessage('Eliminando servicio…','');render();
    try{
      const out=await api({accion:multiperfil?'eliminar_perfil':'eliminar',clienteId:service.clienteId||'',clienteNorm:norm(service.titular||service.nombre||row.name),telefono:service.telefono||row.phone||'',plataforma:service.plataforma||account.family,correo:multiperfil?'':(service.correo||account.email||''),servicioIndex:Number.isInteger(Number(service.servicioIndex))?Number(service.servicioIndex):null,perfilIndex:Number.isInteger(Number(service.perfilIndex))?Number(service.perfilIndex):null,perfilId:service.perfilId||''},RENEW_API);
      const extra=out.inventario?.tocado?` Cupo liberado: ${out.inventario.disponibles} disponible${out.inventario.disponibles===1?'':'s'}.`:'';
      await reloadControlAfterMutation(multiperfil?`✅ Perfil ${row.name} retirado de la compra ${platform}.${extra}`:`✅ ${row.name}: servicio ${platform} eliminado.${extra}`,account.key);
    }catch(e){const text='⚠️ '+(e.message||'No se pudo eliminar el servicio.');mutationMessage(text,'error');alert(text);}
    finally{state.busy=false;render();}
  }

  async function deleteExcelBackupRow(pointer,historicalItem=null,feedbackHost=null){
    let account,row;
    if(historicalItem){
      account={key:`${auditFamily(historicalItem.platform)}|${email(historicalItem.excelAccount)}`,email:historicalItem.excelAccount||''};
      row={name:historicalItem.name||'Sin nombre',excel:historicalItem.row||null,service:null,inv:null};
    }else{
      ({account,row}=auditRoster(pointer));
    }
    if(!account||!row?.excel||row.service||row.inv||state.busy)return {ok:false,message:'Este registro ya no está disponible.'};
    const excel=row.excel;
    const sheetName=String(excel.sheet||'').trim();
    const rowNumber=Number(excel.row);
    if(!sheetName||!Number.isInteger(rowNumber)||rowNumber<1){
      return {ok:false,message:'No pude identificar la fila. Actualice los datos.'};
    }
    const view=feedbackHost?._cmView||captureControlView();
    state.busy=true;mutationMessage('Borrando la fila histórica del respaldo Excel…','');
    try{
      if(!window.ExcelJS)throw new Error('No cargó el lector de Excel. Recargue la página.');
      const originalBase64=await loadTemplateBase64(false);
      const workbook=new ExcelJS.Workbook();
      await workbook.xlsx.load(base64ToBuffer(originalBase64));
      const ws=workbook.getWorksheet(sheetName);
      if(!ws)throw new Error(`No encontré la hoja ${sheetName}.`);
      const header=findHeader(ws);
      if(!header||rowNumber<=header.row)throw new Error('La fila ya no coincide con el listado revisado. Presione “Actualizar base”.');
      const excelRow=ws.getRow(rowNumber);
      const clientColumns=[header.name,header.seller,header.phone,header.profile,header.pin,header.price,header.expiry,header.alert,header.days].filter((v,i,a)=>v&&a.indexOf(v)===i);
      if(!clientColumns.length)throw new Error('No encontré las columnas del cliente en esa hoja.');
      clientColumns.forEach((column)=>{
        const cell=excelRow.getCell(column);cell.value=null;
        try{cell.note=undefined;}catch(_){}
      });

      // El archivo histórico trae miles de reglas de color dañadas. ExcelJS puede
      // abrirlo, pero falla al guardarlo con “reading '0'”. Se sustituyen por las
      // alertas válidas de vencimiento antes de escribir la nueva plantilla.
      const repairedAnalysis=parseWorkbook(workbook,{servicios:[],cuentas:[]});
      rebuildConditionalFormatting(repairedAnalysis);

      let backupCreated=false;
      try{
        const before=await api({accion:'control_guardar_respaldo',filename:`ANTES-DE-BORRAR-${state.meta?.plantilla?.filename||'Sublicuentas.xlsx'}`,size:base64ToBuffer(originalBase64).byteLength,mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',base64:originalBase64,motivo:'antes_eliminar_fila_excel',metricas:state.analysis?.metrics||{}});
        backupCreated=!before.skipped;
      }catch(_){}

      const buffer=await workbook.xlsx.writeBuffer();
      const base64=bufferToBase64(buffer);
      const filename=state.meta?.plantilla?.filename||'Sublicuentas.xlsx';
      await api({accion:'control_guardar_plantilla',filename,size:buffer.byteLength,mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',base64,motivo:'eliminar_fila_solo_excel',metricas:state.analysis?.metrics||{}});
      state.templateBase64=base64;state.analysis=null;state.accountAudit=null;
      let reloadWarning='';
      try{await refreshMeta();await analyze(true);}
      catch(_){reloadWarning=' La eliminación sí se guardó; presione “Actualizar base” para refrescar la vista.';}
      state.expandedAccountKey=account.key;
      mutationMessage(`✅ ${row.name||'El registro'} fue borrado únicamente del respaldo Excel.${backupCreated?' Se guardó una copia anterior para recuperación.':''}${reloadWarning}`,'good');
      state.busy=false;
      render();restoreControlView(view);
      return {ok:true};
    }catch(e){
      const detail=String(e?.message||'No se pudo guardar el archivo.');
      console.error('[Control Maestro] No se pudo borrar del Excel:',e);
      mutationMessage(`⚠️ No se pudo borrar del Excel: ${detail}`,'error');
      state.busy=false;
      return {ok:false,message:detail};
    }
  }

  async function removeAuditAssignment(pointer){
    const {account,row}=auditRoster(pointer);if(!account||!row?.inv||state.busy)return;
    const docId=String(row.inv._accountId||'');if(!docId)return alert('Esta asignación no tiene ID de Bodega. Abra la cuenta para corregirla.');
    if(!confirm(`¿Sacar a ${row.name||'este cliente'} de esta cuenta?\n\nCuenta: ${account.email||'Sin correo'}\nPlataforma: ${account.platform}\n\nEsto solo quita la asignación de Bodega. Si el servicio sigue activo en Clientes, no se elimina.`))return;
    state.busy=true;mutationMessage('Quitando asignación de Bodega…','');render();
    try{
      await api({accion:'quitarCliente',docId,clienteIndex:row.invIndex,nombreCliente:row.inv.nombre||row.name||'',slot:fieldText(row.inv.slot)||row.profile||''},INVENTORY_API);
      await reloadControlAfterMutation(`✅ ${row.name} fue retirado de la cuenta ${account.email}.`,account.key);
    }catch(e){const text='⚠️ '+(e.message||'No se pudo quitar la asignación.');mutationMessage(text,'error');alert(text);}
    finally{state.busy=false;render();}
  }

  // ⚠️ FIX: cuando un cliente está asignado en Bodega pero no tiene un servicio
  // vivo en Clientes (caso "Solo en Bodega" / "Duplicado"), antes no había forma
  // de corregir su nombre, PIN o teléfono ahí mismo — solo se podía "Sacar". Esto
  // edita directamente el registro dentro de Bodega (no depende de que exista un
  // servicio en Clientes), y sí queda guardado en Firebase de inmediato.
  async function editAuditInventoryClient(pointer){
    const {account,row}=auditRoster(pointer);if(!account||!row?.inv||state.busy)return;
    const docId=String(row.inv._accountId||'');if(!docId)return alert('Esta asignación no tiene ID de Bodega. Abra la cuenta para corregirla.');
    const newName=prompt('Nombre del cliente en esta cuenta:',row.name||row.inv.nombre||'');if(newName===null)return;
    if(!String(newName).trim())return alert('El nombre no puede quedar vacío.');
    const newPin=prompt('PIN de este perfil:',row.pin||fieldText(row.inv.pin)||'');if(newPin===null)return;
    const newPhone=prompt('Teléfono del cliente:',row.phone||fieldText(row.inv.telefono)||'');if(newPhone===null)return;
    state.busy=true;mutationMessage('Actualizando cliente en Bodega…','');render();
    try{
      await api({accion:'editarCliente',docId,clienteIndex:row.invIndex,nombreCliente:row.inv.nombre||row.name||'',slot:fieldText(row.inv.slot)||row.profile||'',nuevoNombre:String(newName).trim(),nuevoPin:String(newPin).trim(),nuevoTelefono:String(newPhone).trim()},INVENTORY_API);
      await reloadControlAfterMutation(`✅ ${String(newName).trim()} actualizado en Bodega.`,account.key);
    }catch(e){const text='⚠️ '+(e.message||'No se pudo editar el cliente en Bodega.');mutationMessage(text,'error');alert(text);}
    finally{state.busy=false;render();}
  }

  async function editAuditAccount(index){
    const account=state.accountVisible[index];if(!account||state.busy)return;
    const ids=account.accountIds.filter(Boolean);
    if(ids.length!==1)return alert('Esta cuenta está duplicada en Bodega. Ábrala en Bodega y corrija primero el duplicado.');
    const newEmail=prompt('Correo o usuario de la cuenta:',account.email||'');if(newEmail===null)return;
    if(!String(newEmail).trim())return alert('El correo no puede quedar vacío.');
    const newPassword=prompt('Clave de la cuenta:',account.clave||'');if(newPassword===null)return;
    const capacityRaw=prompt('Capacidad total de clientes/perfiles:',String(account.capacity||1));if(capacityRaw===null)return;
    const capacity=Math.max(1,Math.round(Number(capacityRaw)||0));
    if(capacity<account.invClients.length)return alert(`La capacidad no puede ser menor que los ${account.invClients.length} clientes asignados.`);
    if(!confirm(`¿Guardar estos cambios?\n\nPlataforma: ${account.platform}\nCorreo: ${String(newEmail).trim()}\nClave: ${newPassword||'Sin clave'}\nCapacidad: ${capacity}\n\nEl nuevo correo y clave también se actualizarán en los servicios ligados.`))return;
    state.busy=true;mutationMessage('Actualizando cuenta y servicios ligados…','');render();
    try{
      const out=await api({accion:'editarCuenta',docId:ids[0],correo:String(newEmail).trim(),clave:String(newPassword),capacidad:capacity},INVENTORY_API);
      const newKey=`${account.family}|${email(newEmail)}`;
      await reloadControlAfterMutation(`✅ Cuenta actualizada.${out.serviciosActualizados?` ${out.serviciosActualizados} servicio${out.serviciosActualizados===1?'':'s'} sincronizado${out.serviciosActualizados===1?'':'s'}.`:''}`,newKey);
    }catch(e){const text='⚠️ '+(e.message||'No se pudo editar la cuenta.');mutationMessage(text,'error');alert(text);}
    finally{state.busy=false;render();}
  }

  async function deleteAuditAccount(index){
    const account=state.accountVisible[index];if(!account||state.busy)return;
    const ids=account.accountIds.filter(Boolean);
    if(ids.length!==1)return alert('Esta cuenta no puede eliminarse desde aquí porque está duplicada o no existe en Bodega.');
    if(account.invClients.length)return alert(`Esta cuenta todavía tiene ${account.invClients.length} cliente${account.invClients.length===1?'':'s'} asignado${account.invClients.length===1?'':'s'}. Use “Sacar” o “Eliminar” en cada fila primero.`);
    if(account.services.length)return alert(`Esta cuenta todavía tiene ${account.services.length} servicio${account.services.length===1?'':'s'} activo${account.services.length===1?'':'s'} en Clientes. Elimínelos o edítelos primero.`);
    if(!confirm(`¿Eliminar definitivamente esta cuenta de Bodega?\n\n${account.platform}\n${account.email}\n\nEl correo ya está vacío. Esta acción no se puede deshacer.`))return;
    state.busy=true;mutationMessage('Eliminando cuenta vacía…','');render();
    try{
      await api({accion:'eliminarCuenta',docId:ids[0],confirmarCorreo:account.email},INVENTORY_API);
      await reloadControlAfterMutation(`✅ Cuenta ${account.email} eliminada de Bodega.`,'');
    }catch(e){const text='⚠️ '+(e.message||'No se pudo eliminar la cuenta.');mutationMessage(text,'error');alert(text);}
    finally{state.busy=false;render();}
  }

  function accountByKey(key){
    const wanted=String(key||'');
    return state.accountVisible.find((a)=>String(a.key||'')===wanted)||(state.accountAudit?.accounts||[]).find((a)=>String(a.key||'')===wanted)||null;
  }

  function mergeAccountRevision(revision){
    if(!revision)return;
    const revisionKey=String(revision.accountKey||`${auditFamily(revision.plataforma)}|${email(revision.correo)}`);
    const anteriores=Array.isArray(state.meta?.revisiones)?state.meta.revisiones:[];
    state.meta={...(state.meta||{}),revisiones:[revision,...anteriores.filter((r)=>String(r.accountKey||`${auditFamily(r.plataforma)}|${email(r.correo)}`)!==revisionKey)]};
    state.accountAudit=null;
  }

  async function saveAccountReview(accountKey,result){
    const a=accountByKey(accountKey);if(!a||state.busy)return;
    if(!a.email)return setStatus('Esta cuenta no tiene correo; corríjala primero en Bodega.','error');
    let nota='';
    if(result==='incidencia'){
      nota=prompt('Escriba qué encontró en la cuenta (por ejemplo: “hay un perfil extra llamado Juan”):','')??'';
      if(!String(nota).trim())return;
    }
    state.busy=true;state.reviewSavingKey=a.key;
    state.accountFeedback={key:a.key,type:'saving',text:result==='incidencia'?'Guardando incidencia en Firebase…':'Guardando revisión en Firebase…'};
    state.status=state.accountFeedback.text;state.statusType='';render();
    try{
      const saved=await api({accion:'control_guardar_revision_cuenta',accountId:a.accountIds.filter(Boolean).join(','),plataforma:a.family,correo:a.email,resultado:result,nota,clientesEsperados:a.roster.length,diferencias:a.internalIssueCount});
      if(!saved.revision)throw new Error('Firebase respondió sin confirmar la revisión.');
      mergeAccountRevision(saved.revision);
      const text=result==='incidencia'?'⚠️ Incidencia guardada en Firebase.':'✅ Revisión del proveedor guardada en Firebase. Las diferencias de Excel o Bodega seguirán visibles hasta corregirlas; esta revisión volverá a solicitarse dentro de 15 días.';
      state.accountFeedback={key:a.key,type:result==='incidencia'?'err':'good',text};state.status=text;state.statusType='good';
    }catch(e){
      const text='⚠️ '+(e.message||'No se pudo guardar la revisión.');
      state.accountFeedback={key:a.key,type:'err',text};state.status=text;state.statusType='error';
    }finally{state.busy=false;state.reviewSavingKey='';render();}
  }

  async function refreshMeta(){
    state.loading=true;render();
    try{state.meta=await api({accion:'control_estado'});state.accountAudit=null;state.status='';state.statusType='';}
    catch(e){state.status=e.message||'No se pudo cargar Control Maestro.';state.statusType='error';}
    finally{state.loading=false;render();}
  }

  async function uploadTemplate(file){
    if(!file)return;
    if(!/\.xlsx$/i.test(file.name)){setStatus('Use su archivo Excel en formato .xlsx.','error');return;}
    state.busy=true;setStatus('Validando y guardando la plantilla privada…','');
    try{
      const buffer=await file.arrayBuffer();
      if(!window.ExcelJS)throw new Error('No cargó el lector de Excel.');
      const test=new ExcelJS.Workbook();await test.xlsx.load(buffer);
      if(!test.worksheets.length)throw new Error('El Excel no contiene hojas.');
      const j=await api({accion:'control_guardar_plantilla',filename:file.name,size:file.size,mime:file.type,base64:bufferToBase64(buffer),motivo:state.meta?.plantilla?'reemplazo_plantilla':'carga_inicial'});
      state.templateBase64=bufferToBase64(buffer);state.analysis=null;state.accountAudit=null;
      await refreshMeta();
      setStatus(`✅ Plantilla guardada: ${j.archivo?.filename||file.name}. Ahora revisando clientes…`,'good');
      setTimeout(()=>runReview(false),80);
    }catch(e){setStatus('⚠️ '+(e.message||'No se pudo guardar la plantilla.'),'error');}
    finally{state.busy=false;render();}
  }

  async function runReview(force){
    if(state.busy)return;
    state.busy=true;setStatus('Comparando clientes, cuentas, inventario y fechas…','');
    try{
      await analyze(!!force);
      const m=state.analysis.metrics;
      setStatus(`✅ Revisión terminada: ${m.correctos} correctos · ${m.revision} para revisar.`,'good');
      render();
      setTimeout(()=>maybeAutoBackup(),80);
    }catch(e){setStatus('⚠️ '+(e.message||'No se pudo revisar.'),'error');}
    finally{state.busy=false;render();}
  }

  function writeService(row,item){
    const h=row.header,ws=row.ws,s=item.service;if(!s)return;
    const excelRow=ws.getRow(row.row);
    if(h.name&&s.nombre)excelRow.getCell(h.name).value=s.nombre;
    if(h.phone&&s.telefono){excelRow.getCell(h.phone).value=String(s.telefono);excelRow.getCell(h.phone).numFmt='@';}
    if(h.pin&&s.pinPerfil)excelRow.getCell(h.pin).value=String(s.pinPerfil);
    if(h.price&&Number.isFinite(Number(s.precio)))excelRow.getCell(h.price).value=Number(s.precio)||0;
    if(h.expiry&&s.fecha){const d=dateValue(s.fecha);if(d){excelRow.getCell(h.expiry).value=d;excelRow.getCell(h.expiry).numFmt='dd/mm/yyyy';}}
    if(h.profile&&s.perfil&&String(s.perfil).trim())excelRow.getCell(h.profile).value=s.perfil;
  }

  function updateAccountCredentials(analysis,src){
    const accounts=(src.cuentas||[]).map(a=>({...a,_plat:canonPlatform(a.plataforma),_email:email(a.correo)}));
    analysis.sheets.forEach((sheet)=>{
      if(!sheet.header.password)return;
      sheet.rows.filter(r=>r.directEmail).forEach((row)=>{
        const account=accounts.find(a=>a._email===row.directEmail&&sheet.platforms.includes(a._plat));
        if(account&&account.clave!=null&&String(account.clave)!=='')row.ws.getRow(row.row).getCell(sheet.header.password).value=String(account.clave);
      });
    });
  }

  function fillMissingServices(analysis){
    const used=new Set();let added=0;
    analysis.items.filter(x=>x.kind==='solo_sublichat'&&x.service&&x.service._email).forEach((item)=>{
      const s=item.service;
      const candidates=[];
      analysis.sheets.filter(sh=>sh.platforms.includes(s._plat)).forEach(sh=>sh.rows.forEach(r=>{
        if(r.blank&&r.accountEmail&&r.accountEmail===s._email&&!used.has(`${r.sheet}|${r.row}`))candidates.push(r);
      }));
      if(!candidates.length)return;
      let target=candidates[0];
      if(s.perfil){const exact=candidates.find(r=>norm(r.profile)===norm(s.perfil));if(exact)target=exact;}
      used.add(`${target.sheet}|${target.row}`);writeService(target,{service:s});
      item.detail='Se agregó automáticamente al Excel de respaldo. No se creó ni duplicó ningún dato en Firebase.';item.status='Agregado al respaldo';item.level='ok';item.currentOk=true;
      item.generatedRow=target;added++;
    });
    return added;
  }

  function removeSheet(workbook,name){const ws=workbook.getWorksheet(name);if(ws)workbook.removeWorksheet(ws.id);}

  function addReviewSheet(analysis){
    const wb=analysis.workbook;removeSheet(wb,'REVISIÓN');
    const ws=wb.addWorksheet('REVISIÓN',{views:[{state:'frozen',ySplit:3}]});
    ws.properties.defaultRowHeight=20;
    ws.mergeCells('A1:J1');ws.getCell('A1').value='CONTROL MAESTRO · REVISIÓN DE CLIENTES Y CUENTAS';
    ws.getCell('A1').font={name:'Arial',size:15,bold:true,color:{argb:'FFFFFFFF'}};ws.getCell('A1').fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF123052'}};ws.getCell('A1').alignment={vertical:'middle',horizontal:'left'};ws.getRow(1).height=30;
    ws.mergeCells('A2:J2');ws.getCell('A2').value=`Generado ${new Date().toLocaleString('es-HN')} · Corrija los casos marcados desde Sublichat y vuelva a generar.`;ws.getCell('A2').font={italic:true,color:{argb:'FF5F7082'}};
    const headers=['Estado','Cliente','Teléfono','Plataforma','Cuenta Excel','Cuenta Sublichat','Cuenta Inventario','Fecha Excel','Fecha Sublichat','Detalle'];
    ws.getRow(3).values=headers;ws.getRow(3).font={bold:true,color:{argb:'FFFFFFFF'}};ws.getRow(3).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFE2231A'}};
    const review=analysis.items.filter(x=>x.kind!=='ok'||x.generatedRow);
    review.forEach((x)=>ws.addRow([x.status,x.name,x.phone,x.platform,x.excelAccount,x.liveAccount,x.inventoryAccount,dateLabel(x.excelDate),dateLabel(x.liveDate),x.detail]));
    [16,28,15,18,34,34,34,15,15,62].forEach((width,i)=>{ws.getColumn(i+1).width=width;});
    ws.autoFilter={from:'A3',to:'J3'};
    for(let r=4;r<=ws.rowCount;r++){
      const row=ws.getRow(r);row.alignment={vertical:'top',wrapText:false};
      const status=String(row.getCell(1).value||'');
      const color=/Correcto/i.test(status)?'FFE4F6EC':(/Actualizar|Agregado/i.test(status)?'FFFFF4D6':'FFFFE5E7');
      row.getCell(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:color}};row.getCell(1).font={bold:true};
    }
    if(!review.length){ws.addRow(['Correcto','','','','','','','','','No se detectaron diferencias.']);}
  }

  function addIdSheet(analysis){
    const wb=analysis.workbook;removeSheet(wb,'__SUBLICHAT_IDS');
    const ws=wb.addWorksheet('__SUBLICHAT_IDS');ws.state='veryHidden';
    ws.addRow(['clienteId','servicioIndex','perfilIndex','perfilId','compraId','hoja','fila','plataforma','cuenta','generadoAt']);
    analysis.matched.forEach((x)=>{if(x.service&&x.row)ws.addRow([x.service.clienteId||'',x.service.servicioIndex??'',x.service.perfilIndex??'',x.service.perfilId||'',x.service.compraId||'',x.row.sheet,x.row.row,x.service._plat,x.service._email,new Date().toISOString()]);});
    analysis.items.filter(x=>x.generatedRow&&x.service).forEach((x)=>ws.addRow([x.service.clienteId||'',x.service.servicioIndex??'',x.service.perfilIndex??'',x.service.perfilId||'',x.service.compraId||'',x.generatedRow.sheet,x.generatedRow.row,x.service._plat,x.service._email,new Date().toISOString()]));
  }

  function columnLetter(number){
    let n=Number(number)||0,out='';
    while(n>0){n--;out=String.fromCharCode(65+(n%26))+out;n=Math.floor(n/26);}
    return out;
  }

  function renewalRules(daysLetter,startRow){
    const days=`$${daysLetter}${startRow}`;
    const rule=(formula,fill,font)=>({
      type:'expression',formulae:[formula],
      style:{
        fill:{type:'pattern',pattern:'solid',fgColor:{argb:fill},bgColor:{argb:fill}},
        font:{bold:true,color:{argb:font}}
      }
    });
    return [
      rule(`AND(ISNUMBER(${days}),${days}<0)`,'FFFFE5E7','FFB4232E'),
      rule(`AND(ISNUMBER(${days}),${days}=0)`,'FFFFE8CC','FF9A4B00'),
      rule(`AND(ISNUMBER(${days}),${days}>0,${days}<4)`,'FFFFF4D6','FF8A6700'),
      rule(`AND(ISNUMBER(${days}),${days}>=4)`,'FFE4F6EC','FF176B45')
    ];
  }

  function rebuildConditionalFormatting(analysis){
    const workbook=analysis.workbook;
    // La plantilla histórica contiene miles de reglas duplicadas y varias con #REF!.
    // ExcelJS no puede volver a escribirlas; se sustituyen por un conjunto pequeño y válido.
    workbook.worksheets.forEach((ws)=>{ws.conditionalFormattings=[];});
    analysis.sheets.forEach((sheet)=>{
      const h=sheet.header;if(!h.days)return;
      const start=h.row+1,end=Math.max(start,Math.min(sheet.ws.rowCount||start,2200));
      const daysLetter=columnLetter(h.days);if(!daysLetter)return;
      const targetColumns=[h.alert,h.days].filter(Boolean);
      targetColumns.forEach((col)=>{
        const letter=columnLetter(col);if(!letter)return;
        sheet.ws.addConditionalFormatting({ref:`${letter}${start}:${letter}${end}`,rules:renewalRules(daysLetter,start)});
      });
    });
  }

  async function buildUpdatedWorkbook(){
    const raw=await loadTemplateBase64(false);
    const wb=new ExcelJS.Workbook();await wb.xlsx.load(base64ToBuffer(raw));
    wb.calcProperties.fullCalcOnLoad=true;
    const src=source();
    const analysis=parseWorkbook(wb,src);
    analysis.matched.forEach((item)=>writeService(item.row,item));
    fillMissingServices(analysis);updateAccountCredentials(analysis,src);addReviewSheet(analysis);addIdSheet(analysis);rebuildConditionalFormatting(analysis);
    const buffer=await wb.xlsx.writeBuffer();
    return {buffer,analysis,filename:`Sublicuentas_actual_${fileDate()}.xlsx`};
  }

  async function generate(options){
    if(state.busy)return;
    if(!state.analysis){await runReview(false);if(!state.analysis)return;}
    state.busy=true;setStatus('Generando el Excel con el mismo formato y la hoja de revisión…','');
    try{
      const out=await buildUpdatedWorkbook();
      if(options.save){
        const j=await api({accion:'control_guardar_respaldo',filename:out.filename,size:out.buffer.byteLength,mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',base64:bufferToBase64(out.buffer),motivo:options.auto?'automatico':'manual',metricas:out.analysis.metrics});
        const finalMessage=j.skipped?'✅ Excel generado. Ya existen los 2 respaldos permitidos de hoy.':'✅ Excel generado y respaldo privado guardado.';
        await refreshMeta();
        setStatus(finalMessage,'good');
      }else setStatus('✅ Excel generado correctamente.','good');
      if(options.download)saveBuffer(out.buffer,out.filename);
      state.analysis=out.analysis;state.accountAudit=null;render();
      return true;
    }catch(e){setStatus('⚠️ '+(e.message||'No se pudo generar el Excel.'),'error');return false;}
    finally{state.busy=false;render();}
  }

  async function downloadStored(id){
    if(!id)return;state.busy=true;setStatus('Preparando descarga…','');
    try{const j=await api({accion:'control_leer_archivo',id});const buffer=base64ToBuffer(j.base64);saveBuffer(buffer,j.archivo?.filename||'Sublicuentas.xlsx');setStatus('✅ Descarga preparada.','good');}
    catch(e){setStatus('⚠️ '+(e.message||'No se pudo descargar.'),'error');}
    finally{state.busy=false;render();}
  }

  async function restoreStored(id){
    if(!id||!confirm('¿Usar este respaldo como nueva plantilla base? La plantilla actual no se elimina y seguirá en el historial.'))return;
    state.busy=true;setStatus('Restaurando plantilla…','');
    try{await api({accion:'control_restaurar_plantilla',id});state.templateBase64='';state.analysis=null;state.accountAudit=null;await refreshMeta();setStatus('✅ Respaldo restaurado como plantilla.','good');setTimeout(()=>runReview(true),80);}
    catch(e){setStatus('⚠️ '+(e.message||'No se pudo restaurar.'),'error');}
    finally{state.busy=false;render();}
  }

  function openClient(item){
    if(!item)return;window.subliRBAC?.go?.('clientes');
    setTimeout(()=>{const q=document.getElementById('q');if(q){q.value=item.name||item.phone||'';q.dispatchEvent(new Event('input',{bubbles:true}));q.focus();}},180);
  }

  function openAccount(item){
    if(!item)return;window.subliRBAC?.go?.('inventario');
    setTimeout(()=>{const q=document.getElementById('invQ');if(q){q.value=item.inventoryAccount||item.liveAccount||item.excelAccount||item.platform||'';q.dispatchEvent(new Event('input',{bubbles:true}));q.focus();}},180);
  }

  function syncFullscreenButton(){
    const screen=document.getElementById('screen-control-cuentas');
    const button=root()?.querySelector?.('[data-cm-action="toggle-fullscreen"]');
    if(!button)return;
    const active=document.fullscreenElement===screen||screen?.classList.contains('cm-control-expanded');
    button.textContent=active?'↙️ Salir de pantalla completa':'⛶ Pantalla completa';
    button.setAttribute?.('aria-pressed',String(!!active));
  }

  function closeControlExpanded(){
    const screen=document.getElementById('screen-control-cuentas');if(!screen)return;
    if(!screen.classList.contains('cm-control-expanded'))return;
    screen.classList.remove('cm-control-expanded');document.body.classList.remove('cm-control-no-scroll');
    syncFullscreenButton();
    requestAnimationFrame(()=>{
      try{window.scrollTo({left:0,top:state.fullscreenReturnY||0,behavior:'instant'});}
      catch(_){window.scrollTo(0,state.fullscreenReturnY||0);}
    });
  }

  async function toggleFullscreen(){
    const screen=document.getElementById('screen-control-cuentas');if(!screen)return;
    if(document.fullscreenElement===screen){
      try{await document.exitFullscreen();}catch(e){setStatus('No se pudo salir de pantalla completa. Presione ESC.','error');}
      syncFullscreenButton();return;
    }
    if(screen.classList.contains('cm-control-expanded'))return closeControlExpanded();
    state.fullscreenReturnY=window.scrollY||0;
    if(document.fullscreenElement){try{await document.exitFullscreen();}catch(_){} }
    if(typeof screen.requestFullscreen==='function'){
      try{
        await screen.requestFullscreen();
        screen.scrollTop=0;syncFullscreenButton();return;
      }catch(e){console.warn('[Control Maestro] El navegador rechazó pantalla completa nativa; se usará la vista ampliada.',e);}
    }
    // Respaldo para navegadores que no ofrecen Fullscreen API.
    screen.classList.add('cm-control-expanded');document.body.classList.add('cm-control-no-scroll');
    screen.scrollTop=0;syncFullscreenButton();
  }

  async function refreshControlData(){
    if(state.busy||state.refreshing)return;
    if(typeof window.sublichatControlReload!=='function')return setStatus('No encontré la conexión para actualizar Firebase.','error');
    const view=captureControlView();
    state.busy=true;state.refreshing=true;state.status='Leyendo cambios nuevos de Clientes y Bodega…';state.statusType='';
    render();restoreControlView(view);
    try{
      const summary=await window.sublichatControlReload();
      let metaWarning='';
      try{state.meta=await api({accion:'control_estado'});}
      catch(_){metaWarning=' No se pudo renovar el historial de revisiones, pero Clientes y Bodega sí se actualizaron.';}
      let excelWarning='';
      if(state.meta?.plantilla&&window.ExcelJS){
        try{await analyze(false);}
        catch(_){state.analysis=null;excelWarning=' El cruce histórico con Excel queda pendiente hasta presionar “Revisar ahora”.';}
      }else state.accountAudit=null;
      state.accountAudit=null;
      const fresh=source();
      state.lastRefreshAt=new Date().toISOString();
      const serviceCount=Number(summary?.servicios??fresh.servicios.length)||0;
      const accountCount=Number(summary?.cuentas??fresh.cuentas.length)||0;
      state.status=`✅ Datos actualizados desde Firebase: ${serviceCount} servicios · ${accountCount} cuentas.${metaWarning}${excelWarning}`;
      state.statusType='good';
      try{if(typeof window.mostrarToast==='function')window.mostrarToast('✅ Control Maestro actualizado sin perder su lugar.');}catch(_){}
    }catch(e){
      state.status='⚠️ '+(e.message||'No se pudo actualizar Firebase. Su vista se conservó para volver a intentarlo.');
      state.statusType='error';
      try{if(typeof window.mostrarToast==='function')window.mostrarToast(state.status);}catch(_){}
    }finally{
      state.busy=false;state.refreshing=false;render();restoreControlView(view);
    }
  }

  async function handleAction(action){
    if(action==='toggle-fullscreen')return toggleFullscreen();
    if(action==='show-all-accounts'){state.accountLimit=Number.MAX_SAFE_INTEGER;render();return;}
    if(action==='review')return runReview(true);
    if(action==='refresh-data')return refreshControlData();
    if(action==='download-template')return downloadStored(state.meta?.plantilla?.id);
    if(action==='generate-download')return generate({save:true,download:true});
    if(action==='save-backup')return generate({save:true,download:false});
  }

  async function maybeAutoBackup(){
    if(state.autoTried||!state.analysis||!state.meta?.plantilla)return;
    state.autoTried=true;
    const key=`sublichat_control_auto_${serverDateKey()}`;
    if(localStorage.getItem(key))return;
    const today=(state.meta.respaldos||[]).filter(x=>x.dateKey===serverDateKey()).length;
    if(today>=(state.meta.dailyLimit||2)){localStorage.setItem(key,'limite');return;}
    localStorage.setItem(key,'intentando');
    const ok=await generate({save:true,download:false,auto:true});
    if(ok)localStorage.setItem(key,'guardado');else localStorage.removeItem(key);
  }

  async function boot(){
    if(!isAdmin()||!root())return;
    if(!state.booted){state.booted=true;await refreshMeta();}
    else{state.accountAudit=null;render();}
    if(state.meta?.plantilla&&!state.analysis&&!state.busy)runReview(false);
  }

  window.sublichatControlSyncLoadedData=(message)=>{
    const view=captureControlView();
    state.accountAudit=null;state.accountFeedback=null;
    state.status=message||'✅ Cambio guardado. Control Maestro ya muestra los datos nuevos.';state.statusType='good';
    if(screenActive()&&root()){render();restoreControlView(view);}
  };

  function install(){
    if(state.installed)return;state.installed=true;
    document.addEventListener('click',(ev)=>{if(ev.target?.closest?.('[data-screen="control-cuentas"]'))setTimeout(boot,90);},true);
    const observer=new MutationObserver(()=>{if(screenActive()&&!state.loading)boot();});
    const screen=document.getElementById('screen-control-cuentas');if(screen)observer.observe(screen,{attributes:true,attributeFilter:['class']});
    document.addEventListener('fullscreenchange',()=>{
      if(!screen)return;
      if(document.fullscreenElement===screen){
        screen.classList.remove('cm-control-expanded');document.body.classList.remove('cm-control-no-scroll');
        requestAnimationFrame(()=>{screen.scrollTop=0;syncFullscreenButton();});
      }else syncFullscreenButton();
    });
    document.addEventListener('keydown',(event)=>{if(event.key==='Escape'&&screen?.classList.contains('cm-control-expanded')){event.preventDefault();closeControlExpanded();}},true);
    if(screenActive())boot();
  }

  let tries=0;
  const timer=setInterval(()=>{
    tries++;
    if(document.getElementById('screen-control-cuentas')&&window.subliRBAC){clearInterval(timer);install();}
    else if(tries>120)clearInterval(timer);
  },100);
  if(document.readyState==='complete'||document.readyState==='interactive')setTimeout(()=>{if(document.getElementById('screen-control-cuentas'))install();},200);
})();
