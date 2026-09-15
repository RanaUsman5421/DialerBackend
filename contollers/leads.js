const mongoose=require('mongoose');
const XLSX=require('xlsx');
const Lead=require('../models/Lead');
const LeadImport=require('../models/LeadImport');
const Group=require('../models/LeadGroup');
const Rejected=require('../models/RejectedLead');
const Activity=require('../models/LeadActivity');
const User=require('../models/User');
const CallAttempt=require('../models/CallAttempt');
const {leadFilters,filterCounts}=require('../services/leadFilters');
const {fields,key,brandKey,validateRow}=require('../services/leadValidation');
const {roleOf}=require('../middleware/auth');
const isAdmin=req=>roleOf(req.user)==='admin';
const scope=req=>isAdmin(req)?{}:{uploadedBy:req.user._id};
const pageOf=req=>({page:Math.min(10000,Math.max(1,parseInt(req.query.page)||1)),limit:Math.min(100,Math.max(10,parseInt(req.query.limit)||25))});
const fail=(status,message)=>{const error=new Error(message);error.status=status;throw error;};
const validId=id=>mongoose.isValidObjectId(id);
const idOf=value=>String(value?._id || value || '');
async function groupFor(name,user) {
 name=String(name||'').trim().replace(/\s+/g,' ');
 if(!name || name.length>120)fail(400,'A group name between 1 and 120 characters is required');
 try{return await Group.findOneAndUpdate({normalizedName:brandKey(name)},{$setOnInsert:{name,createdBy:user}},{upsert:true,new:true});}
 catch(error){if(error.code===11000)return Group.findOne({normalizedName:brandKey(name)});throw error;}
}
async function duplicate(data,session) {
 return Lead.findOne({$or:[{phoneNormalized:data.phoneNormalized},{brandNormalized:data.brandNormalized}]}).select('_id brandName phone phoneNormalized brandNormalized').session(session||null).lean();
}
function duplicateErrors(data,existing) {
 const errors=[];
 if(existing && (existing.phoneNormalized===data.phoneNormalized || existing.phone===data.phone))errors.push('Phone No already exists');
 if(existing && (existing.brandNormalized===data.brandNormalized || brandKey(existing.brandName)===data.brandNormalized))errors.push('Brand Name already exists');
 return errors.length?errors:['Phone No or Brand Name already exists'];
}
function document(data,meta,exception=false) {
 return {...data,...meta,source:data.extractedFrom,status:'new',assignedTo:null,version:0,assignmentVersion:0,
  ...(exception?{duplicateException:true}:{phoneKey:data.phoneNormalized,brandKey:data.brandNormalized})};
}
async function importLeads(req,res) {
 if(!req.file)fail(400,'An XLS or XLSX file is required');
 const book=XLSX.read(req.file.buffer,{type:'buffer',cellFormula:false,cellHTML:false,cellStyles:false});
 const sheet=book.Sheets[book.SheetNames[0]];
 if(!sheet?.['!ref'])fail(400,'The first worksheet is empty');
 const range=XLSX.utils.decode_range(sheet['!ref']);
 if(range.e.r-range.s.r>20000 || range.e.c-range.s.c+1>100)fail(413,'Maximum 20,000 rows and 100 columns');
 const grid=XLSX.utils.sheet_to_json(sheet,{header:1,defval:'',raw:false,blankrows:true});
 const headers=grid[0]||[];
 const headerKeys=headers.map(key);
 if(new Set(headerKeys.filter(Boolean)).size!==headerKeys.filter(Boolean).length)fail(400,'Spreadsheet has duplicate column headings');
 const missing=fields.filter(([,header,required])=>required&&!headerKeys.includes(key(header))).map(([,header])=>header);
 // Missing mandatory columns reject the populated rows; malformed files with no known headers fail early.
 if(!headerKeys.some(header=>fields.some(([,label])=>key(label)===header)))fail(400,'Use the provided leads spreadsheet format');
 const rows=grid.slice(1).map((values,index)=>({row:index+range.s.r+2,raw:Object.fromEntries(headers.map((h,i)=>[h,values[i]??'']))})).filter(item=>Object.values(item.raw).some(v=>String(v).trim()));
 if(!rows.length)fail(400,'No lead rows found');
 const group=await groupFor(req.body.groupName,req.user._id);
 const batch=await LeadImport.create({fileName:req.file.originalname.slice(0,180),sheetName:book.SheetNames[0],group:group._id,uploadedBy:req.user._id,totalRows:rows.length});
 let accepted=0,rejected=0,duplicates=0;
 try {
  for(let offset=0;offset<rows.length;offset+=500) {
   const chunk=rows.slice(offset,offset+500).map(item=>({...item,...validateRow(item.raw)}));
   const existing=await Lead.find({$or:[{phoneNormalized:{$in:chunk.map(item=>item.data.phoneNormalized)}},{brandNormalized:{$in:chunk.map(item=>item.data.brandNormalized)}}]}).select('phoneNormalized brandNormalized').lean();
   const phones=new Set(existing.map(item=>item.phoneNormalized)),brands=new Set(existing.map(item=>item.brandNormalized));
   const candidates=[],rejects=[];
   const reject=(item,errors,reason)=>{rejects.push({raw:item.raw,errors,reason,uploadedBy:req.user._id,group:group._id,importBatch:batch._id,sourceRow:item.row,uploadedAt:batch.createdAt});rejected++;if(reason==='duplicate')duplicates++;};
   for(const item of chunk) {
    if(item.errors.length){reject(item,item.errors,'validation');continue;}
    if(phones.has(item.data.phoneNormalized)||brands.has(item.data.brandNormalized)){reject(item,[...(phones.has(item.data.phoneNormalized)?['Phone No already exists in the database or this file']:[]),...(brands.has(item.data.brandNormalized)?['Brand Name already exists in the database or this file']:[])],'duplicate');continue;}
    phones.add(item.data.phoneNormalized);brands.add(item.data.brandNormalized);
    candidates.push({item,doc:document(item.data,{uploadedBy:req.user._id,group:group._id,importBatch:batch._id,sourceRow:item.row,uploadedAt:batch.createdAt})});
   }
   if(candidates.length) {
    try {const inserted=await Lead.insertMany(candidates.map(item=>item.doc),{ordered:false});accepted+=inserted.length;}
    catch(error) {
     if(!error.writeErrors?.length)throw error;
     accepted+=(error.insertedDocs||[]).length;
     for(const write of error.writeErrors){if(write.code!==11000)throw error;reject(candidates[write.index].item,['Phone number or Brand Name already exists (concurrent upload)'],'duplicate');}
    }
   }
   if(rejects.length)await Rejected.insertMany(rejects);
   await LeadImport.updateOne({_id:batch._id},{$set:{importedRows:accepted,skippedRows:rejected,duplicateRows:duplicates}});
  }
  batch.importedRows=accepted;batch.skippedRows=rejected;batch.duplicateRows=duplicates;batch.status='completed';batch.errors=missing.map(header=>({row:1,message:`Missing column: ${header}`}));await batch.save();
  const rejections=await Rejected.find({importBatch:batch._id,uploadedBy:req.user._id,state:'rejected'}).sort({sourceRow:1,_id:1}).limit(25).lean();
  res.status(201).json({import:batch,rejections,message:`${accepted} accepted, ${rejected} rejected (${duplicates} duplicates)`,summary:{totalRows:rows.length,accepted,rejected,duplicates}});
 }catch(error){await LeadImport.updateOne({_id:batch._id},{$set:{status:'failed',importedRows:accepted,skippedRows:rejected,duplicateRows:duplicates}});throw error;}
}
async function manualLead(req,res) {
 const group=await groupFor(req.body.groupName,req.user._id), result=validateRow(req.body.lead||{});
 let reason='validation',errors=result.errors;
 if(!errors.length){const match=await duplicate(result.data);if(match){reason='duplicate';errors=duplicateErrors(result.data,match);}}
 if(errors.length){const rejection=await Rejected.create({raw:result.raw,errors,reason,uploadedBy:req.user._id,group:group._id});return res.status(202).json({rejection,message:'Lead added to your rejected queue'});}
 try{const lead=await Lead.create(document(result.data,{uploadedBy:req.user._id,group:group._id}));res.status(201).json({lead,message:'Lead added to the unassigned pool'});}
 catch(error){if(error.code!==11000)throw error;const rejection=await Rejected.create({raw:result.raw,errors:['Phone number or Brand Name already exists'],reason:'duplicate',uploadedBy:req.user._id,group:group._id});res.status(202).json({rejection,message:'Duplicate added to your rejected queue'});}
}
async function listLeads(req,res) {
 const {page,limit}=pageOf(req),filter=scope(req);
 if(req.query.group){if(!validId(req.query.group))fail(400,'Invalid group');filter.group=req.query.group;}
 if(req.query.assignedTo){if(!validId(req.query.assignedTo))fail(400,'Invalid agent');filter.assignedTo=req.query.assignedTo;}
 if(req.query.assignment==='unassigned')filter.assignedTo=null;
 if(req.query.assignment==='assigned')filter.assignedTo={$ne:null};
 if(req.query.status)filter.status=req.query.status;
 if(req.query.q){const q=String(req.query.q).slice(0,100).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');const users=await User.find({$or:[{name:{$regex:q,$options:'i'}},{username:{$regex:q,$options:'i'}}]}).select('_id').lean();filter.$or=[{brandName:{$regex:q,$options:'i'}},{phone:{$regex:q}},{assignedTo:{$in:users.map(user=>user._id)}},{uploadedBy:{$in:users.map(user=>user._id)}}];}
 const parseDate=value=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(value))fail(400,'Invalid date filter');const date=new Date(value+'T00:00:00+05:00');if(Number.isNaN(date.getTime())||new Date(date.getTime()+5*3600000).toISOString().slice(0,10)!==value)fail(400,'Invalid date filter');return date;};
 if(req.query.from || req.query.to){const from=req.query.from?parseDate(req.query.from):null,to=req.query.to?new Date(parseDate(req.query.to).getTime()+86400000):null;if(from&&to&&from>=to)fail(400,'Start date must not be after end date');const range={...(from?{$gte:from}:{}),...(to?{$lt:to}:{})};filter.$and=[{$or:[{uploadedAt:range},{uploadedAt:null,createdAt:range}]}];}
 const todayStart=new Date(new Date(Date.now()+5*3600000).toISOString().slice(0,10)+'T00:00:00+05:00');
 if(req.query.schedule){if(!['all','today'].includes(req.query.schedule))fail(400,'Invalid schedule filter');const day=todayStart;filter.followUpAt=req.query.schedule==='today'?{$gte:day,$lt:new Date(day.getTime()+86400000)}:{$ne:null};}
 const queueBase={...filter};
 const sections=leadFilters();
 const chosenFilter=sections.flatMap(section=>section.filters).find(item=>item.id===req.query.leadFilter);
 if(req.query.leadFilter&&!chosenFilter)fail(400,'Invalid lead filter');
 if(chosenFilter)filter.$and=[...(filter.$and||[]),chosenFilter.match];
 const queues={pending:{assignedTo:null,status:{$nin:['won','lost']}},inProgress:{assignedTo:{$ne:null},status:{$nin:['won','lost']}},closed:{status:'won'},dead:{status:'lost'}};
 if(req.query.queue){if(!queues[req.query.queue])fail(400,'Invalid lead queue');filter.$and=[...(filter.$and||[]),queues[req.query.queue]];}
 const [leads,total,counts,filterSections,todaySchedules]=await Promise.all([Lead.find(filter).populate('lastCallBy','name username').populate('assignedTo','name username email').populate('group','name').sort({createdAt:-1}).skip((page-1)*limit).limit(limit).lean(),Lead.countDocuments(filter),Lead.aggregate([{$match:queueBase},{$group:{_id:{$switch:{branches:[{case:{$eq:['$status','won']},then:'closed'},{case:{$eq:['$status','lost']},then:'dead'},{case:{$ne:[{$ifNull:['$assignedTo',null]},null]},then:'inProgress'}],default:'pending'}},count:{$sum:1}}}]),filterCounts(Lead,queueBase,sections),Lead.countDocuments({...queueBase,followUpAt:{$gte:todayStart,$lt:new Date(todayStart.getTime()+86400000)}})]);
 if(leads.length){
  const latest=await Activity.aggregate([{$match:{lead:{$in:leads.map(lead=>lead._id)}}},{$facet:{remarks:[{$match:{'details.remark':{$type:'string',$ne:''}}},{$sort:{createdAt:-1,_id:-1}},{$group:{_id:'$lead',text:{$first:'$details.remark'}}}],calls:[{$match:{type:'call'}},{$sort:{createdAt:-1,_id:-1}},{$group:{_id:'$lead',actor:{$first:'$actor'},date:{$first:'$createdAt'}}},{$lookup:{from:User.collection.name,localField:'actor',foreignField:'_id',pipeline:[{$project:{name:1,username:1}}],as:'user'}}]}}]);
  const remarks=new Map(latest[0].remarks.map(item=>[String(item._id),item.text])),calls=new Map(latest[0].calls.map(item=>[String(item._id),item]));
  for(const lead of leads){if(lead.latestRemark===undefined)lead.latestRemark=remarks.get(String(lead._id));const call=calls.get(String(lead._id));if(!lead.lastCallBy&&call){lead.lastCallBy=call.user[0];lead.lastCallAt=call.date;}}
 }
 const queueCounts={pending:0,inProgress:0,closed:0,dead:0};for(const item of counts)queueCounts[item._id]=item.count;
 res.json({leads,queueCounts,filterSections,todaySchedules,pagination:{page,limit,total,pages:Math.max(1,Math.ceil(total/limit))}});
}
async function listAssignedLeads(req,res) {
 const {page,limit}=pageOf(req), base={assignedTo:req.user._id}, filter={...base};
 if(req.query.status)filter.status=req.query.status;
 const progress={$switch:{branches:[
  {case:{$or:[{$eq:['$status','lost']},{$eq:['$leadCategory','Dead Lead']}]},then:'dead'},
  {case:{$or:[{$eq:['$status','won']},{$in:['$activity',['Registered','Closed']]}]},then:'closed'},
  {case:{$or:[{$in:['$status',['contacted','qualified']]},{$gt:[{$strLenCP:{$ifNull:['$callStatus','']}},0]},{$gt:[{$strLenCP:{$ifNull:['$leadCategory','']}},0]},{$gt:[{$strLenCP:{$ifNull:['$activity','']}},0]},{$gt:[{$strLenCP:{$ifNull:['$latestRemark','']}},0]},{$ne:[{$ifNull:['$lastCallAt',null]},null]},{$ne:[{$ifNull:['$followUpAt',null]},null]}]},then:'inProgress'}
 ],default:'pending'}};
 const allowed=new Set(['pending','inProgress','closed','dead']);
 if(req.query.progress){if(!allowed.has(req.query.progress))fail(400,'Invalid lead progress filter');filter.$expr={$eq:[progress,req.query.progress]};}
 const [leads,total,rows]=await Promise.all([Lead.find(filter).populate('group','name').sort({followUpAt:1,createdAt:-1}).skip((page-1)*limit).limit(limit).lean(),Lead.countDocuments(filter),Lead.aggregate([{$match:base},{$group:{_id:progress,count:{$sum:1}}}])]);
 const progressCounts={pending:0,inProgress:0,closed:0,dead:0};for(const row of rows)if(allowed.has(row._id))progressCounts[row._id]=row.count;
 res.json({leads,progressCounts,pagination:{page,limit,total,pages:Math.max(1,Math.ceil(total/limit))}});
}
async function listImports(req,res){res.json({imports:await LeadImport.find(scope(req)).populate('group','name').populate('uploadedBy','name').sort({createdAt:-1}).limit(50).lean()});}
async function stats(req,res) {
 const filter=scope(req);
 const [totalLeads,newLeads,unassignedLeads,completedImports,rejectedLeads,assigned]=await Promise.all([Lead.countDocuments(filter),Lead.countDocuments({...filter,status:'new'}),Lead.countDocuments({...filter,assignedTo:null}),LeadImport.countDocuments({...filter,status:'completed'}),Rejected.countDocuments({...filter,state:'rejected'}),Lead.aggregate([{$match:filter},{$match:{assignedTo:{$ne:null}}},{$group:{_id:'$assignedTo'}}])]);
 res.json({totalLeads,newLeads,unassignedLeads,assignedUsers:assigned.length,completedImports,rejectedLeads});
}
async function groups(req,res) {
 const filter=scope(req);
 const [counts,rejections]=await Promise.all([Lead.aggregate([{$match:filter},{$group:{_id:'$group',total:{$sum:1},assigned:{$sum:{$cond:[{$ne:[{$ifNull:['$assignedTo',null]},null]},1,0]}}}}]),Rejected.aggregate([{$match:{...filter,state:'rejected'}},{$group:{_id:'$group',rejected:{$sum:1}}}])]);
 const visible=isAdmin(req)?{}:{$or:[{createdBy:req.user._id},{_id:{$in:[...counts,...rejections].map(item=>item._id).filter(Boolean)}}]};
 const items=await Group.find(visible).sort({name:1}).limit(1000).lean();
 res.json({groups:items.map(item=>{const count=counts.find(c=>idOf(c._id)===idOf(item._id))||{};return {...item,total:count.total||0,assigned:count.assigned||0,remaining:(count.total||0)-(count.assigned||0),rejected:rejections.find(c=>idOf(c._id)===idOf(item._id))?.rejected||0};})});
}
async function rejectedLeads(req,res) {
 const {page,limit}=pageOf(req),filter={...scope(req),state:'rejected'};
 if(req.query.importBatch){if(!validId(req.query.importBatch))fail(400,'Invalid import batch');filter.importBatch=req.query.importBatch;}
 if(req.query.reason)filter.reason=req.query.reason;
 const [rejections,total]=await Promise.all([Rejected.find(filter).populate('group','name').populate('uploadedBy','name email').sort(req.query.importBatch?{sourceRow:1,_id:1}:{createdAt:-1}).skip((page-1)*limit).limit(limit).lean(),Rejected.countDocuments(filter)]);
 res.json({rejections,pagination:{page,limit,total,pages:Math.max(1,Math.ceil(total/limit))}});
}
async function duplicateMatches(req,res){
 if(!validId(req.params.id))fail(400,'Invalid rejection ID');
 const rejection=await Rejected.findById(req.params.id).lean();if(!rejection)fail(404,'Rejected lead not found');
 const data=validateRow(rejection.raw).data;
 const matches=await Lead.find({$or:[{phoneNormalized:data.phoneNormalized},{brandNormalized:data.brandNormalized}]}).select('brandName phone leadType socialLink uploadedBy group assignedTo').populate('group','name').populate('assignedTo','name').limit(20).lean();res.json({matches});
}
async function resubmit(req,res) {
 if(!validId(req.params.id))fail(400,'Invalid rejection ID');
 const result=validateRow(req.body.lead||{});
 const override=isAdmin(req)&&req.body.allowDuplicate===true;
 const reviewReason=String(req.body.reviewReason||'').trim().slice(0,500);
 if(override&&!reviewReason)fail(400,'A reason is required for duplicate approval');
 let lead,rejection;
 try{await mongoose.connection.transaction(async session=>{
  rejection=await Rejected.findOne({_id:req.params.id,...scope(req),state:'rejected'}).session(session);
  if(!rejection)fail(404,'Rejected lead not found');
  if(override&&rejection.reason!=='duplicate')fail(400,'Only duplicate rejections may use duplicate approval');
  const errors=[...result.errors];
  if(!errors.length&&!override){const match=await duplicate(result.data,session);if(match)errors.push(...duplicateErrors(result.data,match));}
  if(errors.length){rejection.raw=result.raw;rejection.errors=errors;rejection.reason=result.errors.length?'validation':'duplicate';await rejection.save({session});return;}
  [lead]=await Lead.create([document(result.data,{uploadedBy:rejection.uploadedBy,group:rejection.group,importBatch:rejection.importBatch,sourceRow:rejection.sourceRow,uploadedAt:rejection.createdAt},override)],{session});
  rejection.state='accepted';rejection.acceptedLead=lead._id;rejection.reviewedBy=isAdmin(req)?req.user._id:undefined;rejection.reviewReason=reviewReason;await rejection.save({session});
  if(override)await Activity.create([{lead:lead._id,actor:req.user._id,type:'duplicate-approved',details:{reason:reviewReason}}],{session});
 });}catch(error){if(error.code===11000)fail(409,'A matching lead was just added. Resubmit to refresh the rejection reason.');throw error;}
 res.status(lead?200:202).json({lead,rejection,message:lead?'Lead accepted into its group':'Still rejected: '+rejection.errors.join('; ')});
}
async function assign(req,res) {
 let targetName="Unassigned";
 const groupIds=[...new Set(req.body.groupIds||[])];
 const ids=[...new Set(req.body.leadIds||[])],target=req.body.assignedTo||null,reason=String(req.body.reason||'').trim().slice(0,500);
 if(groupIds.length){if(groupIds.length>25||groupIds.some(id=>!validId(id))||ids.length)fail(400,'Select up to 25 groups without individual leads');if(!target)fail(400,'Choose a Calling Agent');if(!['remaining','reassign'].includes(req.body.mode))fail(400,'Choose remaining leads or group reassignment');if(req.body.mode==='reassign'&&!reason)fail(400,'A reason is required for group reassignment');}
 else if(!ids.length||ids.length>500||ids.some(id=>!validId(id)))fail(400,'Select between 1 and 500 leads');
 if(target){if(!validId(target))fail(400,'Invalid calling agent');const user=await User.findOne({_id:target,role:{$in:['user','calling_agent']},isActive:true,accountState:{$nin:['pending','suspended']}});if(!user)fail(400,'Choose an active Calling Agent');targetName=user.name;}
 let assignedCount=0;
 await mongoose.connection.transaction(async session=>{
  assignedCount=0;
  if(groupIds.length&&(await Group.countDocuments({_id:{$in:groupIds}}).session(session))!==groupIds.length)fail(404,'One or more groups no longer exist');
  const filter=groupIds.length?{group:{$in:groupIds},...(req.body.mode==='remaining'?{assignedTo:null}:{})}:{_id:{$in:ids}};
  const leads=await Lead.find(filter).populate('assignedTo','name').limit(20001).session(session);
  if(leads.length>20000)fail(413,'Assign no more than 20,000 group leads at once');
  if(!groupIds.length&&leads.length!==ids.length)fail(404,'One or more leads no longer exist');
  if(groupIds.length&&!leads.length)fail(400,'Selected groups have no eligible leads');
  const changed=leads.filter(lead=>idOf(lead.assignedTo)!==idOf(target));
  if(changed.some(lead=>lead.assignedTo)&&!reason)fail(400,'A reason is required for reassignment or unassignment');
  if(!changed.length)return;
  assignedCount=changed.length;
  for(let offset=0;offset<changed.length;offset+=500){const chunk=changed.slice(offset,offset+500);
  await Lead.bulkWrite(chunk.map(lead=>({updateOne:{filter:{_id:lead._id},update:{$set:{assignedTo:target,assignedBy:req.user._id,assignedAt:new Date()},$inc:{version:1,assignmentVersion:1}}}})),{session});
  await Activity.insertMany(chunk.map(lead=>({lead:lead._id,actor:req.user._id,type:lead.assignedTo?'reassigned':'assigned',details:{previousAgent:lead.assignedTo?._id||null,newAgent:target,previousAgentName:lead.assignedTo?.name||"Unassigned",newAgentName:targetName,reason}})),{session});
  }
 });
 res.json({assigned:assignedCount,message:`${assignedCount} leads assigned successfully`});
}
async function workload(req,res) {
 const [users,counts]=await Promise.all([User.find({role:{$in:['user','calling_agent']}}).select('name username email isActive accountState').lean(),Lead.aggregate([{$match:{assignedTo:{$ne:null}}},{$group:{_id:'$assignedTo',assigned:{$sum:1},groups:{$addToSet:'$group'},pending:{$sum:{$cond:[{$in:['$status',['won','lost']]},0,1]}},overdue:{$sum:{$cond:[{$and:[{$ne:[{$ifNull:['$followUpAt',null]},null]},{$lt:['$followUpAt',new Date()]},{$not:[{$in:['$status',['won','lost']]}]}]},1,0]}}}}])]);
 res.json({workload:users.map(user=>({...user,id:idOf(user),...(counts.find(item=>idOf(item._id)===idOf(user))||{assigned:0,pending:0,overdue:0}),assignedGroups:(counts.find(item=>idOf(item._id)===idOf(user))?.groups||[]).filter(Boolean).length,_id:user._id}))});
}
async function detail(req,res) {
 if(!validId(req.params.id))fail(400,'Invalid lead ID');
 const filter=isAdmin(req)?{}:roleOf(req.user)==='calling_agent'?{assignedTo:req.user._id}:{uploadedBy:req.user._id};
 const lead=await Lead.findOne({_id:req.params.id,...filter}).lean();if(!lead)fail(404,'Lead not found');res.json({lead});
}
async function history(req,res) {
 if(!validId(req.params.id))fail(400,'Invalid lead ID');
 const filter=isAdmin(req)?{}:roleOf(req.user)==='calling_agent'?{assignedTo:req.user._id}:{uploadedBy:req.user._id};
 const lead=await Lead.findOne({_id:req.params.id,...filter}).populate('uploadedBy','name').lean();if(!lead)fail(404,'Lead not found');
 const {page,limit}=pageOf(req);
 const [events,total]=await Promise.all([Activity.find({lead:lead._id}).populate('actor','name role').sort({createdAt:-1,_id:-1}).skip((page-1)*limit).limit(limit).lean(),Activity.countDocuments({lead:lead._id})]);
 res.json({events,upload:{actor:lead.uploadedBy,createdAt:lead.uploadedAt||lead.createdAt,type:'uploaded',details:{importBatch:lead.importBatch,sourceRow:lead.sourceRow}},pagination:{page,limit,total,pages:Math.max(1,Math.ceil(total/limit))}});
}
// Retain legacy outcomes for older clients; the dialer now uses Call Status directly.
const outcomes=['Connected','No Answer','Busy','Failed','Invalid Number','Phone Switched Off','Call Disconnected','Line Busy','Call Back Later','Interested','Not Interested','Not Qualified','Follow-Up Required','Do Not Contact','Already Using Service'];
function cleanRemark(body) {
 if(body.remark===undefined)return;
 if(typeof body.remark!=='string')fail(400,'Remark must be text');
 body.remark=body.remark.trim();
 if(body.remark.length>2000)fail(400,'Remark exceeds 2000 characters');
 if(!body.remark)delete body.remark;
}
async function updateLead(req,res) {
 if(!validId(req.params.id))fail(400,'Invalid lead ID');
 const body=req.body, operationId=String(body.operationId||'');
 cleanRemark(body);
 if(!/^[a-zA-Z0-9_-]{8,100}$/.test(operationId))fail(400,'A unique operation ID is required');
 if(!Number.isInteger(body.version)||!Number.isInteger(body.assignmentVersion))fail(400,'Lead version and assignment version are required');
 if(body.callAttempt&&!outcomes.includes(body.callAttempt.outcome))fail(400,'Choose a call outcome');
 if(body.status&&!['new','contacted','qualified','won','lost'].includes(body.status))fail(400,'Invalid lead progress');
 const followUpAt=body.followUpAt?new Date(body.followUpAt):null;
 if(followUpAt&&Number.isNaN(followUpAt.getTime()))fail(400,'Invalid follow-up date');
 if(body.remark&&String(body.remark).length>2000)fail(400,'Remark exceeds 2000 characters');
 let lead,event;
 await mongoose.connection.transaction(async session=>{
  event=await Activity.findOne({actor:req.user._id,operationId}).session(session);
  if(event){if(idOf(event.lead)!==req.params.id)fail(409,'Operation ID already used for another lead');lead={_id:event.lead,version:event.details.appliedVersion,assignmentVersion:event.details.assignmentVersion};return;}
  lead=await Lead.findOne({_id:req.params.id,...(isAdmin(req)?{}:{assignedTo:req.user._id})}).session(session);
  if(!lead)fail(409,'This lead is no longer assigned to your account');
  if((lead.version||0)!==body.version||(lead.assignmentVersion||0)!==body.assignmentVersion)fail(409,'Lead changed since your last sync. Refresh and review before retrying.');
  const before=lead.status;
  const changedFields={};
  if(body.phone!==undefined || body.perDayOrders!==undefined){
   if(!isAdmin(req))fail(403,'Only Admin can edit lead contact details');
   if(body.phone!==undefined){
    const phone=require('../services/leadValidation').normalizePhone(body.phone);
    if(!phone)fail(400,'Phone No must be a valid Pakistani number');
    if(phone!==lead.phone){
     if(await Lead.exists({_id:{$ne:lead._id},$or:[{phoneNormalized:phone},{phoneKey:phone},{phone}]}).session(session))fail(409,'Phone No already exists');
     changedFields.phone={from:lead.phone,to:phone};lead.phone=phone;lead.phoneNormalized=phone;lead.phoneKey=phone;
    }
   }
   if(body.perDayOrders!==undefined){const orders=String(body.perDayOrders).trim();if(!orders||orders.length>2000)fail(400,'Per day Orders is required (maximum 2000 characters)');changedFields.perDayOrders={from:lead.perDayOrders,to:orders};lead.perDayOrders=orders;}
  }
  if(body.remark!==undefined)lead.latestRemark=body.remark;
  if(body.callAttempt){lead.lastCallBy=req.user._id;lead.lastCallAt=new Date();}

  if(body.callAttempt){lead.lastCallOutcome=body.callAttempt.outcome;lead.lastCallDuration=Math.max(0,Number(body.callAttempt.duration)||0);lead.lastCallDirection=['OUTGOING','INCOMING'].includes(body.callAttempt.direction)?body.callAttempt.direction:undefined;}
  for(const name of ['status','callStatus','leadCategory','activity'])if(body[name]!==undefined)lead[name]=String(body[name]).slice(0,120);
  if(body.followUpAt!==undefined)lead.followUpAt=followUpAt;
  lead.version=(lead.version||0)+1;await lead.save({session});
  if(body.callAttempt)await CallAttempt.create([{lead:lead._id,actor:req.user._id,phone:lead.phone,operationId,outcome:body.callAttempt.outcome,direction:['OUTGOING','INCOMING'].includes(body.callAttempt.direction)?body.callAttempt.direction:undefined,endedAt:body.callAttempt.endedAt,duration:Math.max(0,Number(body.callAttempt.duration)||0),remark:String(body.remark||'')}],{session});
  [event]=await Activity.create([{lead:lead._id,actor:req.user._id,type:body.callAttempt?'call':'updated',operationId,details:{appliedVersion:lead.version,assignmentVersion:lead.assignmentVersion,fromStatus:before,toStatus:lead.status,changedFields,remark:String(body.remark||''),callStatus:lead.callStatus,leadCategory:lead.leadCategory,activity:lead.activity,followUpAt:lead.followUpAt,callAttempt:body.callAttempt?{outcome:body.callAttempt.outcome,direction:lead.lastCallDirection,endedAt:body.callAttempt.endedAt,duration:Math.max(0,Number(body.callAttempt.duration)||0)}:undefined}}],{session});
 });
 res.json({lead,event,message:'Synced'});
}
async function recordCall(req,res) {
 const body=req.body,operationId=String(body.operationId||'');
 cleanRemark(body);
 const phone=require('../services/leadValidation').normalizePhone(body.phone);
 if(!phone||!outcomes.includes(body.callAttempt?.outcome)||!/^[a-zA-Z0-9_-]{8,100}$/.test(operationId))fail(400,'A valid phone number, unique operation ID and call outcome are required');
 const call=await CallAttempt.findOneAndUpdate({actor:req.user._id,operationId},{$setOnInsert:{phone,outcome:body.callAttempt.outcome,callStatus:body.callStatus,leadCategory:body.leadCategory,activity:body.activity,followUpAt:body.followUpAt||null,direction:body.callAttempt.direction,endedAt:body.callAttempt.endedAt,duration:Math.max(0,Number(body.callAttempt.duration)||0),remark:body.remark||''}},{upsert:true,new:true,runValidators:true});
 res.json({call,lead:{version:body.version+1,assignmentVersion:0},message:'Call outcome synced'});
}
function csvCell(value){const text=String(value??'');return '"'+(/^[=+\-@\t\r]/.test(text)?"'":'')+text.replace(/"/g,'""')+'"';}
async function exportRejected(req,res) {
 const filter={...scope(req),state:'rejected'};
 if(req.query.batch){if(!validId(req.query.batch))fail(400,'Invalid import batch');filter.importBatch=req.query.batch;}
 res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition','attachment; filename="rejected-leads.csv"');
 res.write('\uFEFF'+[...fields.map(([,header])=>header),'Rejection Reasons','Source Row'].map(csvCell).join(',')+'\r\n');
 const cursor=Rejected.find(filter).lean().cursor();
 for await(const row of cursor){if(res.destroyed)break;const raw=validateRow(row.raw).raw;const line=[...fields.map(([name])=>raw[name]),row.errors.join('; '),row.sourceRow].map(csvCell).join(',')+'\r\n';if(!res.write(line))await require('events').once(res,'drain');}
 res.end();
}
module.exports={duplicateMatches,recordCall,detail,importLeads,manualLead,listLeads,listAssignedLeads,listImports,stats,groups,rejectedLeads,resubmit,assign,workload,history,updateLead,exportRejected};
