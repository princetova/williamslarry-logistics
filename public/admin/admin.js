'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const statuses = ['Registered', 'Picked up', 'In transit', 'Arrived at destination', 'Out for delivery', 'Delivered', 'Delayed', 'Cancelled', 'Returned'];
  const terminal = new Set(['Delivered', 'Cancelled', 'Returned']);
  const transitions = {
    Registered: ['Picked up', 'Cancelled'],
    'Picked up': ['In transit', 'Delayed', 'Cancelled', 'Returned'],
    'In transit': ['Arrived at destination', 'Delayed', 'Cancelled', 'Returned'],
    'Arrived at destination': ['Out for delivery', 'Delayed', 'Returned'],
    'Out for delivery': ['Delivered', 'Delayed', 'Returned'],
    Delivered: ['Returned'],
    Delayed: ['In transit', 'Arrived at destination', 'Out for delivery', 'Cancelled', 'Returned'],
    Cancelled: [], Returned: []
  };
  const viewLabels = {overview:'Overview', shipments:'Shipments', create:'New shipment', dispatch:'Dispatch centre', issues:'Delivery issues', staff:'Staff management', audit:'Activity logs', detail:'Shipment details', 'issue-detail':'Issue report'};
  const refPattern = /^WLL-[0-9A-HJKMNP-TV-Z]{16}$/;
  const st = {
    view: 'overview', run: 0, user: null, mutating: false, locked: false,
    shipmentRef: '', issueId: '', selectedStaff: null,
    list: {page:1, limit:25, total:0, filters:{}},
    dispatch: {page:1, limit:12, total:0, filters:{assignment:'unassigned'}},
    workers: {page:1, limit:8, total:0, filters:{}},
    issues: {page:1, limit:12, total:0, filters:{state:'open'}},
    staff: {page:1, limit:10, total:0, filters:{}},
    audit: {page:1, limit:25, total:0, filters:{}}
  };
  const owner = () => st.user?.role === 'Owner';
  const node = (tag, cls='', value) => {const n = document.createElement(tag); if (cls) n.className = cls; if (value !== undefined && value !== null) n.textContent = String(value); return n;};
  const btn = (label, fn, cls='action secondary sm') => {const n=node('button',cls,label);n.type='button';n.addEventListener('click',fn);return n;};
  const statBadge = v => node('span','status-badge '+String(v||'').toLowerCase().replace(/[^a-z]+/g,'-'),v||'Unknown');
  const tag = (value, cls='') => node('span','tag '+cls,value);
  const formValues = form => Object.fromEntries([...new FormData(form)].map(([k,v])=>[k,String(v).trim()]).filter(([,v])=>v!==''));
  const initials = text => String(text||'WL').trim().split(/\s+/).slice(0,2).map(x=>x.charAt(0)).join('').toUpperCase()||'WL';
  const num = v => Number.isFinite(+v)?Number(v).toLocaleString('en-NG'):'—';
  const date = v => {if(!v)return '—';const raw=String(v),d=new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw)?raw+'T12:00:00Z':raw);if(Number.isNaN(+d))return '—';return new Intl.DateTimeFormat('en-NG',{timeZone:'Africa/Lagos',day:'numeric',month:'short',year:'numeric',...(/^\d{4}-\d{2}-\d{2}$/.test(raw)?{}:{hour:'2-digit',minute:'2-digit'})}).format(d);};
  const message = (text, error=false) => {const box=$('notice');box.textContent=text||'';box.classList.toggle('error',error);box.hidden=!text;if(text)box.scrollIntoView({block:'nearest'});};
  const empty = (id, text) => {const target=typeof id==='string'?$(id):id;if(target)target.replaceChildren(node('div','empty-state',text));};
  const loading = (id, text='Loading…') => {const target=typeof id==='string'?$(id):id;if(target)target.replaceChildren(node('div','loading-state',text));};
  function restrictView(view){return (view==='staff'||view==='audit')&&!owner();}
  function wipePrivate(){
    for(const id of ['recent','shipment-table','dispatch-table','worker-list','issue-list','staff-list','audit-table','detail-content','issue-detail-content','distribution','workload'])empty(id,'Sign in again to view operational data.');
    for(const id of ['total','active','delivered','unassigned','pending','issues','week']) {const n=$('stat-'+id);if(n)n.textContent='—';}
    for(const id of ['watch-unassigned','watch-pending','watch-issues','dispatch-unassigned','dispatch-pending','dispatch-workers'])$(id).textContent='—';
    $('create-form').reset();$('staff-form').reset();$('detail-ref').textContent='';st.user=null;st.selectedStaff=null;st.shipmentRef='';st.issueId='';
    $('app').hidden=true;
  }
  function lock(text='Your protected session has expired. Reload to sign in again.'){
    st.locked=true;st.run++;wipePrivate();$('auth-gate').hidden=false;$('auth-status').textContent=text;$('auth-retry').hidden=false;
  }
  class ApiError extends Error {constructor(text,status){super(text);this.status=status;}}
  async function api(path,body){
    if(st.locked)throw new ApiError('Session expired.',401);
    let res;
    try{res=await fetch(path,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});}
    catch{throw new ApiError('Connection interrupted. Check the latest record before retrying any change.',0);}
    let data;
    try{data=await res.json();}catch{throw new ApiError('Unexpected server response. Reload to verify your Access session.',res.status===200?401:res.status);}
    if(!res.ok||data?.ok!==true)throw new ApiError(data?.message||'Request failed. Please retry after reviewing the latest data.',res.status);
    return data;
  }
  function fail(e){
    if(e?.status===401||e?.status===403||e?.status===0){lock(e?.status===0?'The connection was interrupted. Reload and verify the latest records before retrying.':'Access denied or your session expired. Reload to sign in again.');return;}
    message(e?.message||'Unable to load this information.',true);
  }
  async function mutating(fn,button){
    if(st.mutating||st.locked)return;st.mutating=true;if(button)button.disabled=true;
    try{await fn();}catch(e){
      if(e?.status===409){
        const previous=st.view;
        if(previous==='detail')await loadDetail(++st.run);
        else if(previous==='issue-detail')await loadIssueDetail(++st.run);
        else if(previous==='staff'){resetStaff();await loadStaff(++st.run);}
        message('This record changed in another session. Latest details were reloaded; review before retrying.',true);
      }else fail(e);
    }finally{st.mutating=false;if(button)button.disabled=false;}
  }
  function query(resource){return new URLSearchParams({page:String(resource.page),limit:String(resource.limit),...resource.filters}).toString();}
  function paging(resource,prefix){const stem=prefix?prefix+'-':'';$(stem+'page-info').textContent=resource.total?`${(resource.page-1)*resource.limit+1}–${Math.min(resource.page*resource.limit,resource.total)} of ${resource.total}`:'0 records';$(stem+'prev').disabled=resource.page<=1;$(stem+'next').disabled=resource.page*resource.limit>=resource.total;}
  function createTable(target,columns,rows,emptyText='No records found.'){
    if(!Array.isArray(rows)||rows.length===0){empty(target,emptyText);return;}
    const table=node('table'),thead=node('thead'),tr=node('tr');
    for(const c of columns){const th=node('th','',c.title);th.scope='col';tr.append(th);}thead.append(tr);table.append(thead);
    const tbody=node('tbody');
    for(const item of rows){const row=node('tr');for(const c of columns){const td=node('td');td.dataset.label=c.title;const result=c.render(item);if(result instanceof Node)td.append(result);else td.textContent=result==null?'—':String(result);row.append(td);}tbody.append(row);}
    table.append(tbody);$(target).replaceChildren(table);
  }
  function twoLine(primary,secondary,cls=''){const wrap=node('div',cls);wrap.append(node('span','',primary||'—'));if(secondary)wrap.append(node('span','secondary-line',secondary));return wrap;}
  function assignmentSummary(item){if(!item.assignedStaff)return tag('Unassigned','warning');if(!item.assignmentAcknowledgedAt)return twoLine(item.assignedStaff.displayName||'Assigned','Awaiting acknowledgement');return twoLine(item.assignedStaff.displayName||'Assigned','Acknowledged');}
  function renderShipments(target,items,showAssignment=false){
    const columns=[{title:'Tracking / sender',render:s=>{const a=node('div');a.append(btn(s.trackingNumber,()=>openShipment(s.trackingNumber),'link-button'));a.append(node('span','secondary-line',s.senderName||''));return a;}},{title:'Route',render:s=>twoLine(s.origin,s.destination?'→ '+s.destination:'')},{title:'Status',render:s=>statBadge(s.currentStatus)}];
    if(showAssignment)columns.push({title:'Assigned worker',render:s=>assignmentSummary(s)});
    columns.push({title:'Est. delivery',render:s=>date(s.estimatedDeliveryDate)},{title:'',render:s=>btn('View ↗',()=>openShipment(s.trackingNumber),'link-button')});
    createTable(target,columns,items,'No shipments match the selected filters.');
  }
  function dateLabel(){const now=new Date();$('today-label').textContent=new Intl.DateTimeFormat('en-NG',{timeZone:'Africa/Lagos',weekday:'short',day:'numeric',month:'short',year:'numeric'}).format(now);$('current-year').textContent=String(now.getFullYear());}
  function closeMobile(){const sidebar=$('sidebar');sidebar.classList.remove('is-open');$('mobile-scrim').hidden=true;$('open-nav').setAttribute('aria-expanded','false');}
  function navigate(to,keepNotice=false){
    if(st.mutating&&!keepNotice){message('An update is being submitted. Confirm the result before navigating.',true);return;}
    if(!viewLabels[to]||restrictView(to)||st.locked)return;
    st.view=to;const run=++st.run;
    document.querySelectorAll('.view').forEach(x=>x.hidden=x.id!==to);
    document.querySelectorAll('[data-view].side-link').forEach(x=>{const active=x.dataset.view===(to==='detail'?'shipments':to==='issue-detail'?'issues':to);x.classList.toggle('active',active);if(active)x.setAttribute('aria-current','page');else x.removeAttribute('aria-current');});
    $('crumb').textContent=viewLabels[to];if(!keepNotice)message('');closeMobile();window.scrollTo({top:0,behavior:'instant'});
    const loads={overview,shipments:listing,dispatch:loadDispatch,issues:loadIssues,staff:loadStaff,audit:loadAudit,detail:loadDetail,'issue-detail':loadIssueDetail};
    if(loads[to])loads[to](run);
  }
  async function overview(run){
    for(const id of ['total','active','delivered','unassigned','pending','issues','week'])$('stat-'+id).textContent='—';
    loading('distribution','Loading status distribution…');loading('recent','Loading recent shipments…');loading('workload','Loading workload…');
    try{
      const [stats,latest]=await Promise.all([api('/api/admin/stats'),api('/api/admin/shipments?page=1&limit=6')]);if(run!==st.run)return;
      const d=stats.stats||{},counts=d.byStatus||{};const active=statuses.filter(s=>!terminal.has(s)).reduce((sum,s)=>sum+(Number(counts[s])||0),0);
      for(const [id,v] of Object.entries({total:d.total,active,delivered:counts.Delivered,unassigned:d.unassignedActive,pending:d.pendingAcknowledgements,issues:d.openDeliveryIssues,week:d.createdLast7Days}))$('stat-'+id).textContent=num(v);
      for(const [id,v] of Object.entries({'watch-unassigned':d.unassignedActive,'watch-pending':d.pendingAcknowledgements,'watch-issues':d.openDeliveryIssues}))$(id).textContent=num(v);
      const issueNum=Number(d.openDeliveryIssues)||0;$('nav-issues-count').hidden=!issueNum;$('nav-issues-count').textContent=String(issueNum);
      $('distribution').replaceChildren();const max=Math.max(1,...statuses.map(s=>Number(counts[s])||0));
      for(const label of statuses){const amount=Number(counts[label])||0;const row=node('div','bar-row'),meter=node('progress');meter.max=max;meter.value=amount;meter.setAttribute('aria-label',label+': '+amount);row.append(node('span','',label),meter,node('strong','',num(amount)));$('distribution').append(row);}
      renderShipments('recent',latest.items||[]);
      const workload=Array.isArray(d.staffWorkload)?d.staffWorkload:[];
      if(!workload.length)empty('workload','No active field-worker assignments yet.');else{$('workload').replaceChildren();for(const w of workload.slice(0,6)){const row=node('div','workload-row');row.append(node('span','initials',initials(w.staff?.displayName)));const name=node('div','workload-name');name.append(node('strong','',w.staff?.displayName||'Field worker'),node('small','',`${num(w.pendingAcknowledgements)} pending · ${num(w.delayed)} delayed`));row.append(name,node('span','workload-number',num(w.activeAssigned)));$('workload').append(row);}}
    }catch(e){if(run!==st.run)return;empty('recent','Shipment register unavailable.');empty('distribution','Statistics unavailable.');empty('workload','Worker workload unavailable.');fail(e);}
  }
  async function listing(run){loading('shipment-table','Loading shipments…');try{const d=await api('/api/admin/shipments?'+query(st.list));if(run!==st.run)return;st.list.page=d.page;st.list.limit=d.limit;st.list.total=d.total;renderShipments('shipment-table',d.items||[],true);paging(st.list,'');}catch(e){if(run!==st.run)return;empty('shipment-table','Unable to retrieve shipments.');fail(e);}}
  async function loadDispatch(run){
    loading('dispatch-table','Loading dispatch queue…');loading('worker-list','Loading workers…');
    try{
      const [shipments,workers,stats]=await Promise.all([api('/api/admin/shipments?'+query(st.dispatch)),api('/api/admin/dispatch/workers?'+query(st.workers)),api('/api/admin/stats')]);if(run!==st.run)return;
      Object.assign(st.dispatch,{page:shipments.page,limit:shipments.limit,total:shipments.total});
      Object.assign(st.workers,{page:workers.page,limit:workers.limit,total:workers.total});
      $('dispatch-unassigned').textContent=num(stats.stats?.unassignedActive);$('dispatch-pending').textContent=num(stats.stats?.pendingAcknowledgements);$('dispatch-workers').textContent=num(workers.total);
      renderShipments('dispatch-table',shipments.items||[],true);paging(st.dispatch,'dispatch');
      $('worker-list').replaceChildren();if(!(workers.items||[]).length)empty('worker-list','No active workers found.');
      for(const w of workers.items||[]){const card=node('div','worker-card');card.append(node('span','initials',initials(w.displayName)));const info=node('div','worker-card-info');info.append(node('strong','',w.displayName),node('small','',`${num(w.workload?.pendingAcknowledgements)} pending · ${num(w.workload?.delayed)} delayed`));card.append(info,node('span','load-pill',`${num(w.workload?.activeAssigned)} active`));$('worker-list').append(card);}paging(st.workers,'worker');
    }catch(e){if(run!==st.run)return;empty('dispatch-table','Dispatch board unavailable.');empty('worker-list','Worker directory unavailable.');fail(e);}
  }
  async function loadIssues(run){loading('issue-list','Loading delivery reports…');try{const d=await api('/api/admin/issues?'+query(st.issues));if(run!==st.run)return;Object.assign(st.issues,{page:d.page,limit:d.limit,total:d.total});$('issue-list').replaceChildren();if(!(d.items||[]).length)empty('issue-list','No issues match these filters.');for(const i of d.items||[]){const card=node('div','issue-card'),main=node('div','issue-card-main'),head=node('div','issue-card-head');head.append(node('h3','',i.type||'Delivery issue'),tag(i.resolution?'Resolved':'Open',i.resolution?'success':'warning'));main.append(head,node('p','',`${i.trackingNumber||'—'} · ${i.publicLocation||'Location not provided'}`));if(i.publicNote)main.append(node('p','',i.publicNote));main.append(node('small','',`Reported by ${i.reportedBy?.displayName||'Field worker'} · ${date(i.occurredAt||i.createdAt)}`));card.append(main,btn('Review ↗',()=>openIssue(i.id)));$('issue-list').append(card);}paging(st.issues,'issue');}catch(e){if(run!==st.run)return;empty('issue-list','Delivery issues unavailable.');fail(e);}}
  function panel(title,kicker){const p=node('section','glass-panel'),h=node('div','panel-heading'),a=node('div');if(kicker)a.append(node('div','eyebrow',kicker));a.append(node('h2','',title));h.append(a);p.append(h);return p;}
  function definition(container,values){const dl=node('dl','kv-list');for(const [label,value] of values){const block=node('div');block.append(node('dt','',label),node('dd','',value===undefined||value===null||value===''?'—':value));dl.append(block);}container.append(dl);}
  function timeline(container,items,type){const list=node('ol','timeline');for(const i of items||[]){const li=node('li');let title='',subtitle='';if(type==='status'){title=i.status;subtitle=[i.publicLocation,i.publicNote,i.internalNote?'Private: '+i.internalNote:null].filter(Boolean).join(' · ');}else if(type==='assignment'){title=i.assignedStaff?.displayName?'Assigned to '+i.assignedStaff.displayName:'Unassigned';subtitle=[i.assignedBy?.displayName?'By '+i.assignedBy.displayName:null,i.note].filter(Boolean).join(' · ');}else{title='Acknowledged by '+(i.staff?.displayName||'worker');subtitle='Assignment confirmed';}li.append(node('h3','',title||'Update'),node('p','',date(i.occurredAt||i.assignedAt||i.acknowledgedAt||i.createdAt)));if(subtitle)li.append(node('p','',subtitle));list.append(li);}if(!list.children.length)container.append(node('p','data-empty','No recorded events.'));else container.append(list);}
  function makeField(label,name,max,kind='text'){const l=node('label','',label);const input=node(kind==='textarea'?'textarea':kind==='select'?'select':'input');if(kind!=='textarea'&&kind!=='select')input.type=kind;else if(kind==='textarea')input.rows=3;input.name=name;if(max)input.maxLength=max;l.append(input);return {label:l,input};}
  function buildActions(form,submitLabel,submit){const actions=node('div','form-buttons'),save=node('button','action primary',submitLabel);save.type='submit';actions.append(save);form.append(actions);form.addEventListener('submit',e=>{e.preventDefault();mutating(()=>submit(form),save);});return save;}
  function openShipment(tracking){if(!refPattern.test(tracking||'')){message('Invalid tracking reference.',true);return;}st.shipmentRef=tracking;navigate('detail');}
  async function copyRef(ref){try{await navigator.clipboard.writeText(ref);message('Tracking reference copied.');}catch{message('Copy this tracking reference: '+ref);}}
  async function loadDetail(run){const ref=st.shipmentRef;if(!ref){navigate('shipments');return;}loading('detail-content','Loading shipment details…');try{
    const root='/api/admin/shipments/'+encodeURIComponent(ref);
    const [detailData,histData,assignments,acks,workerData]=await Promise.all([api(root),api(root+'/history'),api(root+'/assignments?page=1&limit=25'),api(root+'/acknowledgements?page=1&limit=25'),api('/api/admin/dispatch/workers?page=1&limit=100')]);if(run!==st.run)return;
    renderDetail(detailData.shipment,histData.items||[],assignments.items||[],acks.items||[],workerData.items||[],workerData.total);
  }catch(e){if(run!==st.run)return;empty('detail-content','Shipment details unavailable.');fail(e);}}
  function renderDetail(s,history,assignments,acks,workers,workerTotal){
    $('detail-ref').textContent=s.trackingNumber;const target=$('detail-content');target.replaceChildren();
    const summary=node('section','glass-panel detail-summary'),a=node('div');a.append(node('div','eyebrow','TRACKING REFERENCE'),node('div','ref-big',s.trackingNumber));const actions=node('div','summary-actions');actions.append(statBadge(s.currentStatus),btn('Copy reference',()=>copyRef(s.trackingNumber)));summary.append(a,actions);target.append(summary);
    const cols=node('div','detail-grid'),left=node('div','detail-column'),right=node('div','detail-column');cols.append(left,right);target.append(cols);
    const priv=panel('Private shipment details','CUSTOMER & OPERATIONS');definition(priv,[['Sender',s.sender?.name],['Sender phone',s.sender?.phone],['Receiver',s.receiver?.name],['Receiver phone',s.receiver?.phone],['Pickup address',s.origin?.address],['Delivery address',s.destination?.address],['Item description',s.itemDescription],['Internal notes',s.internalNotes]]);left.append(priv);
    const pub=panel('Customer-visible record','PUBLIC TRACKING FIELDS');definition(pub,[['Origin',s.origin?.publicSummary],['Destination',s.destination?.publicSummary],['Item summary',s.publicItemSummary],['Estimated delivery',date(s.estimatedDeliveryDate)],['Created',date(s.createdAt)],['Last updated',date(s.updatedAt)]]);left.append(pub);
    const assign=panel('Assign delivery worker','DISPATCH CONTROL');definition(assign,[['Current worker',s.assignedStaff?.displayName||'Unassigned'],['Acknowledged',s.assignedStaff?(s.assignmentAcknowledgedAt?date(s.assignmentAcknowledgedAt):'Awaiting acknowledgement'):'Not assigned'],['Assignment sequence',s.assignmentSequence??'—']]);
    const assignForm=node('form','inline-form'),workerLabel=makeField('Delivery worker','staffId');const select=node('select');select.name='staffId';const none=node('option','','— Unassign shipment —');none.value='';select.append(none);for(const w of workers){const opt=node('option','',w.displayName+` · ${num(w.workload?.activeAssigned)} active`);opt.value=w.id;select.append(opt);}if(s.assignedStaff?.id&&!workers.some(w=>w.id===s.assignedStaff.id)){const opt=node('option','',s.assignedStaff.displayName||'Currently assigned');opt.value=s.assignedStaff.id;select.append(opt);}select.value=s.assignedStaff?.id||'';workerLabel.label.replaceChild(select,workerLabel.input);assignForm.append(workerLabel.label,makeField('Internal dispatch note (optional)','note',300).label);
    if(workerTotal>workers.length)assignForm.append(node('p','inline-note','Only the first 100 active workers are listed. For larger teams, contact the administrator to refine worker selection.'));
    buildActions(assignForm,'Save assignment ↗',async f=>{const values=formValues(f);const staffId=values.staffId||null;if(staffId===(s.assignedStaff?.id||null)){message('Choose a different worker or unassign the current worker.');return;}await api('/api/admin/shipments/'+encodeURIComponent(s.trackingNumber)+'/assignment',{staffId,expectedVersion:s.version,...(values.note?{note:values.note}:{})});message('Assignment updated. Latest shipment details loaded.');await loadDetail(++st.run);});assign.append(assignForm);right.append(assign);
    const updates=panel('Update delivery status','TRACKING & PROGRESS');const allowed=transitions[s.currentStatus]||[];if(!allowed.length)updates.append(node('p','data-empty','This shipment has no further allowed status changes.'));
    else{const f=node('form','inline-form');const next=makeField('Next status','status',null,'select');next.input.required=true;const place=node('option','','Choose next status');place.value='';next.input.append(place);for(const name of allowed){const opt=node('option','',name);opt.value=name;next.input.append(opt);}f.append(next.label,makeField('Public location · city and state','publicLocation',120).label,makeField('Customer-visible update note','publicNote',300,'textarea').label,makeField('Private operational note','internalNote',1000,'textarea').label,makeField('Updated estimated date (optional)','estimatedDeliveryDate',null,'date').label);f.append(node('p','inline-note','Public updates appear on the customer tracking page. Do not enter private details.'));buildActions(f,'Save status update ↗',async form=>{await api('/api/admin/shipments/'+encodeURIComponent(s.trackingNumber)+'/status',{...formValues(form),expectedVersion:s.version});message('Shipment status updated.');await loadDetail(++st.run);});updates.append(f);}right.append(updates);
    const h=panel('Shipment status timeline','TRACKING HISTORY');timeline(h,history,'status');left.append(h);
    const ah=panel('Assignment history','DISPATCH HISTORY');timeline(ah,assignments,'assignment');right.append(ah);
    const ack=panel('Acknowledgement history','STAFF CONFIRMATIONS');timeline(ack,acks,'ack');right.append(ack);
  }
  function openIssue(id){if(!id)return;st.issueId=id;navigate('issue-detail');}
  async function loadIssueDetail(run){loading('issue-detail-content','Loading issue report…');try{const response=await api('/api/admin/issues/'+encodeURIComponent(st.issueId));if(run!==st.run)return;const i=response.issue,target=$('issue-detail-content');target.replaceChildren();const p=panel(i.type||'Delivery issue','FIELD REPORT');definition(p,[['Tracking reference',i.trackingNumber],['Shipment status',i.shipmentStatus],['Reported by',i.reportedBy?.displayName],['Reported at',date(i.occurredAt||i.createdAt)],['Public location',i.publicLocation],['Public note',i.publicNote],['Internal operational report',i.operationalNote],['Resolution',i.resolution?.note||'Open'],['Resolved at',date(i.resolution?.resolvedAt)]]);target.append(p);if(i.trackingNumber&&refPattern.test(i.trackingNumber)){const row=node('div','form-buttons');row.append(btn('View shipment ↗',()=>openShipment(i.trackingNumber)));target.append(row);}if(!i.resolution){const r=panel('Resolve this issue','ADMINISTRATIVE ACTION'),form=node('form','inline-form');const field=makeField('Resolution note','resolutionNote',1000,'textarea');field.input.required=true;form.append(field.label);form.append(node('p','inline-note','Resolution is final; the backend does not support reopening an issue.'));buildActions(form,'Mark resolved ↗',async f=>{const values=formValues(f);await api('/api/admin/issues/'+encodeURIComponent(i.id)+'/resolve',{resolutionNote:values.resolutionNote});message('Issue resolved.');await loadIssueDetail(++st.run);});r.append(form);target.append(r);}}catch(e){if(run!==st.run)return;empty('issue-detail-content','Issue report unavailable.');fail(e);}}
  async function loadStaff(run){if(!owner())return;loading('staff-list','Loading staff directory…');try{const d=await api('/api/admin/staff?'+query(st.staff));if(run!==st.run)return;Object.assign(st.staff,{page:d.page,limit:d.limit,total:d.total});$('staff-list').replaceChildren();if(!(d.items||[]).length)empty('staff-list','No staff records found.');for(const item of d.items||[]){const card=node('div','staff-card');card.append(node('span','initials',initials(item.displayName)));const info=node('div','info');info.append(node('strong','',item.displayName||'—'),node('small','',`${item.role||'—'} · ${item.email||'—'}`));card.append(info,tag(item.active?'Active':'Inactive',item.active?'success':'warning'),btn('Edit',()=>editStaff(item)));$('staff-list').append(card);}paging(st.staff,'staff');}catch(e){if(run!==st.run)return;empty('staff-list','Staff directory unavailable.');fail(e);}}
  function editStaff(item){st.selectedStaff=item;const form=$('staff-form');form.elements.displayName.value=item.displayName||'';form.elements.email.value=item.email||'';form.elements.role.value=item.role||'Field Staff';form.elements.active.value=item.active?'true':'false';$('staff-form-title').textContent='Edit staff account';$('staff-subject-label').hidden=true;form.elements.accessSubject.required=false;$('staff-active-label').hidden=false;$('staff-submit').textContent='Update account ↗';form.scrollIntoView({block:'center',behavior:'smooth'});}
  function resetStaff(){st.selectedStaff=null;$('staff-form').reset();$('staff-form-title').textContent='Register staff account';$('staff-subject-label').hidden=false;$('staff-form').elements.accessSubject.required=true;$('staff-active-label').hidden=true;$('staff-submit').textContent='Create account ↗';}
  async function loadAudit(run){if(!owner())return;loading('audit-table','Loading audit events…');try{const d=await api('/api/admin/audit?'+query(st.audit));if(run!==st.run)return;Object.assign(st.audit,{page:d.page,limit:d.limit,total:d.total});const columns=[{title:'Action',render:i=>twoLine(i.action||'—',i.resourceType||'')},{title:'Actor',render:i=>i.actor?.email||i.actor?.staffId||i.actor?.role||'—'},{title:'Resource',render:i=>i.resourceId||'—'},{title:'When',render:i=>date(i.createdAt)}];createTable('audit-table',columns,d.items||[],'No audit events found for these filters.');paging(st.audit,'audit');}catch(e){if(run!==st.run)return;empty('audit-table','Audit records unavailable.');fail(e);}}
  function wireList(formId,section){const f=$(formId);f.addEventListener('submit',e=>{e.preventDefault();st[section].filters=formValues(f);st[section].page=1;navigate(section==='list'?'shipments':section==='workers'?'dispatch':section);});}
  async function initialize(){dateLabel();
    try{const data=await api('/api/admin/me');if(!['Owner','Receptionist'].includes(data.staff?.role)||data.staff?.active!==true){lock('This account is not authorized for the Admin Portal.');return;}
      st.user=data.staff;const display=data.staff.displayName||data.staff.email||'Administrator';$('user-name').textContent=display;$('user-role').textContent=data.staff.role;$('user-initials').textContent=initials(display);$('top-initials').textContent=initials(display);$('welcome-message').textContent=data.staff.role==='Owner'?'Your business, deliveries and people, all in one secure workspace.':'Your desk for shipments, dispatch and day-to-day delivery operations.';
      document.querySelectorAll('[data-owner-only]').forEach(e=>e.hidden=!owner());$('auth-gate').hidden=true;$('app').hidden=false;navigate('overview');
    }catch(e){if(e?.status===401||e?.status===403){lock('Access denied. Please reload to sign in with an authorized account.');}else{lock(e.message||'Unable to verify your protected session.');}}
  }
  document.addEventListener('click',e=>{const target=e.target.closest('button[data-view]');if(!target||!st.user)return;if(target.dataset.dispatchFilter){$('dispatch-filter').elements.assignment.value=target.dataset.dispatchFilter;st.dispatch.filters={assignment:target.dataset.dispatchFilter};st.dispatch.page=1;}navigate(target.dataset.view);});
  $('open-nav').addEventListener('click',()=>{$('sidebar').classList.add('is-open');$('mobile-scrim').hidden=false;$('open-nav').setAttribute('aria-expanded','true');$('close-nav').focus();});
  $('close-nav').addEventListener('click',()=>{closeMobile();$('open-nav').focus();});$('mobile-scrim').addEventListener('click',closeMobile);document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('sidebar').classList.contains('is-open'))closeMobile();});
  $('refresh').addEventListener('click',()=>navigate(st.view));
  for(const status of statuses){const op=node('option','',status);op.value=status;$('filter-status').append(op);}
  $('search-form').addEventListener('submit',e=>{e.preventDefault();st.list.filters=formValues(e.currentTarget);st.list.page=1;navigate('shipments');});$('search-form').addEventListener('reset',()=>{st.list.filters={};st.list.page=1;setTimeout(()=>navigate('shipments'),0);});
  $('prev').addEventListener('click',()=>{if(st.list.page>1){st.list.page--;navigate('shipments');}});$('next').addEventListener('click',()=>{if(st.list.page*st.list.limit<st.list.total){st.list.page++;navigate('shipments');}});
  $('dispatch-filter').addEventListener('submit',e=>{e.preventDefault();st.dispatch.filters=formValues(e.currentTarget);st.dispatch.page=1;navigate('dispatch');});
  $('worker-search').addEventListener('submit',e=>{e.preventDefault();st.workers.filters=formValues(e.currentTarget);st.workers.page=1;navigate('dispatch');});
  $('dispatch-prev').addEventListener('click',()=>{if(st.dispatch.page>1){st.dispatch.page--;navigate('dispatch');}});$('dispatch-next').addEventListener('click',()=>{if(st.dispatch.page*st.dispatch.limit<st.dispatch.total){st.dispatch.page++;navigate('dispatch');}});
  $('worker-prev').addEventListener('click',()=>{if(st.workers.page>1){st.workers.page--;navigate('dispatch');}});$('worker-next').addEventListener('click',()=>{if(st.workers.page*st.workers.limit<st.workers.total){st.workers.page++;navigate('dispatch');}});
  $('issue-filters').addEventListener('submit',e=>{e.preventDefault();st.issues.filters=formValues(e.currentTarget);st.issues.page=1;navigate('issues');});
  $('issue-prev').addEventListener('click',()=>{if(st.issues.page>1){st.issues.page--;navigate('issues');}});$('issue-next').addEventListener('click',()=>{if(st.issues.page*st.issues.limit<st.issues.total){st.issues.page++;navigate('issues');}});
  $('staff-filters').addEventListener('submit',e=>{e.preventDefault();st.staff.filters=formValues(e.currentTarget);st.staff.page=1;navigate('staff');});
  $('staff-prev').addEventListener('click',()=>{if(st.staff.page>1){st.staff.page--;navigate('staff');}});$('staff-next').addEventListener('click',()=>{if(st.staff.page*st.staff.limit<st.staff.total){st.staff.page++;navigate('staff');}});
  $('audit-filters').addEventListener('submit',e=>{e.preventDefault();st.audit.filters=formValues(e.currentTarget);st.audit.page=1;navigate('audit');});
  $('audit-filters').addEventListener('reset',()=>{st.audit.filters={};st.audit.page=1;setTimeout(()=>navigate('audit'),0);});
  $('audit-prev').addEventListener('click',()=>{if(st.audit.page>1){st.audit.page--;navigate('audit');}});$('audit-next').addEventListener('click',()=>{if(st.audit.page*st.audit.limit<st.audit.total){st.audit.page++;navigate('audit');}});
  $('staff-reset').addEventListener('click',resetStaff);
  $('staff-form').addEventListener('submit',e=>{e.preventDefault();if(!owner())return;const form=e.currentTarget;mutating(async()=>{const payload=formValues(form);if(st.selectedStaff){delete payload.accessSubject;payload.expectedVersion=st.selectedStaff.version;payload.active=payload.active==='true';await api('/api/admin/staff/'+encodeURIComponent(st.selectedStaff.id),payload);message('Staff account updated.');}else{await api('/api/admin/staff',payload);message('Staff account created.');}resetStaff();await loadStaff(++st.run);},$('staff-submit'));});
  $('create-form').addEventListener('submit',e=>{e.preventDefault();const form=e.currentTarget;mutating(async()=>{const payload=formValues(form);for(const key of ['senderPhone','receiverPhone']){const n=(payload[key]||'').replace(/\D/g,'').length;if(n<7||n>15)throw new ApiError('Both phone numbers must contain 7–15 digits.',422);}const response=await api('/api/admin/shipments',payload),ref=response.shipment?.trackingNumber;if(!refPattern.test(ref||''))throw new ApiError('The server response was incomplete. Check the shipment register before retrying.',0);form.reset();st.shipmentRef=ref;message('Shipment registered. Reference: '+ref);navigate('detail',true);},form.querySelector('[type="submit"]'));});
  window.addEventListener('pagehide',()=>{st.run++;wipePrivate();});window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
  initialize();
})();
