const field = (name, values) => ({[name]: {$in: values}});
const any = (...rules) => ({$or: rules});
const clientType = value => ({$or:[{leadCategory:{$in:[value,value.toLowerCase()]}},{$and:[{leadCategory:{$in:[null,'']}},{leadType:{$in:[value,value.toLowerCase()]}}]}]});
function leadFilters(now = new Date()) {
  const weekEnd = new Date(now); weekEnd.setDate(weekEnd.getDate() + (7 - weekEnd.getDay())); weekEnd.setHours(0,0,0,0);
  const call = (id,label,values) => ({id,label,match:field('callStatus',values)});
  const activity = (id,label,values) => ({id,label,match:field('activity',values)});
  return [
    {id:'calling',title:'Calling filters',description:'Latest saved calling result for each lead',filters:[
      {id:'all',label:'All Records',match:{}},
      {id:'outbound',label:'Outbound Call',match:{lastCallDirection:'OUTGOING'}},
      {id:'active',label:'Active Call',match:any({lastCallDuration:{$gt:60}},field('callStatus',['Active Call']))},
      {id:'inbound',label:'Inbound Call',match:{lastCallDirection:'INCOMING'}},
      {id:'busy',label:'No Busy',match:any(field('callStatus',['Line Busy','Busy','No Busy']),{lastCallOutcome:'Busy'})},
      {id:'off',label:'No Off',match:any(field('callStatus',['Phone Switched Off','No Off']),{lastCallOutcome:'Phone Switched Off'})},
      {id:'cut',label:'Call Cut',match:any(field('callStatus',['Call Disconnected','Call Cut']),{lastCallOutcome:'Call Disconnected'})},
      call('later','Talk Later',['Call Back Later','Talk Later']),
      {id:'not-picked',label:'Not Picked',match:any(field('callStatus',['No Answer','Not Picked']),{lastCallOutcome:'No Answer'})},
      call('robot','Robot Picked',['Robot Picked']),call('rude','Rude Behavior',['Rude Behavior']),call('interested','Interested',['Interested']),call('not-interested','Not Interested',['Not Interested']),
      {id:'week-follow',label:'This Week Follow',match:any(field('callStatus',['This Week Follow']),{followUpAt:{$gte:now,$lt:weekEnd}})},
      {id:'future-follow',label:'Future Follow',match:any(field('callStatus',['Future Follow']),{followUpAt:{$gte:weekEnd}})},
      call('proposal','Need Proposal',['Need Proposal']),call('not-match','Not Field Match',['Not Field Match','Not Qualified']),call('trust','Trust Issues',['Trust Issues']),
      {id:'wa-follow',label:'WhatsApp Follow',match:any(field('callStatus',['WhatsApp Follow']),field('activity',['WA Sent','WhatsApp Follow']))},
    ]},
    {id:'progress',title:'In Progress filters',description:'Business activity and lead category',filters:[
      activity('proposal-sent','Proposal Sent',['Proposal Sent']),activity('future-registration','Future Registration',['Future Registration']),
      {id:'dead-lead',label:'Dead Lead',match:any({status:'lost'},{leadCategory:'Dead Lead'})},
      {id:'registered',label:'Registered',match:any({status:'won'},{activity:'Registered'})},
      call('progress-not-interested','Not Interested',['Not Interested']),activity('he-visit','He Wants Visit',['He Wants Visit']),activity('we-visit','We Want Visit',['We Want Visit']),
      activity('office-visit','Office Visit Done',['Office Visit Done']),activity('staff-visit-done','Staff Visit Done',['Staff Visit Done']),activity('modified','Modified No',['Modified No']),
      {id:'premium',label:'Premium',match:field('leadCategory',['Premium'])},{id:'normal',label:'Normal',match:field('leadCategory',['Normal','Standard','Basic'])},{id:'startup',label:'Startup',match:field('leadCategory',['Startup'])},
      activity('staff-visit','Staff Visit',['Staff Visit']),activity('cv','CV Done',['CV Done']),activity('sv','SV Done',['SV Done']),activity('others','Others',['Others']),activity('customer-visit','Customer Visit',['Customer Visit']),activity('no-wa','No WhatsApp',['No WhatsApp']),
    ]},
    {id:'clients',title:'Assignment & Client Type Dashboard',description:'Lead assignment and client classifications',filters:[
      {id:'client-assigned',label:'All Assigned Leads',match:{assignedTo:{$ne:null}}},
      {id:'client-dead',label:'Dead Clients',match:any({status:'lost'},{leadCategory:'Dead Lead'})},
      {id:'client-basic',label:'Basic Clients',match:clientType('Basic')},
      {id:'client-standard',label:'Standard Clients',match:clientType('Standard')},
      {id:'client-premium',label:'Premium Clients',match:clientType('Premium')},
    ]},
  ];
}
async function filterCounts(Lead, base, sections) {
  const facets = Object.fromEntries(sections.flatMap(section => section.filters.map(filter => [filter.id,[{$match:filter.match},{$count:'count'}]])));
  const [result] = await Lead.aggregate([{$match:base},{$facet:facets}]);
  return sections.map(section=>({...section,filters:section.filters.map(({id,label})=>({id,label,count:result?.[id]?.[0]?.count || 0}))}));
}
module.exports={leadFilters,filterCounts};
